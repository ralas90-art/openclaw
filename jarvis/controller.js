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
async function getDailyBrief(refresh = false) {
  console.log('[JarvisController] Compiling prioritized Daily Brief...');
  const todayStr = new Date().toISOString().substring(0, 10);

  // 1. Idempotency Check: return existing brief if refresh is false
  if (!refresh) {
    try {
      // Ensure column exists first
      await queryDb("ALTER TABLE jarvis_daily_briefs ADD COLUMN IF NOT EXISTS siri_summary TEXT;");
      
      const rows = await queryDb(
        "SELECT raw_brief_markdown, siri_summary FROM jarvis_daily_briefs WHERE brief_date = $1;",
        [todayStr]
      );
      if (rows.length > 0 && rows[0].raw_brief_markdown) {
        console.log('[JarvisController] Returning cached today brief (idempotent).');
        return {
          raw_brief_markdown: rows[0].raw_brief_markdown,
          siri_summary: rows[0].siri_summary || "No Siri summary available."
        };
      }
    } catch (err) {
      console.warn('[JarvisController] Idempotency check failed:', err.message);
    }
  }

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

  // Fetch and format Morning Command Priority Intelligence
  let intelSection = `## 🧠 Jarvis Priority Intelligence\n\n`;
  try {
    const { getPriorityIntelligence } = require('./intelligence');
    const intel = await getPriorityIntelligence();

    intelSection += `### 🏆 Top 3 Priorities for Today\n`;
    if (intel.topThreePriorities.length === 0) {
      intelSection += `* ✅ No urgent priorities detected. All clear!\n\n`;
    } else {
      intel.topThreePriorities.forEach((p, idx) => {
        intelSection += `${idx + 1}. **${p.heading}**\n   *${p.why}*\n   *${p.nextAction}*\n`;
      });
      intelSection += `\n`;
    }

    intelSection += `### 📬 Urgent Unread Emails\n`;
    if (intel.urgentEmails.length === 0) {
      intelSection += `* No urgent unread emails detected.\n\n`;
    } else {
      for (const e of intel.urgentEmails) {
        const fromName = (e.raw.from || '').split('<')[0].trim();
        intelSection += `* **From:** \`${fromName || 'Unknown'}\` | **Subject:** ${e.raw.subject} | *Next action:* review email and decide response\n`;
      }
      intelSection += `\n`;
    }

    intelSection += `### 👥 Client & Project Follow-ups\n`;
    if (intel.followUps.length === 0) {
      intelSection += `* No follow-ups pending.\n\n`;
    } else {
      for (const f of intel.followUps) {
        if (f.type === 'email') {
          const fromName = (f.raw.from || '').split('<')[0].trim();
          intelSection += `* **[Gmail]** Unread message from \`${fromName || 'Unknown'}\`: "${f.raw.subject}"\n`;
        } else {
          const content = (f.raw.text_content || 'No content').substring(0, 50).trim();
          intelSection += `* **[Mobile Inbox]** Unprocessed note: "${content}" (ID: \`${f.raw.id}\`)\n`;
        }
      }
      intelSection += `\n`;
    }

    intelSection += `### 🗂️ Project-Related Drive Files\n`;
    const driveProjectFiles = intel.projectDriveFiles;
    if (driveProjectFiles.length === 0) {
      intelSection += `* No recent project-related Drive changes.\n\n`;
    } else {
      for (const d of driveProjectFiles) {
        intelSection += `* **[${d.raw.name}](${d.raw.webViewLink})** (Project: \`${d.project_slug}\`)\n`;
      }
      intelSection += `\n`;
    }

    intelSection += `### 🛑 Stale Blockers\n`;
    if (intel.staleBlockers.length === 0) {
      intelSection += `* ✅ No stale blockers active.\n\n`;
    } else {
      for (const b of intel.staleBlockers) {
        const days = Math.floor((Date.now() - new Date(b.raw.created_at).getTime()) / (1000 * 60 * 60 * 24));
        intelSection += `* **[${b.project_slug || 'system'}]** ${b.raw.description} (stale for ${days} days)\n`;
      }
      intelSection += `\n`;
    }

    intelSection += `### 📥 Mobile Notes Needing Processing\n`;
    if (intel.unprocessedMobileNotes.length === 0) {
      intelSection += `* Mobile inbox is clear.\n\n`;
    } else {
      for (const m of intel.unprocessedMobileNotes) {
        const content = (m.raw.text_content || 'No content').substring(0, 50).trim();
        intelSection += `* [${content}] (ID: \`${m.raw.id}\`)\n`;
      }
      intelSection += `\n`;
    }
  } catch (err) {
    console.error('[JarvisController] Failed to generate Priority Intelligence:', err.message);
    intelSection += `⚠️ *Priority Intelligence Layer failed to load:* ${err.message}\n\n`;
  }

  md += intelSection;

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

  // Section F: Cloud Connector Summaries (Gmail & Google Drive)
  try {
    const connectorsSummary = require('./connectors-summary');
    
    // 1. Gmail summary
    const emails = await connectorsSummary.getEmailSummary();
    if (emails && emails.length > 0) {
      md += `## 📬 Unread Actionable Emails\n`;
      const topEmails = emails.slice(0, 4);
      for (const email of topEmails) {
        const priorityLabel = email.priority_keyword ? ` 🔥 *[PRIORITY: ${email.priority_keyword.toUpperCase()}]*` : '';
        const projLabel = email.suggested_project ? ` (Project: \`${email.suggested_project}\`)` : '';
        md += `* **Subject:** ${email.subject}${priorityLabel}\n`;
        md += `  *From:* \`${email.from}\`${projLabel}\n`;
        md += `  *Snippet:* _${email.snippet}_\n`;
      }
      if (emails.length > 4) {
        md += `* ...and ${emails.length - 4} more unread emails.\n`;
      }
      md += `\n`;
    }

    // 2. Google Drive summary
    const driveFiles = await connectorsSummary.getDriveSummary();
    if (driveFiles && driveFiles.length > 0) {
      md += `## 🗂️ Google Drive Activity\n`;
      const topDrive = driveFiles.slice(0, 4);
      for (const f of topDrive) {
        const sizeStr = f.size_bytes ? ` (${(f.size_bytes / 1024).toFixed(1)} KB)` : '';
        const projLabel = f.suggested_project ? ` (Project: \`${f.suggested_project}\`)` : '';
        md += `* **[${f.name}](${f.webViewLink})**${sizeStr}${projLabel}\n`;
      }
      if (driveFiles.length > 4) {
        md += `* ...and ${driveFiles.length - 4} more modified files.\n`;
      }
      md += `\n`;
    }
  } catch (err) {
    console.warn('[JarvisController] Failed to integrate cloud summaries in Daily Brief:', err.message);
  }

  // Compile Siri-friendly spoken summary
  let siriSummary = `Good morning Rob! Here is your Jarvis summary for today. `;
  const totalDone = completedTasks.length + hermesCompleted;
  if (totalDone > 0) {
    siriSummary += `In the last twenty four hours, you completed ${totalDone} tasks. `;
  } else {
    siriSummary += `You have no completed tasks logged since yesterday. `;
  }
  
  siriSummary += `You have ${projects.length} active projects. `;
  
  const totalBlocks = blockers.length + hermesFailed;
  if (totalBlocks > 0) {
    siriSummary += `Warning: There are ${totalBlocks} active blockers or system execution failures that need your attention. `;
  } else {
    siriSummary += `All systems are stable with no active blockers. `;
  }
  
  if (nextActions.length > 0) {
    siriSummary += `Your top recommended next action is: ${nextActions[0].action} for project ${nextActions[0].project_slug || 'system'}. `;
  } else {
    siriSummary += `You have no pending next actions today. `;
  }
  
  const totalApprovals = pendingApprovals.length + hermesPendingApproval;
  if (totalApprovals > 0) {
    siriSummary += `You have ${totalApprovals} gated executions awaiting your approval. `;
  } else {
    siriSummary += `No pending approvals outstanding. `;
  }
  
  siriSummary += `Have a productive day!`;

  // Save/Upsert brief to database
  await queryDb("ALTER TABLE jarvis_daily_briefs ADD COLUMN IF NOT EXISTS siri_summary TEXT;");
  
  const insertSql = `
    INSERT INTO jarvis_daily_briefs (brief_date, completed_summary, active_summary, blockers_summary, next_actions_summary, suggested_commands, raw_brief_markdown, siri_summary)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (brief_date) DO UPDATE
    SET completed_summary = EXCLUDED.completed_summary,
        active_summary = EXCLUDED.active_summary,
        blockers_summary = EXCLUDED.blockers_summary,
        next_actions_summary = EXCLUDED.next_actions_summary,
        suggested_commands = EXCLUDED.suggested_commands,
        raw_brief_markdown = EXCLUDED.raw_brief_markdown,
        siri_summary = EXCLUDED.siri_summary;
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
    md,
    siriSummary
  ]);

  // Synchronize snapshots
  try {
    await exportJarvisMemory();
  } catch (err) {
    console.warn('[JarvisController] Exporter warning:', err.message);
  }

  return {
    raw_brief_markdown: md,
    siri_summary: siriSummary
  };
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


/**
 * 5. Compiles list of mobile uploads with optional filters:
 * - 'all': all uploads
 * - 'processed': only processed uploads
 * - '<project_slug>': only uploads for a specific project
 * - default: only unprocessed uploads
 */
async function getMobileInbox(filter) {
  const cleanFilter = filter ? filter.trim().toLowerCase() : null;
  console.log(`[JarvisController] Querying mobile inbox with filter: ${cleanFilter || 'default (unprocessed)'}...`);
  
  // Ensure archived columns exist
  try {
    await queryDb("ALTER TABLE jarvis_mobile_uploads ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;");
    await queryDb("ALTER TABLE jarvis_mobile_uploads ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;");
  } catch (err) {
    console.warn('[JarvisController] Dynamic archiving migration warning:', err.message);
  }
  
  let sqlText = "SELECT * FROM jarvis_mobile_uploads ";
  let params = [];
  
  if (cleanFilter === 'all') {
    sqlText += "WHERE archived = false ORDER BY created_at DESC LIMIT 10;";
  } else if (cleanFilter === 'processed') {
    sqlText += "WHERE processed = true AND archived = false ORDER BY created_at DESC LIMIT 10;";
  } else if (cleanFilter === 'latest') {
    sqlText += "WHERE processed = false AND archived = false ORDER BY created_at DESC LIMIT 1;";
  } else if (cleanFilter === 'today') {
    sqlText += "WHERE processed = false AND archived = false AND created_at >= CURRENT_DATE ORDER BY created_at DESC LIMIT 20;";
  } else if (cleanFilter === 'count') {
    sqlText = "SELECT COUNT(*) as cnt FROM jarvis_mobile_uploads WHERE processed = false AND archived = false;";
  } else if (cleanFilter === 'archived') {
    sqlText += "WHERE archived = true ORDER BY archived_at DESC LIMIT 10;";
  } else if (cleanFilter) {
    sqlText += "WHERE project_slug = $1 AND archived = false ORDER BY created_at DESC LIMIT 10;";
    params = [cleanFilter];
  } else {
    sqlText += "WHERE processed = false AND archived = false ORDER BY created_at DESC LIMIT 10;";
  }

  const rows = await queryDb(sqlText, params);
  
  if (cleanFilter === 'count') {
    const cnt = rows.length > 0 ? rows[0].cnt : 0;
    return `📥 *Mobile Inbox Count*\n\nThere are *${cnt}* unprocessed uploads in the mobile inbox.`;
  }
  
  let md = "# 📥 Unprocessed Mobile Inbox\n\n";
  if (cleanFilter === 'all') {
    md = "# 📥 All Mobile Inbox\n\n";
  } else if (cleanFilter === 'processed') {
    md = "# 📥 Processed Mobile Inbox\n\n";
  } else if (cleanFilter === 'latest') {
    md = "# 📥 Latest Unprocessed Upload\n\n";
  } else if (cleanFilter === 'today') {
    md = "# 📥 Today's Unprocessed Mobile Inbox\n\n";
  } else if (cleanFilter === 'archived') {
    md = "# 📥 Archived Mobile Inbox\n\n";
  } else if (cleanFilter) {
    md = `# 📥 Mobile Inbox for Project: ${cleanFilter}\n\n`;
  }

  if (rows.length === 0) {
    md += "✅ Mobile inbox is clear. No matching notes or tasks found.";
  } else {
    for (const r of rows) {
      const date = new Date(r.created_at).toISOString().substring(0, 16).replace('T', ' ');
      md += "• *[" + r.intake_source.toUpperCase() + "]* `[" + r.task_type + "]` at _" + date + "_\n";
      if (r.project_slug) {
        md += "  *Project:* `" + r.project_slug + "`\n";
      }
      if (r.text_content) {
        md += "  *Content:* " + r.text_content + "\n";
      }
      if (r.media_url) {
        md += "  *Media:* [View Attachment](" + r.media_url + ")\n";
      }
      if (r.notes) {
        md += "  *Notes:* " + r.notes + "\n";
      }
      md += "  *ID:* `" + r.id + "`\n\n";
    }
  }
  return md;
}

