---
name: fdk-file-fetcher
description: Fetch one source file from fdk-react-templates and either return code in chat mode or create a local file in create mode.
disable-model-invocation: true
---

# FDK File Fetcher

Use this skill when a user provides:

- `File path`
- `Extension`
- `Call path`
- `mode` (`chat` or `create`)
- optional `Output`

It runs:

```bash
node scripts/fdk_file_fetcher.js ...
```

## Help / Syntax Response Contract

If the user asks things like:

- "how can I use this skill?"
- "what is the input format?"
- "give me syntax"
- "show example input"

Do not run the script first. Reply with:

1. Required fields
2. Copy-paste input template
3. One chat-mode example
4. One create-mode example
5. Supported extensions list

Use this exact template block:

```txt
File path : "fdk-react-templates/page-layouts/single-checkout/shipment/single-page-shipment"
Extension : "jsx"
Call path : "theme/page-layouts/single-checkout/checkout/checkout.jsx"
mode : "chat" | "create" (default: "chat")
Output : "theme/page-layouts/single-checkout" (optional, only for "create" mode)
```

## Execution Marker

Before running the command, explicitly print this line in the agent response:

`Using skill: fdk-file-fetcher`

The script itself also logs runtime markers to stderr in this format:

`[fdk-file-fetcher] ...`

## Input Mapping

- `File path` -> `--file-path`
  - This is the imported package file to fetch code for.
  - Example: `fdk-react-templates/page-layouts/single-checkout/shipment/single-page-shipment`
- `Extension` -> `--extension`
- `Call path` -> `--call-path`
  - This is the local storefront file where that import is used.
  - Example: `theme/page-layouts/single-checkout/checkout/checkout.jsx`
- `mode` -> `--mode` (`chat|create`)
- `Output` -> `--output` (create mode only; optional)

## Mode Behavior

- `mode: "chat"`
  - Fetch file from GitHub at the exact installed package commit.
  - Return full source code in stdout (for chat response).
  - This is the default mode if user does not specify mode.

- `mode: "create"`
  - Fetch file from GitHub at the exact installed package commit.
  - Write full source file at the user-provided output path.
  - If `Output` is missing, create file at project root.
  - Return JSON summary including `outputFile` and `suggestedLocalImport`.

## Command Templates

Chat mode:

```bash
node scripts/fdk_file_fetcher.js \
  --file-path "fdk-react-templates/page-layouts/single-checkout/shipment/single-page-shipment" \
  --extension "less" \
  --call-path "theme/page-layouts/single-checkout/checkout/checkout.jsx" \
  --mode "chat"
```

Create mode:

```bash
node scripts/fdk_file_fetcher.js \
  --file-path "fdk-react-templates/page-layouts/single-checkout/shipment/single-page-shipment" \
  --extension "jsx" \
  --call-path "theme/page-layouts/single-checkout/checkout/checkout.jsx" \
  --mode "create" \
  --output "theme/page-layouts/single-checkout"
```

## Notes

- Only fetches ONE file per call
- Reads exact commit hash from `package-lock.json` to match installed `fdk-react-templates`
- If `mode` is missing, default to `chat`
- In `create` mode, if `Output` is missing, file is created at project root
- If `Output` is a directory, created filename is derived from import basename + extension
- If required details are missing or invalid, show the expected user input format template and ask user to resend in the same structure
- Supported extensions: `jsx`, `tsx`, `js`, `ts`, `less`, `css`, `scss`, `sass`
