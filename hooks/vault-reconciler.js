const fs = require("fs");
const path = require("path");
const {
  CONFIG,
  run,
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
  touchHub,
  appendChangeLog,
  markStale,
  nowIso,
  fileExists,
  safeMkdir,
  appendText
} = require("./vault-common");

function getProjectsRoot() {
  return path.join(CONFIG.vaultPath, CONFIG.projectsFolder);
}

function listManagedProjectManifests() {
  const root = getProjectsRoot();
  if (!fileExists(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(root, d.name, "06_State", "manifest.json"))
    .filter(fileExists);
}

/**
 * Parse git diff --name-status output into structured entries.
 * Returns: [{ status: "A"|"M"|"D"|"R", path: string, oldPath?: string }]
 */
function parseNameStatus(stdout) {
  const entries = [];
  const lines = String(stdout || "").split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const parts = line.split(/\t/);
    if (parts.length < 2) continue;
    const status = parts[0].charAt(0); // R100 → R
    if (status === "R" && parts.length >= 3) {
      entries.push({ status: "R", oldPath: parts[1].trim(), path: parts[2].trim() });
    } else {
      entries.push({ status, path: parts[1].trim() });
    }
  }
  return entries;
}

/**
 * Parse git status --porcelain output into structured entries.
 */
function parseStatusEntries(stdout) {
  const entries = [];
  const lines = String(stdout || "").split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    if (line.length < 4) continue;
    const xy = line.slice(0, 2);
    let p = line.slice(3).trim();
    if (p.includes(" -> ")) {
      const parts = p.split(" -> ");
      entries.push({ status: "R", oldPath: parts[0].trim(), path: parts[1].trim() });
    } else if (xy.includes("D")) {
      entries.push({ status: "D", path: p });
    } else if (xy.includes("?")) {
      entries.push({ status: "A", path: p });
    } else {
      entries.push({ status: "M", path: p });
    }
  }
  return entries;
}

function archiveNote(notePath) {
  if (!fileExists(notePath)) return;
  const content = readText(notePath, "");
  if (content.includes("deleted: true")) return;
  const updated = content.replace(/^(---\n)/, "$1deleted: true\n");
  writeText(notePath, updated);
}

function removeFromFileIndex(pathsObj, noteStem) {
  const indexPath = pathsObj.fileIndexPath;
  if (!fileExists(indexPath)) return;
  const content = readText(indexPath, "");
  const lines = content.split(/\r?\n/);
  const filtered = lines.filter(l => !l.includes(`[[${noteStem}]]`));
  if (filtered.length !== lines.length) {
    writeText(indexPath, filtered.join("\n"));
  }
}

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
    appendText(indexPath, line);
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
    appendText(unclPath, `- [[${noteStem}]] — \`${relPath}\` — no feature hub assigned\n`);
  }
}

function reconcileEntry(pathsObj, repoRoot, entry) {
  const relPath = entry.path.replace(/\\/g, "/");
  const absPath = path.join(repoRoot, relPath);
  const notePath = fileNotePath(pathsObj, relPath);
  const noteStem = sanitizeNoteStem(relPath);

  if (entry.status === "D") {
    archiveNote(notePath);
    removeFromFileIndex(pathsObj, noteStem);
    appendChangeLog(pathsObj, relPath, "offline_deleted");
    return;
  }

  if (entry.status === "R" && entry.oldPath) {
    // Archive old note
    const oldNotePath = fileNotePath(pathsObj, entry.oldPath);
    const oldStem = sanitizeNoteStem(entry.oldPath);
    const oldNote = readText(oldNotePath, "");
    const oldHubs = extractExistingFeatureHubs(oldNote);
    const oldManual = extractManualNotes(oldNote);
    archiveNote(oldNotePath);
    removeFromFileIndex(pathsObj, oldStem);
    appendChangeLog(pathsObj, entry.oldPath, "offline_renamed_from");

    // Create new note preserving hub assignments
    if (fileExists(absPath) && isTextFile(absPath)) {
      const stat = fs.statSync(absPath);
      if (stat.size <= 180000) {
        const content = readText(absPath, "");
        const lineCount = content.split(/\r?\n/).length;
        if (lineCount <= 3000) {
          const structure = extractStructure(absPath, content);
          const noteContent = buildFileNoteContent({
            repoKey: pathsObj.repoKey,
            repoRelativePath: relPath,
            sourceAbsPath: absPath,
            structure,
            featureHubs: oldHubs,
            stale: true,
            manualNotes: oldManual,
            prefix: pathsObj.prefix
          });
          writeText(notePath, noteContent);
          addToFileIndex(pathsObj, noteStem, relPath);
          if (!oldHubs.length) addToUnclassified(pathsObj, noteStem, relPath);
          for (const hub of oldHubs) touchHub(pathsObj, hub, relPath);
        }
      }
    }
    appendChangeLog(pathsObj, relPath, "offline_renamed_to");
    return;
  }

  // A (added) or M (modified)
  if (!fileExists(absPath)) {
    markStale(pathsObj, relPath, "missing_during_offline_reconcile");
    appendChangeLog(pathsObj, relPath, "offline_missing");
    return;
  }

  if (!isTextFile(absPath)) {
    markStale(pathsObj, relPath, "non_text_file_during_offline_reconcile");
    appendChangeLog(pathsObj, relPath, "offline_non_text");
    return;
  }

  const stat = fs.statSync(absPath);
  if (stat.size > 180000) {
    markStale(pathsObj, relPath, "large_file_during_offline_reconcile");
    appendChangeLog(pathsObj, relPath, "offline_large_file");
    return;
  }

  const content = readText(absPath, "");
  const lineCount = content.split(/\r?\n/).length;
  if (lineCount > 3000) {
    markStale(pathsObj, relPath, "huge_text_file_during_offline_reconcile");
    appendChangeLog(pathsObj, relPath, "offline_huge_text_file");
    return;
  }

  const isNew = !fileExists(notePath);
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
    stale: true,
    manualNotes,
    prefix: pathsObj.prefix
  });

  writeText(notePath, noteContent);

  if (isNew) {
    addToFileIndex(pathsObj, noteStem, relPath);
    if (!featureHubs.length) addToUnclassified(pathsObj, noteStem, relPath);
  }

  for (const hub of featureHubs) {
    touchHub(pathsObj, hub, relPath);
  }

  appendChangeLog(pathsObj, relPath, "offline_reconcile");
}

