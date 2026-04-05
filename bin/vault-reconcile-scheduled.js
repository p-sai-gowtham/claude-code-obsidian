#!/usr/bin/env node
/**
 * vault-reconcile-scheduled.js — Wrapper for Task Scheduler.
 *
 * Runs the vault reconciler for all managed projects.
 * No LLM calls — purely deterministic git-diff-based processing.
 *
 * Logs to ~/.claude/state/reconciler.log
 *
 * Usage: node vault-reconcile-scheduled.js
 * Schedule: schtasks /create /tn "VaultReconciler" /tr "node C:\Users\puvvu\.claude\bin\vault-reconcile-scheduled.js" /sc minute /mo 15
 */

const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const LOG_PATH = path.join(
  process.env.USERPROFILE || process.env.HOME || ".",
  ".claude", "state", "reconciler.log"
);

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, line, "utf8");
  } catch { /* ignore log errors */ }
}

function trimLog() {
  try {
    const content = fs.readFileSync(LOG_PATH, "utf8");
    const lines = content.split(/\r?\n/);
    if (lines.length > 500) {
      const trimmed = lines.slice(-300).join("\n");
      fs.writeFileSync(LOG_PATH, trimmed + "\n", "utf8");
    }
  } catch { /* ignore */ }
}

function main() {
  log("Starting scheduled reconciliation...");

  const reconcilerPath = path.join(__dirname, "..", "hooks", "vault-reconciler.js");

  if (!fs.existsSync(reconcilerPath)) {
    log(`ERROR: Reconciler not found at ${reconcilerPath}`);
    process.exit(1);
  }

  try {
    const result = cp.spawnSync("node", [reconcilerPath], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 60000
    });

    if (result.status === 0) {
      log("Reconciliation complete (exit 0)");
    } else {
      log(`Reconciliation finished with exit code ${result.status}`);
      if (result.stderr) log(`  stderr: ${result.stderr.trim()}`);
    }
  } catch (err) {
    log(`ERROR: ${err.message}`);
  }

  trimLog();
}

main();
