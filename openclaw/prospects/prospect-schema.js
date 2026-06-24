/**
 * OpenClaw Prospect Validation Schema (P1 Refined)
 */

function validateProspect(prospect) {
  if (!prospect || typeof prospect !== 'object') {
    throw new Error('Prospect must be an object');
  }

  // Required String Fields
  const requiredStringFields = [
    'prospectId',
    'businessName',
    'formattedAddress',
    'town',
    'region',
    'category',
    'googleMapsUri',
    'query',
    'fieldProfile',
    'source',
    'discoveredAt',
    'updatedAt'
  ];
  for (const field of requiredStringFields) {
    if (!prospect[field] || typeof prospect[field] !== 'string') {
      throw new Error(`Field '${field}' is required and must be a string`);
    }
  }

  // Validate allowed source values
  if (prospect.source !== 'google_places' && prospect.source !== 'mock') {
    throw new Error("Field 'source' must be 'google_places' or 'mock'");
  }

  // Validate allowed field profile values
  if (prospect.fieldProfile !== 'BASIC_DISCOVERY' && prospect.fieldProfile !== 'ENRICHED_DISCOVERY') {
    throw new Error("Field 'fieldProfile' must be 'BASIC_DISCOVERY' or 'ENRICHED_DISCOVERY'");
  }

  // Required Number Fields
  const requiredNumFields = ['latitude', 'longitude', 'confidence'];
  for (const field of requiredNumFields) {
    if (prospect[field] === undefined || typeof prospect[field] !== 'number' || isNaN(prospect[field])) {
      throw new Error(`Field '${field}' is required and must be a valid number`);
    }
  }

  // placeId is required if source is google_places, optional/string in mock mode
  if (prospect.source === 'google_places') {
    if (!prospect.placeId || typeof prospect.placeId !== 'string') {
      throw new Error("Field 'placeId' is required when source is 'google_places'");
    }
  } else {
    if (prospect.placeId !== undefined && typeof prospect.placeId !== 'string') {
      throw new Error("Field 'placeId' must be a string if provided");
    }
  }

  // Optional string fields
  const optionalStrings = ['phoneNumber', 'website', 'hermesJobId'];
  for (const field of optionalStrings) {
    if (prospect[field] !== undefined && typeof prospect[field] !== 'string') {
      throw new Error(`Optional field '${field}' must be a string`);
    }
  }

  // Optional number fields
  const optionalNums = ['rating', 'userRatingCount'];
  for (const field of optionalNums) {
    if (prospect[field] !== undefined && typeof prospect[field] !== 'number') {
      throw new Error(`Optional field '${field}' must be a number`);
    }
  }

  // metadata must be an object if provided
  if (prospect.metadata !== undefined && (typeof prospect.metadata !== 'object' || prospect.metadata === null)) {
    throw new Error("Optional field 'metadata' must be a valid object");
  }

  return true;
}

module.exports = {
  validateProspect
};
