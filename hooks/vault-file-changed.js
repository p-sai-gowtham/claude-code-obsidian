const fs = require("fs");
const path = require("path");
const {
  readStdinJson,
  detectRepoRoot,
  getProjectPaths,
  ensureProjectSkeleton,
  relRepoPath,
  sanitizeNoteStem,
  fileNotePath,
  readText,
  writeText,
  extractStructure,
  extractExistingFeatureHubs,
  extractManualNotes,
  buildFileNoteContent,
  markStale,
  touchHub,
  appendChangeLog,
  readManifest,
  writeManifest,
  importantWatchPaths,
  isTextFile,
  fileExists,
  nowIso
} = require("./vault-common");

function archiveNote(notePath, relPath) {
  if (!fileExists(notePath)) return;
  const content = readText(notePath, "");
  if (content.includes("deleted: true")) return;
  const updated = content.replace(/^(---\n)/, "$1deleted: true\n");
  writeText(notePath, updated);
}

(async () => {
  try {
    const input = await readStdinJson();
    const changedFile = input.file_path;
    const event = input.event || "change";

    if (!changedFile) process.exit(0);

    const repoRoot = detectRepoRoot(input.cwd);
    const pathsObj = getProjectPaths(repoRoot);
    ensureProjectSkeleton(pathsObj);

    const absChanged = path.resolve(changedFile);
    if (!absChanged.startsWith(repoRoot)) {
      process.stdout.write(JSON.stringify({ watchPaths: importantWatchPaths(repoRoot) }));
      process.exit(0);
    }

    const relPath = relRepoPath(repoRoot, absChanged);
    const notePath = fileNotePath(pathsObj, relPath);

    // Handle delete/unlink
    if (event === "unlink" || !fs.existsSync(absChanged)) {
      archiveNote(notePath, relPath);
      markStale(pathsObj, relPath, `external_${event}_deleted`);
      appendChangeLog(pathsObj, relPath, `external_${event}_deleted`);

      const manifest = readManifest(pathsObj.manifestPath) || {};
      manifest.workingTreeState = "dirty_diff_refreshable";
      manifest.lastSeenAt = nowIso();
      writeManifest(pathsObj.manifestPath, manifest);

      process.stdout.write(JSON.stringify({ watchPaths: importantWatchPaths(repoRoot) }));
      process.exit(0);
    }

    markStale(pathsObj, relPath, `external_${event}`);
    appendChangeLog(pathsObj, relPath, `external_${event}`);

    if (isTextFile(absChanged)) {
      const stat = fs.statSync(absChanged);
      if (stat.size <= 120000) {
        const content = readText(absChanged, "");
        const lines = content.split(/\r?\n/).length;
        if (lines <= 1800) {
          const existingNote = readText(notePath, "");
          const featureHubs = extractExistingFeatureHubs(existingNote);
          const manualNotes = extractManualNotes(existingNote);
          const structure = extractStructure(absChanged, content);

          const noteContent = buildFileNoteContent({
            repoKey: pathsObj.repoKey,
            repoRelativePath: relPath,
            sourceAbsPath: absChanged,
            structure,
            featureHubs,
            stale: true,
            manualNotes,
            prefix: pathsObj.prefix
          });

          writeText(notePath, noteContent);

          for (const hub of featureHubs) {
            touchHub(pathsObj, hub, relPath);
          }
        }
      }
    }

    const manifest = readManifest(pathsObj.manifestPath) || {};
    manifest.workingTreeState = "dirty_diff_refreshable";
    manifest.lastSeenAt = nowIso();
    writeManifest(pathsObj.manifestPath, manifest);

    process.stdout.write(
      JSON.stringify({
        watchPaths: importantWatchPaths(repoRoot)
      })
    );
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[vault-file-changed] ${err.message}\n`);
    process.exit(0);
  }
})();
