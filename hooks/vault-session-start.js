const fs = require("fs");
const path = require("path");
const {
  readStdinJson,
  detectRepoRoot,
  getVaultRootPaths,
  getProjectPaths,
  ensureProjectSkeleton,
  readManifest,
  writeManifest,
  appendEnvExports,
  getGitHead,
  getGitDirty,
  fileExists,
  writeText,
  readText,
  repoKeyFromRoot,
  nowIso,
  CONFIG
} = require("./vault-common");

function ensureVaultRootNotes(pathsObj) {
  const vaultRoot = getVaultRootPaths();

  if (!fileExists(vaultRoot.vaultHomePath)) {
    writeText(vaultRoot.vaultHomePath, `---\nkind: vault_home\n---\n\n# Vault Home\n\nCentral dashboard for all managed repositories.\n\n## Navigation\n\n- [[Projects_Index]] — All managed projects\n\n## Policy\n\n- The codebase is source of truth. The vault is an index.\n- Do not run full rescans unless explicitly requested or a repo is uninitialized.\n- Prefer targeted diff-based updates over full rescans.\n`);
  }

  if (!fileExists(vaultRoot.projectsIndexPath)) {
    writeText(vaultRoot.projectsIndexPath, `---\nkind: projects_index\nupdated_at: ${nowIso().slice(0, 10)}\n---\n\n# Projects Index\n\nAll managed repositories.\n\n## Projects\n\n`);
  }

  // Ensure this project is listed in Projects_Index
  const repoName = path.basename(pathsObj.repoRoot);
  const indexContent = readText(vaultRoot.projectsIndexPath, "");
  const projectEntry = `[[00_Project_Index|${repoName}]] — \`${pathsObj.repoKey}\``;
  if (!indexContent.includes(pathsObj.repoKey)) {
    const line = `- ${projectEntry}\n`;
    fs.appendFileSync(vaultRoot.projectsIndexPath, line, "utf8");
  }
}

(async () => {
  try {
    const input = await readStdinJson();
    const repoRoot = detectRepoRoot(input.cwd);
    const pathsObj = getProjectPaths(repoRoot);

    ensureProjectSkeleton(pathsObj);
    ensureVaultRootNotes(pathsObj);

    let manifest = readManifest(pathsObj.manifestPath);
    if (!manifest) {
      manifest = {
        repoKey: pathsObj.repoKey,
        repoRoot,
        repoName: require("path").basename(repoRoot),
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

    const head = getGitHead(repoRoot);
    const dirty = getGitDirty(repoRoot);

    manifest.repoRoot = repoRoot;
    manifest.lastSeenAt = nowIso();
    manifest.lastIndexedCommit = manifest.lastIndexedCommit || head || null;
    manifest.workingTreeState = manifest.bootstrapComplete
      ? (dirty ? "dirty_diff_refreshable" : "clean")
      : "uninitialized";
    manifest.needsBootstrap = !manifest.bootstrapComplete;

    writeManifest(pathsObj.manifestPath, manifest);

    appendEnvExports({
      OBSIDIAN_VAULT_PATH: pathsObj.projectDir.split("\\Projects\\")[0].replace(/\\/g, "/"),
      CLAUDE_REPO_ROOT: repoRoot.replace(/\\/g, "/"),
      CLAUDE_REPO_KEY: pathsObj.repoKey,
      CLAUDE_VAULT_PROJECT_DIR: pathsObj.projectDir.replace(/\\/g, "/"),
      CLAUDE_VAULT_MANIFEST: pathsObj.manifestPath.replace(/\\/g, "/")
    });

    const lines = [
      `[vault] repo_key=${pathsObj.repoKey}`,
      `[vault] project_dir=${pathsObj.projectDir.replace(/\\/g, "/")}`,
      `[vault] state=${manifest.workingTreeState}`
    ];

    if (manifest.needsBootstrap) {
      lines.push(
        `[vault] This project is initialized in the vault but not fully bootstrapped.`,
        `[vault] Do not run a full deep scan unless the user explicitly asks for a bootstrap, rebuild, reindex, deep scan, or full rescan.`
      );
    } else {
      lines.push(
        `[vault] Bootstrap already exists. Prefer vault retrieval + diff-based updates over full scans.`
      );
    }

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: lines.join("\n")
        }
      })
    );
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[vault-session-start] ${err.message}\n`);
    process.exit(0);
  }
})();