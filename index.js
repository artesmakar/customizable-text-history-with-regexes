import { chat } from "../../../../script.js";
import { MacrosParser } from "../../../macros.js";
import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const extensionName = "customizable-text-history-with-regexes";

// Default settings
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
    regexRules: []
};

function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};

    for (const [key, value] of Object.entries(defaultSettings)) {
        if (extension_settings[extensionName][key] === undefined) {
            extension_settings[extensionName][key] = Array.isArray(value) ? [...value] : value;
        }
    }
}

function getConfig() {
    return extension_settings[extensionName];
}

function saveSetting(key, value) {
    extension_settings[extensionName][key] = value;
    saveSettingsDebounced();
}

function saveAllSettings() {
    saveSettingsDebounced();
}

// Estimate token count (synchronous)
function estimateTokens(text) {
    const config = getConfig();
    return Math.ceil(text.length / config.charsPerToken);
}

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

    // Apply token limit (0 = unlimited)
    if (config.maxTokens > 0) {
        const limitedMessages = [];
        let totalTokens = 0;

        // Start from most recent, work backwards
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            const msgTokens = estimateTokens(msg.mes);

            if (totalTokens + msgTokens > config.maxTokens) {
                break;
            }

            limitedMessages.unshift(msg);
            totalTokens += msgTokens;
        }

        return limitedMessages;
    }

    return messages;
}

