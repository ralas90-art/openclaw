/**
 * OpenClaw Prospect Research Record Schema
 */

const ALLOWED_SOURCE_TYPES = ['website', 'agent_reach', 'youtube', 'reddit', 'github', 'x', 'clay'];

function validateResearchRecord(record) {
  if (!record || typeof record !== 'object') {
    throw new Error('Research record must be an object');
  }

  // Required string fields
  const stringFields = [
    'researchId',
    'prospectId',
    'businessName',
    'website',
    'sourceType',
    'websiteSummary',
    'recommendedOutreachAngle',
    'createdAt',
    'updatedAt'
  ];

  for (const field of stringFields) {
    if (typeof record[field] !== 'string' || record[field].trim() === '') {
      throw new Error(`Field '${field}' must be a non-empty string`);
    }
  }

  // Specific researchId format check
  if (!record.researchId.startsWith('res_')) {
    throw new Error(`Field 'researchId' must start with 'res_' prefix`);
  }

  // googleMapsUri can be string or null
  if (record.googleMapsUri !== null && typeof record.googleMapsUri !== 'string') {
    throw new Error("Field 'googleMapsUri' must be a string or null");
  }

  // sourceType check
  if (!ALLOWED_SOURCE_TYPES.includes(record.sourceType)) {
    throw new Error(`Field 'sourceType' must be one of: ${ALLOWED_SOURCE_TYPES.join(', ')}`);
  }

  // Required array-of-strings fields
  const arrayFields = [
    'sourceUrls',
    'servicesDetected',
    'leadCaptureIssues',
    'trustSignals',
    'reviewThemes'
  ];

  for (const field of arrayFields) {
    if (!Array.isArray(record[field])) {
      throw new Error(`Field '${field}' must be an array`);
    }
    for (const val of record[field]) {
      if (typeof val !== 'string') {
        throw new Error(`Array field '${field}' must only contain strings`);
      }
    }
  }

  // confidence number check
  if (typeof record.confidence !== 'number' || isNaN(record.confidence) || record.confidence < 0.0 || record.confidence > 1.0) {
    throw new Error("Field 'confidence' must be a number between 0.0 and 1.0");
  }

  return true;
}

module.exports = {
  validateResearchRecord,
  ALLOWED_SOURCE_TYPES
};
