/**
 * Jarvis Phase 2 Validation Test Suite
 */

const { handleCommand } = require('../interfaces/telegram/handlers');
const { Client } = require('pg');

const DB_URL = process.env.DATABASE_URL;
const TEST_CHAT_ID = '12345';

async function setupMockData() {
  console.log('[Setup] Inserting mock next actions, completed tasks, and blockers...');
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    // 1. Insert completed task yesterday
    await client.query(`
      INSERT INTO jarvis_completed_tasks (project_slug, task_name, outcome, completed_at)
      VALUES 
        ('septivolt', 'Build simulator UI variant', 'Delivered slider overlays.', NOW() - INTERVAL '12 hours'),
        ('cresca-os', 'Verify copywriting schema tags', 'Google rich snippets verified.', NOW() - INTERVAL '12 hours')
      ON CONFLICT DO NOTHING;
    `);

    // 2. Insert blocker
    await client.query(`
      INSERT INTO jarvis_blockers (project_slug, description, priority, status)
      VALUES 
        ('septivolt', 'OAuth redirect loop on SOLAR_TRAINER_URI', 'high', 'active')
      ON CONFLICT DO NOTHING;
    `);

    // 3. Insert next actions
    await client.query(`
      INSERT INTO jarvis_next_actions (project_slug, action, priority, status, recommended_command)
      VALUES 
        ('septivolt', 'Add dynamic sliders to simulator frame', 'high', 'pending', '/run_bot content-forge...'),
        ('new-era-solar', 'Design GHL contact trigger sequence', 'normal', 'pending', '/run_bot revenue-master-orchestrator...')
      ON CONFLICT DO NOTHING;
    `);

    // 4. Insert approval request
    await client.query(`
      INSERT INTO jarvis_approval_requests (approval_type, project_slug, requested_action, risk_level, status)
      VALUES 
        ('vercel_deploy', 'cresca-os', 'Trigger Cresca OS production build deployment', 'high', 'pending')
      ON CONFLICT DO NOTHING;
    `);

    console.log('[Setup] Mock data seeded successfully.');
  } finally {
    await client.end();
  }
}

async function runTests() {
  console.log('🧪 Starting Jarvis Phase 2 Telegram Command Validation Test Suite...');
  let testsPassed = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      testsPassed++;
      console.log(`✅ Test ${totalTests} Passed: ${message}`);
    } else {
      console.error(`❌ Test ${totalTests} Failed: ${message}`);
      process.exit(1);
    }
  }

  // Set up mock data first
  await setupMockData();

  const mockMessage = {
    chat: { id: TEST_CHAT_ID },
    from: { id: TEST_CHAT_ID }
  };

  // TEST 1: /jarvis_brief
  try {
    console.log('\n[Test] Executing /jarvis_brief...');
    const resBrief = await handleCommand('/jarvis_brief', mockMessage);
    assert(resBrief !== undefined, 'Brief response received');
    assert(resBrief.includes('# 📆 Jarvis Daily Brief'), 'Brief starts with correct title');
    assert(resBrief.includes('Build simulator UI'), 'Contains completed tasks yesterday'); // wait, let's verify if string matches
    assert(resBrief.includes('OAuth redirect loop'), 'Contains active blockers');
    assert(resBrief.includes('Design GHL contact trigger'), 'Contains recommended next actions');
    assert(resBrief.includes('Trigger Cresca OS production build'), 'Contains pending approvals');
  } catch (err) {
    console.error('Test 1 failed:', err.message);
    assert(false, '/jarvis_brief executed successfully');
  }

  // TEST 2: /jarvis_yesterday
  try {
    console.log('\n[Test] Executing /jarvis_yesterday...');
    const resYesterday = await handleCommand('/jarvis_yesterday', mockMessage);
    assert(resYesterday !== undefined, 'Yesterday summary response received');
    assert(resYesterday.includes('# 🏆 Completed Work Log (Yesterday)'), 'Yesterday summary title is correct');
    assert(resYesterday.includes('Build simulator UI'), 'Contains yesterday\'s completed task');
  } catch (err) {
    console.error('Test 2 failed:', err.message);
    assert(false, '/jarvis_yesterday executed successfully');
  }

  // TEST 3: /jarvis_project septivolt
  try {
    console.log('\n[Test] Executing /jarvis_project septivolt...');
    const resProject = await handleCommand('/jarvis_project septivolt', mockMessage);
    assert(resProject !== undefined, 'Project status card response received');
    assert(resProject.includes('Project Status Card: SeptiVolt'), 'Project title is correct');
    assert(resProject.includes('OAuth redirect loop'), 'Contains project blockers');
    assert(resProject.includes('Build simulator UI'), 'Contains project completed tasks');
  } catch (err) {
    console.error('Test 3 failed:', err.message);
    assert(false, '/jarvis_project septivolt executed successfully');
  }

  // TEST 4: /jarvis_next
  try {
    console.log('\n[Test] Executing /jarvis_next...');
    const resNext = await handleCommand('/jarvis_next', mockMessage);
    assert(resNext !== undefined, 'Next actions response received');
    assert(resNext.includes('# ⚡ Recommended Next Actions'), 'Next actions title is correct');
    assert(resNext.includes('Design GHL contact trigger'), 'Contains next actions');
  } catch (err) {
    console.error('Test 4 failed:', err.message);
    assert(false, '/jarvis_next executed successfully');
  }

  console.log(`\n🎉 Validation Complete! Passed ${testsPassed} of ${totalTests} tests.`);
}

runTests().catch(err => {
  console.error('Fatal test execution error:', err.message);
  process.exit(1);
});
