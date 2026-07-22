/**
 * Jarvis Priority Intelligence Engine
 * Handles read-only project matching, priority scoring, and priority ranking.
 */

const { getEmailSummary, getDriveSummary } = require('./connectors-summary');
const { queryDb } = require('./controller');

function cleanPublicUrl(url) {
  if (!url) return '';
  let cleaned = url.replace(/^["']|["']$/g, '').trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(cleaned);
    if (parsed.pathname !== '/' && parsed.pathname !== '') {
      console.error(`❌ [PUBLIC_URL Check] Rejected PUBLIC_URL "${url}" because it contains a path suffix: "${parsed.pathname}". PUBLIC_URL must be the base domain only!`);
      return '';
    }
    return cleaned;
  } catch (err) {
    console.error(`❌ [PUBLIC_URL Check] Rejected PUBLIC_URL "${url}" because it is not a valid URL: ${err.message}`);
    return '';
  }
}

function containsKeywords(text, keywords) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return keywords.some(kw => lower.includes(kw));
}

function matchTextToProject(text, projects) {
  if (!text) return null;
  const lower = text.toLowerCase();
  
  // 1. Try exact/sub-string matches first
  for (const p of projects) {
    const slugLower = p.slug.toLowerCase();
    const slugNoHyphen = slugLower.replace(/-/g, ' ');
    const nameLower = p.name.toLowerCase();
    if (lower.includes(slugLower) || lower.includes(slugNoHyphen) || lower.includes(nameLower)) {
      return p;
    }
  }

  // 2. Try matching unique key terms (e.g. "solar", "septivolt", "cresca", "cleaning")
  const stopWords = new Set(['new', 'era', 'os', 'bright', 'future', 'homes', 'creation', 'content']);
  for (const p of projects) {
    const terms = p.slug.toLowerCase().split('-');
    for (const term of terms) {
      if (term.length > 3 && !stopWords.has(term) && lower.includes(term)) {
        return p;
      }
    }
  }
  
  return null;
}

function generateStableId(item) {
  if (item.raw && item.raw.id) {
    return `${item.type}:${item.raw.id}`;
  }
  let content = '';
  if (item.type === 'email') {
    content = `${item.raw.subject || ''}-${item.raw.from || ''}`;
  } else if (item.type === 'drive_file') {
    content = `${item.raw.name || ''}`;
  } else if (item.type === 'blocker') {
    content = `${item.raw.description || ''}`;
  } else if (item.type === 'next_action') {
    content = `${item.raw.action || ''}`;
  } else if (item.type === 'mobile_note') {
    content = `${item.raw.text_content || ''}`;
  }
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = (hash << 5) - hash + content.charCodeAt(i);
    hash |= 0;
  }
  return `${item.type}:hash:${Math.abs(hash)}`;
}