/**
 * 6. Marks a mobile upload as processed
 */
async function markUploadProcessed(uploadId) {
  if (!uploadId) {
    throw new Error('Missing uploadId parameter.');
  }
  const cleanId = uploadId.trim();
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!uuidRegex.test(cleanId)) {
    throw new Error('Invalid upload ID format. Must be a valid UUID.');
  }

  console.log(`[JarvisController] Marking mobile upload ${cleanId} as processed...`);
  const rows = await queryDb(
    "UPDATE jarvis_mobile_uploads SET processed = true, updated_at = NOW() WHERE id = $1 RETURNING id;",
    [cleanId]
  );

  if (rows.length === 0) {
    throw new Error('Mobile upload record not found.');
  }

  return true;
}

/**
 * 7. Assigns an upload to a project and marks it as processed
 */
async function processUploadToProject(uploadId, projectSlug) {
  if (!uploadId || !projectSlug) {
    throw new Error('Missing uploadId or project_slug parameter.');
  }
  const cleanId = uploadId.trim();
  const cleanSlug = projectSlug.trim().toLowerCase();
  
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!uuidRegex.test(cleanId)) {
    throw new Error('Invalid upload ID format. Must be a valid UUID.');
  }

  // Validate that project slug exists in jarvis_projects
  console.log(`[JarvisController] Validating project slug: ${cleanSlug}...`);
  const projects = await queryDb(
    "SELECT slug FROM jarvis_projects WHERE slug = $1 AND status = 'active';",
    [cleanSlug]
  );
  if (projects.length === 0) {
    throw new Error(`Invalid project slug: '${projectSlug}'. Project does not exist or is inactive.`);
  }

  // Validate that the upload exists first
  console.log(`[JarvisController] Checking if upload exists: ${cleanId}...`);
  const uploads = await queryDb(
    "SELECT id FROM jarvis_mobile_uploads WHERE id = $1;",
    [cleanId]
  );
  if (uploads.length === 0) {
    throw new Error('Mobile upload record not found.');
  }

  console.log(`[JarvisController] Mapping upload ${cleanId} to project ${cleanSlug} and marking processed...`);
  const rows = await queryDb(
    "UPDATE jarvis_mobile_uploads SET project_slug = $1, processed = true, updated_at = NOW() WHERE id = $2 RETURNING *;",
    [cleanSlug, cleanId]
  );

  return rows[0];
}

