const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cp = require("child_process");

const CONFIG = {
  // Change this once if you do not want to use an env var.
  vaultPath:
    process.env.OBSIDIAN_VAULT_PATH ||
    "C:/vaults",

  projectsFolder: "Projects",
  largeFileBytes: 180000,
  hugeFileLines: 3000,
  maxSearchHits: 8,
  maxReadNotes: 4,
  maxExcerptChars: 900,
  maxImports: 12,
  maxExports: 12,
  maxFunctions: 15,
  maxClasses: 10,
  maxRoutes: 10
};

function readStdinJson() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => {
      try {
        resolve(data.trim() ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    process.stdin.resume();
  });
}

function safeMkdir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function fileExists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function readText(p, fallback = "") {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return fallback;
  }
}

function writeText(p, content) {
  safeMkdir(path.dirname(p));
  fs.writeFileSync(p, content, "utf8");
}

function appendText(p, content) {
  safeMkdir(path.dirname(p));
  fs.appendFileSync(p, content, "utf8");
}

function nowIso() {
  return new Date().toISOString();
}

function todayFile() {
  return new Date().toISOString().slice(0, 10) + ".md";
}

function run(command, args = [], opts = {}) {
  const res = cp.spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    ...opts
  });
  return {
    ok: res.status === 0,
    status: res.status,
    stdout: (res.stdout || "").trim(),
    stderr: (res.stderr || "").trim()
  };
}

function detectRepoRoot(cwd) {
  const git = run("git", ["rev-parse", "--show-toplevel"], { cwd });
  if (git.ok && git.stdout) return normalizePath(git.stdout);
  return normalizePath(cwd || process.cwd());
}

