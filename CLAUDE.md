# Global workflow

Before changing code:
1. Consult the Obsidian project map for the current repo.
2. Read only the connected notes and connected source files first.
3. Expand scope only if the vault is missing information or dependencies require it.

Vault policy:
- Do not run a full codebase scan unless the project is uninitialized in the vault or I explicitly ask for a deep scan, rebuild, reindex, or full rescan.
- Prefer targeted diff-based updates over full rescans.
- After edits, update the affected file note, feature hub, and change log.
- Treat the codebase as source of truth. If vault and code disagree, fix the vault.
- Every managed note must link to its project index and typed index note.
- Every file note must link to a feature hub or [[50_Unclassified_Files]]. Never emit "None linked yet".
- Use wikilinks for all graph edges. No pseudo-folder links.

Vault schema (v2):
- Vault root: C:/vaults/00_Vault_Home.md, C:/vaults/Projects_Index.md
- Per project: 00_Project_Index, 10_File_Index, 20_Feature_Index, 30_Flow_Index, 40_Decision_Index, 50_Unclassified_Files
- State artifacts in 06_State/: manifest.json, file_inventory.json, dependency_edges.json, route_map.json, scan_coverage.json, orphan_report.md

Vault skills (manual-only):
- /vault-bootstrap — Full repo scan (only when uninitialized or explicitly requested)
- /vault-resync — Diff-based refresh

Vault subagents (dispatch from main thread):
- vault-graph-auditor — Run audit, check invariants
- vault-feature-clusterer — Assign files to feature hubs
- vault-reconciler — Handle offline changes

Cost policy:
- Prefer command hooks and local scripts.
- Avoid extra model-based verification unless I explicitly ask.
