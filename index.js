// Chat to Roleplay Plugin for SillyTavern
// Transforms chat messages into roleplay format with customizable XML tags

(function() {
    const extensionName = "chat-to-roleplay";
    const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

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

    let extensionSettings = {};

    // Estimate tokens based on character count
    function estimateTokens(text) {
        if (!text) return 0;
        const config = getConfig();
        const charsPerToken = config.charsPerToken || 4;
        return Math.ceil(text.length / charsPerToken);
    }

    // Get config with defaults
    function getConfig() {
        return Object.assign({}, defaultSettings, extensionSettings);
    }

    // Save a setting
    function saveSetting(key, value) {
        extensionSettings[key] = value;
        saveSettingsDebounced();
    }

    // Get chat history with optional skip logic and token limit
    function getChatHistory(excludeLastUser = false) {
        const config = getConfig();
        let messages = [...chat];

        // Skip last assistant message if enabled
        if (config.skipLastAssistant && messages.length > 0) {
            const lastMsg = messages[messages.length - 1];
            if (!lastMsg.is_user) {
                messages = messages.slice(0, -1);
            }
        }

        // Exclude last user message if requested
        if (excludeLastUser && messages.length > 0) {
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
                    limitedMessages.unshift(msg);
                    totalTokens += msgTokens;

                    if (totalTokens >= config.maxTokens) {
                        break;
                    }
                } else {
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

    // Get the last user message
    function getLastUserMessage() {
        const messages = [...chat];
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].is_user) {
                return messages[i].mes;
            }
        }
        return "";
    }

    // Apply regex rules to text
    function applyRegexRules(text) {
        const config = getConfig();
        let result = text;

        for (const rule of config.regexRules) {
            if (!rule.enabled || !rule.pattern) continue;

            try {
                const flags = rule.flags || 'g';
                const regex = new RegExp(rule.pattern, flags);
                result = result.replace(regex, rule.replacement || '');
            } catch (e) {
                console.error(`Invalid regex pattern: ${rule.pattern}`, e);
            }
        }

        return result;
    }

    // Format a single message with XML tags and headers
    function formatMessage(message, isUser) {
        const config = getConfig();

        const tag = isUser ? config.xmlUserTag : config.xmlAssistantTag;
        const header = isUser ? config.userHeader : config.assistantHeader;
        const name = isUser ? config.userName : config.assistantName;

        let content = message;
        content = applyRegexRules(content);

        let formatted = "";

        if (header) {
            formatted += `${header}\n`;
        }

        if (tag) {
            formatted += `<${tag}_message>\n${content}\n</${tag}_message>`;
        } else {
            formatted += content;
        }

        return formatted;
    }

    // Generate the full formatted chat
    function generateFormattedChat() {
        const config = getConfig();
        const messages = getChatHistory(config.excludeLastUserMessage);
        const formattedMessages = [];

        for (const msg of messages) {
            const formatted = formatMessage(msg.mes, msg.is_user);
            formattedMessages.push(formatted);
        }

        return formattedMessages.join("\n\n");
    }

    // Register macros
    function registerMacros() {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            const context = SillyTavern.getContext();

            if (context.registerMacro) {
                context.registerMacro('chatToRoleplay', () => generateFormattedChat());
                context.registerMacro('lastUserMessage', () => getLastUserMessage());
                console.log("[Chat-to-Roleplay] Macros registered: {{chatToRoleplay}}, {{lastUserMessage}}");
            }
        }
    }

    // Create settings UI
    function createSettingsUI() {
        const config = getConfig();

        const settingsHtml = `
            <div id="chat-to-roleplay-settings" class="extension_settings">
                <div class="inline-drawer">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <b>Chat to Roleplay</b>
                        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content">
                        <div class="chat-to-roleplay-settings-content">
                            <h4>Names</h4>
                            <label>User Name:</label>
                            <input id="cthr-userName" type="text" class="text_pole" placeholder="Student" />

                            <label>Assistant Name:</label>
                            <input id="cthr-assistantName" type="text" class="text_pole" placeholder="Teacher" />

                            <hr>
                            <h4>Headers</h4>
                            <label>User Header:</label>
                            <input id="cthr-userHeader" type="text" class="text_pole" placeholder="## Student's Turn" />

                            <label>Assistant Header:</label>
                            <input id="cthr-assistantHeader" type="text" class="text_pole" placeholder="## Teacher's Turn" />

                            <hr>
                            <h4>XML Tags</h4>
                            <label>User XML Tag:</label>
                            <input id="cthr-xmlUserTag" type="text" class="text_pole" placeholder="student" />
                            <small>Creates <student_message> tags</small>

                            <label>Assistant XML Tag:</label>
                            <input id="cthr-xmlAssistantTag" type="text" class="text_pole" placeholder="teacher" />
                            <small>Creates <teacher_message> tags</small>

                            <hr>
                            <h4>Token Limit</h4>
                            <label>Max Tokens (0 = unlimited):</label>
                            <input id="cthr-maxTokens" type="number" class="text_pole" placeholder="0" min="0" />

                            <label>Characters per Token:</label>
                            <input id="cthr-charsPerToken" type="number" class="text_pole" placeholder="4" min="1" />
                            <small>Used for token estimation (default: 4)</small>

                            <hr>
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
                                <span>Exclude last user message from history</span>
                            </label>
                            <small>Use {{lastUserMessage}} macro separately when enabled</small>

                            <hr>
                            <h4>Regex Rules</h4>
                            <div id="cthr-regexRules"></div>
                            <button id="cthr-addRegex" class="menu_button">
                                <i class="fa-solid fa-plus"></i> Add Regex Rule
                            </button>

                            <hr>
                            <h4>Macros</h4>
                            <small>Use <code>{{chatToRoleplay}}</code> in your prompts</small><br>
                            <small>Use <code>{{lastUserMessage}}</code> for user's last message</small>
                        </div>
                    </div>
                </div>
            </div>
        `;

        $("#extensions_settings").append(settingsHtml);

        // Load current values
        $("#cthr-userName").val(config.userName);
        $("#cthr-assistantName").val(config.assistantName);
        $("#cthr-userHeader").val(config.userHeader);
        $("#cthr-assistantHeader").val(config.assistantHeader);
        $("#cthr-xmlUserTag").val(config.xmlUserTag);
        $("#cthr-xmlAssistantTag").val(config.xmlAssistantTag);
        $("#cthr-maxTokens").val(config.maxTokens);
        $("#cthr-charsPerToken").val(config.charsPerToken);
        $("#cthr-skipLastAssistant").prop("checked", config.skipLastAssistant);
        $("#cthr-softTokenLimit").prop("checked", config.softTokenLimit);
        $("#cthr-excludeLastUserMessage").prop("checked", config.excludeLastUserMessage);

        // Event handlers
        $("#cthr-userName").on("input", function() { saveSetting("userName", $(this).val()); });
        $("#cthr-assistantName").on("input", function() { saveSetting("assistantName", $(this).val()); });
        $("#cthr-userHeader").on("input", function() { saveSetting("userHeader", $(this).val()); });
        $("#cthr-assistantHeader").on("input", function() { saveSetting("assistantHeader", $(this).val()); });
        $("#cthr-xmlUserTag").on("input", function() { saveSetting("xmlUserTag", $(this).val()); });
        $("#cthr-xmlAssistantTag").on("input", function() { saveSetting("xmlAssistantTag", $(this).val()); });
        $("#cthr-maxTokens").on("input", function() { saveSetting("maxTokens", parseInt($(this).val()) || 0); });
        $("#cthr-charsPerToken").on("input", function() { saveSetting("charsPerToken", parseInt($(this).val()) || 4); });
        $("#cthr-skipLastAssistant").on("change", function() { saveSetting("skipLastAssistant", $(this).is(":checked")); });
        $("#cthr-softTokenLimit").on("change", function() { saveSetting("softTokenLimit", $(this).is(":checked")); });
        $("#cthr-excludeLastUserMessage").on("change", function() { saveSetting("excludeLastUserMessage", $(this).is(":checked")); });

        // Regex rule management
        function renderRegexRules() {
            const rulesConfig = getConfig().regexRules || [];
            const container = $("#cthr-regexRules");
            container.empty();

            rulesConfig.forEach((rule, index) => {
                const ruleHtml = `
                    <div class="cthr-regex-rule" data-index="${index}" style="border: 1px solid #555; padding: 8px; margin: 5px 0; border-radius: 4px;">
                        <label class="checkbox_label">
                            <input type="checkbox" class="cthr-regex-enabled" ${rule.enabled ? 'checked' : ''} />
                            <span>Enabled</span>
                        </label>
                        <input type="text" class="text_pole cthr-regex-pattern" placeholder="Regex pattern" value="${rule.pattern || ''}" />
                        <input type="text" class="text_pole cthr-regex-replacement" placeholder="Replacement" value="${rule.replacement || ''}" />
                        <input type="text" class="text_pole cthr-regex-flags" placeholder="Flags (default: g)" value="${rule.flags || 'g'}" style="width: 60px;" />
                        <button class="menu_button cthr-regex-delete" title="Delete">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                `;
                container.append(ruleHtml);
            });

            // Rule event handlers
            $(".cthr-regex-enabled").off("change").on("change", function() {
                const index = $(this).closest(".cthr-regex-rule").data("index");
                const rules = getConfig().regexRules || [];
                rules[index].enabled = $(this).is(":checked");
                saveSetting("regexRules", rules);
            });

            $(".cthr-regex-pattern").off("input").on("input", function() {
                const index = $(this).closest(".cthr-regex-rule").data("index");
                const rules = getConfig().regexRules || [];
                rules[index].pattern = $(this).val();
                saveSetting("regexRules", rules);
            });

            $(".cthr-regex-replacement").off("input").on("input", function() {
                const index = $(this).closest(".cthr-regex-rule").data("index");
                const rules = getConfig().regexRules || [];
                rules[index].replacement = $(this).val();
                saveSetting("regexRules", rules);
            });

            $(".cthr-regex-flags").off("input").on("input", function() {
                const index = $(this).closest(".cthr-regex-rule").data("index");
                const rules = getConfig().regexRules || [];
                rules[index].flags = $(this).val();
                saveSetting("regexRules", rules);
            });

            $(".cthr-regex-delete").off("click").on("click", function() {
                const index = $(this).closest(".cthr-regex-rule").data("index");
                const rules = getConfig().regexRules || [];
                rules.splice(index, 1);
                saveSetting("regexRules", rules);
                renderRegexRules();
            });
        }

        $("#cthr-addRegex").on("click", function() {
            const rules = getConfig().regexRules || [];
            rules.push({ enabled: true, pattern: "", replacement: "", flags: "g" });
            saveSetting("regexRules", rules);
            renderRegexRules();
        });

        renderRegexRules();
    }

    // Initialize extension
    jQuery(async () => {
        if (extension_settings[extensionName]) {
            extensionSettings = extension_settings[extensionName];
        } else {
            extension_settings[extensionName] = {};
            extensionSettings = extension_settings[extensionName];
        }

        createSettingsUI();
        registerMacros();

        console.log("[Chat-to-Roleplay] Extension loaded!");
    });
})();
