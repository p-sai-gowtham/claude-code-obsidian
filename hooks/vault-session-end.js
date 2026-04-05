const fs = require("fs");
const path = require("path");
const {
  readStdinJson,
  detectRepoRoot,
  repoKeyFromRoot,
  nowIso
} = require("./vault-common");

(async () => {
  try {
    const input = await readStdinJson();
    const repoRoot = detectRepoRoot(input.cwd);
    const repoKey = repoKeyFromRoot(repoRoot);

    const queueFile = path.join(
      process.env.USERPROFILE || process.env.HOME || ".",
      ".claude",
      "state",
      "queue.jsonl"
    );

    fs.mkdirSync(path.dirname(queueFile), { recursive: true });

    const entry = {
      endedAt: nowIso(),
      sessionId: input.session_id || null,
      repoRoot,
      repoKey,
      cwd: input.cwd || null,
      reason: input.reason || null
    };

    fs.appendFileSync(queueFile, JSON.stringify(entry) + "\n", "utf8");
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[vault-session-end] ${err.message}\n`);
    process.exit(0);
  }
})();