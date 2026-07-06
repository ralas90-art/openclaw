require('dotenv').config();
const { routeNaturalLanguageCommand } = require('../jarvis/natural-language-router');
const { queryDb } = require('../jarvis/controller');

async function runTests() {
  console.log('🧪 Starting Phase 9: Natural Language Router Tests (Multilingual)');

  const mockMessage = { chat: { id: 'test_chat_123' } };

  // 1. Test language detection and routing for English Brief
  console.log('\\n--- Test 1: English Brief ---');
  const enRes = await routeNaturalLanguageCommand('what should i focus on today', mockMessage);
  console.log(enRes);
  if (enRes.type === 'command' && enRes.command === '/jarvis_brief') {
    console.log('✅ English Brief passed.');
  } else {
    console.error('❌ English Brief failed.');
  }

  // 2. Test language detection and routing for Spanish Brief
  console.log('\\n--- Test 2: Spanish Brief ---');
  const esRes = await routeNaturalLanguageCommand('¿qué tengo pendiente hoy?', mockMessage);
  console.log(esRes);
  if (esRes.type === 'command' && esRes.command === '/jarvis_brief') {
    console.log('✅ Spanish Brief passed.');
  } else {
    console.error('❌ Spanish Brief failed.');
  }

  // 3. Test Spanish Blocked Mutation: manda el mensaje
  console.log('\\n--- Test 3: Spanish Protected Mutation (manda el mensaje) ---');
  const esMut1 = await routeNaturalLanguageCommand('Manda el mensaje a John', mockMessage);
  console.log(esMut1);
  if (esMut1.type === 'reply' && (esMut1.text.includes('Acción Protegida') || esMut1.text.includes('Acción Bloqueada'))) {
    console.log('✅ Spanish Mutation 1 correctly gated.');
  } else {
    console.error('❌ Spanish Mutation 1 failed to gate.');
  }

  // 4. Test Spanish Blocked Mutation: envía el email
  console.log('\\n--- Test 4: Spanish Protected Mutation (envía el email) ---');
  const esMut2 = await routeNaturalLanguageCommand('Envía el email con la propuesta', mockMessage);
  console.log(esMut2);
  if (esMut2.type === 'reply' && (esMut2.text.includes('Acción Protegida') || esMut2.text.includes('Acción Bloqueada'))) {
    console.log('✅ Spanish Mutation 2 correctly gated.');
  } else {
    console.error('❌ Spanish Mutation 2 failed to gate.');
  }

  // 5. Test English Blocked Mutation: approve this
  console.log('\\n--- Test 5: English Protected Mutation (approve this) ---');
  const enMut = await routeNaturalLanguageCommand('approve this now', mockMessage);
  console.log(enMut);
  if (enMut.type === 'reply' && enMut.text.includes('Protected Action')) {
    console.log('✅ English Mutation correctly gated.');
  } else {
    console.error('❌ English Mutation failed to gate.');
  }

  // 6. Test Audit Log Sanitization & Truncation
  console.log('\\n--- Test 6: Audit Log DB check ---');
  
  // We'll insert a mock secret message directly
  const secretMessage = 'reconnect gmail using DATABASE_URL=postgresql://user:pass@host/db and INTERNAL_ADMIN_TOKEN=secret123';
  await routeNaturalLanguageCommand(secretMessage, mockMessage);

  const logs = await queryDb('SELECT * FROM jarvis_natural_language_logs ORDER BY created_at DESC LIMIT 5');
  console.log('Found ' + logs.length + ' recent logs in DB.');
  let hasSecret = false;
  logs.forEach(log => {
    if (log.original_text_sanitized.includes('postgresql://user:pass') || log.original_text_sanitized.includes('secret123')) {
      hasSecret = true;
    }
  });

  if (!hasSecret) {
    console.log('✅ Audit logs are sanitized and contain no raw secrets.');
  } else {
    console.error('❌ Found secrets in audit log!');
  }

  console.log('\\n✅ Phase 9 Tests Complete.');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test script crashed:', err);
  process.exit(1);
});