/**
 * 8. Triage the single most recent unprocessed upload directly to a project
 */
async function processLatestUpload(projectSlug) {
  if (!projectSlug) {
    throw new Error('Missing project_slug parameter.');
  }
  const cleanSlug = projectSlug.trim().toLowerCase();
  
  // Validate that project slug exists in jarvis_projects
  console.log(`[JarvisController] Validating project slug: ${cleanSlug}...`);
  const projects = await queryDb(
    "SELECT slug FROM jarvis_projects WHERE slug = $1 AND status = 'active';",
    [cleanSlug]
  );
  if (projects.length === 0) {
    throw new Error(`Invalid project slug: '${projectSlug}'. Project does not exist or is inactive.`);
  }

  // Find the latest unprocessed upload
  console.log(`[JarvisController] Finding the latest unprocessed upload...`);
  const uploads = await queryDb(
    "SELECT id FROM jarvis_mobile_uploads WHERE processed = false AND archived = false ORDER BY created_at DESC LIMIT 1;"
  );
  if (uploads.length === 0) {
    throw new Error('No unprocessed uploads found in the mobile inbox.');
  }

  const latestId = uploads[0].id;
  console.log(`[JarvisController] Triaging latest upload ${latestId} to project ${cleanSlug}...`);
  const rows = await queryDb(
    "UPDATE jarvis_mobile_uploads SET project_slug = $1, processed = true, updated_at = NOW() WHERE id = $2 RETURNING *;",
    [cleanSlug, latestId]
  );

  return rows[0];
}

/**
 * 9. Archive all processed uploads (soft-delete from default inbox view)
 */
async function archiveProcessedUploads() {
  console.log('[JarvisController] Archiving processed mobile uploads...');
  
  // Ensure archived columns exist
  try {
    await queryDb("ALTER TABLE jarvis_mobile_uploads ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;");
    await queryDb("ALTER TABLE jarvis_mobile_uploads ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;");
  } catch (err) {
    console.warn('[JarvisController] Dynamic archiving migration warning:', err.message);
  }

  const rows = await queryDb(
    "UPDATE jarvis_mobile_uploads SET archived = true, archived_at = NOW() WHERE processed = true AND archived = false RETURNING id;"
  );
  return rows.length;
}

module.exports = {
  queryDb,
  getDailyBrief,
  getYesterdaySummary,
  getProjectStatus,
  getNextActions,
  getMobileInbox,
  markUploadProcessed,
  processUploadToProject,
  processLatestUpload,
  archiveProcessedUploads
};
