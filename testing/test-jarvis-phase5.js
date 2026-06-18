/**
 * Jarvis Phase 5: Gmail & Google Drive Connector Summaries Validation Suite
 */

// Set up environment variables at the very top before requiring modules
process.env.TELEGRAM_ALLOWED_RUNTIME_CHAT_IDS = '12345';
process.env.TELEGRAM_ALLOWED_USER_IDS = '12345';
process.env.OPENCLAW_ROLE_SUPER_ADMIN_CHAT_IDS = '12345';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { Client } = require('pg');
const { handleCommand } = require('../interfaces/telegram/handlers');

const DB_URL = process.env.DATABASE_URL;

let client;

async function setup() {
  console.log('Setting up Phase 5 validation...');
  if (!DB_URL) {
    console.error('Error: DATABASE_URL is not set.');
    process.exit(1);
  }

  client = new Client({ connectionString: DB_URL });
  await client.connect();

  // Clear existing mock connectors to prevent conflict
  await client.query("DELETE FROM jarvis_connectors WHERE connector_id IN ('gmail', 'google_drive');");

  // Seed default definitions
  const connectorsSummary = require('../jarvis/connectors-summary');
  await connectorsSummary.seedInitialConnectors();
}

async function cleanup() {
  console.log('\nCleaning up Phase 5 validation resources...');
  if (client) {
    try {
      await client.query("DELETE FROM jarvis_connectors WHERE connector_id IN ('gmail', 'google_drive');");
      await client.end();
    } catch (err) {
      console.error('[Cleanup DB Error]', err.message);
    }
  }
  console.log('Cleanup completed.');
}

async function runTests() {
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

  // TEST 1: Command /jarvis_connectors displays the status registry
  const connectorsRes = await handleCommand('/jarvis_connectors', mockMessage);
  runAssert(connectorsRes.includes('Cloud Connectors Status'), 'Connectors title matches');
  runAssert(connectorsRes.includes('Gmail Connector'), 'Lists Gmail connector');
  runAssert(connectorsRes.includes('Google Drive Connector'), 'Lists Google Drive connector');

  // TEST 2: Gmail and Drive show 'Not Authorized' status without credentials
  runAssert(connectorsRes.includes('Not Authorized'), 'Status is Not Authorized by default');

  // TEST 3: Gating: Permission summaries show new commands under Read Only tier
  const permissionsSummary = await handleCommand('/run_permissions', mockMessage);
  runAssert(permissionsSummary.includes('/jarvis_connectors'), 'jarvis_connectors is registered');
  runAssert(permissionsSummary.includes('/jarvis_email_summary'), 'jarvis_email_summary is registered');
  runAssert(permissionsSummary.includes('/jarvis_drive_recent'), 'jarvis_drive_recent is registered');

  // TEST 4: Static code audit of google-api.js for safety checks
  const apiCode = fs.readFileSync(path.resolve(__dirname, '../jarvis/google-api.js'), 'utf8');
  runAssert(!apiCode.includes('messages.send'), 'google-api.js does not contain messages.send');
  runAssert(!apiCode.includes('messages.delete'), 'google-api.js does not contain messages.delete');
  runAssert(!apiCode.includes('files.delete'), 'google-api.js does not contain files.delete');

  // TEST 5: Static code audit of connectors-summary.js for read-only safety limits
  const summaryCode = fs.readFileSync(path.resolve(__dirname, '../jarvis/connectors-summary.js'), 'utf8');
  runAssert(!summaryCode.includes('messages.send'), 'connectors-summary.js does not contain messages.send');
  runAssert(!summaryCode.includes('messages.delete'), 'connectors-summary.js does not contain messages.delete');
  runAssert(!summaryCode.includes('messages.trash'), 'connectors-summary.js does not contain messages.trash');
  runAssert(!summaryCode.includes('messages.batchModify'), 'connectors-summary.js does not contain messages.batchModify');
  runAssert(!summaryCode.includes('files.create'), 'connectors-summary.js does not contain files.create');
  runAssert(!summaryCode.includes('files.delete'), 'connectors-summary.js does not contain files.delete');
  runAssert(!summaryCode.includes('files.update'), 'connectors-summary.js does not contain files.update');
  runAssert(!summaryCode.includes('permissions.create'), 'connectors-summary.js does not contain permissions.create');
  runAssert(!summaryCode.includes('permissions.delete'), 'connectors-summary.js does not contain permissions.delete');

  // TEST 6: Mock summary queries and verify integration into /jarvis_brief Daily Brief
  const connectorsSummary = require('../jarvis/connectors-summary');
  
  // Set up mock return values
  connectorsSummary.getEmailSummary = async () => [
    { 
      id: 'mock_msg_1', 
      subject: 'Invoices for SeptiVolt Solar', 
      from: 'billing@septivolt.com', 
      date: 'Wed, 17 Jun 2026', 
      snippet: 'Please verify payment details for invoice #999', 
      suggested_project: 'septivolt', 
      priority_keyword: 'invoice' 
    }
  ];

  connectorsSummary.getDriveSummary = async () => [
    { 
      id: 'mock_file_1', 
      name: 'septivolt_architecture_v2.pdf', 
      mimeType: 'application/pdf', 
      modifiedTime: '2026-06-17T09:00:00Z', 
      webViewLink: 'https://drive.google.com/file/abc', 
      size_bytes: 10240, 
      suggested_project: 'septivolt' 
    }
  ];

  // Call getDailyBrief(true) to bypass cache
  const { getDailyBrief } = require('../jarvis/controller');
  const brief = await getDailyBrief(true);

  // Check Gmail Integration
  runAssert(brief.raw_brief_markdown.includes('## 📬 Unread Actionable Emails'), 'Daily brief contains Gmail unread summary section');
  runAssert(brief.raw_brief_markdown.includes('Invoices for SeptiVolt Solar'), 'Daily brief lists unread email subject');
  runAssert(brief.raw_brief_markdown.includes('[PRIORITY: INVOICE]'), 'Daily brief highlights invoice priority keyword');
  runAssert(brief.raw_brief_markdown.includes('(Project: `septivolt`)'), 'Daily brief associates matched project slug');

  // Check Google Drive Integration
  runAssert(brief.raw_brief_markdown.includes('## 🗂️ Google Drive Activity'), 'Daily brief contains Google Drive activity section');
  runAssert(brief.raw_brief_markdown.includes('[septivolt_architecture_v2.pdf](https://drive.google.com/file/abc)'), 'Daily brief lists Drive filename link');

  // TEST 7: Mock-based command execution for /jarvis_email_summary
  const emailRes = await handleCommand('/jarvis_email_summary', mockMessage);
  runAssert(emailRes.includes('Unread Actionable Emails Summary'), 'Telegram command lists unread email header');
  runAssert(emailRes.includes('Invoices for SeptiVolt Solar'), 'Telegram email summary prints unread subject');

  // TEST 8: Mock-based command execution for /jarvis_drive_recent
  const driveRes = await handleCommand('/jarvis_drive_recent', mockMessage);
  runAssert(driveRes.includes('Recent Google Drive Modifications'), 'Telegram command lists Drive modifications header');
  runAssert(driveRes.includes('septivolt_architecture_v2.pdf'), 'Telegram Drive summary prints modified file name');

  console.log(`\n🎉 Phase 5 Validation Complete! Passed 8 of 8 tests.`);
}

async function run() {
  try {
    await setup();
    await runTests();
  } finally {
    await cleanup();
  }
}

run().catch(err => {
  console.error('Fatal execution error:', err.message);
  process.exit(1);
});
