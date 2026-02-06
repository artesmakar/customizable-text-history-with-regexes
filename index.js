import { chat } from "../../../../script.js";
import { extension_settings, saveMetadataDebounced } from "../../../extensions.js";
import { MacrosParser } from "../../../macros.js";

const extensionName = "custom-threader";

const defaultSettings = {
    userName: "Student",
    assistantName: "Teacher",
    userHeader: "## Student's Turn",
    assistantHeader: "## Teacher's Turn",
    xmlUserTag: "student",
    xmlAssistantTag: "teacher",
    skipLastAssistant: true,
    maxTokens: 0,
    charsPerToken: 4,
    softTokenLimit: false,
    removeLastUserFromHistory: false,
    regexRules: []
};

function getConfig() {
    return extension_settings[extensionName] || defaultSettings;
}

function saveSetting(key, value) {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = { ...defaultSettings };
    }
    extension_settings[extensionName][key] = value;
    saveMetadataDebounced();
}

function estimateTokens(text) {
    if (!text) return 0;
    const config = getConfig();
    return Math.ceil(text.length / config.charsPerToken);
}

function applyRegex(text) {
    const config = getConfig();
    if (!config.regexRules || config.regexRules.length === 0) return text;

    let result = text;
    for (const rule of config.regexRules) {
        if (!rule.enabled) continue;
        try {
            const regex = new RegExp(rule.find, rule.flags || "g");
            result = result.replace(regex, rule.replace);
        } catch (e) {
            console.error(`[${extensionName}] Regex error:`, e);
        }
    }
    return result;
}

function getLastUserMessage() {
    if (!chat || chat.length === 0) return "";

    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i].is_user) {
            return chat[i].mes || "";
        }
    }
    return "";
}

function getChatHistory() {
    const config = getConfig();
    let messages = [...chat];

    // Skip last assistant message if enabled
    if (config.skipLastAssistant && messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        if (!lastMsg.is_user) {
            messages = messages.slice(0, -1);
        }
    }

    // Remove last user message from history if enabled
    if (config.removeLastUserFromHistory) {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].is_user) {
                messages.splice(i, 1);
                break;
            }
        }
    }

    // Apply token limit (0 = unlimited)
    if (config.maxTokens > 0) {
        const limitedMessages = [];
        let totalTokens = 0;

        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            const msgTokens = estimateTokens(msg.mes);

            if (config.softTokenLimit) {
                // Soft: include the message that crosses, then stop
                limitedMessages.unshift(msg);
                totalTokens += msgTokens;
                if (totalTokens >= config.maxTokens) break;
            } else {
                // Hard: stop before exceeding
                if (totalTokens + msgTokens > config.maxTokens) break;
                limitedMessages.unshift(msg);
                totalTokens += msgTokens;
            }
        }

        messages = limitedMessages;
    }

    // Format messages
    const formatted = messages.map(msg => {
        const isUser = msg.is_user;
        const name = isUser ? config.userName : config.assistantName;
        const header = isUser ? config.userHeader : config.assistantHeader;
        const tag = isUser ? config.xmlUserTag : config.xmlAssistantTag;

        let text = applyRegex(msg.mes || "");

        let parts = [];
        if (header) parts.push(header);
        parts.push(`${name}: ${text}`);
        let content = parts.join("\n");

        if (tag) {
            content = `<${tag}_message>\n${content}\n</${tag}_message>`;
        }

        return content;
    });

    return formatted.join("\n\n");
}

