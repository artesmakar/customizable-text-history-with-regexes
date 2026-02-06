// ==UserScript==
// @name         Chat to Human Readable
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Converts chat history to human readable format with regex support
// @author       You
// @match        https://characterhub.org/*
// @icon         https://www.google.com/s2-favicons?sz=64&domain=characterhub.org
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function() {
    'use strict';

    // ============ DEFAULT SETTINGS ============
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
        excludeLastUser: false,
        regexRules: []
    };

    // ============ SETTINGS MANAGEMENT ============
    function getConfig() {
        const saved = GM_getValue("cthrConfig", null);
        if (!saved) return { ...defaultSettings };
        return { ...defaultSettings, ...saved };
    }

    function saveConfig(config) {
        GM_setValue("cthrConfig", config);
    }

    function saveSetting(key, value) {
        const config = getConfig();
        config[key] = value;
        saveConfig(config);
    }

    // ============ CHAT DATA EXTRACTION ============
    let chat = [];

    function extractChatFromPage() {
        const chatContainer = document.querySelector('.overflow-auto.flex-1.p-2.space-y-1');
        if (!chatContainer) return [];

        const messages = [];
        const messageElements = chatContainer.querySelectorAll('[id^="message-"]');

        messageElements.forEach(el => {
            const id = el.id.replace('message-', '');
            const userMessageEl = el.querySelector('.whitespace-pre-wrap.break-words.text-sm.text-right');
            const assistantMessageEl = el.querySelector('.whitespace-pre-wrap.break-words.text-sm.text-left');

            if (userMessageEl) {
                messages.push({
                    id: id,
                    is_user: true,
                    mes: userMessageEl.textContent.trim()
                });
            }

            if (assistantMessageEl) {
                messages.push({
                    id: id,
                    is_user: false,
                    mes: assistantMessageEl.textContent.trim()
                });
            }
        });

        return messages;
    }

    function updateChatData() {
        chat = extractChatFromPage();
    }

    // ============ TOKEN ESTIMATION ============
    function estimateTokens(text) {
        const config = getConfig();
        return Math.ceil(text.length / config.charsPerToken);
    }

    // ============ GET LAST USER MESSAGE ============
    function getLastUserMessage() {
        const messages = [...chat];

        // Find last user message
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].is_user) {
                return messages[i];
            }
        }

        return null;
    }

    // ============ CHAT HISTORY WITH LIMITS ============
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

        // Exclude last user message if enabled
        if (config.excludeLastUser && messages.length > 0) {
            // Find and remove the last user message
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

    // ============ REGEX PROCESSING ============
    function applyRegexRules(text) {
        const config = getConfig();

        for (const rule of config.regexRules) {
            if (!rule.enabled) continue;

            try {
                const flags = rule.flags || 'g';
                const regex = new RegExp(rule.pattern, flags);
                text = text.replace(regex, rule.replacement);
            } catch (e) {
                console.error(`Invalid regex pattern: ${rule.pattern}`, e);
            }
        }

        return text;
    }

    // ============ FORMAT GENERATORS ============
    function generateHeaders() {
        const config = getConfig();
        const messages = getChatHistory();
        let output = "";

        for (const msg of messages) {
            const header = msg.is_user ? config.userHeader : config.assistantHeader;
            let content = msg.mes;
            content = applyRegexRules(content);
            output += `${header}\n${content}\n\n`;
        }

        return output.trim();
    }

    function generateXML() {
        const config = getConfig();
        const messages = getChatHistory();
        let output = "";

        for (const msg of messages) {
            const tag = msg.is_user ? config.xmlUserTag : config.xmlAssistantTag;
            let content = msg.mes;
            content = applyRegexRules(content);
            output += `<${tag}_message>${content}</${tag}_message>\n\n`;
        }

        return output.trim();
    }

    function generateLastMessage() {
        const config = getConfig();
        const messages = getChatHistory();

        if (messages.length === 0) return "";

        const lastMsg = messages[messages.length - 1];
        const tag = lastMsg.is_user ? config.xmlUserTag : config.xmlAssistantTag;
        let content = lastMsg.mes;
        content = applyRegexRules(content);

        return `<${tag}_message>${content}</${tag}_message>`;
    }

    function generateLastUserMessage() {
        const config = getConfig();
        const lastUserMsg = getLastUserMessage();

        if (!lastUserMsg) return "";

        let content = lastUserMsg.mes;
        content = applyRegexRules(content);

        return `<${config.xmlUserTag}_message>${content}</${config.xmlUserTag}_message>`;
    }

    // ============ MACRO REPLACEMENT ============
    function replaceMacros(template) {
        updateChatData();

        let result = template;

        // Replace all macros
        result = result.replace(/\{\{headers\}\}/gi, generateHeaders());
        result = result.replace(/\{\{history\}\}/gi, generateXML());
        result = result.replace(/\{\{lastMessage\}\}/gi, generateLastMessage());
        result = result.replace(/\{\{lastUserMessage\}\}/gi, generateLastUserMessage());

        return result;
    }

    // ============ COPY FUNCTION ============
    function copyWithMacros(template) {
        const result = replaceMacros(template);

        navigator.clipboard.writeText(result).then(() => {
            showNotification("Copied to clipboard!");
        }).catch(err => {
            console.error("Failed to copy:", err);
            showNotification("Failed to copy!", true);
        });
    }

    // ============ NOTIFICATION ============
    function showNotification(message, isError = false) {
        const existing = document.querySelector('.cthr-notification');
        if (existing) existing.remove();

        const notification = document.createElement('div');
        notification.className = 'cthr-notification';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            background: ${isError ? '#f44336' : '#4CAF50'};
            color: white;
            border-radius: 8px;
            z-index: 100000;
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 14px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            animation: slideIn 0.3s ease;
        `;

        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 2000);
    }

    // ============ SETTINGS UI ============
    function createSettingsUI() {
        const existing = document.querySelector('.cthr-settings-overlay');
        if (existing) existing.remove();

        const config = getConfig();

        const overlay = document.createElement('div');
        overlay.className = 'cthr-settings-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.7);
            z-index: 99999;
            display: flex;
            justify-content: center;
            align-items: center;
            font-family: system-ui, -apple-system, sans-serif;
        `;

        overlay.innerHTML = `
            <div class="cthr-settings-panel" style="
                background: #1a1a2e;
                border-radius: 12px;
                padding: 24px;
                width: 600px;
                max-height: 85vh;
                overflow-y: auto;
                color: #e0e0e0;
                box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            ">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h2 style="margin: 0; color: #fff; font-size: 20px;">Chat to Human Readable - Settings</h2>
                    <button id="cthr-close" style="
                        background: none;
                        border: none;
                        color: #888;
                        font-size: 24px;
                        cursor: pointer;
                    ">×</button>
                </div>

                <div style="display: grid; gap: 16px;">
                    <!-- Names Section -->
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <div>
                            <label style="display: block; margin-bottom: 4px; font-size: 12px; color: #888;">User Name</label>
                            <input id="cthr-userName" type="text" value="${config.userName}" style="
                                width: 100%;
                                padding: 8px 12px;
                                border: 1px solid #333;
                                border-radius: 6px;
                                background: #0d0d1a;
                                color: #fff;
                                font-size: 14px;
                                box-sizing: border-box;
                            " />
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 4px; font-size: 12px; color: #888;">Assistant Name</label>
                            <input id="cthr-assistantName" type="text" value="${config.assistantName}" style="
                                width: 100%;
                                padding: 8px 12px;
                                border: 1px solid #333;
                                border-radius: 6px;
                                background: #0d0d1a;
                                color: #fff;
                                font-size: 14px;
                                box-sizing: border-box;
                            " />
                        </div>
                    </div>

                    <!-- Headers Section -->
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <div>
                            <label style="display: block; margin-bottom: 4px; font-size: 12px; color: #888;">User Header</label>
                            <input id="cthr-userHeader" type="text" value="${config.userHeader}" style="
                                width: 100%;
                                padding: 8px 12px;
                                border: 1px solid #333;
                                border-radius: 6px;
                                background: #0d0d1a;
                                color: #fff;
                                font-size: 14px;
                                box-sizing: border-box;
                            " />
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 4px; font-size: 12px; color: #888;">Assistant Header</label>
                            <input id="cthr-assistantHeader" type="text" value="${config.assistantHeader}" style="
                                width: 100%;
                                padding: 8px 12px;
                                border: 1px solid #333;
                                border-radius: 6px;
                                background: #0d0d1a;
                                color: #fff;
                                font-size: 14px;
                                box-sizing: border-box;
                            " />
                        </div>
                    </div>

                    <!-- XML Tags Section -->
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <div>
                            <label style="display: block; margin-bottom: 4px; font-size: 12px; color: #888;">XML User Tag</label>
                            <input id="cthr-xmlUserTag" type="text" value="${config.xmlUserTag}" style="
                                width: 100%;
                                padding: 8px 12px;
                                border: 1px solid #333;
                                border-radius: 6px;
                                background: #0d0d1a;
                                color: #fff;
                                font-size: 14px;
                                box-sizing: border-box;
                            " />
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 4px; font-size: 12px; color: #888;">XML Assistant Tag</label>
                            <input id="cthr-xmlAssistantTag" type="text" value="${config.xmlAssistantTag}" style="
                                width: 100%;
                                padding: 8px 12px;
                                border: 1px solid #333;
                                border-radius: 6px;
                                background: #0d0d1a;
                                color: #fff;
                                font-size: 14px;
                                box-sizing: border-box;
                            " />
                        </div>
                    </div>

                    <!-- Token Limit Section -->
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <div>
                            <label style="display: block; margin-bottom: 4px; font-size: 12px; color: #888;">Max Tokens (0 = unlimited)</label>
                            <input id="cthr-maxTokens" type="number" value="${config.maxTokens}" min="0" style="
                                width: 100%;
                                padding: 8px 12px;
                                border: 1px solid #333;
                                border-radius: 6px;
                                background: #0d0d1a;
                                color: #fff;
                                font-size: 14px;
                                box-sizing: border-box;
                            " />
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 4px; font-size: 12px; color: #888;">Chars per Token (estimation)</label>
                            <input id="cthr-charsPerToken" type="number" value="${config.charsPerToken}" min="1" style="
                                width: 100%;
                                padding: 8px 12px;
                                border: 1px solid #333;
                                border-radius: 6px;
                                background: #0d0d1a;
                                color: #fff;
                                font-size: 14px;
                                box-sizing: border-box;
                            " />
                        </div>
                    </div>

                    <!-- Checkboxes Section -->
                    <div style="display: grid; gap: 8px; padding: 12px; background: #0d0d1a; border-radius: 6px;">
                        <label class="checkbox_label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input id="cthr-skipLastAssistant" type="checkbox" style="width: 16px; height: 16px;" />
                            <span style="font-size: 14px;">Skip last assistant message (fixes swipe issue)</span>
                        </label>
                        <label class="checkbox_label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input id="cthr-softTokenLimit" type="checkbox" style="width: 16px; height: 16px;" />
                            <span style="font-size: 14px;">Soft token limit (include message that exceeds limit)</span>
                        </label>
                        <label class="checkbox_label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input id="cthr-excludeLastUser" type="checkbox" style="width: 16px; height: 16px;" />
                            <span style="font-size: 14px;">Exclude last user message from history (use with {{lastUserMessage}})</span>
                        </label>
                    </div>

                    <!-- Regex Rules Section -->
                    <div style="border-top: 1px solid #333; padding-top: 16px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                            <h3 style="margin: 0; font-size: 16px; color: #fff;">Regex Rules</h3>
                            <button id="cthr-addRegex" style="
                                background: #4CAF50;
                                border: none;
                                color: white;
                                padding: 6px 12px;
                                border-radius: 4px;
                                cursor: pointer;
                                font-size: 12px;
                            ">+ Add Rule</button>
                        </div>
                        <div id="cthr-regexList" style="display: grid; gap: 8px;"></div>
                    </div>

                    <!-- Macros Reference -->
                    <div style="border-top: 1px solid #333; padding-top: 16px;">
                        <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #fff;">Available Macros</h3>
                        <div style="background: #0d0d1a; padding: 12px; border-radius: 6px; font-family: monospace; font-size: 13px;">
                            <div style="margin-bottom: 8px;"><code style="color: #4CAF50;">{{headers}}</code> - Header format with ## markers</div>
                            <div style="margin-bottom: 8px;"><code style="color: #4CAF50;">{{history}}</code> - XML format with custom tags</div>
                            <div style="margin-bottom: 8px;"><code style="color: #4CAF50;">{{lastMessage}}</code> - Last message in XML format</div>
                            <div><code style="color: #4CAF50;">{{lastUserMessage}}</code> - Last user message in XML format</div>
                        </div>
                    </div>

                    <!-- Quick Copy Section -->
                    <div style="border-top: 1px solid #333; padding-top: 16px;">
                        <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #fff;">Quick Copy</h3>
                        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                            <button class="cthr-quickcopy" data-template="{{headers}}" style="
                                background: #2196F3;
                                border: none;
                                color: white;
                                padding: 8px 16px;
                                border-radius: 4px;
                                cursor: pointer;
                                font-size: 13px;
                            ">Copy Headers</button>
                            <button class="cthr-quickcopy" data-template="{{history}}" style="
                                background: #2196F3;
                                border: none;
                                color: white;
                                padding: 8px 16px;
                                border-radius: 4px;
                                cursor: pointer;
                                font-size: 13px;
                            ">Copy XML</button>
                            <button class="cthr-quickcopy" data-template="{{lastMessage}}" style="
                                background: #2196F3;
                                border: none;
                                color: white;
                                padding: 8px 16px;
                                border-radius: 4px;
                                cursor: pointer;
                                font-size: 13px;
                            ">Copy Last Message</button>
                            <button class="cthr-quickcopy" data-template="{{lastUserMessage}}" style="
                                background: #2196F3;
                                border: none;
                                color: white;
                                padding: 8px 16px;
                                border-radius: 4px;
                                cursor: pointer;
                                font-size: 13px;
                            ">Copy Last User Message</button>
                        </div>
                    </div>

                    <!-- Custom Template Section -->
                    <div style="border-top: 1px solid #333; padding-top: 16px;">
                        <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #fff;">Custom Template</h3>
                        <textarea id="cthr-customTemplate" placeholder="Enter your template with macros..." style="
                            width: 100%;
                            height: 100px;
                            padding: 12px;
                            border: 1px solid #333;
                            border-radius: 6px;
                            background: #0d0d1a;
                            color: #fff;
                            font-family: monospace;
                            font-size: 13px;
                            resize: vertical;
                            box-sizing: border-box;
                        "></textarea>
                        <button id="cthr-copyTemplate" style="
                            margin-top: 8px;
                            background: #9C27B0;
                            border: none;
                            color: white;
                            padding: 8px 16px;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 13px;
                        ">Copy Custom Template</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Load checkbox values
        document.getElementById("cthr-skipLastAssistant").checked = config.skipLastAssistant;
        document.getElementById("cthr-softTokenLimit").checked = config.softTokenLimit;
        document.getElementById("cthr-excludeLastUser").checked = config.excludeLastUser;

        // Event Listeners
        document.getElementById("cthr-close").addEventListener("click", () => overlay.remove());
        overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

        // Settings inputs
        document.getElementById("cthr-userName").addEventListener("change", function() { saveSetting("userName", this.value); });
        document.getElementById("cthr-assistantName").addEventListener("change", function() { saveSetting("assistantName", this.value); });
        document.getElementById("cthr-userHeader").addEventListener("change", function() { saveSetting("userHeader", this.value); });
        document.getElementById("cthr-assistantHeader").addEventListener("change", function() { saveSetting("assistantHeader", this.value); });
        document.getElementById("cthr-xmlUserTag").addEventListener("change", function() { saveSetting("xmlUserTag", this.value); });
        document.getElementById("cthr-xmlAssistantTag").addEventListener("change", function() { saveSetting("xmlAssistantTag", this.value); });
        document.getElementById("cthr-maxTokens").addEventListener("change", function() { saveSetting("maxTokens", parseInt(this.value) || 0); });
        document.getElementById("cthr-charsPerToken").addEventListener("change", function() { saveSetting("charsPerToken", parseInt(this.value) || 4); });
        document.getElementById("cthr-skipLastAssistant").addEventListener("change", function() { saveSetting("skipLastAssistant", this.checked); });
        document.getElementById("cthr-softTokenLimit").addEventListener("change", function() { saveSetting("softTokenLimit", this.checked); });
        document.getElementById("cthr-excludeLastUser").addEventListener("change", function() { saveSetting("excludeLastUser", this.checked); });

        // Quick copy buttons
        document.querySelectorAll(".cthr-quickcopy").forEach(btn => {
            btn.addEventListener("click", function() {
                copyWithMacros(this.dataset.template);
            });
        });

        // Custom template
        document.getElementById("cthr-copyTemplate").addEventListener("click", function() {
            const template = document.getElementById("cthr-customTemplate").value;
            if (template) {
                copyWithMacros(template);
            } else {
                showNotification("Enter a template first!", true);
            }
        });

        // Regex management
        document.getElementById("cthr-addRegex").addEventListener("click", addRegexRule);
        renderRegexRules();
    }

    // ============ REGEX RULES UI ============
    function renderRegexRules() {
        const config = getConfig();
        const container = document.getElementById("cthr-regexList");
        if (!container) return;

        container.innerHTML = "";

        config.regexRules.forEach((rule, index) => {
            const ruleEl = document.createElement("div");
            ruleEl.style.cssText = `
                display: grid;
                grid-template-columns: auto 1fr 1fr auto auto auto;
                gap: 8px;
                align-items: center;
                padding: 8px;
                background: #0d0d1a;
                border-radius: 6px;
            `;

            ruleEl.innerHTML = `
                <input type="checkbox" class="cthr-regex-enabled" data-index="${index}" ${rule.enabled ? 'checked' : ''} style="width: 16px; height: 16px;" />
                <input type="text" class="cthr-regex-pattern" data-index="${index}" value="${rule.pattern.replace(/"/g, '"')}" placeholder="Pattern" style="
                    padding: 6px 10px;
                    border: 1px solid #333;
                    border-radius: 4px;
                    background: #1a1a2e;
                    color: #fff;
                    font-family: monospace;
                    font-size: 12px;
                " />
                <input type="text" class="cthr-regex-replacement" data-index="${index}" value="${rule.replacement.replace(/"/g, '"')}" placeholder="Replacement" style="
                    padding: 6px 10px;
                    border: 1px solid #333;
                    border-radius: 4px;
                    background: #1a1a2e;
                    color: #fff;
                    font-family: monospace;
                    font-size: 12px;
                " />
                <input type="text" class="cthr-regex-flags" data-index="${index}" value="${rule.flags || 'g'}" placeholder="Flags" style="
                    width: 50px;
                    padding: 6px 10px;
                    border: 1px solid #333;
                    border-radius: 4px;
                    background: #1a1a2e;
                    color: #fff;
                    font-family: monospace;
                    font-size: 12px;
                    text-align: center;
                " />
                <button class="cthr-regex-delete" data-index="${index}" style="
                    background: #f44336;
                    border: none;
                    color: white;
                    width: 28px;
                    height: 28px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 16px;
                ">×</button>
            `;

            container.appendChild(ruleEl);
        });

        // Attach event listeners
        container.querySelectorAll(".cthr-regex-enabled").forEach(el => {
            el.addEventListener("change", function() {
                updateRegexRule(parseInt(this.dataset.index), "enabled", this.checked);
            });
        });

        container.querySelectorAll(".cthr-regex-pattern").forEach(el => {
            el.addEventListener("change", function() {
                updateRegexRule(parseInt(this.dataset.index), "pattern", this.value);
            });
        });

        container.querySelectorAll(".cthr-regex-replacement").forEach(el => {
            el.addEventListener("change", function() {
                updateRegexRule(parseInt(this.dataset.index), "replacement", this.value);
            });
        });

        container.querySelectorAll(".cthr-regex-flags").forEach(el => {
            el.addEventListener("change", function() {
                updateRegexRule(parseInt(this.dataset.index), "flags", this.value);
            });
        });

        container.querySelectorAll(".cthr-regex-delete").forEach(el => {
            el.addEventListener("click", function() {
                deleteRegexRule(parseInt(this.dataset.index));
            });
        });
    }

    function addRegexRule() {
        const config = getConfig();
        config.regexRules.push({
            enabled: true,
            pattern: "",
            replacement: "",
            flags: "g"
        });
        saveConfig(config);
        renderRegexRules();
    }

    function updateRegexRule(index, field, value) {
        const config = getConfig();
        if (config.regexRules[index]) {
            config.regexRules[index][field] = value;
            saveConfig(config);
        }
    }

    function deleteRegexRule(index) {
        const config = getConfig();
        config.regexRules.splice(index, 1);
        saveConfig(config);
        renderRegexRules();
    }

    // ============ KEYBOARD SHORTCUT ============
    document.addEventListener('keydown', (e) => {
        // Ctrl+Shift+H to open settings
        if (e.ctrlKey && e.shiftKey && e.key === 'H') {
            e.preventDefault();
            createSettingsUI();
        }
    });

    // ============ REGISTER MENU COMMAND ============
    GM_registerMenuCommand("Open Settings", createSettingsUI);

    // ============ CSS ANIMATION ============
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
    `;
    document.head.appendChild(style);

    console.log("Chat to Human Readable loaded! Press Ctrl+Shift+H to open settings.");
})();
