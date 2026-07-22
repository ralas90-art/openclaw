/**
 * Jarvis Memory Exporter snapshot generator
 * Connects to Supabase operational memory (via PG client) and exports snapshots to local markdown files.
 */

const fs = require('fs');
const path = require('path');
const { queryDb } = require('./db');
const MEMORY_DIR = path.resolve(__dirname, 'memory');

function ensureMemoryDir() {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

function getHeaderBlock(title) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  return [
    `# ${title}`,
    ``,
    `> [!NOTE]`,
    `> This is a read-only local export snapshot of the operational Jarvis database.`,
    `> Generated At: ${timestamp}`,
    ``,
    `---`,
    ``
  ].join('\n');
}

/**
 * Exporter: Projects
 */
async function exportProjects() {
  console.log('[MemoryExporter] Exporting Projects...');
  const rows = await queryDb('SELECT * FROM jarvis_projects ORDER BY name ASC;');
  if (!rows) {
    console.warn('[MemoryExporter] No database connection available for projects.');
    return;
  }

  let md = getHeaderBlock('🗂️ Active Project Registry');
  
  if (rows.length === 0) {
    md += 'No projects found in operational memory.\n';
  } else {
    for (const p of rows) {
      md += [
        `## ${p.name}`,
        `- **Slug:** \`${p.slug}\``,
        `- **Status:** ${p.status || 'unknown'}`,
        `- **Phase:** ${p.phase || 'unknown'}`,
        `- **Primary Objective:** ${p.primary_objective || 'N/A'}`,
        `- **Last Updated:** ${p.updated_at || p.created_at}`,
        `- **Metadata:** \`\`\`json`,
        JSON.stringify(p.metadata || {}, null, 2),
        `\`\`\``,
        ``
      ].join('\n');
    }
  }

  fs.writeFileSync(path.join(MEMORY_DIR, 'PROJECT_STATE.md'), md, 'utf8');
}

/**
 * Exporter: Daily Briefs
 */
async function exportDailyBriefs() {
  console.log('[MemoryExporter] Exporting Daily Briefs...');
  const todayStr = new Date().toISOString().substring(0, 10);
  const rows = await queryDb('SELECT * FROM jarvis_daily_briefs WHERE brief_date = $1;', [todayStr]);
  
  let md;
  if (rows && rows.length > 0 && rows[0].raw_brief_markdown) {
    md = rows[0].raw_brief_markdown;
  } else {
    md = [
      `# 📆 Daily Brief - ${todayStr}`,
      ``,
      `> [!WARNING]`,
      `> No daily brief generated for today yet. Use \`/jarvis_brief\` to build one.`
    ].join('\n');
  }

  fs.writeFileSync(path.join(MEMORY_DIR, 'DAILY_BRIEF.md'), md, 'utf8');
}

/**
 * Exporter: Completed Tasks
 */
async function exportCompletedWork() {
  console.log('[MemoryExporter] Exporting Completed Work...');
  const rows = await queryDb('SELECT * FROM jarvis_completed_tasks ORDER BY completed_at DESC;');
  if (!rows) return;

  let md = getHeaderBlock('🏆 Completed Work Log');
  md += [
    '| Date | Project | Task | Outcome | Artifacts |',
    '|---|---|---|---|---|'
  ].join('\n') + '\n';

  if (rows.length === 0) {
    md += '| N/A | N/A | No completed work recorded | N/A | N/A |\n';
  } else {
    for (const t of rows) {
      const date = new Date(t.completed_at).toISOString().substring(0, 10);
      const arts = Array.isArray(t.artifacts) ? t.artifacts.join(', ') : 'None';
      md += `| ${date} | ` +
            `\`${t.project_slug || 'system'}\` | ` +
            `${t.task_name} | ` +
            `${t.outcome || 'N/A'} | ` +
            `${arts} |\n`;
    }
  }

  fs.writeFileSync(path.join(MEMORY_DIR, 'COMPLETED_WORK.md'), md, 'utf8');
}

/**
 * Exporter: Blockers
 */
