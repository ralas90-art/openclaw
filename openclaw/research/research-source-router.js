/**
 * OpenClaw Research Source Adapter Router
 */

const prospectStore = require('../prospects/prospect-store');
const researchStore = require('./prospect-research-store');
const websiteResearchAdapter = require('./website-research-adapter');

const ADAPTER_REGISTRY = {
  website: websiteResearchAdapter,
  agent_reach: null,
  youtube: null,
  reddit: null,
  github: null,
  x: null,
  clay: null
};

async function enrichProspect(prospectId, options = {}) {
  const prospects = prospectStore.loadProspects();
  const prospect = prospects.find(p => p.prospectId === prospectId);
  
  if (!prospect) {
    throw new Error(`Prospect with ID '${prospectId}' not found`);
  }

  const sourceType = options.sourceType || 'website';
  const adapter = ADAPTER_REGISTRY[sourceType];

  if (adapter === undefined) {
    throw new Error(`Unsupported research source type: '${sourceType}'`);
  }

  if (adapter === null) {
    throw new Error(`Research source type '${sourceType}' is currently disabled.`);
  }

  let websiteUrl = prospect.website;
  if (sourceType === 'website' && (!websiteUrl || websiteUrl.trim() === '')) {
    throw new Error(`Prospect '${prospect.businessName}' does not have a website configured for research`);
  }

  // Execute routed adapter
  const result = await adapter.researchWebsite(
    prospectId,
    websiteUrl,
    prospect.businessName,
    {
      googleMapsUri: prospect.googleMapsUri || null,
      ...options
    }
  );

  // Validate and save the resulting record
  researchStore.saveResearchRecord(result);

  return result;
}

module.exports = {
  enrichProspect,
  ADAPTER_REGISTRY
};
