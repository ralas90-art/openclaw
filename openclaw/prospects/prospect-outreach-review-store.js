const fs = require('fs');
const path = require('path');
const { validateReviewRecord } = require('./prospect-outreach-review-schema');

let WORKSPACE_ROOT = process.env.OPENCLAW_WORKSPACE_ROOT || path.resolve(__dirname, '../..');

function getStorePath() {
  // Handle dynamically re-assigned workspace roots for test isolation
  const root = process.env.OPENCLAW_WORKSPACE_ROOT || WORKSPACE_ROOT;
  return path.join(root, 'openclaw/prospects/data/outreach_reviews.json');
}

function ensureStoreExists() {
  const storePath = getStorePath();
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify({}, null, 2), 'utf8');
  }
}

function loadReviews() {
  ensureStoreExists();
  try {
    const raw = fs.readFileSync(getStorePath(), 'utf8');
    return JSON.parse(raw) || {};
  } catch (err) {
    console.error(`[ProspectOutreachReviewStore] Error reading reviews, returning empty object: ${err.message}`);
    return {};
  }
}

function saveReviews(reviews) {
  ensureStoreExists();
  fs.writeFileSync(getStorePath(), JSON.stringify(reviews, null, 2), 'utf8');
}

/**
 * Extracts SMS, Email, DM, Follow-ups, and Discovery call angle from the generated output markdown file.
 */
