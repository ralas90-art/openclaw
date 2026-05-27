const fs = require('fs');
const path = require('path');

// 1. Setup mock workspace root and environment
const mockWorkspace = path.join(__dirname, 'mock-workspace-bot-tests-' + Date.now());
fs.mkdirSync(path.join(mockWorkspace, 'openclaw', 'inbox', 'telegram-requests'), { recursive: true });
fs.mkdirSync(path.join(mockWorkspace, 'openclaw', 'bots'), { recursive: true });

// Copy the updated registry.md to our mock workspace so the parser reads the updated registry
const realRegistryPath = path.join(__dirname, '../openclaw/bots/registry.md');
const mockRegistryPath = path.join(mockWorkspace, 'openclaw', 'bots', 'registry.md');
fs.copyFileSync(realRegistryPath, mockRegistryPath);

// Set environment variables for isolated tests
process.env.OPENCLAW_WORKSPACE_ROOT = mockWorkspace;
process.env.OPENCLAW_TEST = 'true';

// Import handlers
const handlers = require('../interfaces/telegram/handlers');
const { handleCommand } = handlers;

const inboxRequestsDir = path.join(mockWorkspace, 'openclaw', 'inbox', 'telegram-requests');

console.log('Test Setup completed.');
console.log('Mock workspace root:', mockWorkspace);
console.log('Mock inbox directory:', inboxRequestsDir);