// Apply all regex rules to text
function applyRegexRules(text) {
    const rules = getConfig().regexRules || [];
    let result = text;

    for (const rule of rules) {
        if (!rule.enabled || !rule.findRegex) continue;

        try {
            const regex = new RegExp(rule.findRegex, 'g');
            result = result.replace(regex, rule.replaceWith || '');

            if (rule.trimOut) {
                const trimPatterns = rule.trimOut.split('\n').filter(p => p.trim());
                for (const pattern of trimPatterns) {
                    try {
                        const trimRegex = new RegExp(pattern, 'g');
                        result = result.replace(trimRegex, '');
                    } catch (e) {
                        console.warn(`[CTH-R] Invalid trim pattern: ${pattern}`, e);
                    }
                }
            }
        } catch (e) {
            console.warn(`[CTH-R] Invalid regex in rule "${rule.name}":`, e);
        }
    }

    return result;
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function renderRegexRules() {
    const container = $("#cthr-regex-rules");
    container.empty();

    const rules = getConfig().regexRules || [];

    if (rules.length === 0) {
        container.append('<div class="cthr-no-rules">No regex rules yet. Click "Add Rule" to create one.</div>');
        return;
    }

    for (const rule of rules) {
        const ruleHtml = `
        <div class="cthr-rule" data-id="${rule.id}">
            <div class="cthr-rule-header">
                <input type="checkbox" class="cthr-rule-enabled" ${rule.enabled ? 'checked' : ''} title="Enable/Disable" />
                <input type="text" class="cthr-rule-name text_pole" value="${escapeHtml(rule.name)}" placeholder="Rule name" />
                <button class="cthr-rule-delete menu_button" title="Delete rule">
                    <i class="fa-solid fa-trash"></i>
                </button>
                <button class="cthr-rule-toggle menu_button" title="Expand/Collapse">
                    <i class="fa-solid fa-chevron-down"></i>
                </button>
            </div>
            <div class="cthr-rule-body">
                <label>
                    Find Regex:
                    <input type="text" class="cthr-rule-find text_pole" value="${escapeHtml(rule.findRegex)}" placeholder="Regular expression" />
                </label>
                <label>
                    Replace With:
                    <textarea class="cthr-rule-replace text_pole" placeholder="Use $1, $2 for capture groups...">${escapeHtml(rule.replaceWith)}</textarea>
                </label>
                <label>
                    Trim Out (one pattern per line):
                    <textarea class="cthr-rule-trim text_pole" placeholder="Additional patterns to remove...">${escapeHtml(rule.trimOut)}</textarea>
                </label>
            </div>
        </div>`;
        container.append(ruleHtml);
    }

    $(".cthr-rule-enabled").off("change").on("change", function() {
        const id = $(this).closest(".cthr-rule").data("id");
        updateRule(id, "enabled", $(this).is(":checked"));
    });

    $(".cthr-rule-name").off("input").on("input", function() {
        const id = $(this).closest(".cthr-rule").data("id");
        updateRule(id, "name", $(this).val());
    });

    $(".cthr-rule-find").off("input").on("input", function() {
        const id = $(this).closest(".cthr-rule").data("id");
        updateRule(id, "findRegex", $(this).val());
    });

    $(".cthr-rule-replace").off("input").on("input", function() {
        const id = $(this).closest(".cthr-rule").data("id");
        updateRule(id, "replaceWith", $(this).val());
    });

    $(".cthr-rule-trim").off("input").on("input", function() {
        const id = $(this).closest(".cthr-rule").data("id");
        updateRule(id, "trimOut", $(this).val());
    });

    $(".cthr-rule-delete").off("click").on("click", function() {
        const id = $(this).closest(".cthr-rule").data("id");
        deleteRule(id);
    });

    $(".cthr-rule-toggle").off("click").on("click", function() {
        $(this).closest(".cthr-rule").toggleClass("collapsed");
        $(this).find("i").toggleClass("fa-chevron-down fa-chevron-right");
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');
}

function addRule() {
    const rules = getConfig().regexRules;
    rules.push({
        id: generateId(),
        name: `Rule ${rules.length + 1}`,
        enabled: true,
        findRegex: '',
        replaceWith: '',
        trimOut: ''
    });
    saveAllSettings();
    renderRegexRules();
}

function updateRule(id, field, value) {
    const rules = getConfig().regexRules;
    const rule = rules.find(r => r.id === id);
    if (rule) {
        rule[field] = value;
        saveAllSettings();
    }
}

function deleteRule(id) {
    const config = getConfig();
    config.regexRules = config.regexRules.filter(r => r.id !== id);
    saveAllSettings();
    renderRegexRules();
}

function createSettingsUI() {
    const html = `
    <div id="cthr-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Customizable Text History (Regex)</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="cthr-settings-block">
                    <h4>Names (for colon/numbered styles)</h4>
                    <label>
                        User Name:
                        <input id="cthr-userName" type="text" class="text_pole" />
                    </label>
                    <label>
                        Assistant Name:
                        <input id="cthr-assistantName" type="text" class="text_pole" />
                    </label>

                    <h4>Headers (for header style)</h4>
                    <label>
                        User Header:
                        <input id="cthr-userHeader" type="text" class="text_pole" />
                    </label>
                    <label>
                        Assistant Header:
                        <input id="cthr-assistantHeader" type="text" class="text_pole" />
                    </label>

                    <h4>XML Tags (for xml style)</h4>
                    <label>
                        User Tag:
                        <input id="cthr-xmlUserTag" type="text" class="text_pole" />
                    </label>
                    <label>
                        Assistant Tag:
                        <input id="cthr-xmlAssistantTag" type="text" class="text_pole" />
                    </label>

                    <hr />

                    <h4>Options</h4>
                    <label class="checkbox_label">
                        <input id="cthr-skipLastAssistant" type="checkbox" />
                        <span>Skip last assistant message (fixes swipe issue)</span>
                    </label>

                    <label>
                        Max Tokens (0 = unlimited):
                        <input id="cthr-maxTokens" type="number" class="text_pole" min="0" step="100" />
                    </label>

                    <label>
                        Chars per Token (for estimation):
                        <input id="cthr-charsPerToken" type="number" class="text_pole" min="1" max="10" step="0.5" />
                    </label>
                    <p class="cthr-hint">Token count is estimated as: characters ÷ chars-per-token. Default 4 works well for English.</p>

                    <hr />

                    <h4>Regex Rules</h4>
                    <p class="cthr-hint">These rules are applied to all history macros in order.</p>
                    <div id="cthr-regex-rules"></div>
                    <button id="cthr-add-rule" class="menu_button">
                        <i class="fa-solid fa-plus"></i> Add Rule
                    </button>

                    <hr />
                    <div class="cthr-macros">
                        <b>Available Macros:</b>
                        <code>{{headerHistoryR}}</code>
                        <code>{{colonHistoryR}}</code>
                        <code>{{xmlHistoryR}}</code>
                        <code>{{bracketHistoryR}}</code>
                        <code>{{numberedHistoryR}}</code>
                        <code>{{quoteHistoryR}}</code>
                        <code>{{lastNR::5}}</code>
                        <code>{{rawHistoryR}}</code>
                    </div>
                </div>
            </div>
        </div>
    </div>`;

    const containers = [
        "#extensions_settings2",
        "#extensions_settings",
        "#extensions_settings_content"
    ];

    let appended = false;
    for (const selector of containers) {
        const container = $(selector);
        if (container.length > 0) {
            container.append(html);
            console.log(`[CTH-R] Settings appended to ${selector}`);
            appended = true;
            break;
        }
    }

    if (!appended) {
        console.error("[CTH-R] Could not find settings container!");
        return;
    }

    const config = getConfig();
    $("#cthr-userName").val(config.userName);
    $("#cthr-assistantName").val(config.assistantName);
    $("#cthr-userHeader").val(config.userHeader);
    $("#cthr-assistantHeader").val(config.assistantHeader);
    $("#cthr-xmlUserTag").val(config.xmlUserTag);
    $("#cthr-xmlAssistantTag").val(config.xmlAssistantTag);
    $("#cthr-skipLastAssistant").prop("checked", config.skipLastAssistant);
    $("#cthr-maxTokens").val(config.maxTokens);
    $("#cthr-charsPerToken").val(config.charsPerToken);

    $("#cthr-userName").on("input", function() { saveSetting("userName", $(this).val()); });
    $("#cthr-assistantName").on("input", function() { saveSetting("assistantName", $(this).val()); });
    $("#cthr-userHeader").on("input", function() { saveSetting("userHeader", $(this).val()); });
    $("#cthr-assistantHeader").on("input", function() { saveSetting("assistantHeader", $(this).val()); });
    $("#cthr-xmlUserTag").on("input", function() { saveSetting("xmlUserTag", $(this).val()); });
    $("#cthr-xmlAssistantTag").on("input", function() { saveSetting("xmlAssistantTag", $(this).val()); });
    $("#cthr-skipLastAssistant").on("change", function() { saveSetting("skipLastAssistant", $(this).is(":checked")); });
    $("#cthr-maxTokens").on("input", function() { saveSetting("maxTokens", parseInt($(this).val()) || 0); });
    $("#cthr-charsPerToken").on("input", function() { saveSetting("charsPerToken", parseFloat($(this).val()) || 4); });

    $("#cthr-add-rule").on("click", addRule);

    renderRegexRules();
}

function registerMacros() {
    MacrosParser.registerMacro('headerHistoryR', () => {
        const c = getConfig();
        const messages = getChatHistory();
        const raw = messages.map(msg => {
            const header = msg.is_user ? c.userHeader : c.assistantHeader;
            return `${header}\n${msg.mes}`;
        }).join('\n\n');
        return applyRegexRules(raw);
    });

    MacrosParser.registerMacro('colonHistoryR', () => {
        const c = getConfig();
        const messages = getChatHistory();
        const raw = messages.map(msg => {
            const name = msg.is_user ? c.userName : c.assistantName;
            return `${name}: ${msg.mes}`;
        }).join('\n\n');
        return applyRegexRules(raw);
    });

    MacrosParser.registerMacro('xmlHistoryR', () => {
        const c = getConfig();
        const messages = getChatHistory();
        const raw = messages.map(msg => {
            const tag = msg.is_user ? c.xmlUserTag : c.xmlAssistantTag;
            return `<${tag}>\n${msg.mes}\n</${tag}>`;
        }).join('\n\n');
        return applyRegexRules(raw);
    });

    MacrosParser.registerMacro('bracketHistoryR', () => {
        const c = getConfig();
        const messages = getChatHistory();
        const raw = messages.map(msg => {
            const name = msg.is_user ? c.userName : c.assistantName;
            return `[${name}]\n${msg.mes}\n[/${name}]`;
        }).join('\n\n');
        return applyRegexRules(raw);
    });

    MacrosParser.registerMacro('numberedHistoryR', () => {
        const c = getConfig();
        const messages = getChatHistory();
        const raw = messages.map((msg, i) => {
            const name = msg.is_user ? c.userName : c.assistantName;
            return `${i + 1}. ${name}: ${msg.mes}`;
        }).join('\n\n');
        return applyRegexRules(raw);
    });

    MacrosParser.registerMacro('quoteHistoryR', () => {
        const c = getConfig();
        const messages = getChatHistory();
        const raw = messages.map(msg => {
            const name = msg.is_user ? c.userName : c.assistantName;
            const quoted = msg.mes.split('\n').map(line => `> ${line}`).join('\n');
            return `**${name}:**\n${quoted}`;
        }).join('\n\n');
        return applyRegexRules(raw);
    });

    MacrosParser.registerMacro('lastNR', (args) => {
        const c = getConfig();
        const n = parseInt(args) || 10;
        const messages = getChatHistory();
        const raw = messages.slice(-n).map(msg => {
            const name = msg.is_user ? c.userName : c.assistantName;
            return `${name}: ${msg.mes}`;
        }).join('\n\n');
        return applyRegexRules(raw);
    });

    MacrosParser.registerMacro('rawHistoryR', () => {
        const messages = getChatHistory();
        const raw = messages.map(msg => msg.mes).join('\n\n---\n\n');
        return applyRegexRules(raw);
    });
}

jQuery(async () => {
    loadSettings();
    createSettingsUI();
    registerMacros();
    console.log('[Customizable Text History with Regexes] Extension loaded!');
});
