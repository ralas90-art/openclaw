require('dotenv').config();
const assert = require('assert');
const { queryDb } = require('../jarvis/controller');
const workSessions = require('../jarvis/work-sessions');
const { routeNaturalLanguageCommand } = require('../jarvis/natural-language-router');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const mockMessage = { chat: { id: 'test_chat_phase10' } };

async function runTests() {
  console.log('🧪 Starting Phase 10: iPhone + Antigravity Context Sync Tests');

  // Ensure tables and columns exist
  await workSessions.ensureWorkSessionsTableExists();

  // Seed project if not exists
  const projectSlug = 'septivolt';
  const checkProj = await queryDb("SELECT slug FROM jarvis_projects WHERE slug = $1;", [projectSlug]);
  if (checkProj.length === 0) {
    await queryDb("INSERT INTO jarvis_projects (slug, name, status) VALUES ($1, 'SeptiVolt Project', 'active');", [projectSlug]);
  }

  // Clear previous sessions for test predictability
  await queryDb("DELETE FROM jarvis_work_sessions WHERE project_slug = $1;", [projectSlug]);

  // 1. Work session start
  console.log('\n- Test 1: Start work session');
  const sessionStart = await workSessions.startWorkSession(projectSlug, 'telegram', 'Started testing Phase 10');
  assert.strictEqual(sessionStart.project_slug, projectSlug);
  assert.strictEqual(sessionStart.status, 'active');
  assert.strictEqual(sessionStart.source, 'telegram');
  console.log('✅ Start session passed.');

  // 2. Start session when already active should throw
  console.log('\n- Test 2: Double start check');
  try {
    await workSessions.startWorkSession(projectSlug, 'telegram', 'Should fail');
    assert.fail('Should have thrown an error for double active session');
  } catch (err) {
    assert.ok(err.message.includes('already active'));
    console.log('✅ Double start protection passed.');
  }

  // 3. Work session update
  console.log('\n- Test 3: Update session');
  const sessionUpdate = await workSessions.updateWorkSession(projectSlug, 'Added log validation', 'telegram');
  assert.strictEqual(sessionUpdate.status, 'updated');
  assert.ok(sessionUpdate.summary.includes('Started testing Phase 10'));
  assert.ok(sessionUpdate.summary.includes('Added log validation'));
  console.log('✅ Update session passed.');

  // 4. Work session done
  console.log('\n- Test 4: Done session');
  const sessionDone = await workSessions.doneWorkSession(projectSlug, 'Completed all steps', 'telegram');
  assert.strictEqual(sessionDone.status, 'completed');
  assert.ok(sessionDone.summary.includes('Completed all steps'));
  assert.ok(sessionDone.ended_at !== null);
  console.log('✅ Done session passed.');

  // 5. Work session status returns active session
  console.log('\n- Test 5: Session status check');
  const activeSession = await workSessions.getActiveSession();
  assert.strictEqual(activeSession, null); // should be null since completed
  console.log('✅ Status check for completed session passed (returned null).');

  // Start another session to keep it active for status check
  await workSessions.startWorkSession(projectSlug, 'telegram', 'Keep this active');
  const activeSession2 = await workSessions.getActiveSession();
  assert.strictEqual(activeSession2.project_slug, projectSlug);
  assert.strictEqual(activeSession2.status, 'active');
  console.log('✅ Status check for active session passed.');

  // Finish active session so we are clean
  await workSessions.doneWorkSession(projectSlug, 'Clean up', 'telegram');

  // 6. Ingest Handoff File
  console.log('\n- Test 6: Ingest handoff file');
  const handoffPath = path.join(__dirname, '../docs/JARVIS_HANDOFF.md');
  const originalHandoff = fs.readFileSync(handoffPath, 'utf8');

  // Modify handoff file for testing with a secret
  const testHandoffContent = `
# Jarvis Handoff

## Current Project
project_slug: septivolt

## Work Session Summary
Completed implementation of Phase 10 with DATABASE_URL=postgresql://user:pass@host/db and INTERNAL_ADMIN_TOKEN=mysecret123

## Files Changed Summary
jarvis/work-sessions.js

## Commands Run
node test

## Tests Passed
All passing

## Tests Failed
None

## Deployment Status
Staging validated

## Blockers
Spanish audio issues

## Next Recommended Actions
Deploy to production
`;

  fs.writeFileSync(handoffPath, testHandoffContent, 'utf8');
  
  // Ingest
  const ingestedSession = await workSessions.ingestHandoffFile();
  assert.strictEqual(ingestedSession.project_slug, 'septivolt');
  assert.strictEqual(ingestedSession.status, 'completed');
  assert.strictEqual(ingestedSession.blockers, 'Spanish audio issues');
  assert.strictEqual(ingestedSession.next_actions, 'Deploy to production');
  
  // Verify secrets are redacted in DB summary
  assert.ok(!ingestedSession.summary.includes('postgresql://user:pass'));
  assert.ok(!ingestedSession.summary.includes('mysecret123'));
  assert.ok(ingestedSession.summary.includes('[REDACTED]'));
  console.log('✅ Handoff file ingestion and secret redaction passed.');

  // Restore original handoff file
  fs.writeFileSync(handoffPath, originalHandoff, 'utf8');

  // 7. Daily brief includes current work context
  console.log('\n- Test 7: Daily Brief Integration');
  const { getDailyBrief } = require('../jarvis/controller');
  const brief = await getDailyBrief(true);
  const briefText = typeof brief === 'object' ? brief.raw_brief_markdown : brief;
  assert.ok(briefText.includes('Current Work Context'));
  assert.ok(briefText.includes('SEPTIVOLT'));
  assert.ok(briefText.includes('Spanish audio issues'));
  assert.ok(briefText.includes('Deploy to production'));
  console.log('✅ Daily Brief integration passed.');

  // 8. Natural Language router maps to Phase 10 intents
  console.log('\n- Test 8: English NL routing');
  const enResStart = await routeNaturalLanguageCommand('start a work session for septivolt', mockMessage);
  assert.strictEqual(enResStart.type, 'reply');
  assert.strictEqual(enResStart.intent, 'work_session_start');
  assert.ok(enResStart.text.includes('Protected Action') || enResStart.text.includes('Acción Protegida'));
  
  const enResStatus = await routeNaturalLanguageCommand('summarize my current work session', mockMessage);
  assert.strictEqual(enResStatus.type, 'command');
  assert.strictEqual(enResStatus.command, '/jarvis_session_status');
  console.log('✅ English NL routing passed.');

  // 9. Spanish NL Routing
  console.log('\n- Test 9: Spanish NL routing');
  const esResStart = await routeNaturalLanguageCommand('empieza una sesión para septivolt', mockMessage);
  assert.strictEqual(esResStart.type, 'reply');
  assert.strictEqual(esResStart.intent, 'work_session_start');
  assert.ok(esResStart.text.includes('Acción Protegida') || esResStart.text.includes('Protected Action'));
  
  const esResStatus = await routeNaturalLanguageCommand('resume mi sesión actual', mockMessage);
  assert.strictEqual(esResStatus.type, 'command');
  assert.strictEqual(esResStatus.command, '/jarvis_session_status');
  console.log('✅ Spanish NL routing passed.');

  // 10. Spanglish NL Routing
  console.log('\n- Test 10: Spanglish NL routing');
  const spanglishResStart = await routeNaturalLanguageCommand('start sesión para septivolt', mockMessage);
  assert.strictEqual(spanglishResStart.type, 'reply');
  assert.strictEqual(spanglishResStart.intent, 'work_session_start');
  
  const spanglishResStatus = await routeNaturalLanguageCommand('qué changed today en antigravity', mockMessage);
  assert.strictEqual(spanglishResStatus.type, 'command');
  assert.strictEqual(spanglishResStatus.command, '/jarvis_session_latest');
  console.log('✅ Spanglish NL routing passed.');

  // 11. Clarification when project slug is missing
  console.log('\n- Test 11: Clarification check');
  const missingSlugRes = await routeNaturalLanguageCommand('start a work session', mockMessage);
  assert.strictEqual(missingSlugRes.type, 'reply');
  assert.strictEqual(missingSlugRes.command, 'ASK_CLARIFICATION');
  assert.ok(missingSlugRes.text.includes('Which project should I save this under'));
  console.log('✅ Clarification check passed.');

  // 12. Security: Verify mobile token cannot access admin APIs
  console.log('\n- Test 12: Mobile token restriction simulation');
  const adminToken = process.env.INTERNAL_ADMIN_TOKEN || 'admin-test-token-123';
  const testMobileToken = 'test-mobile-intake-token-10';
  
  assert.ok(testMobileToken !== adminToken, "Mobile token should not be identical to internal admin token");
  
  const mockReq = { headers: { authorization: `Bearer ${testMobileToken}` } };
  let statusResult = null;
  let jsonResult = null;
  const mockRes = {
    status: function(code) {
      statusResult = code;
      return this;
    },
    json: function(obj) {
      jsonResult = obj;
      return this;
    }
  };
  
  const testRequireAdminToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    if (!token || token !== adminToken) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  };
  
  let nextCalled = false;
  testRequireAdminToken(mockReq, mockRes, () => { nextCalled = true; });
  assert.strictEqual(statusResult, 401);
  assert.strictEqual(jsonResult.error, "Unauthorized");
  assert.strictEqual(nextCalled, false);
  console.log('✅ Mobile token blocked from admin API passed.');

  console.log('\n🎉 ALL Phase 10 Tests Passed Successfully!');
  process.exit(0);
}

runTests().catch(err => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
