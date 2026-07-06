const { queryDb } = require('./controller');
const fs = require('fs');
const path = require('path');

// 1. Ensure Table Schema and Migrations
async function ensureWorkSessionsTableExists() {
  const sqlSessions = `
    CREATE TABLE IF NOT EXISTS jarvis_work_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_slug TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      summary TEXT,
      changed_files_summary TEXT,
      tests_run_summary TEXT,
      blockers TEXT,
      next_actions TEXT,
      source TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  try {
    await queryDb(sqlSessions);
  } catch (err) {
    console.error('[WorkSessions] Error creating jarvis_work_sessions:', err.message);
  }

  // B. Alter jarvis_mobile_uploads columns
  try {
    await queryDb("ALTER TABLE jarvis_mobile_uploads ADD COLUMN IF NOT EXISTS caption TEXT;");
    await queryDb("ALTER TABLE jarvis_mobile_uploads ADD COLUMN IF NOT EXISTS language VARCHAR(50);");
  } catch (err) {
    console.error('[WorkSessions] Error altering jarvis_mobile_uploads:', err.message);
  }
}

// 2. State Mutation protection and Sanitization
function sanitizeHandoffContent(content) {
  if (!content) return '';
  let sanitized = content;
  const patterns = [
    /DATABASE_URL=[\S]+/g,
    /postgresql:\/\/[\S]+/g,
    /INTERNAL_ADMIN_TOKEN=[\S]+/g,
    /JARVIS_ENCRYPTION_KEY=[\S]+/g,
    /GOOGLE_CLIENT_SECRET=[\S]+/g,
    /GOOGLE_REFRESH_TOKEN=[\S]+/g,
    /access_token=[\S]+/g,
    /refresh_token=[\S]+/g,
    /authTag=[\S]+/g,
    /ciphertext=[\S]+/g,
    /https?:\/\/[\S]+\?[\S]+/g
  ];
  for (const pattern of patterns) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  const lines = sanitized.split('\n');
  const cleanedLines = lines.map(line => {
    if (line.includes('API_KEY=') || line.includes('SECRET=') || line.includes('PASSWORD=')) {
      return line.split('=')[0] + '=[REDACTED]';
    }
    return line;
  });
  return cleanedLines.join('\n');
}

// 3. Ingestion Function
async function ingestHandoffFile() {
  await ensureWorkSessionsTableExists();
  
  const handoffPath = path.join('c:\\Users\\12132\\.gemini\\antigravity\\playground\\primal-astro', 'docs\\JARVIS_HANDOFF.md');
  if (!fs.existsSync(handoffPath)) {
    throw new Error('docs/JARVIS_HANDOFF.md not found in the workspace.');
  }

  const content = fs.readFileSync(handoffPath, 'utf8');
  const sanitized = sanitizeHandoffContent(content);

  const lines = sanitized.split(/\r?\n/);
  let projectSlug = '';
  let summary = '';
  let changedFiles = '';
  let commandsRun = '';
  let testsPassed = '';
  let testsFailed = '';
  let deployStatus = '';
  let blockers = '';
  let nextActions = '';

  let currentSection = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.trim().startsWith('project_slug:')) {
      projectSlug = line.split('project_slug:')[1].trim();
      continue;
    }

    if (line.startsWith('## ')) {
      const heading = line.replace('## ', '').trim();
      currentSection = heading;
      continue;
    }

    if (currentSection === 'Work Session Summary') {
      summary += line + '\n';
    } else if (currentSection === 'Files Changed Summary') {
      changedFiles += line + '\n';
    } else if (currentSection === 'Commands Run') {
      commandsRun += line + '\n';
    } else if (currentSection === 'Tests Passed') {
      testsPassed += line + '\n';
    } else if (currentSection === 'Tests Failed') {
      testsFailed += line + '\n';
    } else if (currentSection === 'Deployment Status') {
      deployStatus += line + '\n';
    } else if (currentSection === 'Blockers') {
      blockers += line + '\n';
    } else if (currentSection === 'Next Recommended Actions') {
      nextActions += line + '\n';
    }
  }

  projectSlug = projectSlug.toLowerCase().trim();
  if (!projectSlug) {
    throw new Error('Missing project_slug in docs/JARVIS_HANDOFF.md');
  }

  const projectCheck = await queryDb("SELECT slug FROM jarvis_projects WHERE slug = $1 AND status = 'active';", [projectSlug]);
  if (projectCheck.length === 0) {
    throw new Error(`Project slug '${projectSlug}' parsed from handoff is invalid or inactive.`);
  }

  summary = summary.trim();
  changedFiles = changedFiles.trim();
  blockers = blockers.trim();
  nextActions = nextActions.trim();

  const combinedTests = `Passed: ${testsPassed.trim()}\nFailed: ${testsFailed.trim()}`.trim();

  const activeSessions = await queryDb(
    "SELECT * FROM jarvis_work_sessions WHERE project_slug = $1 AND status IN ('active', 'updated') LIMIT 1;",
    [projectSlug]
  );

  let sessionRecord;
  if (activeSessions.length > 0) {
    const rows = await queryDb(
      `UPDATE jarvis_work_sessions 
       SET status = 'completed', ended_at = NOW(), summary = $1, changed_files_summary = $2, tests_run_summary = $3, blockers = $4, next_actions = $5, source = 'antigravity', updated_at = NOW() 
       WHERE id = $6 RETURNING *;`,
      [summary, changedFiles, combinedTests, blockers, nextActions, activeSessions[0].id]
    );
    sessionRecord = rows[0];
  } else {
    const rows = await queryDb(
      `INSERT INTO jarvis_work_sessions 
       (project_slug, status, started_at, ended_at, summary, changed_files_summary, tests_run_summary, blockers, next_actions, source)
       VALUES ($1, 'completed', NOW(), NOW(), $2, $3, $4, $5, $6, 'antigravity') RETURNING *;`,
      [projectSlug, summary, changedFiles, combinedTests, blockers, nextActions]
    );
    sessionRecord = rows[0];
  }

  if (blockers && blockers !== 'None' && blockers !== 'none') {
    await queryDb(
      `INSERT INTO jarvis_blockers (project_slug, description, priority, status) 
       VALUES ($1, $2, 'normal', 'active');`,
      [projectSlug, blockers]
    );
  }

  if (nextActions && nextActions !== 'None' && nextActions !== 'none') {
    await queryDb(
      `INSERT INTO jarvis_next_actions (project_slug, action, priority, status) 
       VALUES ($1, $2, 'normal', 'pending');`,
      [projectSlug, nextActions]
    );
  }

  return sessionRecord;
}

// 4. Session Start
async function startWorkSession(projectSlug, source = 'telegram', textContent = null) {
  await ensureWorkSessionsTableExists();
  const cleanSlug = projectSlug ? projectSlug.trim().toLowerCase() : null;
  if (!cleanSlug) {
    throw new Error('Missing project_slug parameter.');
  }

  const projectCheck = await queryDb("SELECT slug FROM jarvis_projects WHERE slug = $1 AND status = 'active';", [cleanSlug]);
  if (projectCheck.length === 0) {
    throw new Error(`Invalid or inactive project slug: '${projectSlug}'`);
  }

  const existing = await queryDb(
    "SELECT id FROM jarvis_work_sessions WHERE project_slug = $1 AND status IN ('active', 'updated') LIMIT 1;",
    [cleanSlug]
  );
  if (existing.length > 0) {
    throw new Error(`A work session is already active for project: ${cleanSlug}`);
  }

  const rows = await queryDb(
    `INSERT INTO jarvis_work_sessions (project_slug, status, started_at, summary, source)
     VALUES ($1, 'active', NOW(), $2, $3) RETURNING *;`,
    [cleanSlug, textContent ? textContent.trim() : 'Session started', source]
  );
  return rows[0];
}

// 5. Session Update
async function updateWorkSession(projectSlug, summary, source = 'telegram') {
  await ensureWorkSessionsTableExists();
  const cleanSlug = projectSlug ? projectSlug.trim().toLowerCase() : null;
  if (!cleanSlug) {
    throw new Error('Missing project_slug parameter.');
  }

  const existing = await queryDb(
    "SELECT id, summary FROM jarvis_work_sessions WHERE project_slug = $1 AND status IN ('active', 'updated') LIMIT 1;",
    [cleanSlug]
  );
  if (existing.length === 0) {
    throw new Error(`No active work session found for project: ${cleanSlug}`);
  }

  const newSummary = existing[0].summary ? `${existing[0].summary}\n- ${summary}` : summary;

  const rows = await queryDb(
    `UPDATE jarvis_work_sessions 
     SET status = 'updated', summary = $1, source = $2, updated_at = NOW() 
     WHERE id = $3 RETURNING *;`,
    [newSummary, source, existing[0].id]
  );
  return rows[0];
}

// 6. Session Done
async function doneWorkSession(projectSlug, summary = null, source = 'telegram') {
  await ensureWorkSessionsTableExists();
  const cleanSlug = projectSlug ? projectSlug.trim().toLowerCase() : null;
  if (!cleanSlug) {
    throw new Error('Missing project_slug parameter.');
  }

  const existing = await queryDb(
    "SELECT id, summary FROM jarvis_work_sessions WHERE project_slug = $1 AND status IN ('active', 'updated') LIMIT 1;",
    [cleanSlug]
  );
  if (existing.length === 0) {
    throw new Error(`No active work session found for project: ${cleanSlug}`);
  }

  let finalSummary = existing[0].summary || '';
  if (summary) {
    finalSummary = finalSummary ? `${finalSummary}\n- ${summary}` : summary;
  }

  const rows = await queryDb(
    `UPDATE jarvis_work_sessions 
     SET status = 'completed', ended_at = NOW(), summary = $1, source = $2, updated_at = NOW() 
     WHERE id = $3 RETURNING *;`,
    [finalSummary, source, existing[0].id]
  );
  return rows[0];
}

// 7. Get Active Session
async function getActiveSession() {
  await ensureWorkSessionsTableExists();
  const rows = await queryDb(
    "SELECT * FROM jarvis_work_sessions WHERE status IN ('active', 'updated') ORDER BY started_at DESC LIMIT 1;"
  );
  return rows.length > 0 ? rows[0] : null;
}

// 8. Get Latest Session for Project
async function getLatestSession(projectSlug) {
  await ensureWorkSessionsTableExists();
  const cleanSlug = projectSlug ? projectSlug.trim().toLowerCase() : '';
  const rows = await queryDb(
    "SELECT * FROM jarvis_work_sessions WHERE project_slug = $1 ORDER BY created_at DESC LIMIT 1;",
    [cleanSlug]
  );
  return rows.length > 0 ? rows[0] : null;
}

// 9. Get Project Sessions
async function getProjectSessions(projectSlug) {
  await ensureWorkSessionsTableExists();
  const cleanSlug = projectSlug ? projectSlug.trim().toLowerCase() : '';
  return await queryDb(
    "SELECT * FROM jarvis_work_sessions WHERE project_slug = $1 ORDER BY created_at DESC LIMIT 10;",
    [cleanSlug]
  );
}

// 10. List All Work Sessions
async function listWorkSessions(limit = 10) {
  await ensureWorkSessionsTableExists();
  return await queryDb(
    "SELECT * FROM jarvis_work_sessions ORDER BY created_at DESC LIMIT $1;",
    [limit]
  );
}

module.exports = {
  ensureWorkSessionsTableExists,
  ingestHandoffFile,
  startWorkSession,
  updateWorkSession,
  doneWorkSession,
  getActiveSession,
  getLatestSession,
  getProjectSessions,
  listWorkSessions
};