function getGitHead(repoRoot) {
  const res = run("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
  return res.ok ? res.stdout : null;
}

function getGitDirty(repoRoot) {
  const res = run("git", ["status", "--porcelain"], { cwd: repoRoot });
  if (!res.ok) return false;
  return Boolean(res.stdout.trim());
}

function normalizePath(p) {
  return path.resolve(String(p || ""));
}

function sanitizeName(s) {
  return String(s)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function repoKeyFromRoot(repoRoot) {
  const base = sanitizeName(path.basename(repoRoot))
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  const hash = crypto
    .createHash("sha1")
    .update(repoRoot)
    .digest("hex")
    .slice(0, 8);
  return `${base}__${hash}`;
}

function getVaultRootPaths() {
  return {
    vaultHomePath: path.join(CONFIG.vaultPath, "00_Vault_Home.md"),
    projectsIndexPath: path.join(CONFIG.vaultPath, "Projects_Index.md")
  };
}

function projectPrefix(repoRoot) {
  const name = path.basename(repoRoot).replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_");
  // Use a short readable prefix: "ACMS", "lumo_fashion", etc.
  return name.replace(/-/g, "_");
}

function getProjectPaths(repoRoot) {
  const repoKey = repoKeyFromRoot(repoRoot);
  const prefix = projectPrefix(repoRoot);
  const projectDir = path.join(CONFIG.vaultPath, CONFIG.projectsFolder, repoKey);
  const stateDir = path.join(projectDir, "06_State");
  return {
    repoRoot,
    repoKey,
    prefix,
    projectDir,
    stateDir,
    manifestPath: path.join(stateDir, "manifest.json"),
    staleFilePath: path.join(stateDir, `${prefix}_stale_files.md`),
    projectIndexPath: path.join(projectDir, `${prefix}_Project_Index.md`),
    fileIndexPath: path.join(projectDir, `${prefix}_File_Index.md`),
    featureIndexPath: path.join(projectDir, `${prefix}_Feature_Index.md`),
    flowIndexPath: path.join(projectDir, `${prefix}_Flow_Index.md`),
    decisionIndexPath: path.join(projectDir, `${prefix}_Decision_Index.md`),
    unclassifiedPath: path.join(projectDir, `${prefix}_Unclassified.md`),
    // Wikilink stems (used in note content)
    projectIndexStem: `${prefix}_Project_Index`,
    fileIndexStem: `${prefix}_File_Index`,
    featureIndexStem: `${prefix}_Feature_Index`,
    flowIndexStem: `${prefix}_Flow_Index`,
    decisionIndexStem: `${prefix}_Decision_Index`,
    unclassifiedStem: `${prefix}_Unclassified`,
    fileNotesDir: path.join(projectDir, "01_File_Notes"),
    featureHubsDir: path.join(projectDir, "02_Feature_Hubs"),
    flowsDir: path.join(projectDir, "03_Flows"),
    decisionsDir: path.join(projectDir, "04_Decisions"),
    changeLogDir: path.join(projectDir, "05_Change_Log")
  };
}

function ensureProjectSkeleton(pathsObj) {
  safeMkdir(pathsObj.projectDir);
  safeMkdir(pathsObj.stateDir);
  safeMkdir(pathsObj.fileNotesDir);
  safeMkdir(pathsObj.featureHubsDir);
  safeMkdir(pathsObj.flowsDir);
  safeMkdir(pathsObj.decisionsDir);
  safeMkdir(pathsObj.changeLogDir);

  if (!fileExists(pathsObj.projectIndexPath)) {
    writeText(pathsObj.projectIndexPath, buildProjectIndex(pathsObj.repoKey, pathsObj.repoRoot));
  }

  if (!fileExists(pathsObj.fileIndexPath)) {
    writeText(pathsObj.fileIndexPath, buildTypedIndex("file_index", "File Index", "All file notes for this project.", pathsObj.repoKey, pathsObj.prefix));
  }
  if (!fileExists(pathsObj.featureIndexPath)) {
    writeText(pathsObj.featureIndexPath, buildTypedIndex("feature_index", "Feature Index", "All feature hubs for this project.", pathsObj.repoKey, pathsObj.prefix));
  }
  if (!fileExists(pathsObj.flowIndexPath)) {
    writeText(pathsObj.flowIndexPath, buildTypedIndex("flow_index", "Flow Index", "All documented flows for this project.", pathsObj.repoKey, pathsObj.prefix));
  }
  if (!fileExists(pathsObj.decisionIndexPath)) {
    writeText(pathsObj.decisionIndexPath, buildTypedIndex("decision_index", "Decision Index", "All architectural decisions for this project.", pathsObj.repoKey, pathsObj.prefix));
  }
  if (!fileExists(pathsObj.unclassifiedPath)) {
    writeText(pathsObj.unclassifiedPath, buildTypedIndex("unclassified_index", "Unclassified Files", "Files with notes that have not been assigned to any feature hub.", pathsObj.repoKey, pathsObj.prefix));
  }

  if (!fileExists(pathsObj.staleFilePath)) {
    writeText(
      pathsObj.staleFilePath,
      `# Stale files\n\nFiles that changed and may need a broader vault refresh.\n\n`
    );
  }

  if (!fileExists(pathsObj.manifestPath)) {
    writeManifest(pathsObj.manifestPath, defaultManifest(pathsObj.repoKey, pathsObj.repoRoot));
  }
}

function defaultManifest(repoKey, repoRoot) {
  return {
    repoKey,
    repoRoot,
    repoName: path.basename(repoRoot),
    createdAt: nowIso(),
    lastSeenAt: nowIso(),
    lastIndexedAt: null,
    lastDeepScanAt: null,
    lastIndexedCommit: null,
    workingTreeState: "uninitialized",
    bootstrapComplete: false,
    needsBootstrap: true,
    explicitRescanRequested: false
  };
}

function readManifest(manifestPath) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

function writeManifest(manifestPath, manifest) {
  safeMkdir(path.dirname(manifestPath));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

function buildProjectIndex(repoKey, repoRoot) {
  const prefix = projectPrefix(repoRoot);
  return `---
kind: project_index
repo_key: ${repoKey}
repo_root: ${repoRoot.replace(/\\/g, "/")}
created_at: ${nowIso()}
---

# Project Index

## Status
- This project namespace was created automatically.
- Full bootstrap has not been run yet unless the manifest says otherwise.

## Indexes
- [[${prefix}_File_Index]] — All file notes
- [[${prefix}_Feature_Index]] — Feature hubs
- [[${prefix}_Flow_Index]] — Documented flows
- [[${prefix}_Decision_Index]] — Architectural decisions
- [[${prefix}_Unclassified]] — Files without hub assignment

## Notes
Use the vault as an index. Treat the codebase as source of truth.
`;
}

function buildTypedIndex(kind, title, description, repoKey, prefix) {
  const projStem = prefix ? `${prefix}_Project_Index` : "00_Project_Index";
  return `---
kind: ${kind}
repo_key: ${repoKey}
updated_at: ${nowIso().slice(0, 10)}
---

# ${title}

${description} Links back to [[${projStem}]].

## Entries

_Populated during bootstrap or as notes are created._
`;
}

function appendEnvExports(varsObj) {
  const envFile = process.env.CLAUDE_ENV_FILE;
  if (!envFile) return;
  const lines = [];
  for (const [key, value] of Object.entries(varsObj)) {
    if (value === undefined || value === null) continue;
    const escaped = String(value).replace(/"/g, '\\"');
    lines.push(`export ${key}="${escaped}"`);
  }
  if (lines.length) {
    fs.appendFileSync(envFile, lines.join("\n") + "\n", "utf8");
  }
}

function relRepoPath(repoRoot, filePath) {
  const rel = path.relative(repoRoot, filePath);
  return rel.replace(/\\/g, "/");
}

function sanitizeNoteStem(relPath) {
  return relPath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/[<>:"|?*\x00-\x1F]/g, "_")
    .replace(/\//g, "__");
}

function fileNotePath(pathsObj, repoRelativePath) {
  const stem = sanitizeNoteStem(repoRelativePath);
  return path.join(pathsObj.fileNotesDir, `${stem}.md`);
}

function isTextFile(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const sample = buf.subarray(0, Math.min(buf.length, 4096));
    for (const byte of sample) {
      if (byte === 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function toLines(s) {
  return String(s || "").split(/\r?\n/);
}

function uniqueLimited(arr, max = 10) {
  const out = [];
  const seen = new Set();
  for (const item of arr) {
    const v = String(item || "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function firstCommentLine(text) {
  const lines = toLines(text).slice(0, 40);
  for (const line of lines) {
    const t = line.trim();
    if (
      t.startsWith("//") ||
      t.startsWith("#") ||
      t.startsWith("/*") ||
      t.startsWith("*") ||
      t.startsWith("--")
    ) {
      return t.replace(/^[/#*\-\s]+/, "").trim();
    }
  }
  return "";
}

function extractStructure(filePath, text) {
  const ext = path.extname(filePath).toLowerCase();
  const lines = toLines(text);
  const imports = [];
  const exportsList = [];
  const functions = [];
  const classes = [];
  const routes = [];

  for (const line of lines.slice(0, 800)) {
    const t = line.trim();

    if (
      /^import\s.+from\s+['"`].+['"`];?$/.test(t) ||
      /^const\s+\w+\s*=\s*require\(.+\);?$/.test(t) ||
      /^from\s+\S+\s+import\s+.+$/.test(t) ||
      /^#include\s+[<"].+[>"]$/.test(t)
    ) {
      imports.push(t);
    }

    if (
      /^export\s+(default\s+)?(class|function|const|let|var)\s+/.test(t) ||
      /^module\.exports\s*=/.test(t) ||
      /^exports\.\w+\s*=/.test(t) ||
      /^def\s+\w+\(/.test(t) ||
      /^class\s+\w+/.test(t)
    ) {
      exportsList.push(t);
    }

    const fnMatch =
      t.match(/^function\s+([A-Za-z0-9_]+)\s*\(/) ||
      t.match(/^const\s+([A-Za-z0-9_]+)\s*=\s*(async\s*)?\(/) ||
      t.match(/^export\s+function\s+([A-Za-z0-9_]+)\s*\(/) ||
      t.match(/^def\s+([A-Za-z0-9_]+)\s*\(/);
    if (fnMatch) functions.push(fnMatch[1]);

    const classMatch =
      t.match(/^class\s+([A-Za-z0-9_]+)/) ||
      t.match(/^export\s+class\s+([A-Za-z0-9_]+)/);
    if (classMatch) classes.push(classMatch[1]);

    if (
      /(router|get|post|put|patch|delete)\s*\(/i.test(t) ||
      /app\.(get|post|put|patch|delete)\s*\(/i.test(t) ||
      /@(Get|Post|Put|Patch|Delete)\b/.test(t)
    ) {
      routes.push(t);
    }
  }

  const purposeGuess =
    firstCommentLine(text) ||
    `${path.basename(filePath)} appears to define application logic or configuration related to ${path.basename(filePath, ext)}.`;

  return {
    ext,
    lineCount: lines.length,
    sizeBytes: Buffer.byteLength(text, "utf8"),
    imports: uniqueLimited(imports, CONFIG.maxImports),
    exportsList: uniqueLimited(exportsList, CONFIG.maxExports),
    functions: uniqueLimited(functions, CONFIG.maxFunctions),
    classes: uniqueLimited(classes, CONFIG.maxClasses),
    routes: uniqueLimited(routes, CONFIG.maxRoutes),
    purposeGuess
  };
}

function extractExistingFeatureHubs(noteText) {
  const hubs = [];

  const fmMatch = noteText.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm = fmMatch[1];
    const lines = toLines(fm);
    let inFeatureHubs = false;

    for (const line of lines) {
      if (/^feature_hubs:\s*$/.test(line.trim())) {
        inFeatureHubs = true;
        continue;
      }
      if (inFeatureHubs) {
        const m = line.match(/^\s*-\s*(.+?)\s*$/);
        if (m) {
          hubs.push(m[1].replace(/^"+|"+$/g, ""));
          continue;
        }
        if (/^\S/.test(line)) {
          inFeatureHubs = false;
        }
      }
    }
  }

  for (const match of noteText.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const target = match[1];
    // Skip index/structural links — they are not feature hubs
    if (/Project_Index|File_Index|Feature_Index|Flow_Index|Decision_Index|Unclassified|01_File_Notes|03_Flows|04_Decisions|05_Change_Log|00_Project_Index/.test(target)) {
      continue;
    }
    hubs.push(target);
  }

  return uniqueLimited(hubs, 20);
}

function extractManualNotes(existingText) {
  const m = existingText.match(/## Manual notes\s*([\s\S]*)$/);
  return m ? m[1].trim() : "_Add durable human notes here._";
}

function yamlList(items) {
  if (!items || !items.length) return "[]";
  return "\n" + items.map((x) => `  - "${String(x).replace(/"/g, '\\"')}"`).join("\n");
}

function buildFileNoteContent({
  repoKey,
  repoRelativePath,
  sourceAbsPath,
  structure,
  featureHubs,
  stale,
  manualNotes,
  prefix
}) {
  const unclStem = prefix ? `${prefix}_Unclassified` : "50_Unclassified_Files";
  const linkedHubsBlock = featureHubs.length
    ? featureHubs.map((h) => `- [[${h}]]`).join("\n")
    : `- [[${unclStem}]]`;

  const importsBlock = structure.imports.length
    ? structure.imports.map((x) => `- \`${x}\``).join("\n")
    : "- None detected";

  const exportsBlock = structure.exportsList.length
    ? structure.exportsList.map((x) => `- \`${x}\``).join("\n")
    : "- None detected";

  const functionsBlock = structure.functions.length
    ? structure.functions.map((x) => `- \`${x}\``).join("\n")
    : "- None detected";

  const classesBlock = structure.classes.length
    ? structure.classes.map((x) => `- \`${x}\``).join("\n")
    : "- None detected";

  const routesBlock = structure.routes.length
    ? structure.routes.map((x) => `- \`${x}\``).join("\n")
    : "- None detected";

  return `---
kind: file_note
repo_key: "${repoKey}"
source_path: "${repoRelativePath}"
source_abs_path: "${sourceAbsPath.replace(/\\/g, "/")}"
last_synced: "${nowIso()}"
stale: ${stale ? "true" : "false"}
feature_hubs:${yamlList(featureHubs)}
---

# ${repoRelativePath}

**Indexes:** [[${prefix ? prefix + "_Project_Index" : "00_Project_Index"}]] | [[${prefix ? prefix + "_File_Index" : "10_File_Index"}]]

## Managed summary
- Purpose guess: ${structure.purposeGuess}
- Extension: \`${structure.ext || "unknown"}\`
- Size bytes: ${structure.sizeBytes}
- Line count: ${structure.lineCount}

## Imports
${importsBlock}

## Exports / definitions
${exportsBlock}

## Functions
${functionsBlock}

## Classes
${classesBlock}

## Route hints
${routesBlock}

## Linked feature hubs
${linkedHubsBlock}

## Manual notes
${manualNotes}
`;
}

function appendUniqueBullet(filePath, bulletLine, heading = null) {
  let content = readText(filePath, "");
  if (!content) {
    content = heading ? `# ${heading}\n\n` : "";
  }

  if (content.includes(bulletLine)) {
    return;
  }

  appendText(filePath, `${bulletLine}\n`);
}

function markStale(pathsObj, repoRelativePath, reason) {
  const line = `- [ ] ${repoRelativePath} — ${reason} — ${nowIso()}`;
  appendUniqueBullet(pathsObj.staleFilePath, line, "Stale files");
}

function findHubNotePath(pathsObj, hubName) {
  const sanitized = sanitizeName(hubName).replace(/[/\\]/g, "__");
  const candidates = [
    path.join(pathsObj.featureHubsDir, `${hubName}.md`),
    path.join(pathsObj.featureHubsDir, `${sanitized}.md`)
  ];
  return candidates.find(fileExists) || candidates[1];
}

function touchHub(pathsObj, hubName, repoRelativePath) {
  const hubPath = findHubNotePath(pathsObj, hubName);
  if (!fileExists(hubPath)) {
    writeText(
      hubPath,
      `---
kind: feature_hub
last_synced: "${nowIso()}"
---

# ${hubName}

## Recently touched files
- ${repoRelativePath} — ${nowIso()}
`
    );
    return;
  }

  const line = `- ${repoRelativePath} — ${nowIso()}`;
  appendUniqueBullet(hubPath, line);
}

function appendChangeLog(pathsObj, repoRelativePath, action) {
  const logPath = path.join(pathsObj.changeLogDir, todayFile());
  if (!fileExists(logPath)) {
    writeText(logPath, `# ${todayFile().replace(/\.md$/, "")}\n\n`);
  }
  const noteStem = sanitizeNoteStem(repoRelativePath);
  appendText(logPath, `- ${nowIso()} — ${action} — [[${noteStem}]] (\`${repoRelativePath}\`)\n`);
}

function obsidianCommand(commandName, params = {}, opts = {}) {
  const args = [commandName];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === false) continue;
    if (v === true) args.push(k);
    else args.push(`${k}=${v}`);
  }

  const res = run("obsidian", args, {
    cwd: CONFIG.vaultPath,
    ...opts
  });
  return res;
}

function tryParseJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalizeSearchOutput(stdout) {
  const parsed = tryParseJson(stdout);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.results)) return parsed.results;
  if (!stdout) return [];
  return stdout
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function trimForContext(text, maxChars = CONFIG.maxExcerptChars) {
  const cleaned = String(text || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(0, maxChars) + "\n…";
}

function extractKeywords(prompt) {
  const stop = new Set([
    "the","and","for","with","that","this","from","into","your","have","will","just","need",
    "want","make","build","update","change","file","files","code","repo","project","vault",
    "please","about","when","where","what","which","then","them","they","their","should",
    "using","used","only","does","doesnt","don't","dont","can","could","would","like","after",
    "before","there","here","each","everything","anything","something","without","explicit",
    "instructions","whole","through","across","global","setup"
  ]);

  const fileLike = [...String(prompt || "").matchAll(/[\w./\\-]+\.[A-Za-z0-9]+/g)].map((m) => m[0]);
  const words = String(prompt || "")
    .toLowerCase()
    .match(/[a-z0-9_/-]{3,}/g) || [];

  const picked = [];
  const seen = new Set();

  for (const f of fileLike) {
    if (!seen.has(f)) {
      seen.add(f);
      picked.push(f);
    }
  }

  for (const w of words) {
    if (stop.has(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    picked.push(w);
    if (picked.length >= 10) break;
  }

  return picked;
}

function importantWatchPaths(repoRoot) {
  const configNames = [
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "pyproject.toml",
    "poetry.lock",
    "requirements.txt",
    "go.mod",
    "go.sum",
    "Cargo.toml",
    "pom.xml",
    "build.gradle",
    "settings.gradle",
    "Dockerfile",
    "docker-compose.yml",
    "README.md",
    ".env",
    ".env.local",
    ".env.development",
    ".env.production"
  ];

  const sourceDirs = [
    "src", "app", "lib", "pages", "routes", "api",
    "components", "services", "utils", "hooks",
    "backend", "frontend", "server", "client"
  ];

  const paths = [];

  // Config files at repo root
  for (const name of configNames) {
    const p = path.join(repoRoot, name);
    if (fileExists(p)) paths.push(normalizePath(p));
  }

  // Source directories (absolute paths for watchPaths)
  for (const dir of sourceDirs) {
    const p = path.join(repoRoot, dir);
    if (fileExists(p)) paths.push(normalizePath(p));
  }

  return paths;
}

module.exports = {
  CONFIG,
  readStdinJson,
  run,
  detectRepoRoot,
  getGitHead,
  getGitDirty,
  normalizePath,
  repoKeyFromRoot,
  projectPrefix,
  getVaultRootPaths,
  getProjectPaths,
  ensureProjectSkeleton,
  readManifest,
  writeManifest,
  appendEnvExports,
  relRepoPath,
  sanitizeNoteStem,
  fileNotePath,
  isTextFile,
  readText,
  writeText,
  extractStructure,
  extractExistingFeatureHubs,
  extractManualNotes,
  buildFileNoteContent,
  buildTypedIndex,
  markStale,
  touchHub,
  appendChangeLog,
  obsidianCommand,
  normalizeSearchOutput,
  trimForContext,
  extractKeywords,
  importantWatchPaths,
  fileExists,
  safeMkdir,
  appendText,
  nowIso
};