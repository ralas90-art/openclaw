/**
 * Telegram Alert Formatter
 * Generates structured HTML messages for Telegram alerts.
 */

function formatOutreachRecommended(tenantId, leadId, strategy) {
  return `
🚀 <b>New Outreach Recommended</b>
---------------------------
<b>Tenant:</b> <code>${tenantId}</code>
<b>Lead ID:</b> <code>${leadId}</code>

🎯 <b>Priority:</b> ${strategy.priority.toUpperCase()}
⏰ <b>Response Window:</b> ${strategy.recommended_response_time_minutes} mins
📢 <b>Strategy:</b> ${strategy.outreach_strategy}
🛠️ <b>Next Step:</b> ${strategy.next_step}

<a href="https://cresca.os/leads/${leadId}">View Lead in Dashboard</a>
  `.trim();
}

function formatHighValueLead(tenantId, leadId, score, grade) {
  return `
🔥 <b>HIGH VALUE LEAD DETECTED</b>
---------------------------
<b>Tenant:</b> <code>${tenantId}</code>
<b>Lead ID:</b> <code>${leadId}</code>

📊 <b>AI Score:</b> ${score}/100
🏆 <b>Grade:</b> ${grade}

<b>Action Required:</b> This lead meets high-value criteria. Prioritize immediate engagement.
  `.trim();
}

function formatFollowupRequired(tenantId, leadId, dueInMinutes) {
  return `
⏳ <b>Follow-up Required</b>
---------------------------
<b>Lead ID:</b> <code>${leadId}</code>
<b>Due In:</b> ${dueInMinutes} minutes

System is tracking response time for SLA compliance.
  `.trim();
}

module.exports = {
  formatOutreachRecommended,
  formatHighValueLead,
  formatFollowupRequired
};
