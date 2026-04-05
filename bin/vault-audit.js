#!/usr/bin/env node
/**
 * vault-audit.js — Graph invariant checker and coverage auditor.
 *
 * Usage: node vault-audit.js [repoRoot]
 *
 * Reads all vault notes for a project, checks graph invariants, produces:
 *   06_State/scan_coverage.json
 *   06_State/orphan_report.md
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || "C:/vaults";
const PROJECTS_FOLDER = "Projects";

function repoKeyFromRoot(repoRoot) {
  const base = path.basename(repoRoot).replace(/[^a-zA-Z0-9._-]/g, "_");
  const hash = crypto.createHash("sha1").update(path.resolve(repoRoot)).digest("hex").slice(0, 8);
  return `${base}__${hash}`;
}

function readText(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return ""; }
}

function extractWikilinks(text) {
  const links = [];
  for (const m of text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
    links.push(m[1].trim());
  }
  return links;
}

function extractFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split(/\n/)) {
    const kv = line.match(/^(\w[\w_-]*):\s*(.+)/);
    if (kv) fm[kv[1]] = kv[2].trim().replace(/^"|"$/g, "");
  }
  return fm;
}

function listMdFiles(dir) {
  try {
    return fs.readdirSync(dir).filter(f => f.endsWith(".md")).map(f => path.join(dir, f));
  } catch { return []; }
}

function main() {
  const repoRoot = path.resolve(process.argv[2] || process.cwd());
  const repoKey = repoKeyFromRoot(repoRoot);
  const projectDir = path.join(VAULT_PATH, PROJECTS_FOLDER, repoKey);
  const stateDir = path.join(projectDir, "06_State");

  if (!fs.existsSync(projectDir)) {
    console.error(`Project dir not found: ${projectDir}`);
    process.exit(1);
  }

  // Detect project prefix from existing index files
  let prefix = "";
  try {
    const files = fs.readdirSync(projectDir);
    const projIdx = files.find(f => f.endsWith("_Project_Index.md") && !f.startsWith("00_"));
    if (projIdx) {
      prefix = projIdx.replace("_Project_Index.md", "");
    }
  } catch { /* use empty prefix (legacy) */ }

  const projectIndexStem = prefix ? `${prefix}_Project_Index` : "00_Project_Index";
  const fileIndexStem = prefix ? `${prefix}_File_Index` : "10_File_Index";
  const featureIndexStem = prefix ? `${prefix}_Feature_Index` : "20_Feature_Index";
  const flowIndexStem = prefix ? `${prefix}_Flow_Index` : "30_Flow_Index";
  const decisionIndexStem = prefix ? `${prefix}_Decision_Index` : "40_Decision_Index";
  const unclassifiedStem = prefix ? `${prefix}_Unclassified` : "50_Unclassified_Files";

  console.log(`Auditing: ${repoKey}${prefix ? ` (prefix: ${prefix})` : ""}`);
  console.log(`Project:  ${projectDir}`);

  // Load file inventory
  let inventoryFiles = [];
  const invPath = path.join(stateDir, "file_inventory.json");
  if (fs.existsSync(invPath)) {
    try {
      const inv = JSON.parse(readText(invPath));
      inventoryFiles = (inv.files || []).map(f => f.path);
    } catch { /* use empty */ }
  }

  // Collect all notes by type
  const fileNotes = listMdFiles(path.join(projectDir, "01_File_Notes"));
  const featureHubs = listMdFiles(path.join(projectDir, "02_Feature_Hubs"));
  const flows = listMdFiles(path.join(projectDir, "03_Flows"));
  const decisions = listMdFiles(path.join(projectDir, "04_Decisions"));

  const issues = [];
  const orphans = [];
  const pseudoFolderLinks = [];
  const noneLinkYet = [];
  const deletedFilesReferenced = [];
  const fileNotesMissingProjectLink = [];
  const fileNotesMissingIndexLink = [];
  const fileNotesMissingClassification = [];
  const emptyFeatureHubsList = [];
  const emptyFlowsList = [];
  const staleNotes = [];

  // Known pseudo-folder link targets
  const pseudoPatterns = ["01_File_Notes", "02_Feature_Hubs", "03_Flows", "04_Decisions", "05_Change_Log"];

  function auditNote(filePath, requiredIndexLink, noteType) {
    const content = readText(filePath);
    const fm = extractFrontmatter(content);
    const links = extractWikilinks(content);
    const basename = path.basename(filePath, ".md");

    // Check for deleted flag
    if (fm.deleted === "true") {
      staleNotes.push(basename);
      return;
    }

    // Check for "None linked yet"
    if (content.includes("None linked yet")) {
      noneLinkYet.push(basename);
      issues.push(`${basename}: contains "None linked yet"`);
    }

    // Check for pseudo-folder links
    for (const link of links) {
      if (pseudoPatterns.includes(link)) {
        pseudoFolderLinks.push({ note: basename, link });
        issues.push(`${basename}: pseudo-folder link [[${link}]]`);
      }
    }

    // Check project index link (accept both prefixed and legacy)
    if (!links.includes(projectIndexStem) && !links.includes("00_Project_Index")) {
      fileNotesMissingProjectLink.push(basename);
      issues.push(`${basename}: missing [[${projectIndexStem}]] link`);
    }

    // Check typed index link (accept both prefixed and legacy)
    if (requiredIndexLink && !links.includes(requiredIndexLink)) {
      // Also check legacy name
      const legacyMap = {
        [fileIndexStem]: "10_File_Index",
        [featureIndexStem]: "20_Feature_Index",
        [flowIndexStem]: "30_Flow_Index",
        [decisionIndexStem]: "40_Decision_Index"
      };
      const legacy = legacyMap[requiredIndexLink];
      if (!legacy || !links.includes(legacy)) {
        fileNotesMissingIndexLink.push(basename);
        issues.push(`${basename}: missing [[${requiredIndexLink}]] link`);
      }
    }

    return { content, fm, links, basename };
  }

  // Audit file notes
  for (const fp of fileNotes) {
    const result = auditNote(fp, fileIndexStem, "file_note");
    if (!result) continue;

    // Check classification (hub or unclassified)
    const indexStems = new Set([
      projectIndexStem, fileIndexStem, featureIndexStem, flowIndexStem, decisionIndexStem, unclassifiedStem,
      "00_Project_Index", "10_File_Index", "20_Feature_Index", "30_Flow_Index",
      "40_Decision_Index", "50_Unclassified_Files", ...pseudoPatterns
    ]);
    const hasHub = result.links.some(l => !indexStems.has(l));
    const hasUnclassified = result.links.includes(unclassifiedStem) || result.links.includes("50_Unclassified_Files");

    if (!hasHub && !hasUnclassified) {
      fileNotesMissingClassification.push(result.basename);
      issues.push(`${result.basename}: no feature hub and no [[50_Unclassified_Files]] link`);
    }
  }

  // Audit feature hubs
  for (const fp of featureHubs) {
    const result = auditNote(fp, featureIndexStem, "feature_hub");
    if (!result) continue;

    // Check for member file notes
    const hubIndexStems = new Set([
      projectIndexStem, fileIndexStem, featureIndexStem, flowIndexStem, decisionIndexStem, unclassifiedStem,
      "00_Project_Index", "10_File_Index", "20_Feature_Index", "30_Flow_Index",
      "40_Decision_Index", "50_Unclassified_Files", ...pseudoPatterns
    ]);
    const memberLinks = result.links.filter(l => !hubIndexStems.has(l));
    if (memberLinks.length === 0) {
      emptyFeatureHubsList.push(result.basename);
      issues.push(`${result.basename}: feature hub has no member file links`);
    }
  }

  // Audit flows
  for (const fp of flows) {
    const result = auditNote(fp, flowIndexStem, "flow");
    if (!result) continue;

    const flowIndexStems = new Set([
      projectIndexStem, flowIndexStem, "00_Project_Index", "30_Flow_Index", ...pseudoPatterns
    ]);
    const memberLinks = result.links.filter(l => !flowIndexStems.has(l));
    if (memberLinks.length === 0) {
      emptyFlowsList.push(result.basename);
      issues.push(`${result.basename}: flow has no implementing file/hub links`);
    }
  }

  // Audit decisions
  for (const fp of decisions) {
    auditNote(fp, decisionIndexStem, "decision");
  }

  // Files missing notes — check multiple naming conventions
  const existingNoteStems = new Set(fileNotes.map(fp => path.basename(fp, ".md")));

  // Also build a map from source_path frontmatter to note stems
  const sourcePathToStem = new Map();
  for (const fp of fileNotes) {
    const content = readText(fp);
    const fm = extractFrontmatter(content);
    const stem = path.basename(fp, ".md");
    if (fm.source_path) sourcePathToStem.set(fm.source_path, stem);
    if (fm.file) sourcePathToStem.set(fm.file, stem);
  }

  const filesMissingNotes = inventoryFiles.filter(relPath => {
    // Check by source_path/file frontmatter match
    if (sourcePathToStem.has(relPath)) return false;

    // Full-path stem (e.g. CMS__CGA__mangareels__backend__app__main.py)
    const fullStem = relPath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/[<>:"|?*\x00-\x1F]/g, "_").replace(/\//g, "__");
    if (existingNoteStems.has(fullStem)) return false;

    // Basename stem (e.g. main_py)
    const basename = path.basename(relPath);
    const shortStem = basename.replace(/\./g, "_").replace(/[<>:"|?*\x00-\x1F]/g, "_");
    if (existingNoteStems.has(shortStem)) return false;

    // parent_basename_ext pattern (e.g. agents_base_py for agents/base.py)
    const parts = relPath.replace(/\\/g, "/").split("/");
    if (parts.length >= 2) {
      const parent = parts[parts.length - 2];
      const nameNoExt = path.basename(basename, path.extname(basename));
      const extClean = path.extname(basename).replace(".", "_");
      const parentStem = `${parent}_${nameNoExt}${extClean}`;
      if (existingNoteStems.has(parentStem)) return false;
    }

    // Also try: frontend_app_tsx for frontend/src/App.tsx
    const ext = path.extname(basename);
    const nameNoExt = path.basename(basename, ext);
    const extClean = ext.replace(".", "_");
    const altStem = nameNoExt + extClean;
    if (existingNoteStems.has(altStem)) return false;

    // Try lowercase variants
    if (existingNoteStems.has(altStem.toLowerCase())) return false;
    if (existingNoteStems.has(`frontend_${altStem.toLowerCase()}`)) return false;

    return true;
  });

  // Coverage
  const totalTracked = inventoryFiles.length;
  const totalFileNotes = fileNotes.length;
  const activeFileNotes = totalFileNotes - staleNotes.length;
  const coveragePercent = totalTracked > 0 ? Math.round((activeFileNotes / totalTracked) * 1000) / 10 : 0;

  // Build audit results
  const auditResult = {
    auditedAt: new Date().toISOString(),
    repoKey,
    totalTrackedFiles: totalTracked,
    totalFileNotes,
    activeFileNotes,
    filesMissingNotes: filesMissingNotes.length,
    filesMissingNotesList: filesMissingNotes.slice(0, 50),
    fileNotesMissingProjectLink,
    fileNotesMissingIndexLink,
    fileNotesMissingClassification,
    orphanNotes: orphans,
    pseudoFolderLinks,
    noneLinkYetOccurrences: noneLinkYet,
    emptyFeatureHubs: emptyFeatureHubsList,
    emptyFlows: emptyFlowsList,
    staleNotes,
    deletedFilesStillReferenced: deletedFilesReferenced,
    featureHubCount: featureHubs.length,
    flowCount: flows.length,
    decisionCount: decisions.length,
    coveragePercent,
    totalIssues: issues.length
  };

  // Write scan_coverage.json
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, "scan_coverage.json"),
    JSON.stringify(auditResult, null, 2),
    "utf8"
  );

  // Write orphan_report.md
  let report = `---\nkind: orphan_report\naudited_at: ${auditResult.auditedAt}\n---\n\n# Vault Audit Report\n\n`;
  report += `## Summary\n\n`;
  report += `| Metric | Value |\n|---|---|\n`;
  report += `| Total tracked files | ${totalTracked} |\n`;
  report += `| Total file notes | ${totalFileNotes} |\n`;
  report += `| Active file notes | ${activeFileNotes} |\n`;
  report += `| Files missing notes | ${filesMissingNotes.length} |\n`;
  report += `| Coverage | ${coveragePercent}% |\n`;
  report += `| Feature hubs | ${featureHubs.length} |\n`;
  report += `| Flows | ${flows.length} |\n`;
  report += `| Decisions | ${decisions.length} |\n`;
  report += `| Orphan notes | ${orphans.length} |\n`;
  report += `| Pseudo-folder links | ${pseudoFolderLinks.length} |\n`;
  report += `| "None linked yet" | ${noneLinkYet.length} |\n`;
  report += `| Missing project link | ${fileNotesMissingProjectLink.length} |\n`;
  report += `| Missing index link | ${fileNotesMissingIndexLink.length} |\n`;
  report += `| Missing classification | ${fileNotesMissingClassification.length} |\n`;
  report += `| Empty feature hubs | ${emptyFeatureHubsList.length} |\n`;
  report += `| Empty flows | ${emptyFlowsList.length} |\n`;
  report += `| Stale/deleted notes | ${staleNotes.length} |\n`;
  report += `| **Total issues** | **${issues.length}** |\n`;

  if (issues.length > 0) {
    report += `\n## Issues\n\n`;
    for (const issue of issues) {
      report += `- ${issue}\n`;
    }
  }

  if (filesMissingNotes.length > 0) {
    report += `\n## Files Missing Notes (first 50)\n\n`;
    for (const f of filesMissingNotes.slice(0, 50)) {
      report += `- \`${f}\`\n`;
    }
  }

  report += `\n## Invariant Status\n\n`;
  const invariantsPassed = pseudoFolderLinks.length === 0 && noneLinkYet.length === 0 &&
    fileNotesMissingProjectLink.length === 0 && fileNotesMissingIndexLink.length === 0 &&
    fileNotesMissingClassification.length === 0;
  report += invariantsPassed
    ? `All graph invariants PASS.\n`
    : `Graph invariants have ${issues.length} failures. See issues above.\n`;

  fs.writeFileSync(path.join(stateDir, "orphan_report.md"), report, "utf8");

  // Console output
  console.log(`\nAudit complete.`);
  console.log(`  Tracked files: ${totalTracked}`);
  console.log(`  File notes: ${totalFileNotes} (${activeFileNotes} active)`);
  console.log(`  Coverage: ${coveragePercent}%`);
  console.log(`  Issues: ${issues.length}`);
  if (issues.length > 0) {
    console.log(`\nIssues:`);
    for (const issue of issues) {
      console.log(`  - ${issue}`);
    }
  }
}

main();
