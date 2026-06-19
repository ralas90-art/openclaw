/**
 * Jarvis Phase 6: Daily Brief Intelligence Layer Validation Suite
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const dotenv = require('dotenv');

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

const { scoreItems, matchTextToProject, rankBriefItems, detectStaleBlockers, detectFollowUps } = require('../jarvis/intelligence');
const { handleCommand } = require('../interfaces/telegram/handlers');
const connectorsSummary = require('../jarvis/connectors-summary');
const controller = require('../jarvis/controller');

async function runTests() {
  console.log('Starting Phase 6 Priority Intelligence Integration Tests...');
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
    { slug: 'new-era-solar', name: 'New Era Solar', status: 'active', priority: 'high' },
    { slug: 'cresca-os', name: 'Cresca OS', status: 'active', priority: 'normal' }
  ];

  // ==========================================
  // TEST 1: Project Matching (Case Insensitive & Hyphnes)
  // ==========================================
  const match1 = matchTextToProject('Questions about septivolt simulator', mockProjects);
  runAssert(match1 && match1.slug === 'septivolt', 'Project matching matches slug exactly');

  const match2 = matchTextToProject('Weekly updates for New Era Solar marketing', mockProjects);
  runAssert(match2 && match2.slug === 'new-era-solar', 'Project matching matches project name exactly');

  const match3 = matchTextToProject('Email regarding new era solar deployment', mockProjects);
  runAssert(match3 && match3.slug === 'new-era-solar', 'Project matching matches hyphenated slug with space');

  const match4 = matchTextToProject('Unknown random text', mockProjects);
  runAssert(match4 === null, 'Project matching returns null for unmatched text');

  // ==========================================
  // TEST 2: Scoring Engine Validation
  // ==========================================
  // Prepare items for scoring
  const mockItems = [
    {
      type: 'email',
      raw: {
        id: 'msg1',
        subject: 'URGENT: Invoice for New Era Solar',
        from: 'billing@client.com',
        snippet: 'Please process this payment immediately',
        suggested_project: 'new-era-solar'
      }
    },
    {
      type: 'drive_file',
      raw: {
        id: 'file1',
        name: 'cresca-os-architecture.pdf',
        suggested_project: 'cresca-os'
      }
    },
    {
      type: 'blocker',
      raw: {
        id: 'block1',
        project_slug: 'septivolt',
        description: 'Mock DB is down',
        created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() // 3 days ago
      }
    },
    {
      type: 'mobile_note',
      raw: {
        id: 'note1',
        text_content: 'Quick note about solar proposal due tomorrow',
        notes: '',
        created_at: new Date().toISOString()
      }
    }
  ];

  const repeatMap = new Map([['new-era-solar', 2], ['septivolt', 1], ['cresca-os', 1]]);
  const scored = scoreItems(mockItems, mockProjects, repeatMap);

  // Email Score Check:
  // Base: 8
  // Matches active project 'new-era-solar': +10
  // Project 'new-era-solar' priority is 'high': +5
  // Urgency keywords ("URGENT", "immediately"): +15
  // Payment keywords ("Invoice", "payment"): +20
  // Repeated mentions: +10
  // Total: 8 + 10 + 5 + 15 + 20 + 10 = 68
  const emailScored = scored.find(s => s.type === 'email');
  runAssert(emailScored && emailScored.score === 68, `Email scores correctly (Expected 68, got ${emailScored ? emailScored.score : 'none'})`);

  // Drive File Score Check:
  // Base: 5
  // Matches active project 'cresca-os': +10
  // Total: 5 + 10 = 15
  const driveScored = scored.find(s => s.type === 'drive_file');
  runAssert(driveScored && driveScored.score === 15, `Drive file scores correctly (Expected 15, got ${driveScored ? driveScored.score : 'none'})`);

  // Blocker Score Check:
  // Base: 10
  // Matches active project 'septivolt': +10
  // Age (3 days = +15): +15
  // Total: 10 + 10 + 15 = 35
  const blockerScored = scored.find(s => s.type === 'blocker');
  runAssert(blockerScored && blockerScored.score === 35, `Blocker scores correctly (Expected 35, got ${blockerScored ? blockerScored.score : 'none'})`);

  // Mobile Note Score Check:
  // Base: 5
  // Matches active project name "solar" -> 'new-era-solar': +10
  // High project priority: +5
  // Urgency "Quick": +15
  // Deadline "due tomorrow": +12
  // From today: +8
  // Repeated mentions (new-era-solar): +10
  // Total: 5 + 10 + 5 + 15 + 12 + 8 + 10 = 65
  const mobileScored = scored.find(s => s.type === 'mobile_note');
  runAssert(mobileScored && mobileScored.score === 65, `Mobile note scores correctly (Expected 65, got ${mobileScored ? mobileScored.score : 'none'})`);

  // ==========================================
  // TEST 3: Stale Blocker & Follow-Up Detection
  // ==========================================
  const stale = detectStaleBlockers(scored);
  runAssert(stale.length === 1 && stale[0].raw.id === 'block1', 'Stale blocker (> 2 days) correctly detected');

  const follow = detectFollowUps(scored);
  runAssert(follow.length === 2, 'Urgent unread emails and mobile notes correctly categorized under follow-ups');

  // ==========================================
  // TEST 4: Ranking Order
  // ==========================================
  const ranked = rankBriefItems(scored);
  runAssert(ranked[0].type === 'email' && ranked[1].type === 'mobile_note' && ranked[2].type === 'blocker', 'Items are correctly ranked in descending score order');

  // ==========================================
  // TEST 5: Static Security Code Audit (Phase 6 Gating)
  // ==========================================
  const intelCode = fs.readFileSync(path.resolve(__dirname, '../jarvis/intelligence.js'), 'utf8');
  runAssert(!intelCode.includes('sendMail') && !intelCode.includes('createDraft') && !intelCode.includes('updateFile'), 'intelligence.js is strictly read-only');

  const testAuditFiles = [
    path.resolve(__dirname, '../jarvis/intelligence.js'),
    path.resolve(__dirname, '../jarvis/controller.js'),
    path.resolve(__dirname, '../interfaces/telegram/handlers.js')
  ];
  for (const f of testAuditFiles) {
    const code = fs.readFileSync(f, 'utf8');
    runAssert(!code.includes('console.log(process.env.DATABASE_URL)') && !code.includes('console.warn(process.env.DATABASE_URL)') && !code.includes('console.error(process.env.DATABASE_URL)'), `File ${path.basename(f)} does not print DATABASE_URL`);
    runAssert(!code.includes('console.log(process.env.JARVIS_ENCRYPTION_KEY)') && !code.includes('console.warn(process.env.JARVIS_ENCRYPTION_KEY)') && !code.includes('console.error(process.env.JARVIS_ENCRYPTION_KEY)'), `File ${path.basename(f)} does not print encryption keys`);
  }

  // ==========================================
  // TEST 6: Fail-Closed Resiliency
  // ==========================================
  // Back up original summary calls
  const origEmails = connectorsSummary.getEmailSummary;
  const origDrive = connectorsSummary.getDriveSummary;

  // Simulate Gmail/Drive Connector throwing Auth / Network errors
  connectorsSummary.getEmailSummary = async () => { throw new Error('Simulated Gmail connection timeout'); };
  connectorsSummary.getDriveSummary = async () => { throw new Error('Simulated Drive authorization revoked'); };

  try {
    const brief = await controller.getDailyBrief(true);
    runAssert(brief.raw_brief_markdown.includes('Jarvis Daily Brief'), 'Daily brief compiles successfully even when Gmail/Drive connectors are completely offline');
    runAssert(brief.raw_brief_markdown.includes('🧠 Jarvis Priority Intelligence'), 'Priority Intelligence section is formatted and gracefully degrades');
  } finally {
    // Restore
    connectorsSummary.getEmailSummary = origEmails;
    connectorsSummary.getDriveSummary = origDrive;
  }

  // ==========================================
  // TEST 7: Telegram Commands Gating
  // ==========================================
  const mockMsg = {
    chat: { id: 12345 },
    from: { id: 12345 }
  };

  // Mock intelligence module calls to run in test context
  const intelligence = require('../jarvis/intelligence');
  const origGetPriorityIntel = intelligence.getPriorityIntelligence;

  intelligence.getPriorityIntelligence = async () => {
    return {
      topThreePriorities: [
        { heading: 'New Era Solar — Follow up on client', why: 'Why: unread email', nextAction: 'Next action: reply' }
      ],
      followUps: [
        { type: 'email', raw: { from: 'Jaden <jaden@test.com>', subject: 'Alert' } }
      ],
      staleBlockers: [],
      rankedItems: [
        { type: 'blocker', project_slug: 'septivolt', raw: { description: 'DB down', created_at: new Date().toISOString() } }
      ]
    };
  };

  try {
    const prioritiesRes = await handleCommand('/jarvis_priorities', mockMsg);
    runAssert(prioritiesRes.includes('🧠 *Jarvis Top Priorities for Today*') && prioritiesRes.includes('New Era Solar'), '/jarvis_priorities command works');

    const followupsRes = await handleCommand('/jarvis_followups', mockMsg);
    runAssert(followupsRes.includes('👥 *Client & Project Follow-ups*') && followupsRes.includes('From `Jaden`'), '/jarvis_followups command works');

    const blockersRes = await handleCommand('/jarvis_blockers', mockMsg);
    runAssert(blockersRes.includes('🛑 *Active Project Blockers*') && blockersRes.includes('DB down'), '/jarvis_blockers command works');
  } finally {
    intelligence.getPriorityIntelligence = origGetPriorityIntel;
  }

  console.log(`\n🎉 Phase 6 Validation Complete! Passed ${testsPassed} of ${totalTests} tests.`);
}

runTests().catch(err => {
  console.error('Fatal execution error:', err.message);
  process.exit(1);
});
