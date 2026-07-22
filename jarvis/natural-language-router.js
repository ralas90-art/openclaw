const crypto = require('crypto');
const { queryDb } = require('./db');
const { sanitizeSecrets, sanitizeError } = require('./sanitizer');


// 1. Dictionaries for Language Detection
const ES_KEYWORDS = ['que', 'qué', 'tengo', 'pendiente', 'hoy', 'enséñame', 'enseñame', 'mis', 'prioridades', 'hay', 'aprobaciones', 'muéstrame', 'muestrame', 'el', 'historial', 'de', 'marca', 'esto', 'como', 'procesado', 'reconecta', 'manda', 'envía', 'envia', 'mensaje', 'email', 'contacta', 'este', 'prospecto', 'aprueba', 'rechaza', 'cuales', 'cuáles', 'son', 'seguimientos', 'vencidos', 'mejores', 'leads', 'cómo', 'como', 'están', 'estan', 'conectores', 'abre', 'dame', 'los', 'sesión', 'sesion', 'trabajé', 'trabaje', 'cambió', 'cambio', 'actualización', 'actualizacion', 'capturas', 'teléfono', 'telefono', 'handoff', 'empieza', 'termina', 'guarda', 'bajo', 'proyecto'];
const EN_KEYWORDS = ['what', 'should', 'focus', 'on', 'today', 'show', 'me', 'my', 'pending', 'approvals', 'prospects', 'contact', 'next', 'do', 'i', 'have', 'follow', 'ups', 'due', 'reconnect', 'create', 'action', 'proposal', 'for', 'this', 'priority', 'top', 'roofing', 'happened', 'in', 'summarize', 'dashboard', 'blocked', 'leads', 'brief', 'session', 'work', 'changed', 'update', 'captures', 'phone', 'handoff', 'start', 'finish', 'save', 'under', 'project', 'antigravity'];

function detectLanguage(text) {
  const words = text.toLowerCase().split(/\s+/);
  let esCount = 0;
  let enCount = 0;

  for (const word of words) {
    if (ES_KEYWORDS.includes(word)) esCount++;
    if (EN_KEYWORDS.includes(word)) enCount++;
  }

  if (esCount > 0 && enCount === 0) return 'es';
  if (enCount > 0 && esCount === 0) return 'en';
  if (esCount > 0 && enCount > 0) return 'mixed';
  return 'unknown';
}

