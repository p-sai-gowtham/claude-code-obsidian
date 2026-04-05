# Claude Code + Obsidian Vault System (V2)

An automated knowledge graph system that connects **Claude Code** to **Obsidian**, maintaining a living, connected vault for every git repository you work on.

Every time you edit code through Claude Code, the vault updates automatically. Every time you start a conversation, relevant vault context is injected. Every 15 minutes, changes made outside Claude are reconciled. Zero manual maintenance required after initial setup.

---

## What It Does

### Automatic Vault Maintenance

When you use Claude Code normally, the system works silently in the background:

| Event | What Happens |
|-------|-------------|
| **Open Claude Code in a repo** | Detects the repo, creates a project namespace in the vault if new, exports context to the session |
| **Send any prompt** | Searches the vault for relevant notes matching your prompt keywords, injects matching file notes + feature hubs + backlinks as context |
| **Claude edits a file** | Creates or updates the file's vault note with extracted structure (imports, exports, functions, classes, routes), updates feature hubs, appends to change log |
| **You `cd` to another directory** | Updates environment variables and file watch paths |
| **Config files change** (package.json, Dockerfile, etc.) | Updates the corresponding vault note, marks as stale if needed |
| **Session ends** | Enqueues a reconciliation signal |
| **Every 15 minutes** (even without Claude running) | Windows Task Scheduler runs the offline reconciler — processes git diffs, creates/updates/archives notes for any changes made outside Claude |

### What Gets Created Per Repository

When you bootstrap a repo, the system creates:

```
C:/vaults/Projects/<reponame>__<hash>/
├── <prefix>_Project_Index.md      # Overview: tech stack, architecture, entrypoints
├── <prefix>_File_Index.md         # All file notes organized by category
├── <prefix>_Feature_Index.md      # Feature hub groupings
├── <prefix>_Flow_Index.md         # End-to-end data/request flows
├── <prefix>_Decision_Index.md     # Architectural decisions
├── <prefix>_Unclassified.md       # Files not yet assigned to a feature hub
│
├── 01_File_Notes/                 # One note per source file
│   ├── main_py.md                 #   Extracted: purpose, imports, exports,
│   ├── routes_jobs_py.md          #   functions, classes, routes, connections
│   └── ...                        #   Auto-updated on every edit
│
├── 02_Feature_Hubs/               # Files grouped by feature area
│   ├── pipeline_orchestration.md  #   Links to all member file notes
│   ├── cart_system.md             #   Data flow diagrams
│   └── ...                        #   Updated when members change
│
├── 03_Flows/                      # End-to-end user journeys
│   └── pdf_to_reel.md             #   Step-by-step with implementing files
│
├── 04_Decisions/                  # Why things are built this way
│   └── agent_skill_pattern.md     #   Context, decision, rationale
│
├── 05_Change_Log/                 # Daily change entries with wikilinks
│   └── 2026-04-05.md
│
└── 06_State/                      # Machine-readable artifacts
    ├── manifest.json              #   Sync state, commit tracking
    ├── file_inventory.json        #   All tracked files with metadata
    ├── dependency_edges.json      #   Import/require relationships
    ├── route_map.json             #   Discovered API routes
    ├── scan_coverage.json         #   Coverage metrics + invariant results
    └── orphan_report.md           #   Human-readable audit report
```

### Graph Invariants (Enforced Automatically)

The system enforces these rules so the Obsidian graph stays fully connected:

- Every file note links to its project index and file index
- Every file note links to at least one feature hub, or to the Unclassified index
- Every feature hub links to its project index and feature index
- Every flow links to its project index and flow index
- Every decision links to its project index and decision index
- No orphan notes (disconnected from the graph)
- No "None linked yet" placeholders
- No pseudo-folder links (like `[[01_File_Notes]]`)
- All index notes are project-prefixed to prevent cross-project graph contamination

### Deterministic Scanner

The scanner (`vault-scanner.js`) produces structured inventory without LLM calls:

**Layer 1 — Deterministic (high confidence):**
- Runs `git ls-files` for complete tracked file inventory
- Classifies files by language/type based on extension
- Excludes build artifacts, binaries, vendor dirs (with recorded reasons)
- Output: `file_inventory.json`

