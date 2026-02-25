---
name: fdk-file-fetcher
description: Fetch one source file from any installed package import path and either return code in chat mode or create a local file in create mode.
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

## Execution Marker

Before running the command, explicitly print this line in the agent response:

`Using skill: fdk-file-fetcher`

The script itself also logs runtime markers to stderr in this format:

`[fdk-file-fetcher] ...`

## Input Mapping

- `File path` -> `--file-path`
  - This is the full package import path to fetch code for.
  - Example: `@gofynd/theme-template/page-layouts/single-checkout/shipment/single-page-shipment`
- `Extension` -> `--extension`
- `Call path` -> `--call-path`
  - This is the local storefront file where that import is used.
  - Example: `theme/page-layouts/single-checkout/checkout/checkout.jsx`
- `mode` -> `--mode` (`chat|create`)
- `Output` -> `--output` (create mode only; optional)
- Optional advanced overrides:
  - `Repo` -> `--repo` (GitHub URL override)
  - `Ref` -> `--ref` (branch/tag/commit override)
  - `Prefer latest` -> `--prefer-latest` (use npm latest metadata and main/master first)
  - `Source prefix` -> `--source-prefix` (preferred source root like `src`)

## Mode Behavior

- `mode: "chat"`
  - Tries to infer repository/ref from local lockfile and installed package metadata.
  - Tries GitHub source first.
  - Return full source code in stdout (for chat response).
  - This is the default mode if user does not specify mode.

- `mode: "create"`
  - Uses the same source resolution flow as chat mode.
  - Write full source file at the user-provided output path.
  - If `Output` is missing, create file at project root.
  - Return JSON summary including `outputFile` and `suggestedLocalImport`.

## Command Templates

Chat mode:

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

- Only fetches ONE file per call
- Supports scoped and unscoped package paths
- Automatically resolves package metadata from:
  - `package-lock.json`
  - installed `node_modules/<package>/package.json`
  - npm registry fallback (if needed)
- Source lookup is remote-only (GitHub source). No local file fallback is used.
- If `mode` is missing, default to `chat`
- In `create` mode, if `Output` is missing, file is created at project root
- If `Output` is a directory, created filename is derived from import basename + extension
- If required details are missing or invalid, show the expected user input format template
- Supported extensions: `jsx`, `tsx`, `js`, `ts`, `less`, `css`, `scss`, `sass`
