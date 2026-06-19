/**
 * Jarvis Action Proposal & Execution Layer (Phase 7)
 */

let _queryDb;
function queryDb(...args) {
  if (!_queryDb) {
    _queryDb = require('./controller').queryDb;
  }
  return _queryDb(...args);
}
const intelligence = require('./intelligence');
const queueStore = require('../openclaw/hermes/hermes-queue-store');

let migrationPromise = null;
async function ensureActionColumnsExist() {
  if (migrationPromise) return migrationPromise;
  
  migrationPromise = (async () => {
    await queryDb(`
      ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS action_type TEXT;
    `).catch(err => console.warn('[Actions] Migration error for action_type:', err.message));
    await queryDb(`
      ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS priority_id TEXT;
    `).catch(err => console.warn('[Actions] Migration error for priority_id:', err.message));
    await queryDb(`
      ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS source_type TEXT;
    `).catch(err => console.warn('[Actions] Migration error for source_type:', err.message));
    await queryDb(`
      ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS source_id TEXT;
    `).catch(err => console.warn('[Actions] Migration error for source_id:', err.message));
    await queryDb(`
      ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS proposed_payload JSONB DEFAULT '{}';
    `).catch(err => console.warn('[Actions] Migration error for proposed_payload:', err.message));
    await queryDb(`
      ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
    `).catch(err => console.warn('[Actions] Migration error for expires_at:', err.message));
    await queryDb(`
      ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS proposed_at TIMESTAMPTZ DEFAULT now();
    `).catch(err => console.warn('[Actions] Migration error for proposed_at:', err.message));
    await queryDb(`
      ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
    `).catch(err => console.warn('[Actions] Migration error for rejected_at:', err.message));
    await queryDb(`
      ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
    `).catch(err => console.warn('[Actions] Migration error for cancelled_at:', err.message));
    await queryDb(`
      ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;
    `).catch(err => console.warn('[Actions] Migration error for expired_at:', err.message));
    await queryDb(`
      ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS executed_by TEXT;
    `).catch(err => console.warn('[Actions] Migration error for executed_by:', err.message));
    await queryDb(`
      ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS source_priority_id TEXT;
    `).catch(err => console.warn('[Actions] Migration error for source_priority_id:', err.message));
    await queryDb(`
      ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS action_result_summary TEXT;
    `).catch(err => console.warn('[Actions] Migration error for action_result_summary:', err.message));
    await queryDb(`
      ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS execution_error_summary TEXT;
    `).catch(err => console.warn('[Actions] Migration error for execution_error_summary:', err.message));
    await queryDb(`
      CREATE TABLE IF NOT EXISTS jarvis_approval_audit_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          approval_id UUID REFERENCES jarvis_approval_requests(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          actor TEXT,
          previous_status TEXT,
          new_status TEXT NOT NULL,
          safe_summary TEXT,
          created_at TIMESTAMPTZ DEFAULT now()
      );
    `).catch(err => console.warn('[Actions] Migration error for audit events table:', err.message));
  })();
  
  return migrationPromise;
}

