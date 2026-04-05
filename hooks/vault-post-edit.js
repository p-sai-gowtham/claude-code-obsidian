const fs = require("fs");
const path = require("path");
const {
  readStdinJson,
  detectRepoRoot,
  getProjectPaths,
  ensureProjectSkeleton,
  readManifest,
  writeManifest,
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
  markStale,
  touchHub,
  appendChangeLog,
  getGitHead,
  fileExists,
  nowIso
} = require("./vault-common");

function addToFileIndex(pathsObj, noteStem, relPath) {
  const indexPath = pathsObj.fileIndexPath;
  if (!fileExists(indexPath)) return;
  const content = readText(indexPath, "");
  if (content.includes(`[[${noteStem}]]`)) return;
  const line = `- [[${noteStem}]] — \`${relPath}\`\n`;
  const insertPoint = content.indexOf("_Populated during bootstrap");
  if (insertPoint !== -1) {
    writeText(indexPath, content.replace("_Populated during bootstrap or as notes are created._", line.trim()));
  } else {
    fs.appendFileSync(indexPath, line, "utf8");
  }
}

function addToUnclassified(pathsObj, noteStem, relPath) {
  const unclPath = pathsObj.unclassifiedPath;
  if (!fileExists(unclPath)) return;
  const content = readText(unclPath, "");
  if (content.includes(`[[${noteStem}]]`)) return;
  const insertPoint = content.indexOf("_None currently._");
  if (insertPoint !== -1) {
    writeText(unclPath, content.replace("_None currently._", `- [[${noteStem}]] — \`${relPath}\` — no feature hub assigned`));
  } else {
    fs.appendFileSync(unclPath, `- [[${noteStem}]] — \`${relPath}\` — no feature hub assigned\n`, "utf8");
  }
}

(async () => {
  try {
    const input = await readStdinJson();
    const toolInput = input.tool_input || {};
    const toolResponse = input.tool_response || {};

    const rawPath =
      toolInput.file_path ||
      toolResponse.filePath ||
      toolResponse.file_path;

    if (!rawPath) process.exit(0);

    const repoRoot = detectRepoRoot(input.cwd);
    const absPath = path.isAbsolute(rawPath)
      ? rawPath
      : path.resolve(repoRoot, rawPath);

    if (!absPath.startsWith(repoRoot)) process.exit(0);

    const pathsObj = getProjectPaths(repoRoot);
    ensureProjectSkeleton(pathsObj);

    const relPath = relRepoPath(repoRoot, absPath);
    const notePath = fileNotePath(pathsObj, relPath);
    const noteStem = sanitizeNoteStem(relPath);

    // Handle deleted file
    if (!fs.existsSync(absPath)) {
      if (fileExists(notePath)) {
        const noteContent = readText(notePath, "");
        if (!noteContent.includes("deleted: true")) {
          const updated = noteContent.replace(/^(---\n)/, "$1deleted: true\n");
          writeText(notePath, updated);
        }
      }
      markStale(pathsObj, relPath, "edited file not found after tool execution");
      appendChangeLog(pathsObj, relPath, "deleted");
      process.exit(0);
    }

    const stat = fs.statSync(absPath);
    if (stat.size > 180000 || !isTextFile(absPath)) {
      markStale(pathsObj, relPath, "large_or_non_text_file");
      appendChangeLog(pathsObj, relPath, "touched_large_or_non_text");
      process.exit(0);
    }

    const content = readText(absPath, "");
    const lineCount = content.split(/\r?\n/).length;

    if (lineCount > 3000) {
      markStale(pathsObj, relPath, "very_large_text_file");
      appendChangeLog(pathsObj, relPath, "touched_very_large_text");
      process.exit(0);
    }

    const isNewNote = !fileExists(notePath);
    const existingNote = readText(notePath, "");
    const featureHubs = extractExistingFeatureHubs(existingNote);
    const manualNotes = extractManualNotes(existingNote);
    const structure = extractStructure(absPath, content);

    const noteContent = buildFileNoteContent({
      repoKey: pathsObj.repoKey,
      repoRelativePath: relPath,
      sourceAbsPath: absPath,
      structure,
      featureHubs,
      stale: false,
      manualNotes,
      prefix: pathsObj.prefix
    });

    writeText(notePath, noteContent);

    for (const hub of featureHubs) {
      touchHub(pathsObj, hub, relPath);
    }

    // If new note, add to file index
    if (isNewNote) {
      addToFileIndex(pathsObj, noteStem, relPath);
    }

    // If no feature hubs, add to unclassified
    if (!featureHubs.length) {
      addToUnclassified(pathsObj, noteStem, relPath);
    }

    appendChangeLog(pathsObj, relPath, "edited_by_claude");

    const manifest = readManifest(pathsObj.manifestPath) || {};
    manifest.lastIndexedAt = nowIso();
    manifest.lastIndexedCommit = getGitHead(repoRoot) || manifest.lastIndexedCommit || null;
    manifest.workingTreeState = "dirty_diff_refreshable";
    writeManifest(pathsObj.manifestPath, manifest);

    process.exit(0);
  } catch (err) {
    process.stderr.write(`[vault-post-edit] ${err.message}\n`);
    process.exit(0);
  }
})();
