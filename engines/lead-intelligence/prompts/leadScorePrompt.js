/**
 * Lead Score Prompt Template (Placeholder for V2 AI Scoring)
 */

module.exports = (lead) => `
Analyze the following lead for a home service business:
Business Name: ${lead.business_name || 'N/A'}
Contact: ${lead.contact_name || 'N/A'}
Phone: ${lead.phone || 'N/A'}
Service: ${lead.service_type || 'N/A'}
Notes: ${lead.notes || 'N/A'}

Assign a score from 0-100 based on conversion likelihood.
Return a JSON object with: score, grade, recommendation, outreach_angle.
`;