async function exportBlockers() {
  console.log('[MemoryExporter] Exporting Blockers...');
  const rows = await queryDb("SELECT * FROM jarvis_blockers WHERE status = 'active' ORDER BY created_at DESC;");
  if (!rows) return;

  let md = getHeaderBlock('🛑 Active Blockers');
  md += [
    '| Date Added | Project | Description | Priority | Steps to Resolve |',
    '|---|---|---|---|---|'
  ].join('\n') + '\n';

  if (rows.length === 0) {
    md += '| N/A | N/A | No active blockers found | N/A | N/A |\n';
  } else {
    for (const b of rows) {
      const date = new Date(b.created_at).toISOString().substring(0, 10);
      md += `| ${date} | ` +
            `\`${b.project_slug || 'system'}\` | ` +
            `${b.description} | ` +
            `${b.priority} | ` +
            `${b.steps_to_resolve || 'N/A'} |\n`;
    }
  }

  fs.writeFileSync(path.join(MEMORY_DIR, 'BLOCKERS.md'), md, 'utf8');
}

/**
 * Exporter: Next Actions
 */
async function exportNextActions() {
  console.log('[MemoryExporter] Exporting Next Actions...');
  const rows = await queryDb("SELECT * FROM jarvis_next_actions WHERE status = 'pending' ORDER BY priority DESC;");
  if (!rows) return;

  let md = getHeaderBlock('⚡ Recommended Next Actions');
  
  if (rows.length === 0) {
    md += 'No pending next actions found.\n';
  } else {
    for (const a of rows) {
      md += `- [ ] **${a.project_slug || 'System'}**: ${a.action} \`[Priority: ${a.priority || 'normal'}]\`\n`;
      if (a.recommended_command) {
        md += `    *Recommended Command:* \`${a.recommended_command}\`\n`;
      }
    }
  }

  fs.writeFileSync(path.join(MEMORY_DIR, 'NEXT_ACTIONS.md'), md, 'utf8');
}

/**
 * Exporter: Decisions
 */
async function exportDecisions() {
  console.log('[MemoryExporter] Exporting Decisions...');
  const rows = await queryDb('SELECT * FROM jarvis_decisions ORDER BY created_at DESC;');
  if (!rows) return;

  let md = getHeaderBlock('🧠 Architectural & Design Decisions Log');
  
  if (rows.length === 0) {
    md += 'No decisions logged yet.\n';
  } else {
    for (const d of rows) {
      const date = new Date(d.created_at).toISOString().substring(0, 10);
      md += [
        `## ${d.decision}`,
        `- **Project:** \`${d.project_slug || 'system'}\``,
        `- **Date:** ${date}`,
        `- **Context:** ${d.context || 'N/A'}`,
        `- **Rationale:** ${d.rationale || 'N/A'}`,
        `- **Impact:** ${d.impact || 'N/A'}`,
        ``
      ].join('\n');
    }
  }

  fs.writeFileSync(path.join(MEMORY_DIR, 'DECISIONS.md'), md, 'utf8');
}

/**
 * Unified Exporter runner
 */
async function exportJarvisMemory() {
  try {
    if (process.env.SKIP_MEMORY_EXPORT === 'true' || process.env.NODE_ENV === 'test') {
      console.log('[MemoryExporter] SKIP_MEMORY_EXPORT set. Skipping physical file snapshot generation to preserve tracked operational files.');
      return { success: true, skipped: true };
    }

    ensureMemoryDir();
    
    if (!process.env.DATABASE_URL) {
      console.warn('[MemoryExporter] Database connection URL missing. Creating placeholders.');
      return { success: false, reason: 'Database config missing' };
    }

    await exportProjects();
    await exportDailyBriefs();
    await exportCompletedWork();
    await exportBlockers();
    await exportNextActions();
    await exportDecisions();

    console.log('[MemoryExporter] Exporter run successfully complete!');
    return { success: true };
  } catch (err) {
    console.error('[MemoryExporter] Critical exporter error:', err.message);
    throw err;
  }
}

// Self-execute if run directly
if (require.main === module) {
  exportJarvisMemory().catch(err => {
    console.error('Fatal execution error:', err.message);
    process.exit(1);
  });
}

module.exports = { exportJarvisMemory };
