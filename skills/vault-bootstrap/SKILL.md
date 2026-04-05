---
name: vault-bootstrap
description: Initialize or rebuild the Obsidian vault map for the current repository. Use when the repo has no meaningful vault map yet, or when the user explicitly asks for a deep scan, full rescan, reindex, or rebuild.
disable-model-invocation: true
context: fork
agent: general-purpose
allowed-tools: Read Grep Glob Bash Write Edit
---

# Vault Bootstrap

Use this skill only for first-time repo indexing or explicit rebuilds.
This runs in a forked context as a single general-purpose agent. Do NOT attempt to spawn subagents.

## Sequence

### Step 1: Run the deterministic scanner
```
!`node "~/.claude/bin/vault-scanner.js" "$CLAUDE_REPO_ROOT"`
```
This produces `file_inventory.json`, `dependency_edges.json`, `route_map.json`, and `scan_coverage.json` in `06_State/`.

### Step 2: Read scanner output
Read `06_State/file_inventory.json` to get the full list of tracked source files.

### Step 3: Read the codebase structurally
For each included source file (prioritize by type):
1. Entrypoints (main.py, index.ts, app.tsx, etc.)
2. Package/dependency files
3. Routes/controllers
4. Services/engines
5. Models/schemas
6. Jobs/workflows/workers
7. Tests
8. Config files

### Step 4: Create or update vault notes
Write notes to the project's vault folder:
- `00_Project_Index.md` — Overview with architecture, tech stack, entrypoints
- `01_File_Notes/` — One note per significant source file
- `02_Feature_Hubs/` — Group files by feature area
- `03_Flows/` — End-to-end data/request flows
- `04_Decisions/` — Architectural decisions inferable from code

### Step 5: Enforce graph invariants
Every file note MUST include:
- `**Indexes:** [[00_Project_Index]] | [[10_File_Index]]` after the heading
- A link to at least one feature hub, OR `[[50_Unclassified_Files]]`
- Never emit "None linked yet"

Every feature hub MUST include:
- `**Indexes:** [[00_Project_Index]] | [[20_Feature_Index]]` after the heading

Every flow MUST include:
- `**Indexes:** [[00_Project_Index]] | [[30_Flow_Index]]` after the heading

Every decision MUST include:
- `**Indexes:** [[00_Project_Index]] | [[40_Decision_Index]]` after the heading

### Step 6: Update typed index notes
Update these files to list all created notes:
- `10_File_Index.md` — All file notes with wikilinks
- `20_Feature_Index.md` — All feature hubs with wikilinks
- `30_Flow_Index.md` — All flows with wikilinks
- `40_Decision_Index.md` — All decisions with wikilinks
- `50_Unclassified_Files.md` — Files without hub assignment

### Step 7: Run the audit
```
!`node "~/.claude/bin/vault-audit.js" "$CLAUDE_REPO_ROOT"`
```
Review audit output. Fix any invariant failures.

### Step 8: Update manifest
Update `06_State/manifest.json`:
- `bootstrapComplete` = true
- `needsBootstrap` = false
- `explicitRescanRequested` = false
- `lastDeepScanAt` = current timestamp
- `lastIndexedAt` = current timestamp
- `lastIndexedCommit` = current HEAD
- `lastReconciledCommit` = current HEAD

### Step 9: Append change log
Add a summary entry to today's note in `05_Change_Log/`.

## Rules
1. Prefer broad, accurate coverage over detailed speculation.
2. If a relationship is uncertain, mark it as uncertain.
3. Preserve any existing "## Manual notes" sections.
4. Do not ask about running a full scan — this skill IS the full scan.

## Expected output
Report:
- How many file notes created/updated
- Which feature hubs created
- Audit results (orphans, unclassified, coverage %)
- Any areas marked uncertain or stale
