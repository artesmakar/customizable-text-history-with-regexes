// ==============================================================
// Custom Template Handler (Regex) — SillyTavern Plugin
// ==============================================================
// Builds a custom system prompt by combining a template with
// formatted chat history. Every message is wrapped in XML-style
// tags and prefixed with a configurable header.
//
// Key features
// ─────────────────────────────────────────────────────────────
//  • Per-role XML tags and headers (Student / Teacher, etc.)
//  • Ordered regex rules (find → replace) applied to every message
//  • "Skip last assistant message" toggle (fixes the swipe bug
//    where the previous, discarded reply would leak into context)
//  • Token-based history limit with hard/soft modes
//  • {{lastMessage}} macro for user's last message
//  • Toggle to remove last user message from history
//  • Works as an iframe extension; all settings saved via
//    SillyTavern's extension API.
// ==============================================================

(function () {
    // ──────────────────────────────────────────────────────────
    // Default configuration
    // ──────────────────────────────────────────────────────────
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

    const extensionName = "custom-template-handler-regex";
    let settings = {};
    let chat = [];

    // ──────────────────────────────────────────────────────────
    // SillyTavern helper references
    // ──────────────────────────────────────────────────────────
    const { saveSettingsDebounced, eventSource, event_types } = SillyTavern.getContext();

    // ──────────────────────────────────────────────────────────
    // Settings helpers
    // ──────────────────────────────────────────────────────────
    function getConfig() {
        return Object.assign({}, defaultSettings, settings);
    }

    function saveSetting(key, value) {
        settings[key] = value;
        const ctx = SillyTavern.getContext();
        ctx.extensionSettings[extensionName] = settings;
        saveSettingsDebounced();
    }

    // ──────────────────────────────────────────────────────────
    // Token estimation
    // ──────────────────────────────────────────────────────────
    function estimateTokens(text) {
        const config = getConfig();
        if (!text) return 0;
        return Math.ceil(text.length / config.charsPerToken);
    }

    // ──────────────────────────────────────────────────────────
    // Chat history builder
    // ──────────────────────────────────────────────────────────
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
        if (config.removeLastUserFromHistory && messages.length > 0) {
            // Find last user message from the end
            for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].is_user) {
                    messages = [...messages.slice(0, i), ...messages.slice(i + 1)];
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

    // ──────────────────────────────────────────────────────────
    // Get last user message (for {{lastMessage}} macro)
    // ──────────────────────────────────────────────────────────
    function getLastUserMessage() {
        for (let i = chat.length - 1; i >= 0; i--) {
            if (chat[i].is_user) {
                return chat[i].mes || "";
            }
        }
        return "";
    }

    // ──────────────────────────────────────────────────────────
    // Apply regex rules to a single message
    // ──────────────────────────────────────────────────────────
    function applyRegex(text, rules) {
        let result = text;
        for (const rule of rules) {
            if (!rule.find) continue;
            try {
                const regex = new RegExp(rule.find, "gi");
                result = result.replace(regex, rule.replace || "");
            } catch (e) {
                console.warn("[CTHR] Invalid regex:", rule.find, e);
            }
        }
        return result;
    }

    // ──────────────────────────────────────────────────────────
    // Build the formatted chat history string
    // ──────────────────────────────────────────────────────────
    function buildFormattedHistory() {
        const config = getConfig();
        const messages = getChatHistory();

        return messages.map(msg => {
            const isUser = msg.is_user;
            const name = isUser ? config.userName : config.assistantName;
            const header = isUser ? config.userHeader : config.assistantHeader;
            const tag = isUser ? config.xmlUserTag : config.xmlAssistantTag;

            let content = msg.mes || "";

            // Apply regex rules
            if (config.regexRules && config.regexRules.length > 0) {
                content = applyRegex(content, config.regexRules);
            }

            return `<${tag}_message>${header}\n**${name}:**\n${content}</${tag}_message>`;
        }).join("\n\n");
    }

    // ──────────────────────────────────────────────────────────
    // Main injection — runs before every prompt is sent
    // ──────────────────────────────────────────────────────────
    function onPromptReady(eventData) {
        try {
            const ctx = SillyTavern.getContext();
            chat = ctx.chat || [];

            const history = buildFormattedHistory();
            const lastMessage = getLastUserMessage();

            // Replace {{history}} and {{lastMessage}} macros in every prompt section
            if (eventData && eventData.messages) {
                eventData.messages = eventData.messages.map(msg => {
                    if (msg.content) {
                        msg.content = msg.content.replace(/\{\{history\}\}/gi, history);
                        msg.content = msg.content.replace(/\{\{lastMessage\}\}/gi, lastMessage);
                    }
                    return msg;
                });
            }
        } catch (err) {
            console.error("[CTHR] Error:", err);
        }
    }

    // ──────────────────────────────────────────────────────────
    // Settings UI
    // ──────────────────────────────────────────────────────────
    function createSettingsUI() {
        const config = getConfig();

        const html = `
        <div class="cthr-settings" style="padding:10px;">
            <h3>Custom Template Handler (Regex)</h3>
            <hr>

            <h4>Role Names</h4>
            <label>User Name
                <input id="cthr-userName" class="text_pole" type="text" value="${config.userName}" />
            </label>
            <label>Assistant Name
                <input id="cthr-assistantName" class="text_pole" type="text" value="${config.assistantName}" />
            </label>

            <h4>Headers</h4>
            <label>User Header
                <input id="cthr-userHeader" class="text_pole" type="text" value="${config.userHeader}" />
            </label>
            <label>Assistant Header
                <input id="cthr-assistantHeader" class="text_pole" type="text" value="${config.assistantHeader}" />
            </label>

            <h4>XML Tags</h4>
            <label>User Tag
                <input id="cthr-xmlUserTag" class="text_pole" type="text" value="${config.xmlUserTag}" />
            </label>
            <label>Assistant Tag
                <input id="cthr-xmlAssistantTag" class="text_pole" type="text" value="${config.xmlAssistantTag}" />
            </label>

            <h4>History Limits</h4>
            <label>Max Tokens (0 = unlimited)
                <input id="cthr-maxTokens" class="text_pole" type="number" min="0" value="${config.maxTokens}" />
            </label>
            <label>Characters per Token (estimation)
                <input id="cthr-charsPerToken" class="text_pole" type="number" min="1" value="${config.charsPerToken}" />
            </label>

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

            <h4>Regex Rules</h4>
            <div id="cthr-regexRules"></div>
            <button id="cthr-addRule" class="menu_button">+ Add Rule</button>
        </div>
        `;

        $("#extensions_settings2").append(html);

        // Load saved values
        $("#cthr-skipLastAssistant").prop("checked", config.skipLastAssistant);
        $("#cthr-softTokenLimit").prop("checked", config.softTokenLimit);
        $("#cthr-removeLastUserFromHistory").prop("checked", config.removeLastUserFromHistory);

        // Event handlers — text fields
        $("#cthr-userName").on("input", function () { saveSetting("userName", $(this).val()); });
        $("#cthr-assistantName").on("input", function () { saveSetting("assistantName", $(this).val()); });
        $("#cthr-userHeader").on("input", function () { saveSetting("userHeader", $(this).val()); });
        $("#cthr-assistantHeader").on("input", function () { saveSetting("assistantHeader", $(this).val()); });
        $("#cthr-xmlUserTag").on("input", function () { saveSetting("xmlUserTag", $(this).val()); });
        $("#cthr-xmlAssistantTag").on("input", function () { saveSetting("xmlAssistantTag", $(this).val()); });
        $("#cthr-maxTokens").on("input", function () { saveSetting("maxTokens", parseInt($(this).val()) || 0); });
        $("#cthr-charsPerToken").on("input", function () { saveSetting("charsPerToken", parseInt($(this).val()) || 4); });

        // Event handlers — checkboxes
        $("#cthr-skipLastAssistant").on("change", function () { saveSetting("skipLastAssistant", $(this).is(":checked")); });
        $("#cthr-softTokenLimit").on("change", function () { saveSetting("softTokenLimit", $(this).is(":checked")); });
        $("#cthr-removeLastUserFromHistory").on("change", function () { saveSetting("removeLastUserFromHistory", $(this).is(":checked")); });

        // Regex rules
        $("#cthr-addRule").on("click", function () {
            const rules = settings.regexRules || [];
            rules.push({ find: "", replace: "" });
            saveSetting("regexRules", rules);
            renderRegexRules();
        });

        renderRegexRules();
    }

    // ──────────────────────────────────────────────────────────
    // Regex rule list UI
    // ──────────────────────────────────────────────────────────
    function renderRegexRules() {
        const rules = settings.regexRules || [];
        const container = $("#cthr-regexRules");
        container.empty();

        rules.forEach((rule, index) => {
            const ruleHtml = `
            <div class="cthr-rule" style="border:1px solid #555; padding:8px; margin:5px 0; border-radius:5px; position:relative;">
                <div style="display:flex; gap:5px; align-items:center; margin-bottom:5px;">
                    <span style="font-weight:bold;">Rule ${index + 1}</span>
                    <button class="cthr-moveUp menu_button" data-index="${index}" style="padding:2px 6px;" title="Move Up">▲</button>
                    <button class="cthr-moveDown menu_button" data-index="${index}" style="padding:2px 6px;" title="Move Down">▼</button>
                    <button class="cthr-deleteRule menu_button" data-index="${index}" style="padding:2px 6px; margin-left:auto;" title="Delete">✕</button>
                </div>
                <label>Find (regex)
                    <input class="cthr-ruleFind text_pole" data-index="${index}" type="text" value="${(rule.find || '').replace(/"/g, '"')}" />
                </label>
                <label>Replace with
                    <input class="cthr-ruleReplace text_pole" data-index="${index}" type="text" value="${(rule.replace || '').replace(/"/g, '"')}" />
                </label>
            </div>
            `;
            container.append(ruleHtml);
        });

        // Rule event handlers
        $(".cthr-ruleFind").on("input", function () {
            const idx = $(this).data("index");
            rules[idx].find = $(this).val();
            saveSetting("regexRules", rules);
        });

        $(".cthr-ruleReplace").on("input", function () {
            const idx = $(this).data("index");
            rules[idx].replace = $(this).val();
            saveSetting("regexRules", rules);
        });

        $(".cthr-deleteRule").on("click", function () {
            const idx = $(this).data("index");
            rules.splice(idx, 1);
            saveSetting("regexRules", rules);
            renderRegexRules();
        });

        $(".cthr-moveUp").on("click", function () {
            const idx = $(this).data("index");
            if (idx > 0) {
                [rules[idx - 1], rules[idx]] = [rules[idx], rules[idx - 1]];
                saveSetting("regexRules", rules);
                renderRegexRules();
            }
        });

        $(".cthr-moveDown").on("click", function () {
            const idx = $(this).data("index");
            if (idx < rules.length - 1) {
                [rules[idx], rules[idx + 1]] = [rules[idx + 1], rules[idx]];
                saveSetting("regexRules", rules);
                renderRegexRules();
            }
        });
    }

    // ──────────────────────────────────────────────────────────
    // Initialisation
    // ──────────────────────────────────────────────────────────
    function init() {
        const ctx = SillyTavern.getContext();

        // Load saved settings
        if (ctx.extensionSettings[extensionName]) {
            settings = ctx.extensionSettings[extensionName];
        } else {
            settings = Object.assign({}, defaultSettings);
            ctx.extensionSettings[extensionName] = settings;
            saveSettingsDebounced();
        }

        createSettingsUI();

        // Hook into the chat completion event
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, onPromptReady);

        console.log("[CTHR] Custom Template Handler (Regex) loaded.");
    }

    init();
})();
