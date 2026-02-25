# FDK File Fetcher Skill

## Problem Statement

In modern storefront projects, components are often imported from package libraries, for example:

```js
import SinglePageShipment from "@gofynd/theme-template/page-layouts/single-checkout/shipment/single-page-shipment";
```

When you want to customize such a component, you need its original source code. Manually finding the correct file in GitHub every time is slow and error-prone.

This skill + script solves that by:

1. Taking an import-style file path as input.
2. Resolving package metadata dynamically from lockfile + installed dependencies.
3. Fetching the matching source file from the package's GitHub repository when available.
4. Returning code in chat mode or creating a local file in create mode.

## Solution Overview

This implementation has two connected parts:

1. `SKILL.md` (agent instructions):
   - Defines when to use the skill.
   - Defines the input format expected from the user.
   - Tells the agent how to call the script.

2. `scripts/fdk_file_fetcher.js` (execution engine):
   - Parses CLI input.
   - Resolves package/repo/ref dynamically.
   - Calls GitHub APIs (remote source only).
   - Returns source code (`chat`) or writes file (`create`).

## How They Are Connected

- Agent receives your request.
- `SKILL.md` maps your request into CLI flags.
- Agent runs:

```bash
node scripts/fdk_file_fetcher.js ...
```

- Script executes fetch/write logic and returns output.

So:

- `SKILL.md` = orchestration/instructions.
- `fdk_file_fetcher.js` = real implementation.

## Input Contract (User Format)

Use this structure in agent chat:

```txt
File path : "@gofynd/theme-template/page-layouts/single-checkout/shipment/single-page-shipment"
Extension : "jsx"
Call path : "theme/page-layouts/single-checkout/checkout/checkout.jsx"
mode : "chat" | "create"
Output : "theme/page-layouts/single-checkout"
```

Meaning:

- `File path`: package file you want to fetch.
- `Extension`: target extension (`jsx`, `tsx`, `js`, `ts`, `less`, `css`, `scss`, `sass`).
- `Call path`: local storefront file where import is used.
- `mode`:
  - `chat` (default): return code only.
  - `create`: create a local file.
- `Output`: output path from project root (optional in create mode).
- Optional advanced inputs:
  - `Repo`: force GitHub repo URL override.
  - `Ref`: force branch/tag/commit override.
  - `Prefer latest`: use npm latest metadata and try `main/master` first.
  - `Source prefix`: prefer root like `src`.

## Modes

### 1) Chat Mode

- Fetches source and prints full code to stdout.
- No local file write.
- Default mode if mode is omitted.

Example:

```bash
node scripts/fdk_file_fetcher.js \
  --file-path "@gofynd/theme-template/page-layouts/single-checkout/shipment/single-page-shipment" \
  --extension "jsx" \
  --call-path "theme/page-layouts/single-checkout/checkout/checkout.jsx" \
  --mode "chat" \
  --prefer-latest
```

### 2) Create Mode

- Fetches source and writes a file locally.
- Returns JSON summary (`outputFile`, `source`, `repo`, `ref`, optional `suggestedLocalImport`).

Example:

```bash
node scripts/fdk_file_fetcher.js \
  --file-path "@gofynd/theme-template/page-layouts/single-checkout/shipment/single-page-shipment" \
  --extension "jsx" \
  --call-path "theme/page-layouts/single-checkout/checkout/checkout.jsx" \
  --mode "create" \
  --output "theme/page-layouts/single-checkout"
```

## Edge Cases Implemented

1. If `mode` is missing:
   - Defaults to `chat`.

2. If `create` mode has no `Output`:
   - File is created at project root.

3. If required input is invalid:
   - Script prints an expected input format template.

4. If style files are needed:
   - Supports `less`, `css`, `scss`, `sass` in addition to code extensions.

## Requirements

- Node.js available.
- Internet access (script fetches from GitHub).
- `package-lock.json` recommended for best package/ref resolution.

## How Dynamic Resolution Works

The script tries this order:

1. Parse package name/path from `File path`.
2. Read package info from `package-lock.json`.
3. Read installed package `repository` from `node_modules/<package>/package.json`.
4. Fallback to npm registry metadata.
5. Fallback to GitHub repo extraction from npm README text.
6. Fetch source from GitHub.
7. If source is not found remotely, fail with a clear resolver error.

## Typical Errors and Meaning

1. `Unsupported extension ...`
   - Extension not in allowed list.

2. `Could not resolve source ...`
   - Repository metadata/ref/path matching failed on remote GitHub source.

3. Network / sandbox errors (for example DNS or blocked internet):
   - Environment blocked external GitHub calls.
   - Not a script logic bug.

## Verifying Skill Is Being Used

You should see both:

1. Agent message marker:
   - `Using skill: fdk-file-fetcher`

2. Script runtime marker:
   - `[fdk-file-fetcher] Executing skill in "..."`

## Publish and Reuse (GitHub + Skill Catalog)

Recommended repo structure:

```txt
fdk-file-fetcher-skill/
  SKILL.md
  README.md
  scripts/
    fdk_file_fetcher.js
```

For users:

1. Clone repo.
2. Keep script accessible from project root or update command path.
3. Use agent prompt format from this README.

## Quick Start

1. From storefront root, run:

```bash
node scripts/fdk_file_fetcher.js --help
```

2. Run one chat-mode fetch.
3. Run one create-mode fetch.
4. Update import in caller file to local file path if needed.
