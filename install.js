#!/usr/bin/env node
/**
 * install.js — One-command installer for the V2 Vault System.
 *
 * Usage:
 *   node install.js [--vault-path /path/to/vault] [--skip-scheduler]
 *
 * On a new machine:
 *   git clone https://github.com/p-sai-gowtham/claude-code-obsidian.git
 *   cd claude-code-obsidian
 *   node install.js
 */

const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const os = require("os");

// ── Parse args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, ".claude");
const BUNDLE_DIR = __dirname;
const IS_WIN = process.platform === "win32";

let vaultPath = "";
let skipScheduler = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--vault-path" && args[i + 1]) vaultPath = args[++i];
  if (args[i] === "--skip-scheduler") skipScheduler = true;
  if (args[i] === "--help" || args[i] === "-h") {
    console.log("Usage: node install.js [--vault-path /path] [--skip-scheduler]");
    console.log("  --vault-path  Obsidian vault location (default: C:/vaults on Windows, ~/vaults elsewhere)");
    console.log("  --skip-scheduler  Skip registering the offline reconciler scheduled task");
    process.exit(0);
  }
}

if (!vaultPath) {
  vaultPath = IS_WIN ? "C:/vaults" : path.join(HOME, "vaults");
}

function log(msg) { console.log(`  ${msg}`); }
function heading(msg) { console.log(`\n=== ${msg} ===`); }
function ok(msg) { console.log(`  \u2713 ${msg}`); }
function fail(msg) { console.log(`  \u2717 ${msg}`); }

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const child of fs.readdirSync(src)) {
      if (child === ".git" || child === "node_modules") continue;
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    ok(`${path.relative(CLAUDE_DIR, dest)}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

console.log("\nV2 Vault System Installer");
console.log(`  Platform:   ${process.platform} (${os.arch()})`);
console.log(`  Home:       ${HOME}`);
console.log(`  Claude dir: ${CLAUDE_DIR}`);
console.log(`  Vault path: ${vaultPath}`);

// ── Step 1: Prerequisites ───────────────────────────────────────────────

heading("1. Prerequisites");

ok(`Node.js ${process.version}`);

const gitCheck = cp.spawnSync("git", ["--version"], { encoding: "utf8", windowsHide: true });
if (gitCheck.status === 0) {
  ok(gitCheck.stdout.trim());
} else {
  fail("Git not found — install Git first");
  process.exit(1);
}

// ── Step 2: Create directories ──────────────────────────────────────────

heading("2. Directories");

const dirs = [
  path.join(CLAUDE_DIR, "hooks"),
  path.join(CLAUDE_DIR, "bin"),
  path.join(CLAUDE_DIR, "skills"),
  path.join(CLAUDE_DIR, "agents"),
  path.join(CLAUDE_DIR, "state"),
  path.join(vaultPath, "Projects")
];

for (const dir of dirs) {
  ensureDir(dir);
  ok(dir.startsWith(HOME) ? "~/" + path.relative(HOME, dir) : dir);
}

// ── Step 3: Copy vault system files ─────────────────────────────────────

heading("3. Vault System Files");

const fileSets = [
  { src: "hooks", dest: path.join(CLAUDE_DIR, "hooks") },
  { src: "bin", dest: path.join(CLAUDE_DIR, "bin") },
  { src: "skills", dest: path.join(CLAUDE_DIR, "skills") },
  { src: "agents", dest: path.join(CLAUDE_DIR, "agents") }
];

for (const { src, dest } of fileSets) {
  const srcPath = path.join(BUNDLE_DIR, src);
  if (fs.existsSync(srcPath)) {
    copyRecursive(srcPath, dest);
  }
}

// ── Step 4: CLAUDE.md ───────────────────────────────────────────────────

heading("4. CLAUDE.md");

const claudeMdSrc = path.join(BUNDLE_DIR, "CLAUDE.md");
const claudeMdDest = path.join(CLAUDE_DIR, "CLAUDE.md");

if (fs.existsSync(claudeMdDest)) {
  const existing = fs.readFileSync(claudeMdDest, "utf8");
  if (!existing.includes("Vault policy")) {
    const vaultContent = fs.readFileSync(claudeMdSrc, "utf8");
    const policyStart = vaultContent.indexOf("Vault policy:");
    if (policyStart !== -1) {
      fs.appendFileSync(claudeMdDest, "\n" + vaultContent.slice(policyStart) + "\n", "utf8");
      ok("Vault policy appended to existing CLAUDE.md");
    }
  } else {
    log("CLAUDE.md already has vault policy — skipped");
  }
} else {
  fs.copyFileSync(claudeMdSrc, claudeMdDest);
  ok("CLAUDE.md created");
}

// ── Step 5: Merge hooks into settings.json ──────────────────────────────

heading("5. Settings (hooks + env)");

const settingsPath = path.join(CLAUDE_DIR, "settings.json");
let settings = {};

if (fs.existsSync(settingsPath)) {
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    log("Existing settings.json found — merging");
  } catch {
    log("WARN: Could not parse settings.json — creating new");
    settings = {};
  }
}

// 5a. Persist OBSIDIAN_VAULT_PATH in settings.json env
if (!settings.env) settings.env = {};
settings.env.OBSIDIAN_VAULT_PATH = vaultPath.replace(/\\/g, "/");
ok(`env.OBSIDIAN_VAULT_PATH = "${settings.env.OBSIDIAN_VAULT_PATH}"`);

// 5b. Build hook commands with the correct home directory
const hooksDir = path.join(CLAUDE_DIR, "hooks").replace(/\\/g, "/");

const vaultHooks = {
  SessionStart: [{
    matcher: "startup|resume|clear|compact",
    hooks: [{
      type: "command",
      command: `node "${hooksDir}/vault-session-start.js"`,
      timeout: 20
    }]
  }],
  UserPromptSubmit: [{
    hooks: [{
      type: "command",
      command: `node "${hooksDir}/vault-prompt-context.js"`,
      timeout: 20
    }]
  }],
  PostToolUse: [{
    matcher: "Write|Edit|MultiEdit",
    hooks: [{
      type: "command",
      command: `node "${hooksDir}/vault-post-edit.js"`,
      async: true,
      timeout: 120
    }]
  }],
  CwdChanged: [{
    hooks: [{
      type: "command",
      command: `node "${hooksDir}/vault-watch-roots.js"`,
      timeout: 10
    }]
  }],
  FileChanged: [{
    matcher: "package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|pyproject.toml|poetry.lock|requirements.txt|go.mod|go.sum|Cargo.toml|pom.xml|build.gradle|settings.gradle|Dockerfile|docker-compose.yml|README.md|.env|.env.local|.env.development|.env.production",
    hooks: [{
      type: "command",
      command: `node "${hooksDir}/vault-file-changed.js"`,
      timeout: 20
    }]
  }],
  SessionEnd: [{
    hooks: [{
      type: "command",
      command: `node "${hooksDir}/vault-session-end.js"`,
      timeout: 1
    }]
  }]
};

// 5c. Merge hooks — replace vault hooks, preserve non-vault hooks
if (!settings.hooks) settings.hooks = {};

for (const [event, newConfigs] of Object.entries(vaultHooks)) {
  if (!settings.hooks[event]) {
    settings.hooks[event] = newConfigs;
    ok(`${event}: added`);
  } else {
    // Remove existing vault hooks, keep others
    const nonVault = settings.hooks[event].filter(cfg =>
      !cfg.hooks || !cfg.hooks.some(h => (h.command || "").includes("vault-"))
    );
    settings.hooks[event] = [...nonVault, ...newConfigs];
    ok(`${event}: ${nonVault.length > 0 ? "merged (kept " + nonVault.length + " existing)" : "replaced"}`);
  }
}

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
ok("settings.json saved");

// ── Step 6: Vault root notes ────────────────────────────────────────────

heading("6. Vault Root Notes");

const vaultHomePath = path.join(vaultPath, "00_Vault_Home.md");
const projectsIndexPath = path.join(vaultPath, "Projects_Index.md");

if (!fs.existsSync(vaultHomePath)) {
  ensureDir(vaultPath);
  fs.writeFileSync(vaultHomePath, `---\nkind: vault_home\n---\n\n# Vault Home\n\nCentral dashboard for all managed repositories.\n\n## Navigation\n\n- [[Projects_Index]] — All managed projects\n\n## Policy\n\n- The codebase is source of truth. The vault is an index.\n- Do not run full rescans unless explicitly requested or a repo is uninitialized.\n- Prefer targeted diff-based updates over full rescans.\n`, "utf8");
  ok("00_Vault_Home.md created");
} else {
  log("00_Vault_Home.md already exists");
}

if (!fs.existsSync(projectsIndexPath)) {
  fs.writeFileSync(projectsIndexPath, `---\nkind: projects_index\nupdated_at: ${new Date().toISOString().slice(0, 10)}\n---\n\n# Projects Index\n\nAll managed repositories.\n\n## Projects\n\n`, "utf8");
  ok("Projects_Index.md created");
} else {
  log("Projects_Index.md already exists");
}

// ── Step 7: Scheduled task ──────────────────────────────────────────────

heading("7. Offline Reconciler (Scheduled Task)");

const reconcilerScript = path.join(CLAUDE_DIR, "bin", "vault-reconcile-scheduled.js");

if (skipScheduler) {
  log("Skipped (--skip-scheduler)");
} else if (IS_WIN) {
  const winPath = reconcilerScript.replace(/\//g, "\\");
  const result = cp.spawnSync("schtasks", [
    "/create", "/tn", "VaultReconciler",
    "/tr", `node "${winPath}"`,
    "/sc", "minute", "/mo", "15", "/f"
  ], { encoding: "utf8", windowsHide: true });

  if (result.status === 0) {
    ok("Windows Task Scheduler: VaultReconciler (every 15 min)");
  } else {
    fail("Could not register scheduled task (may need admin)");
    log(`Manual: schtasks /create /tn VaultReconciler /tr "node \\"${winPath}\\"" /sc minute /mo 15`);
  }
} else if (process.platform === "darwin") {
  // macOS: create launchd plist
  const plistDir = path.join(HOME, "Library", "LaunchAgents");
  const plistPath = path.join(plistDir, "com.claude.vault-reconciler.plist");
  ensureDir(plistDir);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.claude.vault-reconciler</string>
  <key>ProgramArguments</key>
  <array>
    <string>node</string>
    <string>${reconcilerScript}</string>
  </array>
  <key>StartInterval</key>
  <integer>900</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${path.join(CLAUDE_DIR, "state", "reconciler.log")}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(CLAUDE_DIR, "state", "reconciler.log")}</string>
</dict>
</plist>`;
  fs.writeFileSync(plistPath, plist, "utf8");
  cp.spawnSync("launchctl", ["load", plistPath], { encoding: "utf8" });
  ok("macOS LaunchAgent: com.claude.vault-reconciler (every 15 min)");
} else {
  // Linux: check if cron job exists
  const cronCheck = cp.spawnSync("crontab", ["-l"], { encoding: "utf8" });
  const cronLine = `*/15 * * * * node "${reconcilerScript}"`;
  if (cronCheck.stdout && cronCheck.stdout.includes("vault-reconcile")) {
    log("Cron job already exists");
  } else {
    const existing = (cronCheck.stdout || "").trim();
    const newCron = existing ? `${existing}\n${cronLine}\n` : `${cronLine}\n`;
    const addResult = cp.spawnSync("crontab", ["-"], {
      input: newCron, encoding: "utf8"
    });
    if (addResult.status === 0) {
      ok("Cron job added (every 15 min)");
    } else {
      fail("Could not add cron job");
      log(`Manual: crontab -e, then add: ${cronLine}`);
    }
  }
}

// ── Step 8: Validate ────────────────────────────────────────────────────

heading("8. Validation");

let errors = 0;

const checkFiles = [
  "hooks/vault-common.js",
  "hooks/vault-session-start.js",
  "hooks/vault-prompt-context.js",
  "hooks/vault-post-edit.js",
  "hooks/vault-watch-roots.js",
  "hooks/vault-file-changed.js",
  "hooks/vault-session-end.js",
  "hooks/vault-reconciler.js",
  "bin/vault-scanner.js",
  "bin/vault-audit.js",
  "bin/vault-reconcile-scheduled.js",
  "skills/vault-bootstrap/SKILL.md",
  "skills/vault-resync/SKILL.md",
  "agents/vault-graph-auditor.md",
  "agents/vault-feature-clusterer.md",
  "agents/vault-reconciler.md"
];

for (const relPath of checkFiles) {
  const fullPath = path.join(CLAUDE_DIR, relPath);
  if (!fs.existsSync(fullPath)) {
    fail(`MISSING: ${relPath}`);
    errors++;
    continue;
  }
  if (relPath.endsWith(".js")) {
    const check = cp.spawnSync("node", ["-c", fullPath], { encoding: "utf8", windowsHide: true });
    if (check.status !== 0) {
      fail(`SYNTAX ERROR: ${relPath}`);
      errors++;
      continue;
    }
  }
  ok(relPath);
}

// Check settings.json has hooks
const finalSettings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
const hookEvents = Object.keys(finalSettings.hooks || {});
if (hookEvents.length >= 6) {
  ok(`settings.json: ${hookEvents.length} hook events configured`);
} else {
  fail(`settings.json: only ${hookEvents.length} hook events (expected 6)`);
  errors++;
}

// Check env var persisted
if (finalSettings.env && finalSettings.env.OBSIDIAN_VAULT_PATH) {
  ok(`settings.json: OBSIDIAN_VAULT_PATH = "${finalSettings.env.OBSIDIAN_VAULT_PATH}"`);
} else {
  fail("settings.json: OBSIDIAN_VAULT_PATH not set");
  errors++;
}

// Check vault root
if (fs.existsSync(path.join(vaultPath, "00_Vault_Home.md"))) {
  ok("Vault root: 00_Vault_Home.md");
} else {
  fail("Vault root: 00_Vault_Home.md missing");
  errors++;
}

// ── Done ────────────────────────────────────────────────────────────────

heading("Done");

if (errors === 0) {
  console.log(`
  Installation complete! Everything is set up.

  Next steps:
    1. Open Claude Code in any git repo
    2. Type /vault-bootstrap to create the full vault map
    3. Open "${vaultPath}" in Obsidian to see the graph

  The offline reconciler runs every 15 minutes automatically.
`);
} else {
  console.log(`\n  Installation complete with ${errors} error(s). Check output above.\n`);
}

process.exit(errors > 0 ? 1 : 0);
