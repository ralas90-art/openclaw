/**
 * Jarvis Cloud Connectors Summaries Engine
 * Implements read-only summarization of Gmail and Google Drive activities
 */

const { google } = require('googleapis');
const { getGoogleAuthClient, handleAuthFailure } = require('./google-api');
const { queryDb } = require('./controller');

/**
 * Seeds initial connector config records into jarvis_connectors if they do not exist
 */
async function seedInitialConnectors() {
  console.log('[ConnectorsSummary] Seeding initial connector definitions...');
  try {
    // Ensure core tables exist first
    await queryDb(`
      CREATE TABLE IF NOT EXISTS jarvis_connectors (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          connector_id TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          enabled BOOLEAN DEFAULT true,
          read_permissions JSONB DEFAULT '[]',
          write_permissions JSONB DEFAULT '[]',
          write_gated BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await queryDb(`
      CREATE TABLE IF NOT EXISTS jarvis_connector_tokens (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          connector_id TEXT UNIQUE REFERENCES jarvis_connectors(connector_id) ON DELETE CASCADE,
          access_token TEXT,
          refresh_token TEXT,
          token_type TEXT DEFAULT 'Bearer',
          expires_at TIMESTAMPTZ,
          client_id TEXT,
          client_secret TEXT,
          updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await queryDb(`
      CREATE TABLE IF NOT EXISTS jarvis_connector_sync_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          connector_id TEXT REFERENCES jarvis_connectors(connector_id) ON DELETE CASCADE,
          sync_status TEXT NOT NULL,
          records_synced INTEGER DEFAULT 0,
          error_message TEXT,
          started_at TIMESTAMPTZ DEFAULT now(),
          ended_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // Ensure safety columns exist in jarvis_connector_tokens
    await queryDb(`
      ALTER TABLE jarvis_connector_tokens 
      ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_sync_status TEXT DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS rotation_status TEXT DEFAULT 'active';
    `);

    await queryDb(`
      INSERT INTO jarvis_connectors (connector_id, name, enabled, read_permissions, write_permissions, write_gated)
      VALUES 
        ('gmail', 'Gmail Connector', true, '["https://www.googleapis.com/auth/gmail.readonly"]'::jsonb, '[]'::jsonb, true),
        ('google_drive', 'Google Drive Connector', true, '["https://www.googleapis.com/auth/drive.metadata.readonly"]'::jsonb, '[]'::jsonb, true)
      ON CONFLICT (connector_id) DO NOTHING;
    `);
  } catch (err) {
    console.warn('[ConnectorsSummary] Seeding definitions warning:', err.message);
  }
}

/**
 * Lists all connectors and their current authorization status
 */
async function listConnectorsStatus() {
  await seedInitialConnectors();
  console.log('[ConnectorsSummary] Listing status of registered connectors...');
  
  const rows = await queryDb(`
    SELECT c.*, t.refresh_token, t.rotation_status, t.last_used_at, t.last_sync_status, l.sync_status, l.ended_at 
    FROM jarvis_connectors c 
    LEFT JOIN jarvis_connector_tokens t ON c.connector_id = t.connector_id
    LEFT JOIN (
      SELECT connector_id, sync_status, ended_at,
             ROW_NUMBER() OVER(PARTITION BY connector_id ORDER BY ended_at DESC) rn 
      FROM jarvis_connector_sync_logs
    ) l ON c.connector_id = l.connector_id AND l.rn = 1
    ORDER BY c.connector_id ASC;
  `);

  const connectors = [];
  for (const r of rows) {
    // Check if process env has fallback or token exists
    let hasCredentials = !!r.refresh_token;
    if (!hasCredentials) {
      if (r.connector_id === 'gmail' || r.connector_id === 'google_drive') {
        hasCredentials = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
      }
    }

    let status = 'Not Authorized';
    if (!r.enabled) {
      status = 'Disabled';
    } else if (r.last_sync_status === 'decryption_error') {
      status = 'Decryption Error';
    } else if (r.rotation_status === 'revoked') {
      status = 'Revoked';
    } else if (r.rotation_status === 'needs_reconnect') {
      status = 'Needs Reconnect';
    } else if (hasCredentials && (r.rotation_status === 'active' || !r.rotation_status)) {
      status = 'Active';
    }

    connectors.push({
      connector_id: r.connector_id,
      name: r.name,
      enabled: r.enabled,
      status,
      read_permissions: r.read_permissions,
      write_permissions: r.write_permissions,
      last_sync_status: r.sync_status || r.last_sync_status || 'never',
      last_sync_time: r.ended_at || null,
      last_used_at: r.last_used_at || null
    });
  }

  return connectors;
}

/**
 * Summarizes unread Gmail messages (read-only)
 */
async function getEmailSummary() {
  await seedInitialConnectors();
  const oauthClient = await getGoogleAuthClient('gmail');
  if (!oauthClient) {
    console.log('[ConnectorsSummary] Gmail is not authorized.');
    return null;
  }

  console.log('[ConnectorsSummary] Fetching Gmail unread inbox...');
  const gmail = google.gmail({ version: 'v1', auth: oauthClient });
  
  let res;
  try {
    res = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread',
      maxResults: 15
    });
  } catch (err) {
    console.error('[ConnectorsSummary] Gmail API fetch failed:', err.message);
    const errStr = err.message.toLowerCase();
    const isFatalAuthError = errStr.includes('invalid_grant') || errStr.includes('unauthorized_client');
    if (isFatalAuthError) {
      await handleAuthFailure('gmail');
    } else {
      try {
        await queryDb(
          `UPDATE jarvis_connector_tokens 
           SET last_sync_status = 'temporary_error', updated_at = NOW() 
           WHERE connector_id = 'gmail';`
        );
      } catch (dbErr) {
        // ignore DB logging failure
      }
    }
    throw err;
  }

  if (!res.data.messages || res.data.messages.length === 0) {
    return [];
  }

  // Fetch active project slugs
  const projects = await queryDb("SELECT slug FROM jarvis_projects WHERE status = 'active';");
  const projectSlugs = projects.map(p => p.slug);

  const emailSummaries = [];
  for (const msg of res.data.messages) {
    let details;
    try {
      details = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id
      });
    } catch (err) {
      console.warn(`[ConnectorsSummary] Failed to fetch message details for ${msg.id}: ${err.message}`);
      const errStr = err.message.toLowerCase();
      const isFatalAuthError = errStr.includes('invalid_grant') || errStr.includes('unauthorized_client');
      if (isFatalAuthError) {
        await handleAuthFailure('gmail');
      } else {
        try {
          await queryDb(
            `UPDATE jarvis_connector_tokens 
             SET last_sync_status = 'temporary_error', updated_at = NOW() 
             WHERE connector_id = 'gmail';`
          );
        } catch (dbErr) {
          // ignore DB logging failure
        }
      }
      continue;
    }

    const payload = details.data.payload;
    const headers = payload ? payload.headers : [];
    
    const subjectHeader = headers.find(h => h.name.toLowerCase() === 'subject');
    const fromHeader = headers.find(h => h.name.toLowerCase() === 'from');
    const dateHeader = headers.find(h => h.name.toLowerCase() === 'date');

    const subject = subjectHeader ? subjectHeader.value : '(No Subject)';
    const from = fromHeader ? fromHeader.value : '(Unknown Sender)';
    const dateStr = dateHeader ? dateHeader.value : '';
    const snippet = details.data.snippet || '';

    // Check if matches active project slugs
    const textToMatch = `${subject} ${from} ${snippet}`.toLowerCase();
    let matchedSlug = null;
    for (const slug of projectSlugs) {
      if (textToMatch.includes(slug)) {
        matchedSlug = slug;
        break;
      }
    }

    // Detect payment/invoice keywords (English & Spanish locales)
    const keywords = ['invoice', 'payment', 'bill', 'receipt', 'wire', 'transaction', 'pago', 'factura'];
    let priorityKeyword = null;
    for (const kw of keywords) {
      if (textToMatch.includes(kw)) {
        priorityKeyword = kw;
        break;
      }
    }

    emailSummaries.push({
      id: msg.id,
      subject,
      from,
      date: dateStr,
      snippet,
      suggested_project: matchedSlug,
      priority_keyword: priorityKeyword
    });
  }

  // Write sync log entry
  try {
    await queryDb(`
      INSERT INTO jarvis_connector_sync_logs (connector_id, sync_status, records_synced)
      VALUES ('gmail', 'success', $1);
    `, [emailSummaries.length]);
  } catch (e) {
    // Ignore logging failures
  }

  return emailSummaries;
}

/**
 * Summarizes recently modified Google Drive files (read-only)
 */
async function getDriveSummary() {
  await seedInitialConnectors();
  const oauthClient = await getGoogleAuthClient('google_drive');
  if (!oauthClient) {
    console.log('[ConnectorsSummary] Google Drive is not authorized.');
    return null;
  }

  console.log('[ConnectorsSummary] Fetching Google Drive modifications...');
  const drive = google.drive({ version: 'v3', auth: oauthClient });

  let res;
  try {
    res = await drive.files.list({
      pageSize: 15,
      fields: 'files(id, name, mimeType, modifiedTime, webViewLink, size)',
      orderBy: 'modifiedTime desc',
      q: 'trashed = false'
    });
  } catch (err) {
    console.error('[ConnectorsSummary] Google Drive API fetch failed:', err.message);
    const errStr = err.message.toLowerCase();
    const isFatalAuthError = errStr.includes('invalid_grant') || errStr.includes('unauthorized_client');
    if (isFatalAuthError) {
      await handleAuthFailure('google_drive');
    } else {
      try {
        await queryDb(
          `UPDATE jarvis_connector_tokens 
           SET last_sync_status = 'temporary_error', updated_at = NOW() 
           WHERE connector_id = 'google_drive';`
        );
      } catch (dbErr) {
        // ignore DB logging failure
      }
    }
    throw err;
  }

  const files = res.data.files || [];
  if (files.length === 0) {
    return [];
  }

  // Fetch active project slugs
  const projects = await queryDb("SELECT slug FROM jarvis_projects WHERE status = 'active';");
  const projectSlugs = projects.map(p => p.slug);

  const driveSummaries = [];
  for (const f of files) {
    const nameLower = f.name.toLowerCase();
    
    // Check match against active projects
    let matchedSlug = null;
    for (const slug of projectSlugs) {
      if (nameLower.includes(slug)) {
        matchedSlug = slug;
        break;
      }
    }

    driveSummaries.push({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      modifiedTime: f.modifiedTime,
      webViewLink: f.webViewLink,
      size_bytes: f.size ? parseInt(f.size) : null,
      suggested_project: matchedSlug
    });
  }

  // Write sync log entry
  try {
    await queryDb(`
      INSERT INTO jarvis_connector_sync_logs (connector_id, sync_status, records_synced)
      VALUES ('google_drive', 'success', $1);
    `, [driveSummaries.length]);
  } catch (e) {
    // Ignore logging failures
  }

  return driveSummaries;
}

module.exports = {
  seedInitialConnectors,
  listConnectorsStatus,
  getEmailSummary,
  getDriveSummary
};
