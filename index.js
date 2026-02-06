// Custom Thread Builder Plugin for SillyTavern
// Builds custom prompt threads with configurable formatting

import { chat, chat_metadata, saveMetadataDebounced } from "../../../../script.js";
import { extension_settings } from "../../../extensions.js";

const extensionName = "custom-thread-builder";

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
    excludeLastUserMessage: false,
    regexRules: []
};

// ============================================
// SETTINGS MANAGEMENT
// ============================================

function getConfig() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = {};
    }

    // Return merged defaults + saved settings
    return Object.assign({}, defaultSettings, extension_settings[extensionName]);
}

function saveSetting(key, value) {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = {};
    }
    extension_settings[extensionName][key] = value;
    saveMetadataDebounced();
}

// ============================================
// REGEX ENGINE
// ============================================

function applyRegexRules(text, isUser) {
    const config = getConfig();
    const rules = config.regexRules || [];

    for (const rule of rules) {
        if (!rule.enabled) continue;

        // Check if rule applies to this message type
        if (rule.appliesTo === "user" && !isUser) continue;
        if (rule.appliesTo === "assistant" && isUser) continue;
        // "both" applies to everything

        try {
            const flags = rule.flags || "g";
            const regex = new RegExp(rule.pattern, flags);
            text = text.replace(regex, rule.replacement);
        } catch (e) {
            console.warn(`[${extensionName}] Invalid regex pattern: ${rule.pattern}`, e);
        }
    }

    return text;
}

// ============================================
// TOKEN ESTIMATION
// ============================================

function estimateTokens(text) {
    const config = getConfig();
    const charsPerToken = config.charsPerToken || 4;
    return Math.ceil(text.length / charsPerToken);
}

// ============================================
// LAST USER MESSAGE
// ============================================

function getLastUserMessage() {
    // Walk backwards through chat to find the last user message
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i].is_user) {
            return applyRegexRules(chat[i].mes, true);
        }
    }
    return "";
}

// ============================================
// CHAT HISTORY MANAGEMENT
// ============================================

// Get chat history with optional skip logic and token limit
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

    // Exclude last user message from thread if enabled
    if (config.excludeLastUserMessage && messages.length > 0) {
        // Find and remove the last user message
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

        // Start from most recent, work backwards
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            const msgTokens = estimateTokens(msg.mes);

            if (config.softTokenLimit) {
                // Soft limit: include message that crosses threshold, then stop
                limitedMessages.unshift(msg);
                totalTokens += msgTokens;

                if (totalTokens >= config.maxTokens) {
                    break;
                }
            } else {
                // Hard limit: stop before exceeding threshold
                if (totalTokens + msgTokens > config.maxTokens) {
                    break;
                }

                limitedMessages.unshift(msg);
                totalTokens += msgTokens;
            }
        }

        return limitedMessages;
    }

    return messages;
}

// ============================================
// THREAD BUILDER
// ============================================

function buildThread() {
    const config = getConfig();
    const messages = getChatHistory();
    let thread = "";

    for (const msg of messages) {
        const isUser = msg.is_user;
        const header = isUser ? config.userHeader : config.assistantHeader;
        const tag = isUser ? config.xmlUserTag : config.xmlAssistantTag;

        // Apply regex rules to message content
        let content = applyRegexRules(msg.mes, isUser);

        // Build the message block
        thread += `${header}\n<${tag}_message>${content}</${tag}_message>\n\n`;
    }

    return thread.trim();
}

// ============================================
// MACRO REGISTRATION
// ============================================

function registerMacro() {
    const macroProvider = SillyTavern.getContext().macros;
    if (macroProvider) {
        macroProvider.register(extensionName, "thread", () => buildThread());
        macroProvider.register(extensionName, "lastMessage", () => getLastUserMessage());
        console.log(`[${extensionName}] Macros {{thread}} and {{lastMessage}} registered.`);
    } else {
        console.warn(`[${extensionName}] Macro provider not available.`);
    }
}

// ============================================
// SETTINGS UI
// ============================================

