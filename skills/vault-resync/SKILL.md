---
name: vault-resync
description: Refresh the Obsidian vault for the current repository using changed files and dependency neighbors. Use after major refactors or when the user explicitly asks for a targeted vault refresh.
disable-model-invocation: true
context: fork
agent: general-purpose
allowed-tools: Read Grep Glob Bash Write Edit
---

# Vault Resync

Use this skill for targeted repo-wide refreshes after changes.
This runs in a forked context as a single general-purpose agent. Do NOT attempt to spawn subagents.

## Sequence

### Step 1: Identify changed files
Run:
```
!`git -C "$CLAUDE_REPO_ROOT" diff --name-only $(git -C "$CLAUDE_REPO_ROOT" log -1 --format=%H -- .)`
!`git -C "$CLAUDE_REPO_ROOT" status --porcelain`
```
Combine results to get all changed files since last sync.

### Step 2: Read manifest
Read `06_State/manifest.json` to find `lastReconciledCommit`. Use it for `git diff --name-only <commit>..HEAD`.

### Step 3: Update affected notes
For each changed file:
1. Read the source file
2. Update or create its file note in `01_File_Notes/`
3. Preserve `## Manual notes` sections
4. Ensure graph invariant links are present
5. Update related feature hubs if the file's role changed
6. Handle deleted files: add `deleted: true` to frontmatter, remove from indexes
7. Handle renamed files: create new note, archive old with `deleted: true`

### Step 4: Update indexes
Update `10_File_Index.md`, `20_Feature_Index.md`, etc. to reflect any new/removed notes.

### Step 5: Run audit
```
!`node "C:/Users/puvvu/.claude/bin/vault-audit.js" "$CLAUDE_REPO_ROOT"`
```
Fix any invariant failures found.

### Step 6: Update manifest
Update `06_State/manifest.json`:
- `explicitRescanRequested` = false
- `lastIndexedAt` = current timestamp
- `lastIndexedCommit` = current HEAD
- `lastReconciledCommit` = current HEAD

### Step 7: Append change log
Add a summary entry to today's note in `05_Change_Log/`.

## Rules
1. Do NOT perform a full deep scan unless the user explicitly asked for bootstrap/rebuild/reindex.
2. Preserve manual notes in existing note files.
3. Mark uncertain areas as stale instead of guessing.
4. Enforce all graph invariants (index links, hub or unclassified classification).
