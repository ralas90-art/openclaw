/**
 * Jarvis Phase 7: Approval-Gated Action Layer Test Suite
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const dotenv = require('dotenv');
const { Client } = require('pg');

// Load environment variables
const envLocalPath = path.resolve(__dirname, '../.env.local');
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

process.env.TELEGRAM_ALLOWED_RUNTIME_CHAT_IDS = '12345';
process.env.TELEGRAM_ALLOWED_USER_IDS = '12345';
process.env.OPENCLAW_ROLE_SUPER_ADMIN_CHAT_IDS = '12345';
process.env.NODE_ENV = 'test';

const { getActionPreview, proposeAction, executeApprovedAction } = require('../jarvis/actions');
const { queryDb } = require('../jarvis/controller');
const { handleCommand } = require('../interfaces/telegram/handlers');
const queueStore = require('../openclaw/hermes/hermes-queue-store');
const intelligence = require('../jarvis/intelligence');

const DB_URL = process.env.DATABASE_URL;
let client;

const BLOCKER_UUID = '00000000-0000-0000-0000-000000000789';
const MOBILE_UUID = '00000000-0000-0000-0000-000000000999';
const NEXT_ACTION_UUID = '00000000-0000-0000-0000-000000000111';

// Mock priorities data for getPriorityIntelligence stub
const mockIntelligenceData = {
  rankedItems: [
    {
      priority_id: 'email:msg123',
      type: 'email',
      heading: 'Draft reply for msg123',
      score: 45,
      project_slug: 'septivolt',
      reasons: [],
      raw: { id: 'msg123', subject: 'Solar Proposal Questions', from: 'john@client.com' }
    },
    {
      priority_id: 'drive_file:doc456',
      type: 'drive_file',
      heading: 'Link Drive File doc456',
      score: 30,
      project_slug: 'new-era-solar',
      reasons: [],
      raw: { id: 'doc456', name: 'Contract Draft v2.pdf', webViewLink: 'https://drive.google.com/doc456' }
    },
    {
      priority_id: 'blocker:' + BLOCKER_UUID,
      type: 'blocker',
      heading: 'Resolve Blocker ' + BLOCKER_UUID,
      score: 55,
      project_slug: 'septivolt',
      reasons: [],
      raw: { id: BLOCKER_UUID, description: 'API Integration Blocked' }
    },
    {
      priority_id: 'mobile_note:' + MOBILE_UUID,
      type: 'mobile_note',
      heading: 'Triage note ' + MOBILE_UUID,
      score: 10,
      project_slug: 'system',
      reasons: [],
      raw: { id: MOBILE_UUID, text_content: 'Spoke with prospect about solar timeline' }
    },
    {
      priority_id: 'next_action:' + NEXT_ACTION_UUID,
      type: 'next_action',
      heading: 'Run command ' + NEXT_ACTION_UUID,
      score: 25,
      project_slug: 'septivolt',
      reasons: [],
      raw: { id: NEXT_ACTION_UUID, recommended_command: 'npm run test-cf', action: 'Run command' }
    },
    {
      priority_id: 'email:msg_ignored',
      type: 'email',
      heading: 'Ignored email',
      score: -60,
      project_slug: 'septivolt',
      reasons: ['ignored'],
      raw: { id: 'msg_ignored', subject: 'Ignored Subject', from: 'spam@client.com' }
    },
    {
      priority_id: 'email:msg_pinned',
      type: 'email',
      heading: 'Pinned email',
      score: 95,
      project_slug: 'septivolt',
      reasons: ['pinned'],
      raw: { id: 'msg_pinned', subject: 'Pinned Subject', from: 'important@client.com' }
    }
  ],
  pinnedIds: ['email:msg_pinned'],
  ignoredIds: ['email:msg_ignored']
};

let originalGetPriorityIntelligence;

async function setup() {
  console.log('Setting up Phase 7 test environment...');
  if (!DB_URL) {
    console.error('Error: DATABASE_URL is not set.');
    process.exit(1);
  }
  client = new Client({ connectionString: DB_URL });
  await client.connect();

  // Stub getPriorityIntelligence
  originalGetPriorityIntelligence = intelligence.getPriorityIntelligence;
  intelligence.getPriorityIntelligence = async () => {
    return mockIntelligenceData;
  };

  // Seed mock tables for blocker/mobile note/next action to avoid foreign key or state check errors in execution
  await client.query(`
    CREATE TABLE IF NOT EXISTS jarvis_projects (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS jarvis_blockers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_slug TEXT REFERENCES jarvis_projects(slug),
      description TEXT,
      status TEXT DEFAULT 'active',
      resolved_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS jarvis_mobile_uploads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_slug TEXT REFERENCES jarvis_projects(slug),
      text_content TEXT,
      processed BOOLEAN DEFAULT false,
      archived BOOLEAN DEFAULT false,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS jarvis_next_actions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_slug TEXT REFERENCES jarvis_projects(slug),
      action TEXT NOT NULL,
      recommended_command TEXT,
      status TEXT DEFAULT 'pending',
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await client.query(`
    INSERT INTO jarvis_projects (slug, name, status) VALUES ('septivolt', 'SeptiVolt', 'active') ON CONFLICT DO NOTHING;
    INSERT INTO jarvis_projects (slug, name, status) VALUES ('new-era-solar', 'New Era Solar', 'active') ON CONFLICT DO NOTHING;
    INSERT INTO jarvis_projects (slug, name, status) VALUES ('system', 'System Internal', 'active') ON CONFLICT DO NOTHING;
  `);

  await client.query(`
    INSERT INTO jarvis_blockers (id, project_slug, description, status) VALUES ($1, 'septivolt', 'API Integration Blocked', 'active') ON CONFLICT DO NOTHING;
  `, [BLOCKER_UUID]);

  // Alter table if needed, but since it is created dynamically, we can just insert with intake_source.
  // Wait, if the table already exists in Supabase database, it has intake_source as NOT NULL.
  // Let's query if intake_source column exists in jarvis_mobile_uploads. If so, insert with it.
  const colCheck = await client.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'jarvis_mobile_uploads' AND column_name = 'intake_source';
  `);

  if (colCheck.rows.length > 0) {
    await client.query(`
      INSERT INTO jarvis_mobile_uploads (id, project_slug, text_content, processed, archived, intake_source) 
      VALUES ($1, 'system', 'Spoke with prospect about solar timeline', false, false, 'telegram') 
      ON CONFLICT DO NOTHING;
    `, [MOBILE_UUID]);
  } else {
    await client.query(`
      INSERT INTO jarvis_mobile_uploads (id, project_slug, text_content, processed, archived) 
      VALUES ($1, 'system', 'Spoke with prospect about solar timeline', false, false) 
      ON CONFLICT DO NOTHING;
    `, [MOBILE_UUID]);
  }

  await client.query(`
    INSERT INTO jarvis_next_actions (id, project_slug, action, recommended_command, status) VALUES ($1, 'septivolt', 'Run Command Test', 'npm run test-cf', 'pending') ON CONFLICT DO NOTHING;
  `, [NEXT_ACTION_UUID]);

  // Clear existing approval requests to ensure isolated test environment
  await client.query("DELETE FROM jarvis_approval_requests;");
}

async function cleanup() {
  console.log('\nCleaning up Phase 7 test resources...');
  if (originalGetPriorityIntelligence) {
    intelligence.getPriorityIntelligence = originalGetPriorityIntelligence;
  }
  if (client) {
    try {
      await client.query("DELETE FROM jarvis_approval_requests;");
      await client.end();
    } catch (err) {
      console.error('[Cleanup Error]', err.message);
    }
  }
}

async function runTests() {
  await setup();
  console.log('Starting Phase 7 Approval-Gated Action Layer Integration Tests...');
  let testsPassed = 0;
  let totalTests = 0;

  function runAssert(condition, message) {
    totalTests++;
    if (condition) {
      testsPassed++;
      console.log(`✅ Test ${totalTests} Passed: ${message}`);
    } else {
      console.error(`❌ Test ${totalTests} Failed: ${message}`);
      throw new Error(`Test failure: ${message}`);
    }
  }

  const mockMessage = {
    chat: { id: 12345 },
    from: { id: 12345 }
  };

  try {
    // ==========================================
    // TEST 1: Action Preview Risk Levels and Output
    // ==========================================
    const emailPreview = await getActionPreview('email:msg123');
    runAssert(emailPreview.allowed === true, 'Email action preview allowed');
    runAssert(emailPreview.risk_level === 'high', 'Email action classified as high risk');
    runAssert(emailPreview.action_type === 'draft_email_proposal', 'Correct email action type');
    runAssert(emailPreview.proposed_payload.subject === 'Re: Solar Proposal Questions', 'Email subject correct');

    const blockerPreview = await getActionPreview('blocker:' + BLOCKER_UUID);
    runAssert(blockerPreview.risk_level === 'low', 'Blocker action classified as low risk');
    runAssert(blockerPreview.action_type === 'resolve_blocker', 'Correct blocker action type');

    const mobilePreview = await getActionPreview('mobile_note:' + MOBILE_UUID);
    runAssert(mobilePreview.risk_level === 'medium', 'Mobile note action classified as medium risk');

    const nextActionPreview = await getActionPreview('next_action:' + NEXT_ACTION_UUID);
    runAssert(nextActionPreview.risk_level === 'medium', 'Next action dry-run classified as medium risk');

    // ==========================================
    // TEST 2: Ignored Priorities Blocked from Proposals
    // ==========================================
    const ignoredPreview = await getActionPreview('email:msg_ignored');
    runAssert(ignoredPreview.allowed === false, 'Ignored priority action preview is blocked');
    runAssert(ignoredPreview.reason === 'ignored', 'Ignore reason is explicitly "ignored"');

    await assert.rejects(
      proposeAction('email:msg_ignored'),
      /Action proposal blocked: Priority is ignored/,
      'Proposing ignored action throws exception'
    );
    runAssert(true, 'Proposing ignored priority rejected as expected');

    // ==========================================
    // TEST 3: Pinned Priorities Promotion Indicator
    // ==========================================
    const pinnedPreview = await getActionPreview('email:msg_pinned');
    runAssert(pinnedPreview.allowed === true, 'Pinned priority action preview allowed');
    runAssert(pinnedPreview.is_pinned === true, 'Pinned priority contains pinning metadata flag');

    // ==========================================
    // TEST 4: Action Proposal DB Insertion and Expiration
    // ==========================================
    const proposal = await proposeAction('email:msg123');
    runAssert(proposal.id !== undefined, 'Proposal successfully saved to database and returned ID');
    runAssert(proposal.status === 'pending', 'Proposal defaults to pending status');
    runAssert(proposal.action_type === 'draft_email_proposal', 'Proposal saves correct action_type');
    runAssert(proposal.expires_at !== null, 'Proposal sets expiration timestamp');

    const expTime = new Date(proposal.expires_at).getTime();
    const nowTime = Date.now();
    runAssert(expTime - nowTime > 23 * 60 * 60 * 1000, 'Expiration is approximately 24 hours in the future');

    // ==========================================
    // TEST 5: Action Preview Telegram Command
    // ==========================================
    const previewCmdText = await handleCommand('/jarvis_action_preview email:msg123', mockMessage);
    console.log('DEBUG: previewCmdText =', previewCmdText);
    runAssert(previewCmdText.includes('🔍 *Jarvis Action Preview*'), 'Command output includes title header');
    runAssert(previewCmdText.includes('Risk Level:* *HIGH*'), 'Command output displays correct risk tier');
    runAssert(previewCmdText.includes('What will NOT happen'), 'Command output displays safety boundary notes');

    // ==========================================
    // TEST 6: Action Proposal Telegram Command
    // ==========================================
    const proposeCmdText = await handleCommand('/jarvis_propose_action email:msg123', mockMessage);
    runAssert(proposeCmdText.includes('📝 *Action Proposal Created*'), 'Propose command outputs success message');
    runAssert(proposeCmdText.includes('/jarvis_approve'), 'Propose command contains execution suggestion command');

    // Extract proposal ID from output
    const idMatch = proposeCmdText.match(/Proposal ID:\* `([^`]+)`/);
    runAssert(idMatch !== null, 'Command returns proposal ID');
    const newProposalId = idMatch[1];

    // ==========================================
    // TEST 7: List Approvals Telegram Command
    // ==========================================
    const listCmdText = await handleCommand('/jarvis_approvals', mockMessage);
    runAssert(listCmdText.includes('📥 *Pending Action Approvals*'), 'List command outputs correct header');
    runAssert(listCmdText.includes(newProposalId), 'List command contains the pending proposal ID');

    // ==========================================
    // TEST 8: Approval Details Command & Secret Leaks Guard
    // ==========================================
    const detailsCmdText = await handleCommand(`/jarvis_approval ${newProposalId}`, mockMessage);
    runAssert(detailsCmdText.includes('🛡️ *Approval Request Details*'), 'Details command outputs header');
    runAssert(detailsCmdText.includes('Proposed Payload'), 'Details command lists payload section');

    // Check payload truncation (500 chars limit) by creating a large payload proposal
    const largePayload = { large_field: 'a'.repeat(600) };
    const largePropRows = await queryDb(
      `INSERT INTO jarvis_approval_requests (approval_type, action_type, status, proposed_payload, requested_action, risk_level)
       VALUES ('proposal', 'draft_email_proposal', 'pending', $1, 'Large Payload Test', 'high') RETURNING id;`,
      [JSON.stringify(largePayload)]
    );
    const largePropId = largePropRows[0].id;

    const largeDetailsText = await handleCommand(`/jarvis_approval ${largePropId}`, mockMessage);
    runAssert(largeDetailsText.includes('[truncated for display]'), 'Large payloads are truncated to prevent secret/overflow leaks');

    // ==========================================
    // TEST 9: Reject Approval & Lockout Command
    // ==========================================
    const rejectCmdText = await handleCommand(`/jarvis_reject ${largePropId}`, mockMessage);
    runAssert(rejectCmdText.includes('🛑 Rejected request'), 'Reject command successfully executes');

    const rejectCheck = await queryDb("SELECT status FROM jarvis_approval_requests WHERE id = $1;", [largePropId]);
    runAssert(rejectCheck[0].status === 'rejected', 'Status changed to rejected in database');

    const approveRejectedText = await handleCommand(`/jarvis_approve ${largePropId}`, mockMessage);
    runAssert(approveRejectedText.includes('Execution Rejected: Request status is "rejected"'), 'Cannot approve or execute rejected requests');

    // ==========================================
    // TEST 10: Cancel Approval Command & Lockout
    // ==========================================
    const cancelPropRows = await queryDb(
      `INSERT INTO jarvis_approval_requests (approval_type, action_type, status, requested_action, risk_level)
       VALUES ('proposal', 'draft_email_proposal', 'pending', 'Cancel Test', 'high') RETURNING id;`
    );
    const cancelPropId = cancelPropRows[0].id;

    const cancelCmdText = await handleCommand(`/jarvis_cancel_approval ${cancelPropId}`, mockMessage);
    runAssert(cancelCmdText.includes('🚫 Cancelled pending approval request'), 'Cancel command successfully executes');

    const cancelCheck = await queryDb("SELECT status FROM jarvis_approval_requests WHERE id = $1;", [cancelPropId]);
    runAssert(cancelCheck[0].status === 'cancelled', 'Status changed to cancelled in database');

    const approveCancelledText = await handleCommand(`/jarvis_approve ${cancelPropId}`, mockMessage);
    runAssert(approveCancelledText.includes('Execution Rejected: Request status is "cancelled"'), 'Cannot approve or execute cancelled requests');

    // ==========================================
    // TEST 11: Expired Approvals Execution Block
    // ==========================================
    const expiredPropRows = await queryDb(
      `INSERT INTO jarvis_approval_requests (approval_type, action_type, status, requested_action, risk_level, expires_at)
       VALUES ('proposal', 'draft_email_proposal', 'approved', 'Expired Test', 'high', now() - interval '1 hour') RETURNING id;`
    );
    const expiredPropId = expiredPropRows[0].id;

    await assert.rejects(
      executeApprovedAction(expiredPropId),
      /Cannot execute approval request.*Request expired/
    );
    runAssert(true, 'Expired approval execution throws error as expected');

    const expiredCheck = await queryDb("SELECT status FROM jarvis_approval_requests WHERE id = $1;", [expiredPropId]);
    runAssert(expiredCheck[0].status === 'expired', 'Expired approval request status successfully marked as expired in DB');

    // ==========================================
    // TEST 12: Executed Actions Double-Execution Guard
    // ==========================================
    const doublePropRows = await queryDb(
      `INSERT INTO jarvis_approval_requests (approval_type, action_type, status, requested_action, risk_level, proposed_payload, expires_at)
       VALUES ('proposal', 'resolve_blocker', 'approved', 'Double Execution Test', 'low', $1, now() + interval '1 hour') RETURNING id;`,
      [JSON.stringify({ blocker_id: BLOCKER_UUID })]
    );
    const doublePropId = doublePropRows[0].id;

    // First execution succeeds
    const execText = await executeApprovedAction(doublePropId);
    runAssert(execText.includes('✅ Blocker Resolved'), 'First execution of blocker resolution succeeds');

    // Second execution fails
    await assert.rejects(
      executeApprovedAction(doublePropId),
      /Cannot execute approval request.*Only "approved" allowed/
    );
    runAssert(true, 'Second execution blocked by double-execution guard');

    // ==========================================
    // TEST 13: Blocker Resolution DB Verification (Internal write)
    // ==========================================
    const blockerCheck = await queryDb("SELECT status FROM jarvis_blockers WHERE id = $1;", [BLOCKER_UUID]);
    runAssert(blockerCheck[0].status === 'resolved', 'Supabase blocker state successfully modified to resolved');

    // ==========================================
    // TEST 14: Mobile Note Triage & Archive (Internal writes)
    // ==========================================
    const mobPropRows = await queryDb(
      `INSERT INTO jarvis_approval_requests (approval_type, action_type, status, requested_action, risk_level, proposed_payload, expires_at)
       VALUES ('proposal', 'process_mobile_upload', 'approved', 'Triage Mobile Note Test', 'medium', $1, now() + interval '1 hour') RETURNING id;`,
      [JSON.stringify({ upload_id: MOBILE_UUID })]
    );
    const mobPropId = mobPropRows[0].id;
    await executeApprovedAction(mobPropId);

    const mobCheck = await queryDb("SELECT processed FROM jarvis_mobile_uploads WHERE id = $1;", [MOBILE_UUID]);
    runAssert(mobCheck[0].processed === true, 'Mobile upload processed state successfully updated to true');

    // Archive processed uploads
    const archivePropRows = await queryDb(
      `INSERT INTO jarvis_approval_requests (approval_type, action_type, status, requested_action, risk_level, expires_at)
       VALUES ('proposal', 'archive_mobile_uploads', 'approved', 'Archive Test', 'medium', now() + interval '1 hour') RETURNING id;`
    );
    const archivePropId = archivePropRows[0].id;
    await executeApprovedAction(archivePropId);

    const archiveCheck = await queryDb("SELECT archived FROM jarvis_mobile_uploads WHERE id = $1;", [MOBILE_UUID]);
    runAssert(archiveCheck[0].archived === true, 'Mobile upload archived state successfully updated to true');

    // ==========================================
    // TEST 15: Hermes Dry-Run Queue Verification (Internal queue)
    // ==========================================
    const hermesPropRows = await queryDb(
      `INSERT INTO jarvis_approval_requests (approval_type, action_type, status, requested_action, risk_level, proposed_payload, expires_at)
       VALUES ('proposal', 'queue_hermes_dryrun', 'approved', 'Hermes Dry Run Test', 'medium', $1, now() + interval '1 hour') RETURNING id;`,
      [JSON.stringify({ recommended_command: "npm run test-cf", project_slug: "septivolt" })]
    );
    const hermesPropId = hermesPropRows[0].id;
    const hermesOutput = await executeApprovedAction(hermesPropId);
    runAssert(hermesOutput.includes('Hermes Dry-Run Queued'), 'Hermes dry-run execution outputs success message');

    const queue = queueStore.loadQueue();
    const queuedJob = Object.values(queue).find(job => job.command === 'npm run test-cf');
    runAssert(queuedJob !== undefined, 'Dry-run command was successfully added to Hermes queue store');
    runAssert(queuedJob.status === 'dryrun_queued', 'Dry-run command has dryrun_queued status');

    // Clean up dry-run queue job
    if (queuedJob) {
      delete queue[queuedJob.id];
      queueStore.saveQueue(queue);
    }

    // ==========================================
    // TEST 16: Draft Email Proposal Text Read-Only Verification
    // ==========================================
    const emailPropRows = await queryDb(
      `INSERT INTO jarvis_approval_requests (approval_type, action_type, status, requested_action, risk_level, proposed_payload, expires_at)
       VALUES ('proposal', 'draft_email_proposal', 'approved', 'Email Draft Test', 'high', $1, now() + interval '1 hour') RETURNING id;`,
      [JSON.stringify({ from: "john@client.com", subject: "Re: Solar Proposal Questions", body: "Hello John..." })]
    );
    const emailPropId = emailPropRows[0].id;
    const emailOutput = await executeApprovedAction(emailPropId);
    runAssert(emailOutput.includes('Proposed Email Draft'), 'Email execution returns proposed text header');
    runAssert(emailOutput.includes('john@client.com'), 'Email execution includes recipient email');
    runAssert(emailOutput.includes('Hello John...'), 'Email execution includes draft body content');

    console.log(`\n🎉 Phase 7 Integration Tests Complete! Passed ${testsPassed}/${totalTests} tests.`);
  } catch (err) {
    console.error('❌ Integration Test execution failed:', err);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

runTests().catch(err => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
