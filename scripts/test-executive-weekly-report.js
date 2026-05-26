require('dotenv').config();
const { generate } = require('../core/reports/executiveWeeklyReport');

async function testReport() {
  console.log("=== Testing Executive Weekly Report Engine ===");
  try {
    const report = await generate();
    console.log(JSON.stringify(report, null, 2));
    if (report.status) {
      console.log(`✅ Report generated successfully. Status: ${report.status}`);
    }
  } catch (err) {
    console.error("❌ Failed to generate report:", err);
  }
}

testReport();
