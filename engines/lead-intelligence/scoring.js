/**
 * Lead Scoring Logic V1 (Deterministic)
 * Generates a lead score based on available data and simple heuristics.
 */

function generateScore(lead) {
  let score = 50; // Starting base score
  const flags = [];

  // 1. Contact Info Quality (+30)
  if (lead.phone) {
    score += 15;
  } else {
    flags.push('missing_phone');
  }

  if (lead.email) {
    score += 15;
  } else {
    flags.push('missing_email');
  }

  // 2. Location Clarity (+10)
  if (lead.city || lead.state) {
    score += 10;
  } else {
    flags.push('low_location_clarity');
  }

  // 3. Service Type (+10)
  const serviceType = lead.service_type || lead.metadata?.service_type;
  if (serviceType && serviceType !== 'general') {
    score += 10;
  }

  // 4. Urgency Detection (+20)
  const urgencyKeywords = ['emergency', 'leaking', 'broken', 'immediate', 'asap', 'stat', 'now'];
  const content = `${lead.notes || ''} ${lead.message || ''} ${lead.metadata?.notes || ''} ${lead.metadata?.message || ''}`.toLowerCase();
  
  const hasUrgency = urgencyKeywords.some(keyword => content.includes(keyword));
  if (hasUrgency) {
    score += 20;
    flags.push('high_urgency');
  }

  // Cap score at 100
  score = Math.min(score, 100);

  // Determine Grade
  let grade = 'C';
  if (score >= 90) grade = 'A';
  else if (score >= 75) grade = 'B';
  else if (score < 50) grade = 'D';

  // Recommendation
  let recommendation = 'Standard follow-up.';
  if (grade === 'A') recommendation = '🔥 HOT LEAD: Call within 5 minutes!';
  else if (grade === 'B') recommendation = 'Solid prospect. Outreach within 1 hour.';

  return {
    score,
    grade,
    recommendation,
    flags,
    outreach_angle: generateOutreachAngle(lead, grade)
  };
}

function generateOutreachAngle(lead, grade) {
  const service = lead.service_type || lead.metadata?.service_type || 'service';
  if (grade === 'A') return `Focus on immediate response for ${service}.`;
  return `Introduce Cresca value proposition for ${service}.`;
}

module.exports = { generateScore };
