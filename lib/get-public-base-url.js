/**
 * Centralized PUBLIC_URL normalization helper.
 * Returns a clean base URL (no trailing slash, protocol-validated).
 * Falls back to 'http://localhost:3300' if PUBLIC_URL is missing or invalid.
 */
function getPublicBaseUrl() {
  const raw = process.env.PUBLIC_URL || 'http://localhost:3300';
  let cleaned = raw.replace(/^["']|["']$/g, '').trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(cleaned);
    if (parsed.pathname !== '/' && parsed.pathname !== '') {
      console.error(`❌ [PUBLIC_URL] Rejected "${raw}" – contains path suffix: "${parsed.pathname}"`);
      return 'http://localhost:3300';
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      console.error(`❌ [PUBLIC_URL] Rejected "${raw}" – invalid protocol: "${parsed.protocol}"`);
      return 'http://localhost:3300';
    }
    return cleaned;
  } catch (err) {
    console.error(`❌ [PUBLIC_URL] Rejected "${raw}" – not a valid URL: ${err.message}`);
    return 'http://localhost:3300';
  }
}

module.exports = { getPublicBaseUrl };
