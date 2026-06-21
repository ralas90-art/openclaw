/**
 * OpenClaw Prospect Validation Schema
 */

function validateProspect(prospect) {
  if (!prospect || typeof prospect !== 'object') {
    throw new Error('Prospect must be an object');
  }

  const requiredStringFields = ['placeId', 'name', 'formattedAddress', 'query', 'discoveredAt'];
  for (const field of requiredStringFields) {
    if (!prospect[field] || typeof prospect[field] !== 'string') {
      throw new Error(`Field '${field}' is required and must be a string`);
    }
  }

  // Latitude and Longitude are required numbers
  const requiredNumFields = ['latitude', 'longitude'];
  for (const field of requiredNumFields) {
    if (prospect[field] === undefined || typeof prospect[field] !== 'number' || isNaN(prospect[field])) {
      throw new Error(`Field '${field}' is required and must be a valid number`);
    }
  }

  // Optional string fields
  const optionalStrings = ['phoneNumber', 'website'];
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

  // Optional array of types
  if (prospect.types !== undefined && !Array.isArray(prospect.types)) {
    throw new Error(`Optional field 'types' must be an array`);
  }

  return true;
}

module.exports = {
  validateProspect
};