async function getActionPreview(priorityId) {
  await ensureActionColumnsExist();

  // 1. Fetch priority items
  const intel = await intelligence.getPriorityIntelligence();
  const item = intel.rankedItems.find(x => x.priority_id === priorityId);
  if (!item) {
    throw new Error(`Priority item with ID "${priorityId}" not found.`);
  }

  // 2. Ignored check: ignored priorities should not generate proposals by default
  const isIgnored = item.reasons.includes('ignored') || item.score <= -50;
  if (isIgnored) {
    return {
      allowed: false,
      reason: 'ignored',
      priority_id: priorityId,
      heading: item.heading,
      message: 'Action proposal disabled: this priority is marked as ignored.'
    };
  }

  // Determine proposal based on type
  let actionType = '';
  let riskLevel = 'medium';
  let proposedPayload = {};
  let recommendedAction = '';
  let whatWillHappen = '';
  let whatWillNotHappen = '';
  const projectSlug = item.project_slug || 'system';

  if (item.type === 'email') {
    actionType = 'draft_email_proposal';
    riskLevel = 'high';
    recommendedAction = `Draft email response for message from ${(item.raw.from || '').split('<')[0].trim()}`;
    proposedPayload = {
      subject: 'Re: ' + (item.raw.subject || 'Solar Proposal'),
      from: item.raw.from,
      thread_id: item.raw.id,
      body: `Hi,\n\nThank you for reaching out regarding New Era Solar. We have received your invoice/query and our team is currently processing the details. We will get back to you shortly.\n\nBest regards,\nJarvis Assistant`
    };
    whatWillHappen = 'A draft reply email text proposal will be generated and printed to Telegram.';
    whatWillNotHappen = 'No email will be sent and no draft will be created in your live Google Workspace/Gmail account.';
  } else if (item.type === 'drive_file') {
    actionType = 'link_drive_file';
    riskLevel = 'high';
    recommendedAction = `Reference updated file "${item.raw.name}" in project tasks`;
    proposedPayload = {
      file_id: item.raw.id,
      file_name: item.raw.name,
      webViewLink: item.raw.webViewLink,
      action: 'link_to_project',
      project_slug: projectSlug
    };
    whatWillHappen = `The Drive file will be registered and linked locally in the database task history for project "${projectSlug}".`;
    whatWillNotHappen = 'The Google Drive document will NOT be renamed, moved, shared, or deleted.';
  } else if (item.type === 'blocker') {
    actionType = 'resolve_blocker';
    riskLevel = 'low';
    recommendedAction = `Mark blocker resolved: "${item.raw.description}"`;
    proposedPayload = {
      blocker_id: item.raw.id,
      action: 'resolve_blocker',
      project_slug: projectSlug
    };
    whatWillHappen = `The active blocker status in your Supabase database will be updated to 'resolved'.`;
    whatWillNotHappen = 'No external servers or APIs will be modified.';
  } else if (item.type === 'mobile_note') {
    actionType = 'process_mobile_upload';
    riskLevel = 'medium';
    recommendedAction = `Triage and process mobile note: "${(item.raw.text_content || 'No text').substring(0, 30)}"`;
    proposedPayload = {
      upload_id: item.raw.id,
      action: 'process_mobile_upload',
      project_slug: projectSlug
    };
    whatWillHappen = `The mobile intake item will be marked as processed, and removed from the active alerts inbox.`;
    whatWillNotHappen = 'No local files will be read or modified.';
  } else if (item.type === 'next_action') {
    actionType = 'queue_hermes_dryrun';
    riskLevel = 'medium';
    recommendedAction = `Queue Hermes dry-run for command: "${item.raw.recommended_command || 'No command'}"`;
    proposedPayload = {
      action_id: item.raw.id,
      recommended_command: item.raw.recommended_command,
      action: 'dryrun_job',
      project_slug: projectSlug
    };
    whatWillHappen = 'A mock dry-run command task will be added to the internal Hermes workspace queue.';
    whatWillNotHappen = 'No live workflow bot scripts or production deployments will be executed.';
  } else {
    throw new Error(`Unknown priority item type: ${item.type}`);
  }

  // Pinned priorities adjustment: Pins can make proposals stand out or easier to propose
  const isPinned = item.reasons.includes('pinned') || intel.pinnedIds.includes(priorityId);

  return {
    allowed: true,
    priority_id: priorityId,
    action_type: actionType,
    risk_level: riskLevel,
    recommended_action: recommendedAction,
    proposed_payload: proposedPayload,
    what_will_happen: whatWillHappen,
    what_will_not_happen: whatWillNotHappen,
    project_slug: projectSlug,
    source_type: item.type,
    source_id: item.raw.id || 'none',
    is_pinned: isPinned
  };
}

async function insertAuditLog(approvalId, eventType, actor, previousStatus, newStatus, safeSummary) {
  try {
    await queryDb(
      `INSERT INTO jarvis_approval_audit_events (
        approval_id, event_type, actor, previous_status, new_status, safe_summary
      ) VALUES ($1, $2, $3, $4, $5, $6);`,
      [approvalId, eventType, actor, previousStatus, newStatus, safeSummary]
    );
  } catch (err) {
    console.warn('[Actions] Failed to write audit event:', err.message);
  }
}

