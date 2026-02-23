#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const https = require("https");

const PACKAGE_NAME = "fdk-react-templates";
const GITHUB_OWNER = "gofynd";
const GITHUB_REPO = "fdk-react-templates";
const SOURCE_PREFIX = "src";
const CODE_EXTENSIONS = [
  "jsx",
  "tsx",
  "js",
  "ts",
  "less",
  "css",
  "scss",
  "sass",
];
const SKILL_LABEL = "fdk-file-fetcher";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    }
  }
  return args;
}

function stripQuotes(value) {
  const v = String(value || "").trim();
  return v.replace(/^['"]|['"]$/g, "");
}

function fail(message, exitCode = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(exitCode);
}

function announce(message) {
  process.stderr.write(`[${SKILL_LABEL}] ${message}\n`);
}

function expectedInputFormat() {
  return [
    "Expected input format:",
    'File path : "fdk-react-templates/page-layouts/single-checkout/shipment/single-page-shipment"',
    'Extension : "jsx"',
    'Call path : "theme/page-layouts/single-checkout/checkout/checkout.jsx"',
    'mode : "chat" | "create" (default: "chat")',
    'Output : "theme/page-layouts/single-checkout" (optional, used in create mode)',
  ].join("\n");
}

function failWithFormat(message, exitCode = 1) {
  fail(`${message}\n\n${expectedInputFormat()}`, exitCode);
}

function toPosix(p) {
  return String(p || "").replace(/\\/g, "/");
}

function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "fdk-file-fetcher-script", ...headers } },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          return httpGet(res.headers.location, headers).then(resolve, reject);
        }

        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
            return;
          }
          resolve(body);
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

async function githubListDir(dirPath, ref, token) {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${dirPath}?ref=${ref}`;
  const headers = { Accept: "application/vnd.github.v3+json" };
  if (token) headers.Authorization = `token ${token}`;
  const body = await httpGet(url, headers);
  const items = JSON.parse(body);
  return Array.isArray(items) ? items : [];
}

async function githubGetRaw(filePath, ref, token) {
  const url = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${ref}/${filePath}`;
  const headers = {};
  if (token) headers.Authorization = `token ${token}`;
  return httpGet(url, headers);
}

function detectProjectRoot() {
  let dir = process.cwd();
  for (let i = 0; i < 20; i++) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps[PACKAGE_NAME]) return dir;
      } catch {
        // Ignore parse issues and keep walking up
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function readCommitHash(projectRoot) {
  const lockPath = path.join(projectRoot, "package-lock.json");
  if (!fs.existsSync(lockPath)) return null;
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    const entry =
      lock?.packages?.[`node_modules/${PACKAGE_NAME}`] ||
      lock?.dependencies?.[PACKAGE_NAME];
    if (!entry?.resolved) return null;
    const m = String(entry.resolved).match(/#([a-f0-9]+)$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function normalizeExtension(ext) {
  if (!ext) return null;
  const cleaned = String(ext).replace(/^\./, "").toLowerCase().trim();
  return cleaned || null;
}

async function resolveFileInRepo(packagePath, ref, token, requestedExt) {
  const fullPath = `${SOURCE_PREFIX}/${packagePath}`;
  const dirPart = path.posix.dirname(fullPath);
  const baseName = path.posix.basename(fullPath);
  const baseExt = normalizeExtension(path.posix.extname(baseName));
  const baseNoExt = baseExt
    ? baseName.slice(0, -1 * (baseExt.length + 1))
    : baseName;

  const entries = await githubListDir(dirPart, ref, token);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));

  if (requestedExt && !CODE_EXTENSIONS.includes(requestedExt)) {
    throw new Error(
      `Unsupported extension "${requestedExt}". Use one of: ${CODE_EXTENSIONS.join(", ")}`
    );
  }

  const tryFile = (name) => {
    const entry = byName.get(name);
    if (entry && entry.type === "file") {
      return path.posix.join(dirPart, name);
    }
    return null;
  };

  if (requestedExt) {
    const direct =
      baseExt && baseExt === requestedExt
        ? tryFile(baseName)
        : tryFile(`${baseNoExt}.${requestedExt}`);
    if (direct) return direct;
  }

  if (baseExt && CODE_EXTENSIONS.includes(baseExt)) {
    const direct = tryFile(baseName);
    if (direct) return direct;
  }

  if (!requestedExt) {
    for (const ext of CODE_EXTENSIONS) {
      const direct = tryFile(`${baseNoExt}.${ext}`);
      if (direct) return direct;
    }
  }

  const maybeDir = byName.get(baseNoExt);
  if (maybeDir && maybeDir.type === "dir") {
    const subDir = path.posix.join(dirPart, baseNoExt);
    const subEntries = await githubListDir(subDir, ref, token);
    const subByName = new Map(subEntries.map((entry) => [entry.name, entry]));

    const tryIndex = (ext) => {
      const indexName = `index.${ext}`;
      const entry = subByName.get(indexName);
      return entry && entry.type === "file"
        ? path.posix.join(subDir, indexName)
        : null;
    };

    if (requestedExt) {
      const withExt = tryIndex(requestedExt);
      if (withExt) return withExt;
    } else {
      for (const ext of CODE_EXTENSIONS) {
        const withExt = tryIndex(ext);
        if (withExt) return withExt;
      }
    }
  }

  return null;
}

