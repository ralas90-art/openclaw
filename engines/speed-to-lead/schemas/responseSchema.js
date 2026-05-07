/**
 * Speed-to-Lead Response Schema
 * Standardized structure for operational outreach recommendations.
 */

const responseSchema = {
  priority: 'low', // low, medium, high, critical
  recommended_response_time_minutes: 60,
  outreach_strategy: '', // sms_first, call_first, email_drip
  qualification_path: '', // lead_capture, appointment_booking
  next_step: ''
};

module.exports = { responseSchema };
