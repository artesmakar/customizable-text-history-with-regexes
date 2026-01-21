# Customizable Text History (with Regexes)

A SillyTavern extension that provides customizable macros for formatting chat history, with built-in regex processing.

## Available Macros

| Macro | Description |
|-------|-------------|
| `{{colonHistoryR}}` | `Name: message` format |
| `{{headerHistoryR}}` | Header above each message |
| `{{xmlHistoryR}}` | XML tags around messages |
| `{{bracketHistoryR}}` | `[Name]` bracket format |
| `{{numberedHistoryR}}` | Numbered list format |
| `{{quoteHistoryR}}` | Markdown quote format |
| `{{lastNR::5}}` | Last N messages |
| `{{rawHistoryR}}` | Raw message text only |

## Regex Rules

Add regex find/replace rules that automatically apply to all history macros. Useful for pruning repeated sections like `[World State]` blocks.

## Credits

Built with Claude (Anthropic)