function getChangedEntries(repoRoot, lastCommit) {
  const entries = new Map(); // path → entry (dedupe)

  const headRes = run("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
  const currentCommit = headRes.ok ? headRes.stdout.trim() : null;

  // Committed changes since last reconcile
  if (lastCommit && currentCommit && lastCommit !== currentCommit) {
    const diffRes = run("git", ["diff", "--name-status", `${lastCommit}..${currentCommit}`], {
      cwd: repoRoot
    });
    for (const entry of parseNameStatus(diffRes.stdout)) {
      entries.set(entry.path, entry);
    }
  }

  // Uncommitted changes
  const statusRes = run("git", ["status", "--porcelain"], { cwd: repoRoot });
  for (const entry of parseStatusEntries(statusRes.stdout)) {
    entries.set(entry.path, entry);
  }

  return { currentCommit, entries: [...entries.values()] };
}

function reconcileProject(manifestPath) {
  const manifest = readManifest(manifestPath);
  if (!manifest || !manifest.repoRoot || !fileExists(manifest.repoRoot)) return;

  const repoRoot = manifest.repoRoot;
  const pathsObj = getProjectPaths(repoRoot);
  ensureProjectSkeleton(pathsObj);

  if (!manifest.bootstrapComplete) {
    manifest.lastSeenAt = nowIso();
    manifest.workingTreeState = "uninitialized";
    writeManifest(pathsObj.manifestPath, manifest);
    return;
  }

  if (manifest.explicitRescanRequested) {
    manifest.lastSeenAt = nowIso();
    writeManifest(pathsObj.manifestPath, manifest);
    return;
  }

  const baseCommit = manifest.lastReconciledCommit || manifest.lastIndexedCommit || null;
  const { currentCommit, entries } = getChangedEntries(repoRoot, baseCommit);

  if (!entries.length) {
    manifest.lastSeenAt = nowIso();
    manifest.lastReconciledCommit = currentCommit || manifest.lastReconciledCommit || null;
    const statusRes = run("git", ["status", "--porcelain"], { cwd: repoRoot });
    manifest.workingTreeState = String(statusRes.stdout || "").trim()
      ? "dirty_diff_refreshable"
      : "clean";
    writeManifest(pathsObj.manifestPath, manifest);
    return;
  }

  for (const entry of entries) {
    reconcileEntry(pathsObj, repoRoot, entry);
  }

  manifest.lastSeenAt = nowIso();
  manifest.lastIndexedAt = nowIso();
  manifest.lastReconciledCommit = currentCommit || manifest.lastReconciledCommit || null;

  const statusRes = run("git", ["status", "--porcelain"], { cwd: repoRoot });
  manifest.workingTreeState = String(statusRes.stdout || "").trim()
    ? "dirty_diff_refreshable"
    : "clean";

  writeManifest(pathsObj.manifestPath, manifest);
}

function trimQueue(queuePath) {
  if (!fileExists(queuePath)) return;
  const lines = readText(queuePath, "")
    .split(/\r?\n/)
    .filter(Boolean);
  const keep = lines.slice(-200);
  writeText(queuePath, keep.join("\n") + (keep.length ? "\n" : ""));
}

function main() {
  const manifests = listManagedProjectManifests();
  for (const manifestPath of manifests) {
    try {
      reconcileProject(manifestPath);
    } catch (err) {
      process.stderr.write(`[vault-reconciler] ${manifestPath}: ${err.message}\n`);
    }
  }

  const queuePath = path.join(
    process.env.USERPROFILE || process.env.HOME || ".",
    ".claude",
    "state",
    "queue.jsonl"
  );
  trimQueue(queuePath);
}

main();
