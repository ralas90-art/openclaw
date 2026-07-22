/**
 * Jarvis Phase 6.1: Daily Brief Feedback Loop & Quality Controls Test Suite
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

const { scoreItems, generateStableId, getPriorityIntelligence } = require('../jarvis/intelligence');
const { queryDb, saveBriefFeedback, savePriorityFeedback, getDailyBrief } = require('../jarvis/controller');
const { handleCommand } = require('../interfaces/telegram/handlers');
const connectorsSummary = require('../jarvis/connectors-summary');

const DB_URL = process.env.DATABASE_URL;
let client;

async function setup() {
  console.log('Setting up Phase 6.1 test environment...');
  if (!DB_URL) {
    console.error('Error: DATABASE_URL is not set.');
    process.exit(1);
  }
  const { runMigrations } = require('../jarvis/migrations');
  await runMigrations();
  client = new Client({ connectionString: DB_URL });
  await client.connect();

  // Clean tables via authoritative migration engine
  await client.query("DELETE FROM jarvis_brief_feedback;");
  await client.query("DELETE FROM jarvis_priority_feedback;");
}

async function cleanup() {
  console.log('\nCleaning up Phase 6.1 test resources...');
  if (client) {
    try {
      await client.query("DROP TABLE IF EXISTS jarvis_brief_feedback CASCADE;");
      await client.query("DROP TABLE IF EXISTS jarvis_priority_feedback CASCADE;");
      await client.end();
    } catch (err) {
      console.error('[Cleanup Error]', err.message);
    }
  }
}

async function runTests() {
  await setup();
  console.log('Starting Phase 6.1 Priority Feedback Integration Tests...');
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

  // Define mock projects
  const mockProjects = [
    { slug: 'septivolt', name: 'SeptiVolt', status: 'active', priority: 'normal' },
    { slug: 'new-era-solar', name: 'New Era Solar', status: 'active', priority: 'high' }
  ];

  // ==========================================
  // TEST 1: Stable Priority IDs Format
  // ==========================================
  const emailItem = {
    type: 'email',
    raw: { id: 'msg999', subject: 'Urgent Solar Update', from: 'ceo@client.com' }
  };
  const emailId = generateStableId(emailItem);
  runAssert(emailId === 'email:msg999', 'Stable ID formats correctly for defined ids');

  const fallbackItem = {
    type: 'email',
    raw: { subject: 'Urgent Solar Update', from: 'ceo@client.com' }
  };
  const fallbackId = generateStableId(fallbackItem);
  runAssert(fallbackId.startsWith('email:hash:'), 'Stable ID fallbacks cleanly to hashing if id is missing');

  // ==========================================
  // TEST 2: Brief & Priority Feedback DB Insertion
  // ==========================================
  const todayStr = new Date().toISOString().substring(0, 10);
  await saveBriefFeedback(todayStr, 'good');
  const briefRows = await queryDb("SELECT * FROM jarvis_brief_feedback WHERE brief_date = $1;", [todayStr]);
  runAssert(briefRows.length === 1 && briefRows[0].feedback_type === 'good', 'saveBriefFeedback successfully inserts rating');

  await savePriorityFeedback('email:msg999', 'note', 'This priority is very accurate');
  const prioRows = await queryDb("SELECT * FROM jarvis_priority_feedback WHERE priority_id = $1 AND feedback_type = 'note';", ['email:msg999']);
  runAssert(prioRows.length === 1 && prioRows[0].user_feedback === 'This priority is very accurate', 'savePriorityFeedback successfully inserts priority note');

  // ==========================================
  // TEST 3: Ignored Items De-prioritization
  // ==========================================
  await savePriorityFeedback('email:msg999', 'ignored');
  const ignoredIds = new Set(['email:msg999']);
  const repeatMap = new Map();
  
  // Base score without ignore (base unread email: 8, client/project match: 10, project high priority: 5, urgency: 15) = 38
  const normalScored = scoreItems([emailItem], mockProjects, repeatMap);
  runAssert(normalScored[0].score === 38, `Normal score matches expectation (Expected 38, got ${normalScored[0].score})`);

  // Ignored score should be -100 points less
  const ignoredScored = scoreItems([emailItem], mockProjects, repeatMap, ignoredIds);
  runAssert(ignoredScored[0].score === -62, `Ignored priority score matches expectation (Expected -62, got ${ignoredScored[0].score})`);

  // ==========================================
  // TEST 4: Pinned Priorities Promotion
  // ==========================================
  await savePriorityFeedback('email:msg999', 'pinned');
  const pinnedIds = new Set(['email:msg999']);
  const pinnedScored = scoreItems([emailItem], mockProjects, repeatMap, new Set(), pinnedIds);
  runAssert(pinnedScored[0].score === 88, `Pinned priority score matches expectation (Expected 88, got ${pinnedScored[0].score})`);

  // ==========================================
  // TEST 5: Stale Blocker Score Decay Safeguard
  // ==========================================
  const staleBlockerItem = {
    type: 'blocker',
    raw: {
      id: 'block_stale',
      project_slug: 'septivolt',
      description: 'Stale task that has been lingering for a while',
      created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() // 5 days old (stale > 3)
    }
  };
  
  // Base score: 10 (blocker) + 10 (project) + 25 (5 days stale) = 45
  // It is non-urgent, so decay: -15. Expected total: 30
  const staleDecayScored = scoreItems([staleBlockerItem], mockProjects, repeatMap);
  runAssert(staleDecayScored[0].score === 30, `Stale non-urgent blocker decays score by -15 (Expected 30, got ${staleDecayScored[0].score})`);

  const urgentBlockerItem = {
    type: 'blocker',
    raw: {
      id: 'block_stale_urgent',
      project_slug: 'septivolt',
      description: 'URGENT: critical blockage',
      created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() // 5 days old
    }
  };
  // Base: 10 + 10 + 25 (stale) + 15 (urgency keywords) = 60. Should NOT decay because of urgency.
  const urgentStaleScored = scoreItems([urgentBlockerItem], mockProjects, repeatMap);
  runAssert(urgentStaleScored[0].score === 60, `Stale URGENT blocker does NOT undergo decay (Expected 60, got ${urgentStaleScored[0].score})`);

  // ==========================================
  // TEST 6: Static Security Code Audit (Read-Only)
  // ==========================================
  const intelCode = fs.readFileSync(path.resolve(__dirname, '../jarvis/intelligence.js'), 'utf8');
  runAssert(!intelCode.includes('sendMail') && !intelCode.includes('createDraft') && !intelCode.includes('updateFile'), 'intelligence.js contains no Gmail/Drive write APIs');

  const testAuditFiles = [
    path.resolve(__dirname, '../jarvis/intelligence.js'),
    path.resolve(__dirname, '../jarvis/controller.js'),
    path.resolve(__dirname, '../interfaces/telegram/handlers.js')
  ];
  for (const f of testAuditFiles) {
    const code = fs.readFileSync(f, 'utf8');
    runAssert(!code.includes('console.log(process.env.DATABASE_URL)') && !code.includes('console.warn(process.env.DATABASE_URL)') && !code.includes('console.error(process.env.DATABASE_URL)'), `File ${path.basename(f)} does not print DATABASE_URL`);
  }

  // ==========================================
  // TEST 7: Fail-Closed Resiliency in Daily Brief
  // ==========================================
  const origEmails = connectorsSummary.getEmailSummary;
  const origDrive = connectorsSummary.getDriveSummary;
  connectorsSummary.getEmailSummary = async () => { throw new Error('Gmail outage simulated'); };
  connectorsSummary.getDriveSummary = async () => { throw new Error('Drive auth revoked simulated'); };

  try {
    const brief = await getDailyBrief(true);
    runAssert(brief.raw_brief_markdown.includes('Jarvis Daily Brief'), 'Brief generated successfully during cloud outages');
    runAssert(brief.raw_brief_markdown.includes('🧠 Jarvis Priority Intelligence'), 'Priority section included in the brief output');
    runAssert(brief.raw_brief_markdown.includes('Top 3 Priorities for Today'), 'Top priorities formatted successfully');
  } finally {
    connectorsSummary.getEmailSummary = origEmails;
    connectorsSummary.getDriveSummary = origDrive;
  }

  // ==========================================
  // TEST 8: Telegram Command Gating & Filter Route Testing
  // ==========================================
  const mockMsg = {
    chat: { id: 12345 },
    from: { id: 12345 }
  };

  const intelligence = require('../jarvis/intelligence');
  const origGetPriorityIntel = intelligence.getPriorityIntelligence;

  intelligence.getPriorityIntelligence = async () => {
    return {
      topThreePriorities: [
        { heading: 'SeptiVolt — Resolve blocker', priority_id: 'blocker:block_1', why: 'Why: active project', nextAction: 'Next action: fix' }
      ],
      urgentEmails: [],
      followUps: [],
      projectDriveFiles: [],
      staleBlockers: [],
      unprocessedMobileNotes: [],
      rankedItems: [
        { heading: 'SeptiVolt — Resolve blocker', project_slug: 'septivolt', score: 35, priority_id: 'blocker:block_1', why: 'active project', nextAction: 'fix', reasons: ['active project'] },
        { heading: 'New Era Solar — Email check', project_slug: 'new-era-solar', score: 10, priority_id: 'email:msg_5', why: 'active project', nextAction: 'review', reasons: ['active project'] }
      ],
      ignoredIds: ['email:ignored_1'],
      pinnedIds: ['blocker:block_1']
    };
  };

  try {
    const resGood = await handleCommand('/jarvis_brief_good', mockMsg);
    console.log('DEBUG: resGood =', resGood);
    runAssert(resGood.includes('feedback as *GOOD*'), '/jarvis_brief_good command logged successfully');

    const resBad = await handleCommand('/jarvis_brief_bad', mockMsg);
    console.log('DEBUG: resBad =', resBad);
    runAssert(resBad.includes('feedback as *BAD*'), '/jarvis_brief_bad command logged successfully');

    const resPrioNote = await handleCommand('/jarvis_priority_feedback email:msg_5 Check later', mockMsg);
    console.log('DEBUG: resPrioNote =', resPrioNote);
    runAssert(resPrioNote.includes('Logged priority note feedback for item'), '/jarvis_priority_feedback command works');

    const resIgnore = await handleCommand('/jarvis_ignore_priority email:ignored_1', mockMsg);
    console.log('DEBUG: resIgnore =', resIgnore);
    runAssert(resIgnore.includes('Ignored item'), '/jarvis_ignore_priority command works');

    const resPin = await handleCommand('/jarvis_pin_priority blocker:block_1', mockMsg);
    console.log('DEBUG: resPin =', resPin);
    runAssert(resPin.includes('Pinned item/project'), '/jarvis_pin_priority command works');

    // Filter routing validation
    const resPrioToday = await handleCommand('/jarvis_priorities today', mockMsg);
    runAssert(resPrioToday.includes('Jarvis Top Priorities for Today') && resPrioToday.includes('blocker:block_1'), '/jarvis_priorities today works');

    const resPrioUrgent = await handleCommand('/jarvis_priorities urgent', mockMsg);
    runAssert(resPrioUrgent.includes('Urgent Priorities') && resPrioUrgent.includes('blocker:block_1'), '/jarvis_priorities urgent works');

    const resPrioProject = await handleCommand('/jarvis_priorities project septivolt', mockMsg);
    runAssert(resPrioProject.includes('Priorities for Project `septivolt`') && resPrioProject.includes('blocker:block_1'), '/jarvis_priorities project slug works');

    const resPrioIgnored = await handleCommand('/jarvis_priorities ignored', mockMsg);
    runAssert(resPrioIgnored.includes('Ignored Priorities') && resPrioIgnored.includes('email:ignored_1'), '/jarvis_priorities ignored works');

    const resPrioPinned = await handleCommand('/jarvis_priorities pinned', mockMsg);
    runAssert(resPrioPinned.includes('Pinned Priorities') && resPrioPinned.includes('blocker:block_1'), '/jarvis_priorities pinned works');

  } finally {
    intelligence.getPriorityIntelligence = origGetPriorityIntel;
  }

  console.log(`\n🎉 Phase 6.1 Quality Controls Validation Complete! Passed ${testsPassed} of ${totalTests} tests.`);
  await cleanup();
}

runTests().catch(async err => {
  console.error('Fatal execution error:', err.message);
  await cleanup();
  process.exit(1);
});
