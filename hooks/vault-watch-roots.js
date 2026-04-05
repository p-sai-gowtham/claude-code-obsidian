const {
  readStdinJson,
  detectRepoRoot,
  getProjectPaths,
  ensureProjectSkeleton,
  appendEnvExports,
  importantWatchPaths
} = require("./vault-common");

(async () => {
  try {
    const input = await readStdinJson();
    const cwd = input.new_cwd || input.cwd;
    const repoRoot = detectRepoRoot(cwd);
    const pathsObj = getProjectPaths(repoRoot);

    ensureProjectSkeleton(pathsObj);

    appendEnvExports({
      CLAUDE_REPO_ROOT: repoRoot.replace(/\\/g, "/"),
      CLAUDE_REPO_KEY: pathsObj.repoKey,
      CLAUDE_VAULT_PROJECT_DIR: pathsObj.projectDir.replace(/\\/g, "/"),
      CLAUDE_VAULT_MANIFEST: pathsObj.manifestPath.replace(/\\/g, "/")
    });

    const watchPaths = importantWatchPaths(repoRoot);

    process.stdout.write(
      JSON.stringify({
        watchPaths
      })
    );
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[vault-watch-roots] ${err.message}\n`);
    process.exit(0);
  }
})();