#!/usr/bin/env node
/**
 * install.js — One-command installer for the V2 Vault System.
 *
 * Copies vault files into ~/.claude/ and sets up everything.
 *
 * Usage:
 *   node install.js [--vault-path C:/vaults] [--skip-scheduler]
 *
 * On another machine:
 *   git clone <repo> vault-system-v2
 *   cd vault-system-v2
 *   node install.js
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, ".claude");
const BUNDLE_DIR = __dirname;

const args = process.argv.slice(2);
let vaultPath = "C:/vaults";
let skipScheduler = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--vault-path" && args[i + 1]) vaultPath = args[++i];
  if (args[i] === "--skip-scheduler") skipScheduler = true;
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    console.log(`  copied: ${path.relative(CLAUDE_DIR, dest)}`);
  }
}

console.log("Installing V2 Vault System...");
console.log(`  Target: ${CLAUDE_DIR}`);
console.log(`  Vault:  ${vaultPath}\n`);

// Step 1: Copy all vault files into ~/.claude/
const folders = ["hooks", "bin", "skills", "agents"];
for (const folder of folders) {
  const src = path.join(BUNDLE_DIR, folder);
  const dest = path.join(CLAUDE_DIR, folder);
  if (fs.existsSync(src)) {
    copyRecursive(src, dest);
  }
}

// Step 2: Copy CLAUDE.md (merge if exists)
const claudeMdSrc = path.join(BUNDLE_DIR, "CLAUDE.md");
const claudeMdDest = path.join(CLAUDE_DIR, "CLAUDE.md");
if (fs.existsSync(claudeMdDest)) {
  const existing = fs.readFileSync(claudeMdDest, "utf8");
  if (!existing.includes("Vault policy")) {
    const vaultSection = fs.readFileSync(claudeMdSrc, "utf8");
    const policyStart = vaultSection.indexOf("Vault policy:");
    if (policyStart !== -1) {
      fs.appendFileSync(claudeMdDest, "\n" + vaultSection.slice(policyStart) + "\n", "utf8");
      console.log("  merged: CLAUDE.md (appended vault policy)");
    }
  } else {
    console.log("  skipped: CLAUDE.md (vault policy already present)");
  }
} else {
  fs.copyFileSync(claudeMdSrc, claudeMdDest);
  console.log("  copied: CLAUDE.md");
}

// Step 3: Run the setup script (handles settings.json, vault root, scheduler, validation)
console.log("\nRunning setup...\n");
const setupArgs = ["--vault-path", vaultPath];
if (skipScheduler) setupArgs.push("--skip-scheduler");

const cp = require("child_process");
const setupScript = path.join(CLAUDE_DIR, "bin", "vault-setup.js");
const result = cp.spawnSync("node", [setupScript, ...setupArgs], {
  encoding: "utf8",
  stdio: "inherit",
  windowsHide: true
});

process.exit(result.status || 0);