function createSettingsUI() {
    const config = getConfig();

    const settingsHtml = `
    <div id="cthr-settings" class="extension_settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Custom Thread Builder</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">

                <h4>Names</h4>
                <label for="cthr-userName">User Name</label>
                <input id="cthr-userName" class="text_pole" type="text" value="${config.userName}" />

                <label for="cthr-assistantName">Assistant Name</label>
                <input id="cthr-assistantName" class="text_pole" type="text" value="${config.assistantName}" />

                <hr />
                <h4>Headers</h4>
                <label for="cthr-userHeader">User Header</label>
                <input id="cthr-userHeader" class="text_pole" type="text" value="${config.userHeader}" />

                <label for="cthr-assistantHeader">Assistant Header</label>
                <input id="cthr-assistantHeader" class="text_pole" type="text" value="${config.assistantHeader}" />

                <hr />
                <h4>XML Tags</h4>
                <label for="cthr-xmlUserTag">User XML Tag Name</label>
                <input id="cthr-xmlUserTag" class="text_pole" type="text" value="${config.xmlUserTag}" />

                <label for="cthr-xmlAssistantTag">Assistant XML Tag Name</label>
                <input id="cthr-xmlAssistantTag" class="text_pole" type="text" value="${config.xmlAssistantTag}" />

                <hr />
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
                    <input id="cthr-excludeLastUserMessage" type="checkbox" />
                    <span>Exclude last user message from thread (use {{lastMessage}} separately)</span>
                </label>

                <label for="cthr-maxTokens">Max Tokens (0 = unlimited)</label>
                <input id="cthr-maxTokens" class="text_pole" type="number" min="0" value="${config.maxTokens}" />

                <label for="cthr-charsPerToken">Characters per Token (for estimation)</label>
                <input id="cthr-charsPerToken" class="text_pole" type="number" min="1" value="${config.charsPerToken}" />

                <hr />
                <h4>Regex Rules</h4>
                <div id="cthr-regexList"></div>
                <div class="menu_button" id="cthr-addRegex">+ Add Regex Rule</div>

                <hr />
                <h4>Available Macros</h4>
                <p style="color:#aaa; font-size:0.9em;">
                    <code>{{thread}}</code> — Full formatted chat history<br/>
                    <code>{{lastMessage}}</code> — Last user message (with regex applied)
                </p>

                <hr />
                <h4>Preview</h4>
                <div style="display:flex; gap:8px;">
                    <div class="menu_button" id="cthr-preview">Preview Thread</div>
                    <div class="menu_button" id="cthr-previewLastMsg">Preview Last Message</div>
                </div>
                <pre id="cthr-previewOutput" style="display:none; max-height:300px; overflow-y:auto; background:#1a1a1a; padding:8px; border-radius:4px; font-size:0.85em; white-space:pre-wrap;"></pre>

            </div>
        </div>
    </div>`;

    $("#extensions_settings2").append(settingsHtml);

    // Load checkbox states
    $("#cthr-skipLastAssistant").prop("checked", config.skipLastAssistant);
    $("#cthr-softTokenLimit").prop("checked", config.softTokenLimit);
    $("#cthr-excludeLastUserMessage").prop("checked", config.excludeLastUserMessage);

    // --- Event Handlers ---

    // Text inputs
    $("#cthr-userName").on("input", function() { saveSetting("userName", $(this).val()); });
    $("#cthr-assistantName").on("input", function() { saveSetting("assistantName", $(this).val()); });
    $("#cthr-userHeader").on("input", function() { saveSetting("userHeader", $(this).val()); });
    $("#cthr-assistantHeader").on("input", function() { saveSetting("assistantHeader", $(this).val()); });
    $("#cthr-xmlUserTag").on("input", function() { saveSetting("xmlUserTag", $(this).val()); });
    $("#cthr-xmlAssistantTag").on("input", function() { saveSetting("xmlAssistantTag", $(this).val()); });

    // Number inputs
    $("#cthr-maxTokens").on("input", function() { saveSetting("maxTokens", parseInt($(this).val()) || 0); });
    $("#cthr-charsPerToken").on("input", function() { saveSetting("charsPerToken", parseInt($(this).val()) || 4); });

    // Checkboxes
    $("#cthr-skipLastAssistant").on("change", function() { saveSetting("skipLastAssistant", $(this).is(":checked")); });
    $("#cthr-softTokenLimit").on("change", function() { saveSetting("softTokenLimit", $(this).is(":checked")); });
    $("#cthr-excludeLastUserMessage").on("change", function() { saveSetting("excludeLastUserMessage", $(this).is(":checked")); });

    // Regex
    $("#cthr-addRegex").on("click", addRegexRule);
    renderRegexRules();

    // Preview
    $("#cthr-preview").on("click", function() {
        const output = $("#cthr-previewOutput");
        output.text(buildThread());
        output.show();
    });

    $("#cthr-previewLastMsg").on("click", function() {
        const output = $("#cthr-previewOutput");
        const lastMsg = getLastUserMessage();
        output.text(lastMsg || "(No user message found)");
        output.show();
    });
}

