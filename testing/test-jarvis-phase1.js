/**
 * Jarvis Phase 1 Validation Suite
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { exportJarvisMemory } = require('../jarvis/memory-exporter');

const DB_URL = process.env.DATABASE_URL;

async function runTests() {
  console.log('🧪 Starting Jarvis Phase 1 Live Validation Test Suite...');
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

  // TEST 1: Database connection check
  assert(DB_URL !== undefined, 'Database Connection URL is defined');

  // TEST 2: Query live project records
  try {
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    
    const res = await client.query('SELECT slug, name FROM jarvis_projects;');
    assert(res.rows.length > 0, `Found ${res.rows.length} projects in jarvis_projects table`);
    
    const expectedSlugs = ['septivolt', 'new-era-solar', 'cresca-os', 'g-g-cleaning', 'bright-future-homes', 'content-creation'];
    const dbSlugs = res.rows.map(r => r.slug);
    const allSeeded = expectedSlugs.every(slug => dbSlugs.includes(slug));
    assert(allSeeded, 'Verified all 6 seed projects reside in the live database');
    
    await client.end();
  } catch (dbErr) {
    console.error('[Test Error] DB query error:', dbErr.message);
    assert(false, 'Live database connection and query assertions failed.');
  }

  // TEST 3: Memory exporter run in live mode
  try {
    const runResult = await exportJarvisMemory();
    assert(runResult.success === true, 'Memory exporter completed with live database success');
    
    // Check if markdown export files were generated
    const memoryDir = path.resolve(__dirname, '../jarvis/memory');
    const expectedFiles = [
      'PROJECT_STATE.md',
      'DAILY_BRIEF.md',
      'COMPLETED_WORK.md',
      'BLOCKERS.md',
      'NEXT_ACTIONS.md',
      'DECISIONS.md'
    ];

    for (const file of expectedFiles) {
      const filePath = path.join(memoryDir, file);
      const exists = fs.existsSync(filePath);
      assert(exists, `Markdown snapshot file created: ${file}`);
      if (exists) {
        const stats = fs.statSync(filePath);
        assert(stats.size > 0, `Markdown file is not empty: ${file} (${stats.size} bytes)`);
        
        // Confirm it does not contain the database offline placeholder
        const content = fs.readFileSync(filePath, 'utf8');
        const hasPlaceholder = content.includes('Database offline placeholder');
        assert(!hasPlaceholder, `Verified file contains live database data (no placeholders): ${file}`);
      }
    }
  } catch (err) {
    console.error('[Test Error] Exporter live test error:', err.message);
    assert(false, 'Live memory exporter run complete');
  }

  console.log(`\n🎉 Live Validation Complete! Passed ${testsPassed} of ${totalTests} tests.`);
}

runTests().catch(err => {
  console.error('Fatal test execution error:', err.message);
  process.exit(1);
});