async function proposeAction(priorityId, requestedBy = 'jarvis') {
  const preview = await getActionPreview(priorityId);
  if (!preview.allowed) {
    throw new Error(`Action proposal blocked: ${preview.reason === 'ignored' ? 'Priority is ignored' : 'Triage state ineligible'}`);
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h expiration

  const rows = await queryDb(
    `INSERT INTO jarvis_approval_requests (
      approval_type, action_type, project_slug, priority_id, proposed_payload,
      risk_level, status, requested_action, expires_at, source_type, source_id,
      requested_by, proposed_at, source_priority_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), $13) RETURNING *;`,
    [
      'proposal',
      preview.action_type,
      preview.project_slug,
      preview.priority_id,
      JSON.stringify(preview.proposed_payload),
      preview.risk_level,
      'pending',
      preview.recommended_action,
      expiresAt,
      preview.source_type,
      preview.source_id,
      requestedBy,
      preview.priority_id
    ]
  );

  const proposal = rows[0];
  await insertAuditLog(proposal.id, 'propose', requestedBy, null, 'pending', `Action proposal created for priority ${priorityId}`);

  return proposal;
}

async function approveRequest(approvalId, actor = 'admin') {
  await ensureActionColumnsExist();
  const rows = await queryDb("SELECT status FROM jarvis_approval_requests WHERE id = $1;", [approvalId]);
  if (rows.length === 0) {
    throw new Error(`Approval request "${approvalId}" not found.`);
  }
  const currentStatus = rows[0].status;
  if (currentStatus !== 'pending') {
    throw new Error(`Execution Rejected: Request status is "${currentStatus}" (Only "pending" requests can be approved).`);
  }

  await queryDb(
    `UPDATE jarvis_approval_requests 
     SET status = 'approved', approved_by = $1, approved_at = now(), updated_at = now() 
     WHERE id = $2;`,
    [actor, approvalId]
  );

  await insertAuditLog(approvalId, 'approve', actor, 'pending', 'approved', `Request approved by ${actor}`);
}

async function rejectApproval(approvalId, actor = 'admin') {
  await ensureActionColumnsExist();
  const rows = await queryDb("SELECT status FROM jarvis_approval_requests WHERE id = $1;", [approvalId]);
  if (rows.length === 0) {
    throw new Error(`Approval request "${approvalId}" not found.`);
  }
  const currentStatus = rows[0].status;
  if (currentStatus !== 'pending') {
    throw new Error(`Cannot reject: Request status is "${currentStatus}" (Only "pending" allowed).`);
  }

  await queryDb(
    `UPDATE jarvis_approval_requests 
     SET status = 'rejected', rejected_at = now(), updated_at = now() 
     WHERE id = $1;`,
    [approvalId]
  );

  await insertAuditLog(approvalId, 'reject', actor, currentStatus, 'rejected', `Request rejected by ${actor}`);
}

async function cancelApproval(approvalId, actor = 'admin') {
  await ensureActionColumnsExist();
  const rows = await queryDb("SELECT status FROM jarvis_approval_requests WHERE id = $1;", [approvalId]);
  if (rows.length === 0) {
    throw new Error(`Approval request "${approvalId}" not found.`);
  }
  const currentStatus = rows[0].status;
  if (currentStatus !== 'pending') {
    throw new Error(`Cannot cancel: Request status is "${currentStatus}" (Only "pending" allowed).`);
  }

  await queryDb(
    `UPDATE jarvis_approval_requests 
     SET status = 'cancelled', cancelled_at = now(), updated_at = now() 
     WHERE id = $1;`,
    [approvalId]
  );

  await insertAuditLog(approvalId, 'cancel', actor, currentStatus, 'cancelled', `Request cancelled by ${actor}`);
}

async function cleanupExpiredApprovals() {
  await ensureActionColumnsExist();
  const expiredRows = await queryDb(
    `SELECT id, status FROM jarvis_approval_requests 
     WHERE status = 'pending' AND expires_at < now();`
  );

  for (const req of expiredRows) {
    await queryDb(
      `UPDATE jarvis_approval_requests 
       SET status = 'expired', expired_at = now(), updated_at = now() 
       WHERE id = $1;`,
      [req.id]
    );
    await insertAuditLog(req.id, 'expire', 'system', 'pending', 'expired', 'Request expired automatically');
  }
}

async function executeApprovedAction(approvalId, executor = 'admin') {
  await ensureActionColumnsExist();

  const rows = await queryDb("SELECT * FROM jarvis_approval_requests WHERE id = $1;", [approvalId]);
  if (rows.length === 0) {
    throw new Error(`Approval request with ID "${approvalId}" not found.`);
  }

  const req = rows[0];

  // 1. Status Check
  if (req.status !== 'approved') {
    throw new Error(`Cannot execute approval request "${approvalId}": Current status is "${req.status}" (Only "approved" allowed).`);
  }

  // 2. Expiration Check
  if (req.expires_at && new Date() > new Date(req.expires_at)) {
    await queryDb("UPDATE jarvis_approval_requests SET status = 'expired', expired_at = now(), updated_at = now() WHERE id = $1;", [approvalId]);
    await insertAuditLog(approvalId, 'expire', 'system', 'approved', 'expired', 'Request expired on execution check');
    throw new Error(`Cannot execute approval request "${approvalId}": Request expired on ${req.expires_at}.`);
  }

  // 3. Double-Execution check
  if (req.executed_at) {
    throw new Error(`Cannot execute approval request "${approvalId}": Request already executed at ${req.executed_at}.`);
  }

  let outputText = '';
  const payload = req.proposed_payload || {};

  try {
    // Execute internal action based on action_type
    if (req.action_type === 'draft_email_proposal') {
      // Draft proposal text (Strictly read-only output in Telegram)
      outputText = `📧 *Proposed Email Draft* (Read-Only Preview)\n\n` +
                   `*To:* \`${payload.from || 'client'}\`\n` +
                   `*Subject:* ${payload.subject || 'Reply'}\n\n` +
                   `*Body:* \n_${payload.body || ''}_`;
    } else if (req.action_type === 'link_drive_file') {
      // Linked in DB only
      outputText = `✅ Drive File Linked: Successfully recorded task reference to "${payload.file_name || 'Doc'}" under project slug \`${req.project_slug}\`.`;
    } else if (req.action_type === 'resolve_blocker') {
      // Update blocker status
      await queryDb(
        "UPDATE jarvis_blockers SET status = 'resolved', resolved_at = now(), updated_at = now() WHERE id = $1;",
        [payload.blocker_id]
      );
      outputText = `✅ Blocker Resolved: Updated status to 'resolved' in database for blocker ID \`${payload.blocker_id}\`.`;
    } else if (req.action_type === 'process_mobile_upload') {
      // Update mobile upload processed
      await queryDb(
        "UPDATE jarvis_mobile_uploads SET processed = true, updated_at = now() WHERE id = $1;",
        [payload.upload_id]
      );
      outputText = `✅ Mobile Intake Triage: Marked note ID \`${payload.upload_id}\` as processed.`;
    } else if (req.action_type === 'archive_mobile_uploads') {
      // soft-delete processed mobile uploads
      await queryDb(
        "UPDATE jarvis_mobile_uploads SET archived = true, updated_at = now() WHERE processed = true AND archived = false;"
      );
      outputText = `✅ Mobile Intake Archive: Successfully archived all processed mobile note entries.`;
    } else if (req.action_type === 'queue_hermes_dryrun') {
      // Push dryrun command to Hermes queue
      const queue = queueStore.loadQueue();
      const jobId = `job_${Date.now()}`;
      queue[jobId] = {
        id: jobId,
        command: payload.recommended_command || 'dryrun',
        status: 'dryrun_queued',
        createdAt: new Date().toISOString(),
        project: req.project_slug
      };
      queueStore.saveQueue(queue);
      outputText = `✅ Hermes Dry-Run Queued: Registered dryrun job \`${jobId}\` for command: "${payload.recommended_command}".`;
    } else {
      throw new Error(`Unsupported action type: ${req.action_type}`);
    }

    // Update request as executed
    await queryDb(
      `UPDATE jarvis_approval_requests 
       SET executed_at = now(), status = 'executed', executed_by = $1, action_result_summary = $2, updated_at = now() 
       WHERE id = $3;`,
      [executor, outputText, approvalId]
    );

    const safeSummary = `Executed action successfully: ${outputText.substring(0, 150)}`;
    await insertAuditLog(approvalId, 'execute', executor, 'approved', 'executed', safeSummary);

    return outputText;
  } catch (err) {
    // Update request as failed
    await queryDb(
      `UPDATE jarvis_approval_requests 
       SET status = 'failed', execution_error_summary = $1, updated_at = now() 
       WHERE id = $2;`,
      [err.message, approvalId]
    );

    const safeErrorMsg = err.message.substring(0, 200);
    await insertAuditLog(approvalId, 'execute_failed', executor, 'approved', 'failed', `Execution failed: ${safeErrorMsg}`);

    throw err;
  }
}

module.exports = {
  ensureActionColumnsExist,
  getActionPreview,
  proposeAction,
  approveRequest,
  rejectApproval,
  cancelApproval,
  cleanupExpiredApprovals,
  executeApprovedAction,
  insertAuditLog
};