**Layer 2 — Heuristic (medium confidence):**
- Extracts import/require/from statements via regex (Python, JS/TS)
- Extracts route definitions (FastAPI, Express, Next.js file routing)
- Each edge includes a confidence level
- Output: `dependency_edges.json`, `route_map.json`

**Layer 3 — Summary:**
- Coverage statistics, language breakdown
- Output: `scan_coverage.json`

---

## Installation

### Prerequisites

- **Node.js** v18 or later
- **Git**
- **Claude Code** (Anthropic's CLI)
- **Obsidian** (for viewing the vault — any version)

### Install (One Command)

```bash
git clone https://github.com/p-sai-gowtham/claude-code-obsidian.git
cd claude-code-obsidian
node install.js
```

### What the Installer Does

1. Copies all vault system files into `~/.claude/` (hooks, scripts, skills, agents)
2. Merges vault hooks into your existing `settings.json` (preserves all other settings)
3. **Persists `OBSIDIAN_VAULT_PATH`** in settings.json `env` so all hooks use the correct vault location
4. Appends vault policy to `CLAUDE.md` (or creates it if missing)
5. Creates vault root notes (`00_Vault_Home.md`, `Projects_Index.md`)
6. **Auto-detects your OS** and registers the appropriate scheduler:
   - **Windows**: Task Scheduler (`schtasks`)
   - **macOS**: LaunchAgent (`launchctl`)
   - **Linux**: Cron job (`crontab`)
7. Validates the entire installation and reports status

The install is **idempotent** — running it again updates files and won't duplicate hooks.

### Options

```bash
# Custom vault location (default: C:/vaults on Windows, ~/vaults elsewhere)
node install.js --vault-path "D:/my-obsidian-vault"

# Skip scheduler registration
node install.js --skip-scheduler
```

### Linux / macOS

```bash
# Installer auto-detects: LaunchAgent on macOS, cron on Linux
node install.js --vault-path "$HOME/vaults"
```

### Open the Vault in Obsidian

After installing, open Obsidian and select "Open folder as vault" pointing to your vault path (e.g. `C:/vaults`). The graph view will show all your projects as connected knowledge graphs.

---

## Usage

### Setting Up a New Repo

1. **Open Claude Code** in any git repository — the system automatically detects it and creates a project skeleton
2. **Type `/vault-bootstrap`** — runs a full scan: inventory, file notes, feature hubs, flows, decisions, audit
3. **Work normally** — hooks keep everything in sync from this point on

### Daily Workflow

Just use Claude Code as you normally would. The hooks handle everything:

- Edit a file → its vault note updates
- Create a new file → a new note is created and indexed
- Delete a file → its note is archived (marked `deleted: true`)
- Rename a file → old note archived, new note created, hub assignments preserved
- Switch branches → reconciler catches up at next run

### Manual Commands

| Command | When to Use |
|---------|------------|
| `/vault-bootstrap` | First-time repo scan, or explicit rebuild |
| `/vault-resync` | After major refactors or branch switches |

Both are **manual-only** (`disable-model-invocation: true`) — Claude will never auto-trigger them.

### Subagents (Dispatch from Conversation)

Ask Claude to dispatch these for specific tasks:

| Agent | Purpose |
|-------|---------|
| `vault-graph-auditor` | Run audit, check all graph invariants, produce coverage report |
| `vault-feature-clusterer` | Reassign unclassified files to feature hubs based on import graphs |
| `vault-reconciler` | Force reconciliation of offline changes |

### Running Scripts Directly

```bash
# Scan a repo's files (produces inventory artifacts)
node ~/.claude/bin/vault-scanner.js /path/to/repo

# Audit a repo's vault (checks invariants, produces reports)
node ~/.claude/bin/vault-audit.js /path/to/repo

# Reconcile all managed projects
node ~/.claude/bin/vault-reconcile-scheduled.js
```

---

## Architecture

### System Components

```
~/.claude/                          ← User-level Claude Code control plane
├── settings.json                   ← Hook registrations (6 events)
├── CLAUDE.md                       ← Global instructions + vault policy
├── hooks/                          ← 8 vault hook scripts (Node.js)
│   ├── vault-common.js             ← Shared library (38 exported functions)
│   ├── vault-session-start.js      ← SessionStart: detect repo, create skeleton
│   ├── vault-prompt-context.js     ← UserPromptSubmit: search vault, inject context
│   ├── vault-post-edit.js          ← PostToolUse: update notes after edits
│   ├── vault-watch-roots.js        ← CwdChanged: update watch paths
│   ├── vault-file-changed.js       ← FileChanged: handle external changes
│   ├── vault-session-end.js        ← SessionEnd: enqueue reconcile signal
│   └── vault-reconciler.js         ← Offline reconciler (git diff based)
├── bin/                            ← Standalone scripts
│   ├── vault-scanner.js            ← Deterministic file inventory
│   ├── vault-audit.js              ← Graph invariant checker
│   ├── vault-reconcile-scheduled.js ← Task Scheduler wrapper
│   └── vault-setup.js              ← System installer
├── skills/
│   ├── vault-bootstrap/SKILL.md    ← Full scan (context:fork, manual-only)
│   └── vault-resync/SKILL.md       ← Diff refresh (context:fork, manual-only)
└── agents/
    ├── vault-graph-auditor.md      ← Audit runner
    ├── vault-feature-clusterer.md  ← Feature hub assignment
    └── vault-reconciler.md         ← Offline change handler
```

### Hook Event Flow

```
SessionStart ──→ Detect repo → Create skeleton → Export env vars → Report state
                                                                        │
UserPromptSubmit ──→ Extract keywords → Search vault → Inject context ──┘
                                                                        │
PostToolUse (Write/Edit) ──→ Read edited file → Update file note ───────┘
                              → Update feature hubs → Update change log
                              → Add to File Index if new
                              → Route to Unclassified if no hub
                                                                        │
CwdChanged ──→ Update env vars → Expand watch paths ───────────────────┘
                                                                        │
FileChanged ──→ Update/archive note → Mark stale → Update manifest ────┘
                                                                        │
SessionEnd ──→ Enqueue reconcile signal ───────────────────────────────┘
                                                                        │
Task Scheduler (every 15 min) ──→ Git diff → Reconcile all projects ───┘
```

### Design Principles

1. **Codebase is source of truth** — the vault is an index, not the authority
2. **No automatic full scans** — only when explicitly requested or repo is uninitialized
3. **Deterministic first, semantic second** — file inventory is deterministic; feature grouping is heuristic
4. **Graph integrity enforced** — every note must be connected; no orphans, no dangling links
5. **Project isolation** — all index notes are project-prefixed to prevent cross-project graph contamination
6. **Manual notes preserved** — `## Manual notes` sections survive all automated updates
7. **Uncertainty is explicit** — uncertain classifications go to Unclassified, not invented hubs

### Only Documented Claude Code Features Used

| Feature | Status |
|---------|--------|
| `~/.claude/settings.json` hooks | Officially documented |
| `context: fork` in skill frontmatter | Officially documented |
| `disable-model-invocation: true` | Officially documented |
| Custom agents in `~/.claude/agents/` | Officially documented |
| `agent: general-purpose` in skills | Officially documented |
| Hook events (SessionStart, PostToolUse, etc.) | Officially documented |

No experimental or undocumented features are used.

---

## Updating

Pull latest and re-run:

```bash
cd claude-code-obsidian
git pull
node install.js
```

The installer detects existing files and only updates what changed.

---

## Uninstalling

1. Remove vault hooks from `~/.claude/settings.json` (delete the vault-related entries under each hook event)
2. Delete vault files: `rm -rf ~/.claude/hooks/vault-* ~/.claude/bin/vault-* ~/.claude/skills/vault-* ~/.claude/agents/vault-*`
3. Remove scheduled task: `schtasks /delete /tn VaultReconciler /f`
4. Optionally delete the vault: `rm -rf C:/vaults/`

---

## License

MIT