function extractDrafts(content) {
  let mainText = content;
  const fullOutputIdx = content.indexOf('## Full Output');
  if (fullOutputIdx !== -1) {
    mainText = content.substring(fullOutputIdx + 14);
  }

  const result = {
    smsDraft: '',
    emailDraft: '',
    dmDraft: '',
    followUpDrafts: [],
    discoveryCallAngle: ''
  };

  function extractSection(regexes) {
    for (const regex of regexes) {
      const match = mainText.match(regex);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    return '';
  }

  result.smsDraft = extractSection([
    /(?:###|##|\*\*|^|\n)\s*(?:[0-9]+\.)?\s*(?:first\s+)?sms(?:\s+draft)?s?[:\-*]*\n([\s\S]*?)(?=\n(?:###|##|#|\*\*|$))/i,
    /sms\s*[:\-*]*\n([\s\S]*?)(?=\n(?:###|##|#|\*\*|$))/i
  ]);

  result.emailDraft = extractSection([
    /(?:###|##|\*\*|^|\n)\s*(?:[0-9]+\.)?\s*(?:first\s+)?email(?:\s+draft)?s?[:\-*]*\n([\s\S]*?)(?=\n(?:###|##|#|\*\*|$))/i,
    /email\s*[:\-*]*\n([\s\S]*?)(?=\n(?:###|##|#|\*\*|$))/i
  ]);

  result.dmDraft = extractSection([
    /(?:###|##|\*\*|^|\n)\s*(?:[0-9]+\.)?\s*(?:facebook\/instagram\s+)?dm(?:\s+draft)?s?[:\-*]*\n([\s\S]*?)(?=\n(?:###|##|#|\*\*|$))/i,
    /dm\s*[:\-*]*\n([\s\S]*?)(?=\n(?:###|##|#|\*\*|$))/i
  ]);

  const followUpRaw = extractSection([
    /(?:###|##|\*\*|^|\n)\s*(?:[0-9]+\.)?\s*(?:3-step\s+)?follow-up(?:\s+sequence)?s?[:\-*]*\n([\s\S]*?)(?=\n(?:###|##|#|\*\*|$))/i,
    /followup\s*[:\-*]*\n([\s\S]*?)(?=\n(?:###|##|#|\*\*|$))/i
  ]);

  if (followUpRaw) {
    const items = followUpRaw.split(/\n(?=(?:[0-9]+\.|\*|-)\s+)/);
    result.followUpDrafts = items
      .map(item => item.trim().replace(/^([0-9]+\.|\*|-)\s+/, '').trim())
      .filter(Boolean);
  }

  result.discoveryCallAngle = extractSection([
    /(?:###|##|\*\*|^|\n)\s*(?:[0-9]+\.)?\s*discovery\s+call(?:\s+opener)?s?[:\-*]*\n([\s\S]*?)(?=\n(?:###|##|#|\*\*|$))/i,
    /(?:###|##|\*\*|^|\n)\s*(?:[0-9]+\.)?\s*offer\s+angle(?:\s+opener)?s?[:\-*]*\n([\s\S]*?)(?=\n(?:###|##|#|\*\*|$))/i,
    /discovery\s*[:\-*]*\n([\s\S]*?)(?=\n(?:###|##|#|\*\*|$))/i
  ]);

  return result;
}

/**
 * Synchronizes review records from current prospects and completed Hermes queue jobs.
 */
function syncReviews() {
  const prospectStore = require('./prospect-store');
  const hermesEngine = require('../hermes/hermes-queue-engine');
  
  const prospects = prospectStore.loadProspects();
  const reviews = loadReviews();
  let updated = false;

  for (const prospect of prospects) {
    const reviewId = `por_${prospect.prospectId.replace(/-/g, '')}`;
    let record = reviews[reviewId];

    if (!record) {
      record = {
        reviewId,
        prospectId: prospect.prospectId,
        hermesJobId: prospect.hermesJobId || null,
        runtimeJobId: null,
        status: 'not_started',
        businessName: prospect.businessName || 'Unknown Business',
        outreachDraftPath: null,
        smsDraft: '',
        emailDraft: '',
        dmDraft: '',
        followUpDrafts: [],
        discoveryCallAngle: '',
        operatorNotes: '',
        lastManualContactAt: null,
        // P4 fields
        manualContactCount: 0,
        lastManualContactChannel: null,
        nextFollowUpAt: null,
        followUpStage: 0,
        outcome: null,
        bookingNotes: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      reviews[reviewId] = record;
      updated = true;
    } else {
      // Backfill P4 fields for existing records
      let backfillCount = 0;
      if (record.manualContactCount === undefined) { record.manualContactCount = 0; backfillCount++; }
      if (record.lastManualContactChannel === undefined) { record.lastManualContactChannel = null; backfillCount++; }
      if (record.nextFollowUpAt === undefined) { record.nextFollowUpAt = null; backfillCount++; }
      if (record.followUpStage === undefined) { record.followUpStage = 0; backfillCount++; }
      if (record.outcome === undefined) { record.outcome = null; backfillCount++; }
      if (record.bookingNotes === undefined) { record.bookingNotes = null; backfillCount++; }
      if (backfillCount > 0) {
        record.updatedAt = new Date().toISOString();
        updated = true;
      }
    }

    // Link job if prospect has a hermesJobId now
    if (prospect.hermesJobId && record.hermesJobId !== prospect.hermesJobId) {
      record.hermesJobId = prospect.hermesJobId;
      record.updatedAt = new Date().toISOString();
      updated = true;
    }

    // Check Hermes job status if linked
    if (record.hermesJobId) {
      const job = hermesEngine.readHermesJob(record.hermesJobId);
      if (job) {
        if (record.runtimeJobId !== job.runtimeJobId) {
          record.runtimeJobId = job.runtimeJobId;
          record.updatedAt = new Date().toISOString();
          updated = true;
        }

        if (job.status === 'completed' && job.outputPath) {
          if (record.status === 'not_started' || record.status === 'draft_generated' || !record.smsDraft) {
            // Read and parse output drafts
            const root = process.env.OPENCLAW_WORKSPACE_ROOT || WORKSPACE_ROOT;
            const fullPath = path.resolve(root, 'openclaw/outbox/telegram-responses', job.outputPath);
            
            if (fs.existsSync(fullPath)) {
              try {
                const fileContent = fs.readFileSync(fullPath, 'utf8');
                const parsed = extractDrafts(fileContent);

                record.smsDraft = parsed.smsDraft;
                record.emailDraft = parsed.emailDraft;
                record.dmDraft = parsed.dmDraft;
                record.followUpDrafts = parsed.followUpDrafts;
                record.discoveryCallAngle = parsed.discoveryCallAngle;
                record.outreachDraftPath = job.outputPath;
                record.status = 'draft_generated';
                record.updatedAt = new Date().toISOString();
                updated = true;
              } catch (err) {
                console.error(`[ProspectOutreachReviewStore] Failed to read/parse outreach draft file at ${fullPath}: ${err.message}`);
              }
            }
          }
        }
      }
    }

    // Validate the synchronized review record
    validateReviewRecord(record);
  }

  if (updated) {
    saveReviews(reviews);
  }

  return Object.values(reviews);
}

/**
 * Updates a review record's manual status.
 */
function updateReviewStatus(reviewId, status) {
  const reviews = loadReviews();
  const record = reviews[reviewId];
  if (!record) {
    throw new Error(`Review with ID '${reviewId}' not found.`);
  }

  record.status = status;
  record.updatedAt = new Date().toISOString();

  if (status === 'contacted_manually') {
    record.lastManualContactAt = new Date().toISOString();
  }

  validateReviewRecord(record);
  saveReviews(reviews);
  return record;
}

/**
 * Updates a review record's operator notes.
 */
function updateReviewNotes(reviewId, notes) {
  const reviews = loadReviews();
  const record = reviews[reviewId];
  if (!record) {
    throw new Error(`Review with ID '${reviewId}' not found.`);
  }

  record.operatorNotes = String(notes || '').trim();
  record.updatedAt = new Date().toISOString();

  validateReviewRecord(record);
  saveReviews(reviews);
  return record;
}

/**
 * Log a manual contact event.
 */
function markReviewContacted(reviewId, channel) {
  const reviews = loadReviews();
  const record = reviews[reviewId];
  if (!record) {
    throw new Error(`Review with ID '${reviewId}' not found.`);
  }

  record.status = 'contacted_manually';
  record.lastManualContactChannel = String(channel || 'unknown').trim();
  record.lastManualContactAt = new Date().toISOString();
  record.manualContactCount = (record.manualContactCount || 0) + 1;
  record.nextFollowUpAt = null; // reset follow-up date since contacted now
  record.updatedAt = new Date().toISOString();

  validateReviewRecord(record);
  saveReviews(reviews);
  return record;
}

/**
 * Log a scheduled follow-up.
 */
function setReviewFollowUp(reviewId, nextFollowUpAt) {
  const reviews = loadReviews();
  const record = reviews[reviewId];
  if (!record) {
    throw new Error(`Review with ID '${reviewId}' not found.`);
  }

  if (nextFollowUpAt) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextFollowUpAt) && isNaN(Date.parse(nextFollowUpAt))) {
      throw new Error("Invalid date format. Use YYYY-MM-DD.");
    }
  }

  record.status = 'follow_up_needed';
  record.nextFollowUpAt = nextFollowUpAt || null;
  record.followUpStage = (record.followUpStage || 0) + 1;
  record.updatedAt = new Date().toISOString();

  validateReviewRecord(record);
  saveReviews(reviews);
  return record;
}

/**
 * Update multiple review record fields at once.
 */
function updateReviewFields(reviewId, updates) {
  const reviews = loadReviews();
  const record = reviews[reviewId];
  if (!record) {
    throw new Error(`Review with ID '${reviewId}' not found.`);
  }

  const allowedKeys = [
    'status',
    'operatorNotes',
    'manualContactCount',
    'lastManualContactChannel',
    'nextFollowUpAt',
    'followUpStage',
    'outcome',
    'bookingNotes'
  ];

  for (const key of allowedKeys) {
    if (updates[key] !== undefined) {
      if (key === 'manualContactCount' || key === 'followUpStage') {
        record[key] = updates[key] !== null ? parseInt(updates[key], 10) : 0;
      } else {
        record[key] = updates[key];
      }
    }
  }

  // Auto-stamp contact date if status transitions to contacted_manually
  if (updates.status === 'contacted_manually' && !record.lastManualContactAt) {
    record.lastManualContactAt = new Date().toISOString();
  }

  record.updatedAt = new Date().toISOString();

  validateReviewRecord(record);
  saveReviews(reviews);
  return record;
}

/**
 * Computes pipeline counts and analytics.
 */
function getPipelineAnalytics() {
  const reviews = loadReviews();
  const list = Object.values(reviews);
  
  const counts = {
    total: list.length,
    not_started: 0,
    draft_generated: 0,
    reviewed: 0,
    contacted_manually: 0,
    follow_up_needed: 0,
    booked_call: 0,
    not_interested: 0,
    due_today: 0
  };

  const todayStr = new Date().toISOString().split('T')[0];

  for (const r of list) {
    if (r.status in counts) {
      counts[r.status]++;
    }
    if (r.nextFollowUpAt) {
      const targetStr = r.nextFollowUpAt.substring(0, 10);
      if (targetStr <= todayStr) {
        counts.due_today++;
      }
    }
  }

  return counts;
}

module.exports = {
  loadReviews,
  saveReviews,
  syncReviews,
  updateReviewStatus,
  updateReviewNotes,
  markReviewContacted,
  setReviewFollowUp,
  updateReviewFields,
  getPipelineAnalytics,
  getStorePath
};
