#!/usr/bin/env node
/**
 * vault-scanner.js — Deterministic file inventory + heuristic dependency/route extraction.
 *
 * Usage: node vault-scanner.js [repoRoot]
 *
 * Layer 1 (deterministic): git ls-files → file_inventory.json
 * Layer 2 (heuristic):     regex-based import/route extraction → dependency_edges.json, route_map.json
 * Layer 3 (summary):       scan_coverage.json
 *
 * Outputs written to the project's 06_State/ directory in the vault.
 */

const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");

// ── Config ──────────────────────────────────────────────────────────────────

const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || "C:/vaults";
const PROJECTS_FOLDER = "Projects";
const LARGE_FILE_BYTES = 180000;
const HUGE_FILE_LINES = 3000;

const EXCLUDE_DIRS = new Set([
  "node_modules", "dist", "build", ".git", "__pycache__", ".next", ".nuxt",
  ".output", "coverage", ".cache", ".turbo", ".parcel-cache", "vendor",
  ".venv", "venv", "env", ".tox", "eggs", ".eggs", "target", "out",
  ".gradle", ".idea", ".vscode", ".vs"
]);

const EXCLUDE_PATTERNS = [
  /\.min\.(js|css)$/,
  /\.bundle\.(js|css)$/,
  /\.chunk\.(js|css)$/,
  /\.map$/,
  /\.lock$/i,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.DS_Store$/,
  /Thumbs\.db$/
];

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg", ".webp", ".avif",
  ".mp3", ".mp4", ".avi", ".mov", ".mkv", ".webm", ".wav", ".flac",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".exe", ".dll", ".so", ".dylib", ".o", ".obj", ".pyc", ".pyo",
  ".sqlite", ".db", ".wasm"
]);

const LANGUAGE_MAP = {
  ".py": "python", ".pyx": "python", ".pyi": "python",
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".ts": "typescript", ".tsx": "typescript", ".jsx": "javascript",
  ".go": "go", ".rs": "rust", ".rb": "ruby",
  ".java": "java", ".kt": "kotlin", ".scala": "scala",
  ".c": "c", ".h": "c", ".cpp": "cpp", ".hpp": "cpp",
  ".cs": "csharp", ".fs": "fsharp",
  ".swift": "swift", ".m": "objective-c",
  ".html": "html", ".htm": "html",
  ".css": "css", ".scss": "scss", ".less": "less", ".sass": "sass",
  ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".toml": "toml",
  ".xml": "xml", ".graphql": "graphql", ".gql": "graphql",
  ".sql": "sql", ".sh": "shell", ".bash": "shell", ".zsh": "shell",
  ".ps1": "powershell", ".psm1": "powershell",
  ".md": "markdown", ".mdx": "markdown",
  ".dockerfile": "docker", ".proto": "protobuf",
  ".tf": "terraform", ".hcl": "terraform",
  ".vue": "vue", ".svelte": "svelte"
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function run(cmd, args, opts) {
  const res = cp.spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, ...opts });
  return { ok: res.status === 0, stdout: (res.stdout || "").trim(), stderr: (res.stderr || "").trim() };
}

function repoKeyFromRoot(repoRoot) {
  const base = path.basename(repoRoot).replace(/[^a-zA-Z0-9._-]/g, "_");
  const hash = crypto.createHash("sha1").update(path.resolve(repoRoot)).digest("hex").slice(0, 8);
  return `${base}__${hash}`;
}

function classifyFile(relPath) {
  const ext = path.extname(relPath).toLowerCase();
  const basename = path.basename(relPath).toLowerCase();

  if (BINARY_EXTENSIONS.has(ext)) return { type: "binary", language: null, excluded: true, reason: "binary_extension" };

  const parts = relPath.replace(/\\/g, "/").split("/");
  for (const part of parts) {
    if (EXCLUDE_DIRS.has(part)) return { type: "excluded_dir", language: null, excluded: true, reason: `in_${part}` };
  }

  for (const pat of EXCLUDE_PATTERNS) {
    if (pat.test(relPath)) return { type: "excluded_pattern", language: null, excluded: true, reason: pat.toString() };
  }

  const language = LANGUAGE_MAP[ext] || null;
  const type = language ? "source" : (ext === "" ? "unknown" : "other");

  return { type, language, excluded: false, reason: null };
}

// ── Layer 1: Deterministic File Inventory ───────────────────────────────────

