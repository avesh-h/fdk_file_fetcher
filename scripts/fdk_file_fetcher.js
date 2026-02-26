#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const https = require("https");

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

function debug(message) {
  process.stderr.write(`[${SKILL_LABEL}][debug] ${message}\n`);
}

function expectedInputFormat() {
  return [
    "Expected input format:",
    'File path : "@gofynd/theme-template/page-layouts/single-checkout/shipment/single-page-shipment"',
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

function normalizePathForMatch(p) {
  return toPosix(String(p || ""))
    .replace(/^\.?\//, "")
    .replace(/\/+/g, "/")
    .toLowerCase();
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
      },
    );

    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

async function fetchJson(url, headers) {
  const body = await httpGet(url, headers);
  return JSON.parse(body);
}

async function githubRepoMeta(owner, repo, token) {
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = { Accept: "application/vnd.github.v3+json" };
  if (token) headers.Authorization = `token ${token}`;
  return fetchJson(url, headers);
}

async function githubTree(owner, repo, ref, token) {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
  const headers = { Accept: "application/vnd.github.v3+json" };
  if (token) headers.Authorization = `token ${token}`;
  const data = await fetchJson(url, headers);
  return Array.isArray(data?.tree) ? data.tree : [];
}

async function githubGetRaw(owner, repo, filePath, ref, token) {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`;
  const headers = {};
  if (token) headers.Authorization = `token ${token}`;
  return httpGet(url, headers);
}

function detectProjectRoot() {
  let dir = process.cwd();
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function readLockData(projectRoot) {
  const lockPath = path.join(projectRoot, "package-lock.json");
  if (!fs.existsSync(lockPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
}

function getLockEntry(lockData, packageName) {
  if (!lockData || !packageName) return null;
  return (
    lockData?.packages?.[`node_modules/${packageName}`] ||
    lockData?.dependencies?.[packageName] ||
    null
  );
}

function normalizeExtension(ext) {
  if (!ext) return null;
  const cleaned = String(ext).replace(/^\./, "").toLowerCase().trim();
  return cleaned || null;
}

function parseImportPath(importPath) {
  const trimmed = stripQuotes(importPath);
  const parts = trimmed.split("/").filter(Boolean);
  if (!parts.length) return null;
  let packageName = parts[0];
  let filePathParts = parts.slice(1);
  if (trimmed.startsWith("@")) {
    if (parts.length < 3) return null;
    packageName = `${parts[0]}/${parts[1]}`;
    filePathParts = parts.slice(2);
  }
  const filePath = filePathParts.join("/");
  if (!filePath) return null;
  return { packageName, filePath };
}

function parseGithubRepo(value) {
  if (!value) return null;
  const raw = String(value)
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/^git@github\.com:/, "https://github.com/")
    .trim();
  const m = raw.match(
    /github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/?].*)?(?:#(.+))?$/i,
  );
  if (!m) return null;
  return { owner: m[1], repo: m[2], ref: m[3] || null };
}

function parseRefFromResolved(resolved) {
  if (!resolved) return null;
  const m = String(resolved).match(/#([A-Za-z0-9._/-]+)$/);
  return m ? m[1] : null;
}

function getRepositoryUrl(repoField) {
  if (!repoField) return null;
  if (typeof repoField === "string") return repoField;
  if (typeof repoField === "object" && repoField.url) return repoField.url;
  return null;
}

function uniqueNonEmpty(values) {
  return [...new Set(values.filter(Boolean).map((v) => String(v).trim()))];
}

function extractGithubRepoFromReadme(readme) {
  if (!readme || typeof readme !== "string") return null;
  const m = readme.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i);
  if (!m) return null;
  return parseGithubRepo(`https://github.com/${m[1]}`);
}

function scorePathMatch(candidatePath, wantedPath, requestedExt, sourcePrefix) {
  const c = normalizePathForMatch(candidatePath);
  const w = normalizePathForMatch(wantedPath);
  const cBase = path.posix.basename(c);
  const wBase = path.posix.basename(w);
  const cNoExt = cBase.replace(/\.[^.]+$/, "");
  const wNoExt = wBase.replace(/\.[^.]+$/, "");
  const cExt = normalizeExtension(path.posix.extname(cBase));

  let score = 0;
  if (c === w) score = 120;
  else if (c.startsWith(`${w}.`)) score = 110;
  else if (c.endsWith(`/${w}`)) score = 95;
  else if (c.endsWith(`/${wNoExt}`)) score = 90;
  else if (cNoExt === wNoExt) score = 80;
  else if (cBase.includes(wNoExt)) score = 60;

  if (requestedExt && cExt === requestedExt) score += 20;
  if (sourcePrefix && c.startsWith(`${normalizePathForMatch(sourcePrefix)}/`)) {
    score += 8;
  }

  const wantedSegments = w.split("/").filter(Boolean);
  const candidateSegments = c.split("/").filter(Boolean);
  let aligned = 0;
  for (
    let i = 0;
    i < Math.min(wantedSegments.length, candidateSegments.length);
    i++
  ) {
    if (
      wantedSegments[wantedSegments.length - 1 - i] ===
      candidateSegments[candidateSegments.length - 1 - i]
    ) {
      aligned += 1;
    } else {
      break;
    }
  }
  score += Math.min(aligned * 5, 20);
  return score;
}

function pickBestTreeFile(treeItems, wantedPath, requestedExt, sourcePrefix) {
  const files = treeItems.filter((item) => item?.type === "blob" && item?.path);
  const scored = files
    .map((item) => {
      const ext = normalizeExtension(path.posix.extname(item.path));
      if (requestedExt && ext !== requestedExt) return null;
      if (!requestedExt && ext && !CODE_EXTENSIONS.includes(ext)) return null;
      return {
        path: item.path,
        score: scorePathMatch(
          item.path,
          wantedPath,
          requestedExt,
          sourcePrefix,
        ),
      };
    })
    .filter(Boolean)
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.length ? scored[0].path : null;
}

async function fetchNpmMetadata(packageName) {
  const encodedName = packageName.startsWith("@")
    ? packageName.replace("/", "%2f")
    : packageName;
  const url = `https://registry.npmjs.org/${encodedName}`;
  return fetchJson(url, {});
}

function readInstalledPackageJson(projectRoot, packageName) {
  const pkgPath = path.join(
    projectRoot,
    "node_modules",
    ...packageName.split("/"),
    "package.json",
  );
  if (!fs.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch {
    return null;
  }
}

async function resolveRepoAndRefs({
  packageName,
  projectRoot,
  lockData,
  manualRepo,
  manualRef,
  preferLatest,
  token,
}) {
  const lockEntry = getLockEntry(lockData, packageName) || {};
  const resolved = lockEntry?.resolved || "";
  const lockParsed = parseGithubRepo(resolved);
  const lockRef = parseRefFromResolved(resolved);
  const version = lockEntry?.version || null;
  const installedPkg = readInstalledPackageJson(projectRoot, packageName);

  let repoInfo = null;
  const manualRepoInfo = manualRepo ? parseGithubRepo(manualRepo) : null;
  const installedRepoInfo = installedPkg
    ? parseGithubRepo(getRepositoryUrl(installedPkg.repository))
    : null;

  let npmData = null;
  try {
    npmData = await fetchNpmMetadata(packageName);
  } catch (err) {
    debug(
      `resolveRepoAndRefs:npmMetadataFailed package=${packageName} error=${err?.message || String(err)}`,
    );
    // ignore registry errors; fallback to local-only metadata sources
  }

  const latest = npmData?.["dist-tags"]?.latest;
  const npmRootRepo = parseGithubRepo(getRepositoryUrl(npmData?.repository));
  const npmVersionRepo = parseGithubRepo(
    getRepositoryUrl(npmData?.versions?.[latest]?.repository),
  );
  const npmReadmeRepo = extractGithubRepoFromReadme(npmData?.readme);

  const repoCandidates = preferLatest
    ? [
        manualRepoInfo,
        npmRootRepo,
        npmVersionRepo,
        npmReadmeRepo,
        lockParsed,
        installedRepoInfo,
      ]
    : [
        manualRepoInfo,
        lockParsed,
        installedRepoInfo,
        npmRootRepo,
        npmVersionRepo,
        npmReadmeRepo,
      ];

  repoInfo = repoCandidates.find(Boolean) || null;

  if (!repoInfo) {
    debug(
      `resolveRepoAndRefs:noRepoCandidate package=${packageName} manualRepo=${manualRepo || "none"}`,
    );
    return null;
  }

  let defaultBranch = null;
  try {
    const meta = await githubRepoMeta(repoInfo.owner, repoInfo.repo, token);
    defaultBranch = meta?.default_branch || null;
  } catch (err) {
    debug(
      `resolveRepoAndRefs:githubRepoMetaFailed repo=${repoInfo.owner}/${repoInfo.repo} error=${err?.message || String(err)}`,
    );
    // ignore and continue with fallback refs
  }

  const installedVersion = installedPkg?.version || null;
  const effectiveVersion = installedVersion || version;

  const stableRefs = uniqueNonEmpty([
    manualRef,
    lockRef,
    repoInfo.ref,
    effectiveVersion ? `v${effectiveVersion}` : null,
    effectiveVersion,
  ]);
  const branchRefs = uniqueNonEmpty([defaultBranch, "main", "master"]);
  const refs = preferLatest
    ? uniqueNonEmpty([...branchRefs, ...stableRefs])
    : uniqueNonEmpty([...stableRefs, ...branchRefs]);

  return {
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    refs,
  };
}

async function resolveFromGithub({
  repoInfo,
  packageFilePath,
  requestedExt,
  sourcePrefix,
  token,
}) {
  if (!repoInfo) {
    debug("resolveFromGithub:skipped reason=noRepoInfo");
    return null;
  }
  for (const ref of repoInfo.refs) {
    try {
      debug(`resolveFromGithub:tryingRef ref=${ref}`);
      const tree = await githubTree(repoInfo.owner, repoInfo.repo, ref, token);
      debug(`resolveFromGithub:treeFetched ref=${ref} items=${tree.length}`);
      const targetPath = pickBestTreeFile(
        tree,
        packageFilePath,
        requestedExt,
        sourcePrefix,
      );
      if (!targetPath) {
        debug(
          `resolveFromGithub:pathNotFound ref=${ref} wanted=${packageFilePath}`,
        );
        continue;
      }
      const content = await githubGetRaw(
        repoInfo.owner,
        repoInfo.repo,
        targetPath,
        ref,
        token,
      );
      debug(
        `resolveFromGithub:rawFetchSuccess ref=${ref} path=${targetPath} bytes=${content.length}`,
      );
      return {
        content,
        repoPath: targetPath,
        ref,
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        source: "github",
      };
    } catch (err) {
      debug(
        `resolveFromGithub:refFailed ref=${ref} error=${err?.message || String(err)}`,
      );
      // try next ref
    }
  }
  debug("resolveFromGithub:allRefsExhausted");
  return null;
}

function validateRequestedExtension(requestedExt) {
  if (requestedExt && !CODE_EXTENSIONS.includes(requestedExt)) {
    throw new Error(
      `Unsupported extension "${requestedExt}". Use one of: ${CODE_EXTENSIONS.join(", ")}`,
    );
  }
}

function buildOutputFile(
  projectRoot,
  outputPath,
  importPath,
  resolvedRepoPath,
  ext,
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
    '  --file-path    e.g. "@gofynd/theme-template/page-layouts/single-checkout/shipment/single-page-shipment"',
    "",
    "Optional:",
    "  --mode         chat | create (default: chat)",
    "  --extension    jsx | tsx | js | ts | less | css | scss | sass",
    "  --call-path    Caller file path from project root (used for suggested import in create mode)",
    "  --output       Output directory or file path from project root (create mode only; defaults to project root)",
    "  --project-root Absolute project root (auto-detected if omitted)",
    "  --repo         Optional GitHub repo URL override, e.g. https://github.com/org/repo",
    "  --ref          Optional Git ref override (commit/tag/branch)",
    "  --prefer-latest Prefer npm latest metadata + main/master branch first",
    "  --source-prefix Optional source root preference (e.g. src)",
    "  --output-format (chat mode only) raw | json (default: raw). Use json for agent parsing.",
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
    failWithFormat(
      'Missing --file-path. Expected "<package>/<path>" or "@scope/package/<path>".',
    );
  }

  const parsedImport = parseImportPath(importPath);
  if (!parsedImport) {
    failWithFormat(`Invalid --file-path "${importPath}".`);
  }
  const { packageName, filePath: packageFilePath } = parsedImport;

  announce(
    `Executing skill in "${mode}" mode for "${importPath}" (package: ${packageName})`,
  );

  const projectRoot =
    stripQuotes(args["project-root"] || "") || detectProjectRoot();
  const lockData = readLockData(projectRoot);
  if (!lockData) {
    announce(
      "package-lock.json not found or unreadable. Will continue with remote metadata resolution.",
    );
  }

  const requestedExt = normalizeExtension(stripQuotes(args.extension || ""));
  validateRequestedExtension(requestedExt);
  const sourcePrefix = stripQuotes(args["source-prefix"] || "") || null;
  const token =
    stripQuotes(args["github-token"] || "") || process.env.GITHUB_TOKEN || null;
  const manualRepo = stripQuotes(args.repo || "");
  const manualRef = stripQuotes(args.ref || "");
  const preferLatest = args["prefer-latest"] === true;

  const repoInfo = await resolveRepoAndRefs({
    packageName,
    projectRoot,
    lockData,
    manualRepo,
    manualRef,
    preferLatest,
    token,
  });

  let resolved = await resolveFromGithub({
    repoInfo,
    packageFilePath,
    requestedExt,
    sourcePrefix,
    token,
  });

  if (!resolved) {
    debug(
      `main:finalFailure package=${packageName} importPath=${importPath} ext=${requestedExt || "auto"}`,
    );
    fail(
      [
        `Could not resolve source for "${importPath}" from remote GitHub for package "${packageName}".`,
        "",
        "This script fetches only from GitHub (no local fallback). It requires network access to:",
        "  - api.github.com",
        "  - raw.githubusercontent.com",
        "  - registry.npmjs.org (optional, for package metadata)",
        "",
        "If running in an automated or sandboxed environment (e.g. agent), ensure outbound network is allowed for this command, or run the script locally and use the output.",
      ].join("\n"),
    );
  }

  const chatOutputFormat =
    stripQuotes(args["output-format"] || "").toLowerCase() || "raw";
  const useJsonOutput = chatOutputFormat === "json";

  if (mode === "chat") {
    announce(
      useJsonOutput
        ? "Returning source code in chat mode (JSON output)"
        : "Returning source code in chat mode",
    );
    if (useJsonOutput) {
      const payload = {
        success: true,
        content: resolved.content,
        repoPath: resolved.repoPath,
        ref: resolved.ref,
        repo:
          resolved.owner && resolved.repo
            ? `${resolved.owner}/${resolved.repo}`
            : resolved.repo,
        packageName,
        importPath,
      };
      process.stdout.write(JSON.stringify(payload));
    } else {
      process.stdout.write(resolved.content);
    }
    return;
  }

  const outputFile = buildOutputFile(
    projectRoot,
    args.output,
    importPath,
    resolved.repoPath,
    requestedExt,
  );
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, resolved.content, "utf8");

  const callPath = stripQuotes(args["call-path"] || "");
  const response = {
    mode: "create",
    packageName,
    importPath,
    repoPath: resolved.repoPath,
    ref: resolved.ref,
    source: resolved.source,
    repo: resolved.owner ? `${resolved.owner}/${resolved.repo}` : resolved.repo,
    outputFile: toPosix(path.relative(projectRoot, outputFile)),
    bytes: resolved.content.length,
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
