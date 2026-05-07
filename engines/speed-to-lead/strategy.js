/**
 * Speed-to-Lead Strategy Logic V1
 * Determines response priority and strategy based on lead intelligence.
 */

function determineStrategy(lead, intelligence) {
  const { grade, score } = intelligence;
  const isHighValue = grade === 'A' || score >= 85;
  const source = lead.source || 'unknown';
  
  // 1. Determine Priority
  let priority = 'low';
  let responseTime = 1440; // 24 hours default

  if (grade === 'A') {
    priority = 'critical';
    responseTime = 5;
  } else if (grade === 'B') {
    priority = 'high';
    responseTime = 30;
  } else if (grade === 'C') {
    priority = 'medium';
    responseTime = 120;
  }

  // 2. Select Outreach Strategy
  let strategy = 'email_drip';
  if (priority === 'critical' || priority === 'high') {
    strategy = 'sms_immediate_call_followup';
  } else if (priority === 'medium') {
    strategy = 'sms_delayed';
  }

  // 3. Select Qualification Path
  let path = 'general_nurture';
  if (isHighValue) {
    path = 'instant_booking';
  } else if (priority !== 'low') {
    path = 'form_completion';
  }

  return {
    priority,
    recommended_response_time_minutes: responseTime,
    outreach_strategy: strategy,
    qualification_path: path,
    next_step: priority === 'critical' ? 'Trigger Instant Notification' : 'Add to Outreach Queue'
  };
}

module.exports = { determineStrategy };