function buildInventory(repoRoot) {
  const gitRes = run("git", ["ls-files", "--full-name"], { cwd: repoRoot });
  if (!gitRes.ok) {
    console.error("git ls-files failed:", gitRes.stderr);
    return { files: [], excluded: [] };
  }

  const allFiles = gitRes.stdout.split(/\r?\n/).filter(Boolean);
  const files = [];
  const excluded = [];

  for (const relPath of allFiles) {
    const cls = classifyFile(relPath);
    const absPath = path.join(repoRoot, relPath);

    let sizeBytes = null;
    let lineCount = null;
    try {
      const stat = fs.statSync(absPath);
      sizeBytes = stat.size;
      if (!cls.excluded && sizeBytes <= LARGE_FILE_BYTES) {
        const content = fs.readFileSync(absPath, "utf8");
        lineCount = content.split(/\r?\n/).length;
      }
    } catch { /* file may not exist on disk */ }

    const entry = {
      path: relPath,
      extension: path.extname(relPath).toLowerCase(),
      language: cls.language,
      type: cls.type,
      sizeBytes,
      lineCount,
      oversized: sizeBytes !== null && (sizeBytes > LARGE_FILE_BYTES || (lineCount !== null && lineCount > HUGE_FILE_LINES))
    };

    if (cls.excluded) {
      excluded.push({ ...entry, reason: cls.reason });
    } else {
      files.push(entry);
    }
  }

  return { files, excluded };
}

// ── Layer 2: Heuristic Dependency & Route Extraction ────────────────────────

const IMPORT_PATTERNS = {
  python: [
    { re: /^from\s+(\S+)\s+import\s+/gm, group: 1, confidence: "high" },
    { re: /^import\s+(\S+)/gm, group: 1, confidence: "high" }
  ],
  javascript: [
    { re: /import\s+.*?from\s+['"]([^'"]+)['"]/gm, group: 1, confidence: "high" },
    { re: /require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm, group: 1, confidence: "high" },
    { re: /import\s*\(\s*['"]([^'"]+)['"]\s*\)/gm, group: 1, confidence: "medium" }
  ],
  typescript: null  // reuses javascript
};
IMPORT_PATTERNS.typescript = IMPORT_PATTERNS.javascript;

