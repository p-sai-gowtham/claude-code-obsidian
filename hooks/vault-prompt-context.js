const path = require("path");
const {
  readStdinJson,
  detectRepoRoot,
  getProjectPaths,
  ensureProjectSkeleton,
  readManifest,
  writeManifest,
  obsidianCommand,
  normalizeSearchOutput,
  trimForContext,
  extractKeywords,
  fileExists
} = require("./vault-common");

function isExplicitFullRescan(prompt) {
  return /\b(full\s+rescan|deep\s+scan|reindex|re-index|rebuild\s+vault|rebuild\s+the\s+vault|bootstrap\s+the\s+vault|initialize\s+the\s+vault|full\s+scan)\b/i.test(
    prompt || ""
  );
}

(async () => {
  try {
    const input = await readStdinJson();
    const prompt = String(input.prompt || "");
    const repoRoot = detectRepoRoot(input.cwd);
    const pathsObj = getProjectPaths(repoRoot);

    ensureProjectSkeleton(pathsObj);

    const manifest = readManifest(pathsObj.manifestPath) || {};
    const fullRescanRequested = isExplicitFullRescan(prompt);

    if (fullRescanRequested) {
      manifest.explicitRescanRequested = true;
      writeManifest(pathsObj.manifestPath, manifest);
    }

    const keywords = extractKeywords(prompt);
    const searchQuery = keywords.join(" ").trim();

    const contextLines = [
      `[vault prompt context] repo_key=${pathsObj.repoKey}`,
      `[vault prompt context] bootstrap_complete=${Boolean(manifest.bootstrapComplete)}`,
      `[vault prompt context] full_rescan_requested=${fullRescanRequested}`
    ];

    if (!manifest.bootstrapComplete) {
      contextLines.push(
        `[vault prompt context] The vault map for this repo is not fully bootstrapped yet.`,
        `[vault prompt context] Use existing notes if helpful, but do not assume full architecture coverage.`,
        `[vault prompt context] Only run a full scan if the user explicitly asked for it.`
      );
    }

    if (!searchQuery) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: contextLines.join("\n")
          }
        })
      );
      process.exit(0);
    }

    const relativeProjectFolder = path
      .relative(require("./vault-common").CONFIG.vaultPath, pathsObj.projectDir)
      .replace(/\\/g, "/");

    const hits = [];
    const addHit = (x) => {
      const v = String(x || "").trim();
      if (!v) return;
      if (!hits.includes(v)) hits.push(v);
    };

    const searchRes = obsidianCommand("search", {
      query: searchQuery,
      path: relativeProjectFolder,
      limit: 8,
      format: "json"
    });

    normalizeSearchOutput(searchRes.stdout).forEach(addHit);

    const searchCtxRes = obsidianCommand("search:context", {
      query: searchQuery,
      path: relativeProjectFolder,
      limit: 8,
      format: "json"
    });

    const contextHits = normalizeSearchOutput(searchCtxRes.stdout);

    if (hits.length) {
      contextLines.push(`[vault prompt context] Top note hits:`);
      hits.slice(0, 6).forEach((h) => contextLines.push(`- ${h}`));
    }

    if (contextHits.length) {
      contextLines.push(`[vault prompt context] Matching context excerpts:`);
      for (const item of contextHits.slice(0, 4)) {
        const text =
          typeof item === "string"
            ? item
            : item.text || item.line || JSON.stringify(item);
        contextLines.push(`- ${trimForContext(text, 220)}`);
      }
    }

    const readableNotes = hits
      .filter((h) => String(h).endsWith(".md"))
      .slice(0, 4);

    for (const notePath of readableNotes) {
      const noteRes = obsidianCommand("read", { path: notePath });
      if (!noteRes.ok || !noteRes.stdout) continue;

      contextLines.push(`\n[vault note] ${notePath}`);
      contextLines.push(trimForContext(noteRes.stdout, 600));

      const backlinksRes = obsidianCommand("backlinks", {
        path: notePath,
        format: "json"
      });
      const backlinks = normalizeSearchOutput(backlinksRes.stdout).slice(0, 5);
      if (backlinks.length) {
        contextLines.push(`[backlinks]`);
        backlinks.forEach((b) =>
          contextLines.push(`- ${typeof b === "string" ? b : JSON.stringify(b)}`)
        );
      }

      const linksRes = obsidianCommand("links", { path: notePath });
      if (linksRes.ok && linksRes.stdout) {
        const linkLines = linksRes.stdout
          .split(/\r?\n/)
          .map((x) => x.trim())
          .filter(Boolean)
          .slice(0, 5);
        if (linkLines.length) {
          contextLines.push(`[outgoing links]`);
          linkLines.forEach((l) => contextLines.push(`- ${l}`));
        }
      }
    }

    if (fileExists(pathsObj.staleFilePath)) {
      const staleText = require("./vault-common").readText(pathsObj.staleFilePath, "");
      const staleLines = staleText
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter((x) => x.startsWith("- [ ]"))
        .slice(-6);

      if (staleLines.length) {
        contextLines.push(`\n[vault stale signals]`);
        staleLines.forEach((l) => contextLines.push(l));
      }
    }

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: contextLines.join("\n")
        }
      })
    );
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[vault-prompt-context] ${err.message}\n`);
    process.exit(0);
  }
})();