function scoreItems(allRawItems, projects, repeatMentionsMap, ignoredIds = new Set(), pinnedIds = new Set()) {
  const urgencyKeywords = ['urgent', 'asap', 'immediate', 'important', 'critical', 'urgente', 'importante', 'critico', 'now', 'ahora', 'inmediato', 'quick'];
  const paymentKeywords = ['invoice', 'payment', 'bill', 'receipt', 'wire', 'transaction', 'pago', 'factura', 'cobro', 'transferencia'];
  const deadlineKeywords = ['by tomorrow', 'due', 'deadline', 'fecha', 'limite', 'antes de', 'soon', 'mañana', 'hoy'];

  return allRawItems.map(item => {
    let score = 0;
    let reasons = [];
    let matchedProject = null;
    let projSlug = null;

    // Determine matched project
    if (item.type === 'email') {
      projSlug = item.raw.suggested_project;
      if (!projSlug) {
        matchedProject = matchTextToProject(`${item.raw.subject} ${item.raw.from} ${item.raw.snippet}`, projects);
      }
    } else if (item.type === 'drive_file') {
      projSlug = item.raw.suggested_project;
      if (!projSlug) {
        matchedProject = matchTextToProject(item.raw.name, projects);
      }
    } else if (item.type === 'blocker') {
      projSlug = item.raw.project_slug;
      if (!projSlug) {
        matchedProject = matchTextToProject(item.raw.description, projects);
      }
    } else if (item.type === 'next_action') {
      projSlug = item.raw.project_slug;
      if (!projSlug) {
        matchedProject = matchTextToProject(item.raw.action, projects);
      }
    } else if (item.type === 'mobile_note') {
      projSlug = item.raw.project_slug;
      if (!projSlug) {
        matchedProject = matchTextToProject(`${item.raw.text_content} ${item.raw.notes || ''}`, projects);
      }
    }

    if (projSlug && !matchedProject) {
      matchedProject = projects.find(p => p.slug === projSlug);
    }
    if (matchedProject) {
      projSlug = matchedProject.slug;
    }

    // Generate stable ID for the item
    const stableId = generateStableId(item);

    // Apply Scoring Rules
    // 1. Matches active project relevance (+10)
    if (matchedProject) {
      score += 10;
      reasons.push('active project');
      // If project is high priority/critical (+5)
      const projPriority = matchedProject.priority || (matchedProject.metadata && matchedProject.metadata.priority);
      if (projPriority === 'high' || projPriority === 'critical') {
        score += 5;
        reasons.push('high priority project');
      }
    }

    // Extract text for keyword checking
    let textToAnalyze = '';
    if (item.type === 'email') {
      textToAnalyze = `${item.raw.subject} ${item.raw.snippet}`;
    } else if (item.type === 'drive_file') {
      textToAnalyze = item.raw.name;
    } else if (item.type === 'blocker') {
      textToAnalyze = item.raw.description;
    } else if (item.type === 'next_action') {
      textToAnalyze = item.raw.action;
    } else if (item.type === 'mobile_note') {
      textToAnalyze = `${item.raw.text_content || ''} ${item.raw.notes || ''}`;
    }

    // 2. Urgency keywords (+15)
    if (containsKeywords(textToAnalyze, urgencyKeywords)) {
      score += 15;
      reasons.push('urgency language');
    }

    // 3. Payment/invoice keywords (+20)
    if (containsKeywords(textToAnalyze, paymentKeywords)) {
      score += 20;
      reasons.push('payment language');
    }

    // 4. Deadline/date language (+12)
    if (containsKeywords(textToAnalyze, deadlineKeywords)) {
      score += 12;
      reasons.push('deadline language');
    }

    // 5. Repeated mentions (+10)
    if (projSlug && repeatMentionsMap.get(projSlug) > 1) {
      score += 10;
      reasons.push('repeated mentions');
    }

    // 6. Base scores by type
    if (item.type === 'email') {
      score += 8; // base unread email
      reasons.push('unread email');
    } else if (item.type === 'drive_file') {
      score += 5; // base modified file
      reasons.push('recent modified file');
    } else if (item.type === 'blocker') {
      score += 10; // base active blocker
      reasons.push('active blocker');
      const days = Math.floor((Date.now() - new Date(item.raw.created_at).getTime()) / (1000 * 60 * 60 * 24));
      if (days > 0) {
        const ageScore = Math.min(days * 5, 30);
        score += ageScore;
        reasons.push(`stale blocker (${days} days)`);
      }
      
      // Decay rule: if stale (> 3 days) and not urgent, decay score to not recommend forever
      if (days > 3) {
        const isUrgent = containsKeywords(textToAnalyze, urgencyKeywords) || 
                         containsKeywords(textToAnalyze, paymentKeywords) || 
                         containsKeywords(textToAnalyze, deadlineKeywords);
        if (!isUrgent) {
          score -= 15;
          reasons.push('stale non-urgent decay');
        }
      }
    } else if (item.type === 'next_action') {
      const priority = (item.raw.priority || '').toLowerCase();
      const nextActionBase = priority === 'high' || priority === 'critical' ? 15 : (priority === 'medium' ? 10 : 5);
      score += nextActionBase;
      reasons.push(`pending next action (${priority || 'normal'})`);
    } else if (item.type === 'mobile_note') {
      score += 5; // base unprocessed note
      reasons.push('unprocessed mobile note');
      const createdDate = new Date(item.raw.created_at).toISOString().substring(0, 10);
      const todayDate = new Date().toISOString().substring(0, 10);
      if (createdDate === todayDate) {
        score += 8;
        reasons.push('from today');
      }
    }

    // 7. Feedback customizations (Ignored vs Pinned)
    const isIgnored = ignoredIds.has(stableId) || (projSlug && ignoredIds.has(projSlug));
    if (isIgnored) {
      score -= 100;
      reasons.push('ignored');
    }

    const isPinned = pinnedIds.has(stableId) || (projSlug && pinnedIds.has(projSlug));
    if (isPinned) {
      score += 50;
      reasons.push('pinned');
    }

    // Formulate heading, why, nextAction
    let heading = '';
    let nextAction = '';
    const projectName = matchedProject ? matchedProject.name : 'System';

    if (item.type === 'email') {
      const displayFrom = (item.raw.from || '').split('<')[0].trim();
      heading = `${projectName} — Follow up on unread client message from ${displayFrom || 'Unknown'}`;
      nextAction = `review email and decide response`;
    } else if (item.type === 'drive_file') {
      heading = `${projectName} — Review recent Drive changes: ${item.raw.name}`;
      nextAction = `inspect updated file before next build session`;
    } else if (item.type === 'blocker') {
      heading = `${projectName} — Resolve active blocker: ${item.raw.description}`;
      nextAction = `address blocker description: "${item.raw.description}"`;
    } else if (item.type === 'mobile_note') {
      const cleanContent = (item.raw.text_content || 'No text').substring(0, 50).trim();
      heading = `Jarvis/OpenClaw — Clear mobile inbox item: ${cleanContent}`;
      nextAction = `process into project task or archive`;
    } else if (item.type === 'next_action') {
      heading = `${projectName} — Execute next action: ${item.raw.action}`;
      nextAction = `execute task: "${item.raw.action}"`;
    }

    return {
      score,
      type: item.type,
      reasons,
      heading,
      why: 'Why: ' + reasons.join(' + '),
      nextAction: 'Next action: ' + nextAction,
      raw: item.raw,
      project_slug: projSlug,
      priority_id: stableId
    };
  });
}

