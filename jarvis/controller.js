/**
 * Jarvis Controller Layer
 * Implements Phase 2: Daily Brief Generator + Project State Commands
 */

const { Client } = require('pg');
const { exportJarvisMemory } = require('./memory-exporter');
const queueStore = require('../openclaw/hermes/hermes-queue-store');

const DB_URL = process.env.DATABASE_URL;

/**
 * Helper to run queries securely on Supabase PostgreSQL
 */
async function queryDb(sqlText, params = []) {
  if (!DB_URL) {
    console.warn('[JarvisController] DATABASE_URL missing.');
    return [];
  }
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const res = await client.query(sqlText, params);
    return res.rows;
  } finally {
    await client.end();
  }
}

/**
 * 1. Generates and returns a markdown daily brief, saving it to database and snapshots
 */
async function getDailyBrief() {
  console.log('[JarvisController] Compiling prioritized Daily Brief...');
  const todayStr = new Date().toISOString().substring(0, 10);

  // Source 1: Hermes / OpenClaw queue activity
  let hermesTotal = 0;
  let hermesCompleted = 0;
  let hermesFailed = 0;
  let hermesPendingApproval = 0;
  try {
    const queue = queueStore.loadQueue();
    const todayJobs = Object.values(queue).filter(j => j.createdAt && j.createdAt.startsWith(todayStr));
    hermesTotal = todayJobs.length;
    hermesCompleted = todayJobs.filter(j => j.status === 'completed').length;
    hermesFailed = todayJobs.filter(j => j.status === 'failed' || j.status === 'blocked').length;
    hermesPendingApproval = todayJobs.filter(j => j.status === 'awaiting_approval').length;
  } catch (err) {
    console.warn('[JarvisController] Failed to parse Hermes queue:', err.message);
  }

  // Source 2: Supabase Memory tables
  const projects = await queryDb("SELECT * FROM jarvis_projects WHERE status = 'active' ORDER BY name ASC;");
  const blockers = await queryDb("SELECT * FROM jarvis_blockers WHERE status = 'active' ORDER BY created_at DESC;");
  const nextActions = await queryDb("SELECT * FROM jarvis_next_actions WHERE status = 'pending' ORDER BY priority DESC;");
  const completedTasks = await queryDb("SELECT * FROM jarvis_completed_tasks WHERE completed_at >= NOW() - INTERVAL '1 day' ORDER BY completed_at DESC;");
  const pendingApprovals = await queryDb("SELECT * FROM jarvis_approval_requests WHERE status = 'pending' ORDER BY created_at DESC;");

  // Format Daily Brief Markdown
  let md = `# 📆 Jarvis Daily Brief - ${todayStr}\n\n`;

  // Section A: Completed Work
  md += `## 🏆 Completed Work (Last 24 Hours)\n`;
  if (completedTasks.length === 0 && hermesCompleted === 0) {
    md += `* No completed tasks recorded since yesterday.\n\n`;
  } else {
    for (const t of completedTasks) {
      md += `* **[${t.project_slug}]** ${t.task_name} (Outcome: ${t.outcome || 'Success'})\n`;
    }
    if (hermesCompleted > 0) {
      md += `* **[Hermes Queue]** Successfully executed ${hermesCompleted} runtime workflows.\n`;
    }
    md += `\n`;
  }

  // Section B: Active Projects Status
  md += `## 🗂️ Active Projects\n`;
  if (projects.length === 0) {
    md += `* No active projects found.\n\n`;
  } else {
    for (const p of projects) {
      md += `* **${p.name}** (${p.phase || 'Initiation'}): ${p.primary_objective || 'N/A'}\n`;
    }
    md += `\n`;
  }

  // Section C: Blockers
  md += `## 🛑 Active Blockers\n`;
  if (blockers.length === 0 && hermesFailed === 0) {
    md += `* ✅ No active blockers or execution failures. All systems stable.\n\n`;
  } else {
    for (const b of blockers) {
      md += `* **[${b.project_slug || 'system'}]** ${b.description} \`[Priority: ${b.priority}]\`\n`;
    }
    if (hermesFailed > 0) {
      md += `* **[Hermes Warning]** ${hermesFailed} runtime executions failed or blocked today.\n`;
    }
    md += `\n`;
  }

  // Section D: Next Actions & Suggested Commands
  md += `## ⚡ Next Recommended Actions\n`;
  const suggestedCmds = [];
  if (nextActions.length === 0) {
    md += `* All action items clear. System is caught up.\n\n`;
  } else {
    for (const a of nextActions) {
      md += `- [ ] **${a.project_slug || 'System'}**: ${a.action} \`[Priority: ${a.priority}]\`\n`;
      if (a.recommended_command) {
        md += `    *Command:* \`${a.recommended_command}\`\n`;
        suggestedCmds.push(a.recommended_command);
      }
    }
    md += `\n`;
  }

  // Section E: Gated Approvals
  md += `## 🔑 Pending Approvals\n`;
  if (pendingApprovals.length === 0 && hermesPendingApproval === 0) {
    md += `* No pending execution approvals outstanding.\n\n`;
  } else {
    for (const ap of pendingApprovals) {
      md += `* **[${ap.project_slug || 'system'}]** ${ap.requested_action} (Approval ID: \`${ap.id}\`)\n`;
      md += `    Run: \`/jarvis_approve ${ap.id}\`\n`;
      suggestedCmds.push(`/jarvis_approve ${ap.id}`);
    }
    md += `\n`;
  }

  // Save/Upsert brief to database
  const insertSql = `
    INSERT INTO jarvis_daily_briefs (brief_date, completed_summary, active_summary, blockers_summary, next_actions_summary, suggested_commands, raw_brief_markdown)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (brief_date) DO UPDATE
    SET completed_summary = EXCLUDED.completed_summary,
        active_summary = EXCLUDED.active_summary,
        blockers_summary = EXCLUDED.blockers_summary,
        next_actions_summary = EXCLUDED.next_actions_summary,
        suggested_commands = EXCLUDED.suggested_commands,
        raw_brief_markdown = EXCLUDED.raw_brief_markdown;
  `;
  
  const compSummary = `Tasks completed: ${completedTasks.length}, Hermes completed: ${hermesCompleted}`;
  const actSummary = `Active projects: ${projects.length}`;
  const blockSummary = `Active blockers: ${blockers.length}, Hermes failures: ${hermesFailed}`;
  const nextSummary = `Pending next actions: ${nextActions.length}`;

  await queryDb(insertSql, [
    todayStr,
    compSummary,
    actSummary,
    blockSummary,
    nextSummary,
    JSON.stringify(suggestedCmds),
    md
  ]);

  // Synchronize snapshots
  try {
    await exportJarvisMemory();
  } catch (err) {
    console.warn('[JarvisController] Exporter warning:', err.message);
  }

  return md;
}