function createSettingsUI() {
    const config = getConfig();

    const html = `
    <div id="cthr-settings" class="extension_settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Custom Threader</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">

                <h4>Naming</h4>
                <label>User Name</label>
                <input id="cthr-userName" class="text_pole" type="text" value="${config.userName}" />
                <label>Assistant Name</label>
                <input id="cthr-assistantName" class="text_pole" type="text" value="${config.assistantName}" />

                <h4>Headers</h4>
                <label>User Header</label>
                <input id="cthr-userHeader" class="text_pole" type="text" value="${config.userHeader}" />
                <label>Assistant Header</label>
                <input id="cthr-assistantHeader" class="text_pole" type="text" value="${config.assistantHeader}" />

                <h4>XML Tags</h4>
                <label>User Tag (empty = no wrapping)</label>
                <input id="cthr-xmlUserTag" class="text_pole" type="text" value="${config.xmlUserTag}" />
                <label>Assistant Tag (empty = no wrapping)</label>
                <input id="cthr-xmlAssistantTag" class="text_pole" type="text" value="${config.xmlAssistantTag}" />

                <h4>Token Limit</h4>
                <label>Max Tokens (0 = unlimited)</label>
                <input id="cthr-maxTokens" class="text_pole" type="number" value="${config.maxTokens}" min="0" />
                <label>Characters per Token (estimation ratio)</label>
                <input id="cthr-charsPerToken" class="text_pole" type="number" value="${config.charsPerToken}" min="1" step="0.5" />

                <h4>Options</h4>
                <label class="checkbox_label">
                    <input id="cthr-skipLastAssistant" type="checkbox" />
                    <span>Skip last assistant message (fixes swipe issue)</span>
                </label>
                <label class="checkbox_label">
                    <input id="cthr-softTokenLimit" type="checkbox" />
                    <span>Soft token limit (include message that exceeds limit)</span>
                </label>
                <label class="checkbox_label">
                    <input id="cthr-removeLastUserFromHistory" type="checkbox" />
                    <span>Remove last user message from {{history}}</span>
                </label>

                <h4>Macros</h4>
                <div class="cthr-macro-info" style="font-size: 0.9em; margin-bottom: 10px; padding: 8px; background: var(--SmartThemeBlurTintColor); border-radius: 5px;">
                    <div><code>{{historyEXT}}</code> — formatted chat history</div>
                    <div><code>{{lastmessageEXT}}</code> — last user message (raw text)</div>
                </div>

                <h4>Regex Rules</h4>
                <div id="cthr-regexList"></div>
                <div class="cthr-regexControls" style="margin-top: 5px;">
                    <input id="cthr-regexFind" class="text_pole" type="text" placeholder="Find (regex pattern)" />
                    <input id="cthr-regexReplace" class="text_pole" type="text" placeholder="Replace with" />
                    <input id="cthr-regexFlags" class="text_pole" type="text" placeholder="Flags (default: g)" value="g" style="width: 60px;" />
                    <div id="cthr-addRegex" class="menu_button menu_button_icon" style="margin-top: 5px;">
                        <div class="fa-solid fa-plus"></div>
                        <span>Add Rule</span>
                    </div>
                </div>
            </div>
        </div>
    </div>`;

    $("#extensions_settings2").append(html);

    // Load checkbox states
    $("#cthr-skipLastAssistant").prop("checked", config.skipLastAssistant);
    $("#cthr-softTokenLimit").prop("checked", config.softTokenLimit);
    $("#cthr-removeLastUserFromHistory").prop("checked", config.removeLastUserFromHistory);

    // Text input handlers
    $("#cthr-userName").on("input", function () { saveSetting("userName", $(this).val()); });
    $("#cthr-assistantName").on("input", function () { saveSetting("assistantName", $(this).val()); });
    $("#cthr-userHeader").on("input", function () { saveSetting("userHeader", $(this).val()); });
    $("#cthr-assistantHeader").on("input", function () { saveSetting("assistantHeader", $(this).val()); });
    $("#cthr-xmlUserTag").on("input", function () { saveSetting("xmlUserTag", $(this).val()); });
    $("#cthr-xmlAssistantTag").on("input", function () { saveSetting("xmlAssistantTag", $(this).val()); });
    $("#cthr-maxTokens").on("input", function () { saveSetting("maxTokens", parseInt($(this).val()) || 0); });
    $("#cthr-charsPerToken").on("input", function () { saveSetting("charsPerToken", parseFloat($(this).val()) || 4); });

    // Checkbox handlers
    $("#cthr-skipLastAssistant").on("change", function () { saveSetting("skipLastAssistant", $(this).is(":checked")); });
    $("#cthr-softTokenLimit").on("change", function () { saveSetting("softTokenLimit", $(this).is(":checked")); });
    $("#cthr-removeLastUserFromHistory").on("change", function () { saveSetting("removeLastUserFromHistory", $(this).is(":checked")); });

    // Regex handlers
    $("#cthr-addRegex").on("click", function () {
        const find = $("#cthr-regexFind").val();
        const replace = $("#cthr-regexReplace").val();
        const flags = $("#cthr-regexFlags").val() || "g";

        if (!find) return;

        const config = getConfig();
        if (!config.regexRules) config.regexRules = [];

        config.regexRules.push({ find, replace, flags, enabled: true });
        saveSetting("regexRules", config.regexRules);

        $("#cthr-regexFind").val("");
        $("#cthr-regexReplace").val("");
        $("#cthr-regexFlags").val("g");

        renderRegexList();
    });

    renderRegexList();
}

function renderRegexList() {
    const config = getConfig();
    const container = $("#cthr-regexList");
    container.empty();

    if (!config.regexRules || config.regexRules.length === 0) {
        container.append('<div style="opacity: 0.5; font-style: italic;">No regex rules</div>');
        return;
    }

    config.regexRules.forEach((rule, index) => {
        const ruleHtml = `
        <div class="cthr-regex-rule" style="display: flex; align-items: center; gap: 5px; margin-bottom: 3px; padding: 4px; background: var(--SmartThemeBlurTintColor); border-radius: 3px;">
            <input type="checkbox" class="cthr-regexToggle" data-index="${index}" ${rule.enabled ? "checked" : ""} />
            <span style="flex: 1; font-size: 0.85em; font-family: monospace; overflow: hidden; text-overflow: ellipsis;">
                /${rule.find}/${rule.flags} → ${rule.replace || "(empty)"}
            </span>
            <div class="cthr-deleteRegex menu_button menu_button_icon" data-index="${index}" style="padding: 2px 5px;">
                <div class="fa-solid fa-trash"></div>
            </div>
        </div>`;
        container.append(ruleHtml);
    });

    $(".cthr-regexToggle").on("change", function () {
        const idx = $(this).data("index");
        const config = getConfig();
        config.regexRules[idx].enabled = $(this).is(":checked");
        saveSetting("regexRules", config.regexRules);
    });

    $(".cthr-deleteRegex").on("click", function () {
        const idx = $(this).data("index");
        const config = getConfig();
        config.regexRules.splice(idx, 1);
        saveSetting("regexRules", config.regexRules);
        renderRegexList();
    });
}

jQuery(async () => {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = { ...defaultSettings };
    }

    // Fill in any missing defaults
    for (const key in defaultSettings) {
        if (extension_settings[extensionName][key] === undefined) {
            extension_settings[extensionName][key] = defaultSettings[key];
        }
    }

    createSettingsUI();

    // Register macros
MacrosParser.registerMacro("historyEXT", () => getChatHistory());
MacrosParser.registerMacro("lastmessageEXT", () => getLastUserMessage());

    console.log(`[${extensionName}] Loaded successfully.`);
});