function rankBriefItems(scoredItems) {
  return [...scoredItems].sort((a, b) => b.score - a.score);
}

function buildTopThreePriorities(scoredItems) {
  return rankBriefItems(scoredItems).slice(0, 3);
}

function detectFollowUps(scoredItems) {
  return scoredItems.filter(item =>
    (item.type === 'email' || item.type === 'mobile_note') &&
    (item.reasons.includes('urgency language') || item.reasons.includes('deadline language') || item.reasons.includes('active project'))
  );
}

function detectStaleBlockers(scoredItems) {
  return scoredItems.filter(item => 
    item.type === 'blocker' && 
    (Date.now() - new Date(item.raw.created_at).getTime() > 2 * 24 * 60 * 60 * 1000)
  );
}

async function ensureFeedbackTablesExist() {
  // Schema and migrations are initialized on server boot by jarvis/migrations.js
  return true;
}

async function getPriorityIntelligence() {
  // Ensure tables exist
  await ensureFeedbackTablesExist();

  // 1. Fetch data from Supabase/PG
  const projects = await queryDb("SELECT * FROM jarvis_projects WHERE status = 'active';");
  const blockers = await queryDb("SELECT * FROM jarvis_blockers WHERE status = 'active';");
  const nextActions = await queryDb("SELECT * FROM jarvis_next_actions WHERE status = 'pending';");
  const mobileInbox = await queryDb("SELECT * FROM jarvis_mobile_uploads WHERE processed = false AND archived = false;");

  // Fetch feedback to extract ignores/pins
  let feedbackList = [];
  try {
    feedbackList = await queryDb("SELECT * FROM jarvis_priority_feedback;");
  } catch (err) {
    console.warn('[Intelligence] Failed to fetch feedback list:', err.message);
  }

  const ignoredIds = new Set(feedbackList.filter(f => f.feedback_type === 'ignored').map(f => f.priority_id));
  const pinnedIds = new Set(feedbackList.filter(f => f.feedback_type === 'pinned').map(f => f.priority_id));

  // 2. Fetch data from Connectors (fail-closed)
  let emails = [];
  try {
    const fetchedEmails = await getEmailSummary();
    if (fetchedEmails) emails = fetchedEmails;
  } catch (err) {
    console.warn('[Intelligence] Gmail connector failed or unauthorized:', err.message);
  }

  let driveFiles = [];
  try {
    const fetchedDrive = await getDriveSummary();
    if (fetchedDrive) driveFiles = fetchedDrive;
  } catch (err) {
    console.warn('[Intelligence] Google Drive connector failed or unauthorized:', err.message);
  }

  // 3. Count occurrences for repeat mentions
  const repeatMentionsMap = new Map();
  const incrementSlug = (slug) => {
    if (!slug) return;
    repeatMentionsMap.set(slug, (repeatMentionsMap.get(slug) || 0) + 1);
  };

  blockers.forEach(b => incrementSlug(b.project_slug));
  nextActions.forEach(a => incrementSlug(a.project_slug));
  mobileInbox.forEach(m => incrementSlug(m.project_slug));
  emails.forEach(e => incrementSlug(e.suggested_project));
  driveFiles.forEach(d => incrementSlug(d.suggested_project));

  // 4. Wrap all items into standard ranking structure
  const rawItems = [];
  blockers.forEach(b => rawItems.push({ type: 'blocker', raw: b }));
  nextActions.forEach(a => rawItems.push({ type: 'next_action', raw: a }));
  mobileInbox.forEach(m => rawItems.push({ type: 'mobile_note', raw: m }));
  emails.forEach(e => rawItems.push({ type: 'email', raw: e }));
  driveFiles.forEach(d => rawItems.push({ type: 'drive_file', raw: d }));

  // 5. Score items
  const scoredItems = scoreItems(rawItems, projects, repeatMentionsMap, ignoredIds, pinnedIds);
  const rankedItems = rankBriefItems(scoredItems);

  // 6. Build categorized subsets
  const topThreePriorities = buildTopThreePriorities(scoredItems);
  const followUps = detectFollowUps(scoredItems);
  const staleBlockers = detectStaleBlockers(scoredItems);

  const urgentEmails = scoredItems.filter(item => 
    item.type === 'email' && 
    (item.score >= 25 || item.reasons.includes('urgency language') || item.reasons.includes('payment language'))
  );

  const projectDriveFiles = scoredItems.filter(item => 
    item.type === 'drive_file' && item.project_slug
  );

  const unprocessedMobileNotes = scoredItems.filter(item => 
    item.type === 'mobile_note'
  );

  return {
    topThreePriorities,
    urgentEmails,
    followUps,
    projectDriveFiles,
    staleBlockers,
    unprocessedMobileNotes,
    rankedItems,
    ignoredIds: Array.from(ignoredIds),
    pinnedIds: Array.from(pinnedIds)
  };
}

module.exports = {
  cleanPublicUrl,
  containsKeywords,
  matchTextToProject,
  generateStableId,
  scoreItems,
  rankBriefItems,
  detectFollowUps,
  detectStaleBlockers,
  buildTopThreePriorities,
  getPriorityIntelligence
};