/**
 * 2. Compiles a summary of yesterday's completed work
 */
async function getYesterdaySummary() {
  console.log('[JarvisController] Compiling yesterday\'s task log...');
  const yesterdayTasks = await queryDb(`
    SELECT t.*, p.name as project_name 
    FROM jarvis_completed_tasks t
    LEFT JOIN jarvis_projects p ON t.project_slug = p.slug
    WHERE t.completed_at::date = CURRENT_DATE - 1
    ORDER BY t.completed_at DESC;
  `);

  let md = `# 🏆 Completed Work Log (Yesterday)\n\n`;
  if (yesterdayTasks.length === 0) {
    md += `No completed tasks logged for yesterday. Use \`/jarvis_brief\` to verify recent briefs.`;
  } else {
    for (const t of yesterdayTasks) {
      md += `* **[${t.project_name || t.project_slug}]** Status: ${t.task_name} (Outcome: ${t.outcome || 'Success'})\n`;
    }
  }
  return md;
}

/**
 * 3. Compiles a project status card
 */
async function getProjectStatus(projectSlug) {
  if (!projectSlug) {
    return `❌ Missing project slug. Usage: /jarvis_project <project_slug>`;
  }
  const slug = projectSlug.trim().toLowerCase();
  
  const projects = await queryDb('SELECT * FROM jarvis_projects WHERE slug = $1;', [slug]);
  if (projects.length === 0) {
    return `❌ Unknown project slug: '${projectSlug}'. Use PROJECT_STATE.md or check seeded project registries.`;
  }

  const p = projects[0];
  const blockers = await queryDb("SELECT * FROM jarvis_blockers WHERE project_slug = $1 AND status = 'active';", [slug]);
  const nextActions = await queryDb("SELECT * FROM jarvis_next_actions WHERE project_slug = $1 AND status = 'pending';", [slug]);
  const completed = await queryDb("SELECT * FROM jarvis_completed_tasks WHERE project_slug = $1 ORDER BY completed_at DESC LIMIT 3;", [slug]);

  let md = `# 🗂️ Project Status Card: ${p.name}\n\n`;
  md += `• **Slug:** \`${p.slug}\`\n`;
  md += `• **Status:** ${p.status || 'active'}\n`;
  md += `• **Phase:** ${p.phase || 'Initiation'}\n`;
  md += `• **Primary Objective:** ${p.primary_objective || 'N/A'}\n\n`;

  md += `### 🛑 Project Blockers\n`;
  if (blockers.length === 0) {
    md += `* None. No active blockers recorded.\n\n`;
  } else {
    for (const b of blockers) {
      md += `* ${b.description} (Steps: ${b.steps_to_resolve || 'N/A'})\n`;
    }
    md += `\n`;
  }

  md += `### ⚡ Next Recommended Actions\n`;
  if (nextActions.length === 0) {
    md += `* All actions clear.\n\n`;
  } else {
    for (const a of nextActions) {
      md += `- [ ] ${a.action} (Command: ` + (a.recommended_command ? `\`${a.recommended_command}\`` : `N/A`) + `)\n`;
    }
    md += `\n`;
  }

  md += `### 🏆 Recent Completed Tasks\n`;
  if (completed.length === 0) {
    md += `* No tasks recorded completed yet.\n`;
  } else {
    for (const c of completed) {
      const date = new Date(c.completed_at).toISOString().substring(0, 10);
      md += `* [${date}] ${c.task_name} (Outcome: ${c.outcome || 'Success'})\n`;
    }
  }

  return md;
}

/**
 * 4. Compiles a summary of pending next actions
 */
async function getNextActions() {
  console.log('[JarvisController] Compiling recommended next actions...');
  const rows = await queryDb("SELECT * FROM jarvis_next_actions WHERE status = 'pending' ORDER BY priority DESC;");
  
  let md = `# ⚡ Recommended Next Actions\n\n`;
  if (rows.length === 0) {
    md += `✅ All systems caught up. No pending next actions!`;
  } else {
    for (const a of rows) {
      md += `- [ ] **${a.project_slug || 'System'}**: ${a.action} \`[Priority: ${a.priority || 'normal'}]\`\n`;
      if (a.recommended_command) {
        md += `    *Command:* \`${a.recommended_command}\`\n`;
      }
    }
  }
  return md;
}

module.exports = {
  getDailyBrief,
  getYesterdaySummary,
  getProjectStatus,
  getNextActions
};
