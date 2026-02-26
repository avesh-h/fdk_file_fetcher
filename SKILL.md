---
name: fdk-file-fetcher
description: Fetch one source file from any installed package import path and either return code in chat mode or create a local file in create mode.
disable-model-invocation: true
---

# FDK File Fetcher

## Architecture

Target flow:

1. **User** gives input (file path, extension, call path, mode, optional output).
2. **Agent** runs the script with those inputs.
3. **Script** fetches the file from GitHub only (no local fallback).
4. **Script** writes the result to **stdout** (chat: source or JSON; create: JSON).
5. **Agent** reads stdout and returns the fetched response to the **user**.

All source is always fetched from GitHub; the script does not read from local files or node_modules for content.

## Requirements

- The script **requires network access** to:
  - `api.github.com`
  - `raw.githubusercontent.com`
  - `registry.npmjs.org` (optional, for package metadata)
- If the agent runs in a **sandboxed environment where network is blocked**, the script will fail (e.g. ENOTFOUND). In that case the agent must:
  - Report the error from stderr to the user.
  - Mention that the script needs outbound network; suggest running the command locally in a terminal, or enabling network for the agent when running this skill.

## When to Use

Use this skill when the user provides:

- `File path`
- `Extension`
- `Call path`
- `mode` (`chat` or `create`)
- optional `Output` (create mode)

## Execution Marker

Before running the command, explicitly print in the agent response:

`Using skill: fdk-file-fetcher`

The script logs to stderr in this format: `[fdk-file-fetcher] ...`

## Input Mapping

- `File path` -> `--file-path`
  - Full package import path to fetch.
  - Example: `@gofynd/theme-template/page-layouts/single-checkout/shipment/single-page-shipment`
- `Extension` -> `--extension`
- `Call path` -> `--call-path`
  - Local storefront file where that import is used.
  - Example: `theme/page-layouts/single-checkout/checkout/checkout.jsx`
- `mode` -> `--mode` (`chat` | `create`)
- `Output` -> `--output` (create mode only; optional)
- Optional: `--output-format json` (chat mode only; recommended when the agent runs the script — see below)
- Optional overrides: `--repo`, `--ref`, `--prefer-latest`, `--source-prefix`

## Agent Behavior After Running the Command

1. **Run** the script (from project root) with the user’s inputs mapped to flags.
2. **Capture** stdout and stderr. Note the exit code.

3. **If exit code is 0 (success):**
   - **Chat mode**
     - If you used `--output-format json`: stdout is one JSON object. Parse it. It has `content`, `repoPath`, `ref`, `repo`, `packageName`, `importPath`. Return the **content** to the user in a **code block** with the language set from the extension (e.g. `jsx`, `ts`, `less`). You may briefly mention source: e.g. “From `repo` at `ref`, path `repoPath`.”
     - If you used default (raw): stdout is the raw file content. Return it to the user in a **code block** with the correct language.
   - **Create mode**: stdout is JSON. Parse it and tell the user the file was created at `outputFile` and, if present, show `suggestedLocalImport` for the caller file.

4. **If exit code is non-zero (failure):**
   - Report the **stderr** content to the user as the error message.
   - If the error mentions network or resolution failure, add that the script needs network access to GitHub (and optionally npm). Suggest running the command locally or enabling network for this skill.

## Command Templates

Chat mode (recommended for agent: use `--output-format json` so you can parse and present reliably):

```bash
node scripts/fdk_file_fetcher.js \
  --file-path "@gofynd/theme-template/page-layouts/single-checkout/shipment/single-page-shipment" \
  --extension "less" \
  --call-path "theme/page-layouts/single-checkout/checkout/checkout.jsx" \
  --mode "chat" \
  --output-format "json" \
  --prefer-latest
```

Chat mode (raw stdout, for terminal use):

```bash
node scripts/fdk_file_fetcher.js \
  --file-path "@gofynd/theme-template/page-layouts/single-checkout/shipment/single-page-shipment" \
  --extension "less" \
  --call-path "theme/page-layouts/single-checkout/checkout/checkout.jsx" \
  --mode "chat" \
  --prefer-latest
```

Create mode:

```bash
node scripts/fdk_file_fetcher.js \
  --file-path "@gofynd/theme-template/page-layouts/single-checkout/shipment/single-page-shipment" \
  --extension "jsx" \
  --call-path "theme/page-layouts/single-checkout/checkout/checkout.jsx" \
  --mode "create" \
  --output "theme/page-layouts/single-checkout"
```

## Notes

- One file per call. Source is **always** from GitHub; no local fallback.
- Resolves package/repo from: package-lock.json, installed package.json, then npm registry.
- Default mode is `chat`. In create mode, default output is project root.
- Supported extensions: `jsx`, `tsx`, `js`, `ts`, `less`, `css`, `scss`, `sass`.
- If required details are missing or invalid, show the expected input format (file path, extension, call path, mode, optional output).
