/**
 * Lead Schema (Source of Truth: Postgres)
 */
const LeadSchema = {
  id: 'uuid',
  tenant_id: 'uuid',
  name: 'string',
  niche: 'string',
  location: 'string',
  phone: 'string',
  website: 'string',
  address: 'string',
  rating: 'number',
  reviews: 'number',
  ai_score: 'number',
  ai_insight: 'text',
  outreach_angle: 'text',
  status: 'enum:New|Qualified|Contacted|Interested|Uninterested',
  source: 'string',
  metadata: 'jsonb',
  created_at: 'timestamp',
  updated_at: 'timestamp'
};

module.exports = LeadSchema;
