/**
 * OpenClaw Prospect Outreach Review Validation Schema (Phase P3)
 */

const ALLOWED_STATUSES = [
  'not_started',
  'draft_generated',
  'reviewed',
  'contacted_manually',
  'follow_up_needed',
  'not_interested',
  'booked_call'
];

function validateReviewRecord(record) {
  if (!record || typeof record !== 'object') {
    throw new Error('Review record must be an object');
  }

  // Required string fields
  const requiredStringFields = [
    'reviewId',
    'prospectId',
    'status',
    'businessName',
    'createdAt',
    'updatedAt'
  ];

  for (const field of requiredStringFields) {
    if (typeof record[field] !== 'string' || !record[field]) {
      throw new Error(`Field '${field}' is required and must be a non-empty string`);
    }
  }

  // Validate reviewId starts with por_
  if (!record.reviewId.startsWith('por_')) {
    throw new Error("Field 'reviewId' must start with 'por_'");
  }

  // Validate status is one of ALLOWED_STATUSES
  if (!ALLOWED_STATUSES.includes(record.status)) {
    throw new Error(`Invalid status '${record.status}'. Allowed statuses: ${ALLOWED_STATUSES.join(', ')}`);
  }

  // Optional or nullable string fields
  const optionalStringFields = [
    'hermesJobId',
    'runtimeJobId',
    'outreachDraftPath',
    'smsDraft',
    'emailDraft',
    'dmDraft',
    'discoveryCallAngle',
    'operatorNotes',
    'lastManualContactAt'
  ];

  for (const field of optionalStringFields) {
    if (record[field] !== undefined && record[field] !== null && typeof record[field] !== 'string') {
      throw new Error(`Field '${field}' must be a string or null`);
    }
  }

  // followUpDrafts must be an array of strings
  if (record.followUpDrafts !== undefined && record.followUpDrafts !== null) {
    if (!Array.isArray(record.followUpDrafts)) {
      throw new Error("Field 'followUpDrafts' must be an array of strings");
    }
    for (const item of record.followUpDrafts) {
      if (typeof item !== 'string') {
        throw new Error("Items in 'followUpDrafts' must be strings");
      }
    }
  }

  // P4 Fields validation
  if (record.manualContactCount !== undefined && record.manualContactCount !== null) {
    if (!Number.isInteger(record.manualContactCount) || record.manualContactCount < 0) {
      throw new Error("Field 'manualContactCount' must be a non-negative integer");
    }
  }

  if (record.followUpStage !== undefined && record.followUpStage !== null) {
    if (!Number.isInteger(record.followUpStage) || record.followUpStage < 0) {
      throw new Error("Field 'followUpStage' must be a non-negative integer");
    }
  }

  const p4NullableStrings = [
    'lastManualContactChannel',
    'nextFollowUpAt',
    'outcome',
    'bookingNotes'
  ];

  for (const field of p4NullableStrings) {
    if (record[field] !== undefined && record[field] !== null && typeof record[field] !== 'string') {
      throw new Error(`Field '${field}' must be a string or null`);
    }
  }

  return true;
}

module.exports = {
  validateReviewRecord,
  ALLOWED_STATUSES
};