async function runTests() {
  let passed = true;

  function assert(condition, message) {
    if (!condition) {
      console.error('❌ Assertion Failed:', message);
      passed = false;
    } else {
      console.log('✓', message);
    }
  }

  // Test 1: Check Help Message has all new bots listed
  console.log('\n--- Running Test 1: Help Message Verification ---');
  const helpResponse = await handleCommand('/help', { chat: { id: 123 } });
  assert(helpResponse.includes('OpenClaw Telegram Router'), 'Help response should include router header');
  assert(helpResponse.includes('1. Creative (Content Forge):'), 'Help should list Creative bot');
  assert(helpResponse.includes('2. Business (Revenue Master):'), 'Help should list Business bot');
  assert(helpResponse.includes('3. Tech (System Master):'), 'Help should list Tech bot');
  assert(helpResponse.includes('4. Copywriting (Cresca Content/AEO):'), 'Help should list Copywriting bot');
  assert(helpResponse.includes('5. Leads (Lead Acquisition):'), 'Help should list Leads bot');
  assert(helpResponse.includes('6. Funnel Audit (Revenue Optimization):'), 'Help should list Funnel Audit bot');
  assert(helpResponse.includes('7. Ops (Weekly Command):'), 'Help should list Ops bot');
  assert(helpResponse.includes('8. Monetize (Client Value):'), 'Help should list Monetize bot');
  assert(helpResponse.includes('9. Optimization Loop (Auto-Loop):'), 'Help should list Optimization Loop bot');

  // Test 2: Check Bots Command List (Registry status parsing)
  console.log('\n--- Running Test 2: Registry Status Parsing ---');
  const botsResponse = await handleCommand('/bots', { chat: { id: 123 } });
  assert(botsResponse.includes('Active Runtime:\n- None'), 'Active Runtime should be None');
  assert(botsResponse.includes('Active Queue-Only:\n- Content Forge'), 'Active Queue-Only should contain Content Forge');
  assert(botsResponse.includes('- Revenue Master Orchestrator'), 'Active Queue-Only should contain Revenue Master');
  assert(botsResponse.includes('- System Master Orchestrator'), 'Active Queue-Only should contain System Master');
  assert(botsResponse.includes('- Cresca Content & AEO Engine'), 'Active Queue-Only should contain Cresca Content');
  assert(botsResponse.includes('- Lead Acquisition Engine'), 'Active Queue-Only should contain Lead Acquisition');
  assert(botsResponse.includes('- Revenue Optimization Engine'), 'Active Queue-Only should contain Revenue Optimization');
  assert(botsResponse.includes('- Weekly Command Center'), 'Active Queue-Only should contain Weekly Command');
  assert(botsResponse.includes('- Client Value Maximizer'), 'Active Queue-Only should contain Client Value');
  assert(botsResponse.includes('- Auto-Loop System'), 'Active Queue-Only should contain Auto-Loop');
  assert(botsResponse.includes('Documented Only:\n- None'), 'Documented Section should be empty');

  // Helper to test bot command execution
  async function testBotCommand(cmdText, expectedBotSlug, expectedWorkflow, keyKeywords, expectedFollowUp) {
    console.log(`\nTesting command: ${cmdText.split('\n')[0]}`);
    
    // Clear inbox files before command
    const existingFiles = fs.readdirSync(inboxRequestsDir);
    for (const f of existingFiles) {
      fs.unlinkSync(path.join(inboxRequestsDir, f));
    }

    const response = await handleCommand(cmdText, {
      from: { id: 999, username: 'testuser' },
      chat: { id: 123 }
    });

    assert(response.includes('Request queued for'), 'Response should report "Request queued for"');
    assert(response.includes(`Bot: ${expectedBotSlug}`), `Response should state Bot: ${expectedBotSlug}`);
    assert(response.includes(`Workflow: ${expectedWorkflow}`), `Response should state Workflow: ${expectedWorkflow}`);
    assert(response.includes('Status: queued'), 'Response should state Status: queued');
    assert(response.includes('This bot is in Active Queue-Only mode') || response.includes('Process this latest inbox request with Antigravity, then publish the result to Google Drive.'), 'Response should direct manual execution and Drive publish');
    assert(response.includes(`Suggested follow-up command after processing: ${expectedFollowUp}`), `Response should suggest follow-up command: ${expectedFollowUp}`);
    
    const files = fs.readdirSync(inboxRequestsDir).filter(f => f.startsWith('telegram_') && f.endsWith('.json'));
    assert(files.length === 1, 'One JSON file should be saved in the inbox');
    
    if (files.length === 1) {
      const savedPayload = JSON.parse(fs.readFileSync(path.join(inboxRequestsDir, files[0]), 'utf8'));
      assert(savedPayload.bot === expectedBotSlug, `Bot slug should be ${expectedBotSlug}`);
      assert(savedPayload.workflow === expectedWorkflow, `Workflow should be ${expectedWorkflow}`);
      
      const nextStep = savedPayload.next_manual_step || '';
      for (const keyword of keyKeywords) {
        assert(nextStep.toLowerCase().includes(keyword.toLowerCase()), `Manual step should contain keyword "${keyword}"`);
      }
    }
  }

  // Test 3-10: Execute commands for each bot
  console.log('\n--- Running Command Routing and Queue-Only Response Formatter Tests ---');
  
  await testBotCommand(
    '/revenue system_design\nProject: SeptiVolt\nCampaign: Launch\nBusiness Type: SaaS',
    'revenue-master-orchestrator',
    'system-design',
    ['revenue-blueprint.md', 'offer-engine-builder'],
    '/revenue offer_design'
  );

  await testBotCommand(
    '/sys build_app\nApp Name: training-dashboard\nFramework: React',
    'system-master-orchestrator',
    'build-app',
    ['build-blueprint.md', 'brand-ux-consistency-auditor'],
    '/sys deploy'
  );

  await testBotCommand(
    '/aeo optimize_page\nPage URL: https://crescaos.com/seo',
    'cresca-content-aeo-engine',
    'optimize-page',
    ['optimized-page-copy.md', 'Claude copywriting'],
    '/aeo faq_schema'
  );

  await testBotCommand(
    '/leads prospect\nTarget Location: Long Island\nPlatform Focus: Google Ads',
    'lead-acquisition-engine',
    'prospect',
    ['qualified-lead-list.csv', 'lead-acquisition-engine'],
    '/leads scripts'
  );

  await testBotCommand(
    '/rev_opt audit\nFunnel Link: https://ggcleaningli.com/book',
    'revenue-optimization-engine',
    'audit',
    ['funnel-leak-audit-report.md', 'ghl-config-auditor'],
    '/rev_opt speed_lead'
  );

  await testBotCommand(
    '/weekly review\nWeek Range: May 18 - May 24',
    'weekly-command-center',
    'review',
    ['weekly-performance-snapshot.md', 'weekly-command-center'],
    '/weekly plan'
  );

  await testBotCommand(
    '/client_value upsell\nBrand Name: SeptiVolt\nCore Service: reps training',
    'client-value-maximizer',
    'upsell',
    ['customer-lifecycle-monetization-map.md', 'client-value-maximizer'],
    '/client_value reactivate'
  );

  await testBotCommand(
    '/autoloop review\nSystem Being Audited: ad funnel',
    'auto-loop-system',
    'review',
    ['system-optimization-trend-report.md', 'auto-loop-system'],
    '/drive_publish_latest'
  );

  // Cleanup
  console.log('\nCleaning up mock workspace...');
  fs.rmSync(mockWorkspace, { recursive: true, force: true });
  
  if (passed) {
    console.log('\n✅ ALL BOT ROUTING & STATUS TESTS PASSED SUCCESSFULLY!');
  } else {
    console.error('\n❌ SOME BOT ROUTING & STATUS TESTS FAILED.');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Unhandled error running tests:', err);
  process.exit(1);
});
