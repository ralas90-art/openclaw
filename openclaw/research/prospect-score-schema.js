/**
 * OpenClaw Prospect Score Record Schema
 */

const ALLOWED_CHANNELS = ['sms', 'email', 'dm', 'call', 'unknown'];
const ALLOWED_PRIORITIES = ['low', 'medium', 'high'];

function validateScoreRecord(record) {
  if (!record || typeof record !== 'object') {
    throw new Error('Score record must be an object');
  }

  // Required string fields
  const stringFields = [
    'scoreId',
    'prospectId',
    'researchId',
    'businessName',
    'recommendedOfferAngle',
    'reasoning',
    'createdAt',
    'updatedAt'
  ];

  for (const field of stringFields) {
    if (typeof record[field] !== 'string' || record[field].trim() === '') {
      throw new Error(`Field '${field}' must be a non-empty string`);
    }
  }

  // Check scoreId prefix
  if (!record.scoreId.startsWith('scr_')) {
    throw new Error("Field 'scoreId' must start with 'scr_' prefix");
  }

  // Check scores are numbers between 0 and 100
  const scoreFields = [
    'fitScore',
    'urgencyScore',
    'websiteGapScore',
    'followUpPotentialScore'
  ];

  for (const field of scoreFields) {
    const val = record[field];
    if (typeof val !== 'number' || isNaN(val) || val < 0 || val > 100) {
      throw new Error(`Field '${field}' must be a number between 0 and 100`);
    }
  }

  // Check allowed recommendedChannel
  if (!ALLOWED_CHANNELS.includes(record.recommendedChannel)) {
    throw new Error(`Field 'recommendedChannel' must be one of: ${ALLOWED_CHANNELS.join(', ')}`);
  }

  // Check allowed priority
  if (!ALLOWED_PRIORITIES.includes(record.priority)) {
    throw new Error(`Field 'priority' must be one of: ${ALLOWED_PRIORITIES.join(', ')}`);
  }

  // Check redFlags is an array of strings
  if (!Array.isArray(record.redFlags)) {
    throw new Error("Field 'redFlags' must be an array");
  }
  for (const flag of record.redFlags) {
    if (typeof flag !== 'string') {
      throw new Error("Array field 'redFlags' must only contain strings");
    }
  }

  return true;
}

module.exports = {
  validateScoreRecord,
  ALLOWED_CHANNELS,
  ALLOWED_PRIORITIES
};