const ROUTE_PATTERNS = {
  python: [
    { re: /@(?:app|router|api)\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/gm, method: 1, path: 2, confidence: "high" },
    { re: /\.add_api_route\s*\(\s*["']([^"']+)["']/gm, method: null, path: 1, confidence: "medium" }
  ],
  javascript: [
    { re: /(?:app|router)\.(get|post|put|patch|delete|all)\s*\(\s*["']([^"']+)["']/gm, method: 1, path: 2, confidence: "high" },
    { re: /@(Get|Post|Put|Patch|Delete)\s*\(\s*["']([^"']+)["']/gm, method: 1, path: 2, confidence: "high" }
  ],
  typescript: null
};
ROUTE_PATTERNS.typescript = ROUTE_PATTERNS.javascript;

function extractDependencies(repoRoot, files) {
  const edges = [];

  for (const file of files) {
    if (!file.language || file.oversized) continue;
    const lang = file.language === "typescript" ? "typescript" : file.language;
    const patterns = IMPORT_PATTERNS[lang];
    if (!patterns) continue;

    let content;
    try {
      content = fs.readFileSync(path.join(repoRoot, file.path), "utf8");
    } catch { continue; }

    // Only scan first 200 lines for imports (they're at the top)
    const head = content.split(/\r?\n/).slice(0, 200).join("\n");

    for (const pat of patterns) {
      let m;
      const re = new RegExp(pat.re.source, pat.re.flags);
      while ((m = re.exec(head)) !== null) {
        const target = m[pat.group];
        if (target && !target.startsWith("http")) {
          edges.push({
            source: file.path,
            target,
            kind: "import",
            confidence: pat.confidence
          });
        }
      }
    }
  }

  return edges;
}

function extractRoutes(repoRoot, files) {
  const routes = [];

  for (const file of files) {
    if (!file.language || file.oversized) continue;
    const lang = file.language === "typescript" ? "typescript" : file.language;
    const patterns = ROUTE_PATTERNS[lang];
    if (!patterns) continue;

    let content;
    try {
      content = fs.readFileSync(path.join(repoRoot, file.path), "utf8");
    } catch { continue; }

    for (const pat of patterns) {
      let m;
      const re = new RegExp(pat.re.source, pat.re.flags);
      while ((m = re.exec(content)) !== null) {
        routes.push({
          file: file.path,
          method: pat.method !== null ? (m[pat.method] || "").toUpperCase() : "UNKNOWN",
          path: m[pat.path] || "",
          confidence: pat.confidence
        });
      }
    }

    // Next.js file-based routing heuristic
    if ((file.language === "javascript" || file.language === "typescript") &&
        /\/(app|pages)\//.test(file.path) &&
        /\/(page|route)\.(tsx?|jsx?)$/.test(file.path)) {
      const routePath = file.path
        .replace(/.*\/(app|pages)/, "")
        .replace(/\/(page|route)\.(tsx?|jsx?)$/, "")
        .replace(/\[([^\]]+)\]/g, ":$1")
        || "/";
      routes.push({
        file: file.path,
        method: "GET",
        path: routePath,
        confidence: "medium"
      });
    }
  }

  return routes;
}

// ── Layer 3: Summary ────────────────────────────────────────────────────────

function buildCoverage(inventory, edges, routes) {
  const byLanguage = {};
  for (const f of inventory.files) {
    const lang = f.language || "other";
    byLanguage[lang] = (byLanguage[lang] || 0) + 1;
  }

  return {
    scannedAt: new Date().toISOString(),
    totalTrackedFiles: inventory.files.length + inventory.excluded.length,
    includedFiles: inventory.files.length,
    excludedFiles: inventory.excluded.length,
    oversizedFiles: inventory.files.filter(f => f.oversized).length,
    byLanguage,
    dependencyEdges: edges.length,
    highConfidenceEdges: edges.filter(e => e.confidence === "high").length,
    routes: routes.length,
    highConfidenceRoutes: routes.filter(r => r.confidence === "high").length
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const repoRoot = path.resolve(process.argv[2] || process.cwd());

  // Verify it's a git repo
  const gitCheck = run("git", ["rev-parse", "--show-toplevel"], { cwd: repoRoot });
  if (!gitCheck.ok) {
    console.error(`Not a git repo: ${repoRoot}`);
    process.exit(1);
  }
  const actualRoot = path.resolve(gitCheck.stdout);

  const repoKey = repoKeyFromRoot(actualRoot);
  const stateDir = path.join(VAULT_PATH, PROJECTS_FOLDER, repoKey, "06_State");
  fs.mkdirSync(stateDir, { recursive: true });

  console.log(`Scanning: ${actualRoot}`);
  console.log(`Repo key: ${repoKey}`);
  console.log(`Output:   ${stateDir}`);

  // Layer 1
  console.log("\n[Layer 1] Building deterministic file inventory...");
  const inventory = buildInventory(actualRoot);
  console.log(`  ${inventory.files.length} included, ${inventory.excluded.length} excluded`);

  fs.writeFileSync(
    path.join(stateDir, "file_inventory.json"),
    JSON.stringify({ scannedAt: new Date().toISOString(), repoRoot: actualRoot, ...inventory }, null, 2),
    "utf8"
  );

  // Layer 2
  console.log("\n[Layer 2] Extracting heuristic dependencies...");
  const edges = extractDependencies(actualRoot, inventory.files);
  console.log(`  ${edges.length} dependency edges found`);

  fs.writeFileSync(
    path.join(stateDir, "dependency_edges.json"),
    JSON.stringify({ scannedAt: new Date().toISOString(), edges }, null, 2),
    "utf8"
  );

  console.log("[Layer 2] Extracting heuristic routes...");
  const routes = extractRoutes(actualRoot, inventory.files);
  console.log(`  ${routes.length} routes found`);

  fs.writeFileSync(
    path.join(stateDir, "route_map.json"),
    JSON.stringify({ scannedAt: new Date().toISOString(), routes }, null, 2),
    "utf8"
  );

  // Layer 3
  console.log("\n[Layer 3] Building coverage summary...");
  const coverage = buildCoverage(inventory, edges, routes);

  fs.writeFileSync(
    path.join(stateDir, "scan_coverage.json"),
    JSON.stringify(coverage, null, 2),
    "utf8"
  );

  console.log("\nScan complete.");
  console.log(JSON.stringify(coverage, null, 2));
}

main();
