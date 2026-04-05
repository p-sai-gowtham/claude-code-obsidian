#!/usr/bin/env node
/**
 * vault-setup.js — Portable installer for the V2 Vault System.
 *
 * Run on a new machine to set up the complete Claude Code + Obsidian vault system.
 *
 * Prerequisites:
 *   - Node.js installed
 *   - Claude Code installed
 *   - Git installed
 *
 * Usage:
 *   node vault-setup.js [--vault-path C:/vaults] [--skip-scheduler]
 *
 * What it does:
 *   1. Creates ~/.claude/ directory structure
 *   2. Copies/creates all hook scripts
 *   3. Creates skills and agents
 *   4. Creates bin/ scripts (scanner, audit, reconciler)
 *   5. Merges vault hooks into settings.json (preserves existing settings)
 *   6. Creates vault root notes
 *   7. Registers Windows Task Scheduler job (unless --skip-scheduler)
 *   8. Validates the installation
 */

const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const os = require("os");

// ── Parse args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let vaultPath = "C:/vaults";
let skipScheduler = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--vault-path" && args[i + 1]) vaultPath = args[++i];
  if (args[i] === "--skip-scheduler") skipScheduler = true;
}

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, ".claude");

function log(msg) { console.log(`  ${msg}`); }
function heading(msg) { console.log(`\n=== ${msg} ===`); }
function ok(msg) { console.log(`  ✓ ${msg}`); }
function fail(msg) { console.log(`  ✗ ${msg}`); }

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeIfMissing(filePath, content) {
  if (fs.existsSync(filePath)) {
    log(`EXISTS: ${path.relative(HOME, filePath)}`);
    return false;
  }
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
  ok(`CREATED: ${path.relative(HOME, filePath)}`);
  return true;
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  ok(`COPIED: ${path.relative(HOME, dest)}`);
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  console.log("V2 Vault System Setup");
  console.log(`  Claude dir: ${CLAUDE_DIR}`);
  console.log(`  Vault path: ${vaultPath}`);

  // ── Step 1: Check prerequisites ───────────────────────────────────────

  heading("1. Prerequisites");

  const nodeVersion = process.version;
  ok(`Node.js ${nodeVersion}`);

  const gitCheck = cp.spawnSync("git", ["--version"], { encoding: "utf8", windowsHide: true });
  if (gitCheck.status === 0) {
    ok(`Git ${gitCheck.stdout.trim()}`);
  } else {
    fail("Git not found — install Git first");
    process.exit(1);
  }

  const claudeCheck = cp.spawnSync("claude", ["--version"], { encoding: "utf8", windowsHide: true, shell: true });
  if (claudeCheck.status === 0) {
    ok(`Claude Code ${(claudeCheck.stdout || "").trim()}`);
  } else {
    log("WARN: Claude Code CLI not detected (may still work if installed differently)");
  }

  // ── Step 2: Create directory structure ─────────────────────────────────

  heading("2. Directory Structure");

  const dirs = [
    path.join(CLAUDE_DIR, "hooks"),
    path.join(CLAUDE_DIR, "bin"),
    path.join(CLAUDE_DIR, "skills", "vault-bootstrap"),
    path.join(CLAUDE_DIR, "skills", "vault-resync"),
    path.join(CLAUDE_DIR, "agents"),
    path.join(CLAUDE_DIR, "state"),
    path.join(vaultPath, "Projects")
  ];

  for (const dir of dirs) {
    ensureDir(dir);
    ok(path.relative(HOME, dir));
  }

  // ── Step 3: Copy hook scripts ─────────────────────────────────────────

  heading("3. Hook Scripts");

  const thisDir = __dirname;
  const hooksDir = path.join(path.dirname(thisDir), "hooks");

  const hookFiles = [
    "vault-common.js",
    "vault-session-start.js",
    "vault-prompt-context.js",
    "vault-post-edit.js",
    "vault-watch-roots.js",
    "vault-file-changed.js",
    "vault-session-end.js",
    "vault-reconciler.js"
  ];

  for (const hookFile of hookFiles) {
    const src = path.join(hooksDir, hookFile);
    const dest = path.join(CLAUDE_DIR, "hooks", hookFile);
    if (fs.existsSync(src)) {
      copyFile(src, dest);
    } else {
      fail(`Source not found: ${src}`);
    }
  }

  // ── Step 4: Copy bin scripts ──────────────────────────────────────────

  heading("4. Bin Scripts");

  const binFiles = [
    "vault-scanner.js",
    "vault-audit.js",
    "vault-reconcile-scheduled.js",
    "vault-setup.js"
  ];

  for (const binFile of binFiles) {
    const src = path.join(thisDir, binFile);
    const dest = path.join(CLAUDE_DIR, "bin", binFile);
    if (fs.existsSync(src)) {
      copyFile(src, dest);
    } else if (src !== dest) {
      fail(`Source not found: ${src}`);
    }
  }

  // ── Step 5: Create skills ─────────────────────────────────────────────

  heading("5. Skills");

  const skillsDir = path.join(path.dirname(thisDir), "skills");

  const skillPaths = [
    ["vault-bootstrap", "SKILL.md"],
    ["vault-resync", "SKILL.md"]
  ];

  for (const [skillName, fileName] of skillPaths) {
    const src = path.join(skillsDir, skillName, fileName);
    const dest = path.join(CLAUDE_DIR, "skills", skillName, fileName);
    if (fs.existsSync(src)) {
      copyFile(src, dest);
    } else {
      fail(`Skill source not found: ${src}`);
    }
  }

  // ── Step 6: Create agents ─────────────────────────────────────────────

  heading("6. Agents");

  const agentsDir = path.join(path.dirname(thisDir), "agents");
  const agentFiles = [
    "vault-graph-auditor.md",
    "vault-feature-clusterer.md",
    "vault-reconciler.md"
  ];

  for (const agentFile of agentFiles) {
    const src = path.join(agentsDir, agentFile);
    const dest = path.join(CLAUDE_DIR, "agents", agentFile);
    if (fs.existsSync(src)) {
      copyFile(src, dest);
    } else {
      fail(`Agent source not found: ${src}`);
    }
  }

  // ── Step 7: Merge settings.json ───────────────────────────────────────

  heading("7. Settings");

  const settingsPath = path.join(CLAUDE_DIR, "settings.json");
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      log("Existing settings.json found — merging vault hooks");
    } catch {
      log("WARN: Could not parse existing settings.json — creating new");
    }
  }

  const hooksPrefix = path.join(CLAUDE_DIR, "hooks").replace(/\\/g, "/");

  const vaultHooks = {
    SessionStart: [{
      matcher: "startup|resume|clear|compact",
      hooks: [{
        type: "command",
        command: `node "${hooksPrefix}/vault-session-start.js"`,
        timeout: 20
      }]
    }],
    UserPromptSubmit: [{
      hooks: [{
        type: "command",
        command: `node "${hooksPrefix}/vault-prompt-context.js"`,
        timeout: 20
      }]
    }],
    PostToolUse: [{
      matcher: "Write|Edit|MultiEdit",
      hooks: [{
        type: "command",
        command: `node "${hooksPrefix}/vault-post-edit.js"`,
        async: true,
        timeout: 120
      }]
    }],
    CwdChanged: [{
      hooks: [{
        type: "command",
        command: `node "${hooksPrefix}/vault-watch-roots.js"`,
        timeout: 10
      }]
    }],
    FileChanged: [{
      matcher: "package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|pyproject.toml|poetry.lock|requirements.txt|go.mod|go.sum|Cargo.toml|pom.xml|build.gradle|settings.gradle|Dockerfile|docker-compose.yml|README.md|.env|.env.local|.env.development|.env.production",
      hooks: [{
        type: "command",
        command: `node "${hooksPrefix}/vault-file-changed.js"`,
        timeout: 20
      }]
    }],
    SessionEnd: [{
      hooks: [{
        type: "command",
        command: `node "${hooksPrefix}/vault-session-end.js"`,
        timeout: 1
      }]
    }]
  };

  // Merge: add vault hooks without removing existing non-vault hooks
  if (!settings.hooks) settings.hooks = {};
  for (const [event, hookConfigs] of Object.entries(vaultHooks)) {
    if (!settings.hooks[event]) {
      settings.hooks[event] = hookConfigs;
    } else {
      // Check if vault hook already exists
      const hasVault = settings.hooks[event].some(cfg =>
        cfg.hooks && cfg.hooks.some(h => (h.command || "").includes("vault-"))
      );
      if (!hasVault) {
        settings.hooks[event].push(...hookConfigs);
      } else {
        log(`${event}: vault hook already present`);
      }
    }
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
  ok("settings.json updated with vault hooks");

  // ── Step 8: Update CLAUDE.md ──────────────────────────────────────────

  heading("8. CLAUDE.md");

  const claudeMdPath = path.join(CLAUDE_DIR, "CLAUDE.md");
  const vaultPolicy = `
Vault policy:
- Do not run a full codebase scan unless the project is uninitialized in the vault or I explicitly ask for a deep scan, rebuild, reindex, or full rescan.
- Prefer targeted diff-based updates over full rescans.
- After edits, update the affected file note, feature hub, and change log.
- Treat the codebase as source of truth. If vault and code disagree, fix the vault.
- Every managed note must link to its project index and typed index note.
- Every file note must link to a feature hub or the Unclassified index. Never emit "None linked yet".
- Use wikilinks for all graph edges. No pseudo-folder links.`;

  if (fs.existsSync(claudeMdPath)) {
    const existing = fs.readFileSync(claudeMdPath, "utf8");
    if (!existing.includes("Vault policy")) {
      fs.appendFileSync(claudeMdPath, "\n" + vaultPolicy + "\n", "utf8");
      ok("Vault policy appended to existing CLAUDE.md");
    } else {
      log("CLAUDE.md already has vault policy");
    }
  } else {
    fs.writeFileSync(claudeMdPath, `# Global workflow\n\nBefore changing code:\n1. Consult the Obsidian project map for the current repo.\n2. Read only the connected notes and connected source files first.\n3. Expand scope only if the vault is missing information or dependencies require it.\n${vaultPolicy}\n\nCost policy:\n- Prefer command hooks and local scripts.\n- Avoid extra model-based verification unless I explicitly ask.\n`, "utf8");
    ok("CLAUDE.md created");
  }

  // ── Step 9: Create vault root notes ───────────────────────────────────

  heading("9. Vault Root Notes");

  writeIfMissing(path.join(vaultPath, "00_Vault_Home.md"),
    `---\nkind: vault_home\n---\n\n# Vault Home\n\nCentral dashboard for all managed repositories.\n\n## Navigation\n\n- [[Projects_Index]] — All managed projects\n\n## Policy\n\n- The codebase is source of truth. The vault is an index.\n- Do not run full rescans unless explicitly requested or a repo is uninitialized.\n- Prefer targeted diff-based updates over full rescans.\n`
  );

  writeIfMissing(path.join(vaultPath, "Projects_Index.md"),
    `---\nkind: projects_index\nupdated_at: ${new Date().toISOString().slice(0, 10)}\n---\n\n# Projects Index\n\nAll managed repositories.\n\n## Projects\n\n`
  );

  // ── Step 10: Register scheduled task ──────────────────────────────────

  heading("10. Scheduled Task");

  if (skipScheduler) {
    log("Skipped (--skip-scheduler flag)");
  } else if (process.platform === "win32") {
    const reconcilerPath = path.join(CLAUDE_DIR, "bin", "vault-reconcile-scheduled.js").replace(/\//g, "\\");
    const result = cp.spawnSync("schtasks", [
      "/create", "/tn", "VaultReconciler",
      "/tr", `node ${reconcilerPath}`,
      "/sc", "minute", "/mo", "15", "/f"
    ], { encoding: "utf8", windowsHide: true });

    if (result.status === 0) {
      ok("VaultReconciler scheduled task registered (every 15 min)");
    } else {
      fail(`Failed to register task: ${(result.stderr || "").trim()}`);
      log("You can register manually: schtasks /create /tn VaultReconciler /tr \"node " + reconcilerPath + "\" /sc minute /mo 15");
    }
  } else {
    log("Not Windows — skip schtasks. Set up a cron job manually:");
    log(`  */15 * * * * node "${path.join(CLAUDE_DIR, "bin", "vault-reconcile-scheduled.js")}"`);
  }

  // ── Step 11: Validate ─────────────────────────────────────────────────

  heading("11. Validation");

  let errors = 0;

  // Check all hook scripts exist
  for (const hookFile of hookFiles) {
    const p = path.join(CLAUDE_DIR, "hooks", hookFile);
    if (fs.existsSync(p)) {
      // Syntax check
      const check = cp.spawnSync("node", ["-c", p], { encoding: "utf8", windowsHide: true });
      if (check.status === 0) {
        ok(hookFile);
      } else {
        fail(`${hookFile}: syntax error`);
        errors++;
      }
    } else {
      fail(`${hookFile}: missing`);
      errors++;
    }
  }

  // Check bin scripts
  for (const binFile of binFiles) {
    const p = path.join(CLAUDE_DIR, "bin", binFile);
    if (fs.existsSync(p)) {
      ok(binFile);
    } else {
      fail(`${binFile}: missing`);
      errors++;
    }
  }

  // Check skills
  for (const [skillName] of skillPaths) {
    const p = path.join(CLAUDE_DIR, "skills", skillName, "SKILL.md");
    if (fs.existsSync(p)) {
      ok(`skill: ${skillName}`);
    } else {
      fail(`skill: ${skillName} missing`);
      errors++;
    }
  }

  // Check agents
  for (const agentFile of agentFiles) {
    const p = path.join(CLAUDE_DIR, "agents", agentFile);
    if (fs.existsSync(p)) {
      ok(`agent: ${agentFile}`);
    } else {
      fail(`agent: ${agentFile} missing`);
      errors++;
    }
  }

  // Check vault root
  if (fs.existsSync(path.join(vaultPath, "00_Vault_Home.md"))) {
    ok("vault root: 00_Vault_Home.md");
  } else {
    fail("vault root: 00_Vault_Home.md missing");
    errors++;
  }

  heading("Done");
  if (errors === 0) {
    console.log("\n  Setup complete! Open Claude Code in any git repo to start.");
    console.log("  Run /vault-bootstrap to create the full vault map for that repo.\n");
  } else {
    console.log(`\n  Setup complete with ${errors} error(s). Check output above.\n`);
  }
}

main();