// ============================================
// REGEX UI
// ============================================

function renderRegexRules() {
    const config = getConfig();
    const container = $("#cthr-regexList");
    container.empty();

    if (!config.regexRules || config.regexRules.length === 0) {
        container.append('<p style="color:#888; font-style:italic;">No regex rules defined.</p>');
        return;
    }

    config.regexRules.forEach((rule, index) => {
        const ruleHtml = `
        <div class="cthr-regex-rule" style="border:1px solid #444; padding:8px; margin-bottom:8px; border-radius:4px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <label class="checkbox_label" style="margin:0;">
                    <input type="checkbox" class="cthr-regex-enabled" data-index="${index}" ${rule.enabled ? "checked" : ""} />
                    <span>Enabled</span>
                </label>
                <div class="menu_button cthr-regex-delete" data-index="${index}" style="color:#f66;">✕ Delete</div>
            </div>
            <input class="text_pole cthr-regex-pattern" data-index="${index}" type="text" placeholder="Pattern (regex)" value="${(rule.pattern || "").replace(/"/g, """)}" />
            <input class="text_pole cthr-regex-replacement" data-index="${index}" type="text" placeholder="Replacement" value="${(rule.replacement || "").replace(/"/g, """)}" />
            <div style="display:flex; gap:8px; margin-top:4px;">
                <input class="text_pole cthr-regex-flags" data-index="${index}" type="text" placeholder="Flags" value="${rule.flags || "g"}" style="width:60px;" />
                <select class="cthr-regex-applies" data-index="${index}">
                    <option value="both" ${rule.appliesTo === "both" ? "selected" : ""}>Both</option>
                    <option value="user" ${rule.appliesTo === "user" ? "selected" : ""}>User only</option>
                    <option value="assistant" ${rule.appliesTo === "assistant" ? "selected" : ""}>Assistant only</option>
                </select>
            </div>
        </div>`;
        container.append(ruleHtml);
    });

    // Bind regex rule events
    $(".cthr-regex-enabled").on("change", function() {
        const i = $(this).data("index");
        config.regexRules[i].enabled = $(this).is(":checked");
        saveSetting("regexRules", config.regexRules);
    });

    $(".cthr-regex-pattern").on("input", function() {
        const i = $(this).data("index");
        config.regexRules[i].pattern = $(this).val();
        saveSetting("regexRules", config.regexRules);
    });

    $(".cthr-regex-replacement").on("input", function() {
        const i = $(this).data("index");
        config.regexRules[i].replacement = $(this).val();
        saveSetting("regexRules", config.regexRules);
    });

    $(".cthr-regex-flags").on("input", function() {
        const i = $(this).data("index");
        config.regexRules[i].flags = $(this).val();
        saveSetting("regexRules", config.regexRules);
    });

    $(".cthr-regex-applies").on("change", function() {
        const i = $(this).data("index");
        config.regexRules[i].appliesTo = $(this).val();
        saveSetting("regexRules", config.regexRules);
    });

    $(".cthr-regex-delete").on("click", function() {
        const i = $(this).data("index");
        config.regexRules.splice(i, 1);
        saveSetting("regexRules", config.regexRules);
        renderRegexRules();
    });
}

function addRegexRule() {
    const config = getConfig();
    if (!config.regexRules) config.regexRules = [];

    config.regexRules.push({
        pattern: "",
        replacement: "",
        flags: "g",
        appliesTo: "both",
        enabled: true
    });

    saveSetting("regexRules", config.regexRules);
    renderRegexRules();
}

// ============================================
// INITIALIZATION
// ============================================

jQuery(async () => {
    createSettingsUI();
    registerMacro();
    console.log(`[${extensionName}] Plugin loaded.`);
});