function removeAccents(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// 2. Intent Aliases
const INTENT_ALIASES = [
  // Brief & Dashboard
  { intent: 'brief', aliases: ['what should i focus on today', 'que tengo pendiente hoy', 'qué tengo pendiente hoy', 'jarvis brief', 'resumen de hoy', 'que paso hoy', 'dame mi brief de today'], mapped_command: '/jarvis_brief', risk_tier: 'read_only' },
  { intent: 'priorities', aliases: ['show me my priorities', 'enséñame mis prioridades', 'enseñame mis prioridades', 'what are my priorities', 'cuales son mis prioridades'], mapped_command: '/jarvis_priorities', risk_tier: 'read_only' },
  { intent: 'connectors', aliases: ['cómo están mis conectores', 'como estan mis conectores'], mapped_command: '/jarvis_connectors', risk_tier: 'read_only' },
  
  // Approvals
  { intent: 'approvals_list', aliases: ['show me my pending approvals', 'show me pending approvals', 'hay aprobaciones pendientes', 'enséñame mis aprobaciones pendientes', 'pending approvals', 'aprobaciones pendientes'], mapped_command: '/jarvis_approvals', risk_tier: 'read_only' },
  { intent: 'approval_history', aliases: ['show me approval history', 'muéstrame el historial de aprobaciones', 'muestrame el historial de aprobaciones', 'approval history'], mapped_command: '/jarvis_approval_history', risk_tier: 'read_only' },
  
  // Gated Actions (Must return helper card, NOT execute mutation)
  { intent: 'approve_action', aliases: ['aprueba esto', 'approve this'], mapped_command: 'HELP_APPROVALS', risk_tier: 'state_mutation' },
  { intent: 'reject_action', aliases: ['rechaza esto', 'reject this'], mapped_command: 'HELP_APPROVALS', risk_tier: 'state_mutation' },
  { intent: 'reconnect_gmail', aliases: ['reconnect gmail', 'reconecta gmail'], mapped_command: 'HELP_RECONNECT', risk_tier: 'state_mutation' },
  { intent: 'mark_processed', aliases: ['mark this as processed', 'marca esto como procesado', 'marca procesado'], mapped_command: 'HELP_MOBILE_INBOX', risk_tier: 'state_mutation' },
  { intent: 'send_message', aliases: ['send the message', 'manda el mensaje', 'envía el email', 'envia el email', 'contact this prospect', 'contacta este prospecto'], mapped_command: 'HELP_GATED', risk_tier: 'state_mutation' },
  
  // Mobile Inbox / Phone Captures
  { intent: 'mobile_inbox', aliases: ['mobile inbox', 'bandeja de entrada', 'show my phone captures', 'muéstrame las capturas del teléfono', 'muestrame las capturas del telefono', 'show me mis capturas', 'mostrar mis capturas'], mapped_command: '/jarvis_mobile_inbox', risk_tier: 'read_only' },
  
  // Outreach
  { intent: 'outreach_due', aliases: ['do i have follow ups due', 'hay seguimientos vencidos', 'tengo seguimientos pendientes', 'follow ups due', 'show me los follow ups de hoy'], mapped_command: '/outreach_due', risk_tier: 'read_only' },
  { intent: 'outreach_today', aliases: ['who should i contact', 'a quien debo contactar', 'contact today', 'what prospects should i contact', 'qué prospectos debo contactar hoy', 'qué leads should i contact'], mapped_command: '/outreach_today', risk_tier: 'read_only' },
  { intent: 'score_top', aliases: ['show my top leads', 'muéstrame los mejores leads', 'top leads'], mapped_command: '/score_top', risk_tier: 'read_only' },
  
  // Dashboard / General
  { intent: 'dashboard', aliases: ['show me my dashboard', 'abre mi dashboard', 'dashboard'], mapped_command: 'HELP_DASHBOARD', risk_tier: 'read_only' },
  { intent: 'blockers', aliases: ['whats blocked', 'what is blocked', 'que esta bloqueado', 'qué está bloqueado', 'blockers'], mapped_command: '/jarvis_blockers', risk_tier: 'read_only' },

  // Phase 10: Work Sessions & Ingestion (State Mutations)
  { intent: 'work_session_start', aliases: ['start a work session for', 'start a work session', 'empieza una sesión para', 'empieza una sesion para', 'empieza una sesión', 'empieza una sesion', 'start sesión para', 'start sesion para', 'start sesión', 'start sesion'], mapped_command: 'HELP_SESSION_START', risk_tier: 'state_mutation' },
  { intent: 'work_session_update', aliases: ['save this as a project update', 'guarda esto como actualización para', 'guarda esto como actualizacion para', 'guarda esto como actualización del proyecto', 'guarda esto como actualizacion del proyecto', 'save this update para', 'guarda this update para'], mapped_command: 'HELP_SESSION_UPDATE', risk_tier: 'state_mutation' },
  { intent: 'work_session_done', aliases: ['finish this work session', 'termina esta sesión', 'termina esta sesion', 'finish work session'], mapped_command: 'HELP_SESSION_DONE', risk_tier: 'state_mutation' },
  { intent: 'handoff_ingest', aliases: ['ingest handoff', 'ingest my handoff', 'procesar handoff'], mapped_command: 'HELP_HANDOFF_INGEST', risk_tier: 'state_mutation' },

  // Phase 10: Work Sessions (Read Only)
  { intent: 'work_session_status', aliases: ['summarize my current work session', 'resume mi sesión actual', 'resume mi sesion actual', 'status de mi sesión', 'status de mi sesion'], mapped_command: '/jarvis_session_status', risk_tier: 'read_only' },
  { intent: 'current_work_context', aliases: ['what changed in antigravity today', 'what did antigravity change today', 'qué cambió en antigravity hoy', 'que cambio en antigravity hoy', 'qué cambió hoy en antigravity', 'que cambio hoy en antigravity', 'qué changed en antigravity today', 'qué changed today en antigravity', 'que changed en antigravity today', 'que changed today en antigravity', 'what did i work on today', 'qué trabajé hoy', 'que trabaje hoy'], mapped_command: '/jarvis_session_latest', risk_tier: 'read_only' }
];

function findIntent(text) {
  const normalizedText = removeAccents(text).trim();
  
  for (const item of INTENT_ALIASES) {
    for (const alias of item.aliases) {
      if (normalizedText.includes(removeAccents(alias))) {
        return item;
      }
    }
  }
  return null;
}

// 3. Sanitization
function sanitizeLogText(text) {
  if (!text) return '';
  let sanitized = sanitizeSecrets(text);
  if (sanitized.length > 1000) {
    sanitized = sanitized.substring(0, 1000) + '...[TRUNCATED]';
  }
  return sanitized;
}

// 4. DB Init and Audit Logging
async function ensureAuditTableExists() {
  const sql = `
    CREATE TABLE IF NOT EXISTS jarvis_natural_language_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      original_text_sanitized TEXT NOT NULL,
      original_text_hash VARCHAR(64) NOT NULL,
      detected_language VARCHAR(50) NOT NULL,
      interpreted_intent VARCHAR(100) NOT NULL,
      mapped_command VARCHAR(255) NOT NULL,
      confidence DECIMAL(5,2) NOT NULL,
      risk_tier VARCHAR(50) NOT NULL,
      executed_boolean BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      source_chat_id VARCHAR(100)
    );
  `;
  try {
    await queryDb(sql);
  } catch (err) {
    console.error('[NaturalLanguageRouter] Error ensuring audit table exists:', err.message);
  }
}

async function logNaturalLanguageRequest(sanitizedText, hash, lang, intentStr, mappedCommand, riskTier, executed, chatId) {
  try {
    await queryDb(`
      INSERT INTO jarvis_natural_language_logs 
      (original_text_sanitized, original_text_hash, detected_language, interpreted_intent, mapped_command, confidence, risk_tier, executed_boolean, source_chat_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [sanitizedText, hash, lang, intentStr, mappedCommand, 1.0, riskTier, executed, chatId]);
  } catch (err) {
    console.error('[NaturalLanguageRouter] Error inserting audit log:', err.message);
  }
}

// Helper to look up active project slugs mentioned in query
async function detectProjectSlug(text) {
  try {
    const projects = await queryDb("SELECT slug FROM jarvis_projects WHERE status = 'active';");
    const normalizedText = removeAccents(text);
    for (const p of projects) {
      const slug = p.slug.toLowerCase();
      // Look for slug match surrounded by word boundaries or spaces
      const regex = new RegExp('\\b' + slug + '\\b', 'i');
      if (regex.test(normalizedText)) {
        return p.slug;
      }
    }
  } catch (err) {
    console.warn('[NaturalLanguageRouter] Project detection failed:', err.message);
  }
  return null;
}

// 5. Main Router Logic
async function routeNaturalLanguageCommand(text, message) {
  await ensureAuditTableExists();

  const lang = detectLanguage(text);
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  const sanitizedText = sanitizeLogText(text);
  const chatId = message.chat?.id?.toString() || 'unknown';

  const intentMatch = findIntent(text);

  if (!intentMatch) {
    // Log as unknown
    await logNaturalLanguageRequest(sanitizedText, hash, lang, 'unknown', 'none', 'none', false, chatId);
    
    // Return language-aware fallback
    if (lang === 'es' || lang === 'mixed') {
      return { 
        type: 'reply', 
        text: '🤔 No entendí ese comando. Por favor usa un comando válido o revisa el menú con /menu.',
        intent: 'unknown',
        command: 'none'
      };
    }
    return {
      type: 'reply',
      text: '🤔 I did not understand that command. Please use a valid slash command or check /menu.',
      intent: 'unknown',
      command: 'none'
    };
  }

  // Check if project slug is needed for work session commands and if it's missing
  const sessionIntents = ['work_session_start', 'work_session_update', 'work_session_done'];
  let projectSlug = null;
  if (sessionIntents.includes(intentMatch.intent)) {
    projectSlug = await detectProjectSlug(text);
    if (!projectSlug) {
      await logNaturalLanguageRequest(sanitizedText, hash, lang, intentMatch.intent, 'ASK_CLARIFICATION', 'read_only', false, chatId);
      const clarText = (lang === 'es' || lang === 'mixed')
        ? 'Which project should I save this under? (e.g. ¿Bajo qué proyecto debería guardar esto? Por favor especifica un slug de proyecto activo)'
        : 'Which project should I save this under? Please specify an active project slug.';
      return { type: 'reply', text: clarText, intent: intentMatch.intent, command: 'ASK_CLARIFICATION' };
    }
  }

  // Handle Safety Gates (state_mutation must not be executed directly via NL)
  if (intentMatch.risk_tier === 'state_mutation') {
    await logNaturalLanguageRequest(sanitizedText, hash, lang, intentMatch.intent, intentMatch.mapped_command, intentMatch.risk_tier, false, chatId);
    
    let replyText = '';
    if (intentMatch.mapped_command === 'HELP_APPROVALS') {
      replyText = (lang === 'es' || lang === 'mixed') 
        ? '⚠️ *Acción Protegida*: Por favor usa `/jarvis_approve <ID>` o `/jarvis_reject <ID>` para gestionar aprobaciones.'
        : '⚠️ *Protected Action*: Please use `/jarvis_approve <ID>` or `/jarvis_reject <ID>` to manage approvals.';
    } else if (intentMatch.mapped_command === 'HELP_RECONNECT') {
      replyText = (lang === 'es' || lang === 'mixed')
        ? '⚠️ *Acción Protegida*: Por favor usa `/jarvis_reconnect_google` explícitamente.'
        : '⚠️ *Protected Action*: Please use `/jarvis_reconnect_google` explicitly.';
    } else if (intentMatch.mapped_command === 'HELP_MOBILE_INBOX') {
      replyText = (lang === 'es' || lang === 'mixed')
        ? '⚠️ *Acción Protegida*: Por favor usa `/jarvis_mark_processed <ID>` o `/jarvis_process_latest <project>`.'
        : '⚠️ *Protected Action*: Please use `/jarvis_mark_processed <ID>` or `/jarvis_process_latest <project>`.';
    } else if (intentMatch.mapped_command === 'HELP_SESSION_START') {
      replyText = (lang === 'es' || lang === 'mixed')
        ? `⚠️ *Acción Protegida*: Por favor usa \`/jarvis_session_start ${projectSlug}\` para iniciar la sesión.`
        : `⚠️ *Protected Action*: Please use \`/jarvis_session_start ${projectSlug}\` to start the work session.`;
    } else if (intentMatch.mapped_command === 'HELP_SESSION_UPDATE') {
      replyText = (lang === 'es' || lang === 'mixed')
        ? `⚠️ *Acción Protegida*: Por favor usa \`/jarvis_session_update ${projectSlug} <resumen>\` para guardar una actualización.`
        : `⚠️ *Protected Action*: Please use \`/jarvis_session_update ${projectSlug} <summary>\` to update the work session.`;
    } else if (intentMatch.mapped_command === 'HELP_SESSION_DONE') {
      replyText = (lang === 'es' || lang === 'mixed')
        ? `⚠️ *Acción Protegida*: Por favor usa \`/jarvis_session_done ${projectSlug}\` para terminar la sesión.`
        : `⚠️ *Protected Action*: Please use \`/jarvis_session_done ${projectSlug}\` to finish the work session.`;
    } else if (intentMatch.mapped_command === 'HELP_HANDOFF_INGEST') {
      replyText = (lang === 'es' || lang === 'mixed')
        ? '⚠️ *Acción Protegida*: Por favor usa `/jarvis_ingest_handoff` explícitamente.'
        : '⚠️ *Protected Action*: Please use `/jarvis_ingest_handoff` explicitly.';
    } else {
      replyText = (lang === 'es' || lang === 'mixed')
        ? '⚠️ *Acción Bloqueada*: Mutación de estado de alto riesgo requiere comandos explícitos.'
        : '⚠️ *Action Blocked*: High-risk state mutation requires explicit slash commands.';
    }

    return { type: 'reply', text: replyText, intent: intentMatch.intent, command: intentMatch.mapped_command };
  }

  // Log successful read-only translation
  await logNaturalLanguageRequest(sanitizedText, hash, lang, intentMatch.intent, intentMatch.mapped_command, intentMatch.risk_tier, true, chatId);

  if (intentMatch.mapped_command === 'HELP_DASHBOARD') {
    const dashboardUrl = process.env.PUBLIC_URL ? (process.env.PUBLIC_URL + '/admin/jarvis') : '/admin/jarvis';
    return { type: 'reply', text: (lang === 'es' || lang === 'mixed') ? `Aquí tienes tu dashboard: ${dashboardUrl}` : `Here is your dashboard: ${dashboardUrl}`, intent: intentMatch.intent, command: intentMatch.mapped_command };
  }

  // Return mapped command for handlers to execute
  return { type: 'command', command: intentMatch.mapped_command, intent: intentMatch.intent };
}

module.exports = {
  routeNaturalLanguageCommand,
  detectLanguage,
  sanitizeLogText
};