function buildOutputFile(
  projectRoot,
  outputPath,
  importPath,
  resolvedRepoPath,
  ext
) {
  const cleanedOutput = stripQuotes(outputPath);
  const outputBase = cleanedOutput
    ? path.resolve(projectRoot, cleanedOutput)
    : projectRoot;

  const requestedExt = normalizeExtension(ext);
  const finalExt =
    requestedExt || normalizeExtension(path.posix.extname(resolvedRepoPath));
  const fileStem = path.posix.basename(importPath).replace(/\.[^.]+$/, "");
  const fileName = finalExt ? `${fileStem}.${finalExt}` : fileStem;

  if (path.extname(outputBase)) {
    return outputBase;
  }
  return path.join(outputBase, fileName);
}

function toRelativeImport(fromFileAbs, toFileAbs) {
  const rel = toPosix(path.relative(path.dirname(fromFileAbs), toFileAbs));
  return rel.startsWith(".") ? rel : `./${rel}`;
}

function printUsage() {
  const help = [
    "Usage:",
    "  node scripts/fdk_file_fetcher.js --file-path <import-path> [options]",
    "",
    "Required:",
    '  --file-path    e.g. "fdk-react-templates/page-layouts/single-checkout/shipment/single-page-shipment"',
    "",
    "Optional:",
    "  --mode         chat | create (default: chat)",
    "  --extension    jsx | tsx | js | ts | less | css | scss | sass",
    "  --call-path    Caller file path from project root (used for suggested import in create mode)",
    "  --output       Output directory or file path from project root (create mode only; defaults to project root)",
    "  --project-root Absolute project root (auto-detected if omitted)",
    "  --github-token Optional GitHub token (or use GITHUB_TOKEN env)",
  ].join("\n");
  process.stdout.write(`${help}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printUsage();
    return;
  }

  const mode = stripQuotes(args.mode || "").toLowerCase() || "chat";
  if (!["chat", "create"].includes(mode)) {
    failWithFormat(`Invalid --mode "${args.mode}". Use "chat" or "create".`);
  }

  const importPath = stripQuotes(args["file-path"] || args.filePath || "");
  if (!importPath) {
    failWithFormat('Missing --file-path. Expected "fdk-react-templates/...".');
  }

  if (!importPath.startsWith(`${PACKAGE_NAME}/`)) {
    failWithFormat(
      `--file-path must start with "${PACKAGE_NAME}/". Received: "${importPath}"`
    );
  }

  announce(`Executing skill in "${mode}" mode for "${importPath}"`);

  const projectRoot =
    stripQuotes(args["project-root"] || "") || detectProjectRoot();
  const commitHash = readCommitHash(projectRoot);
  if (!commitHash) {
    fail(
      `Could not find ${PACKAGE_NAME} commit hash in ${path.join(projectRoot, "package-lock.json")}.`
    );
  }

  const requestedExt = normalizeExtension(stripQuotes(args.extension || ""));
  const packagePath = importPath.slice(`${PACKAGE_NAME}/`.length);
  const token =
    stripQuotes(args["github-token"] || "") || process.env.GITHUB_TOKEN || null;

  const repoPath = await resolveFileInRepo(
    packagePath,
    commitHash,
    token,
    requestedExt
  );
  if (!repoPath) {
    fail(
      `Could not resolve source for "${importPath}" in ${GITHUB_OWNER}/${GITHUB_REPO}@${commitHash.slice(0, 8)}.`
    );
  }

  const content = await githubGetRaw(repoPath, commitHash, token);

  if (mode === "chat") {
    announce("Returning source code in chat mode");
    process.stdout.write(content);
    return;
  }

  const outputFile = buildOutputFile(
    projectRoot,
    args.output,
    importPath,
    repoPath,
    requestedExt
  );
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, content, "utf8");

  const callPath = stripQuotes(args["call-path"] || "");
  const response = {
    mode: "create",
    importPath,
    repoPath,
    commitHash: commitHash.slice(0, 8),
    outputFile: toPosix(path.relative(projectRoot, outputFile)),
    bytes: content.length,
  };

  if (callPath) {
    const callerAbs = path.resolve(projectRoot, callPath);
    response.suggestedLocalImport = toRelativeImport(callerAbs, outputFile);
    response.callPath = toPosix(callPath);
  }

  announce(`File created at "${response.outputFile}"`);
  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
}

main().catch((err) => {
  fail(`fdk_file_fetcher failed: ${err.message || String(err)}`);
});
