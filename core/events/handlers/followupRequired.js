const { sendMessage } = require('../../../integrations/telegram/client');
const { formatFollowupRequired } = require('../../../integrations/telegram/formatter');
const { logEvent } = require('../index');

/**
 * Handler for followup.required
 * Sends a Telegram alert when a lead needs attention.
 */
module.exports = async (event) => {
  const { tenant_id, lead_id, payload } = event;
  const { due_in_minutes } = payload;

  console.log(`[HANDLER] followup.required: Sending alert for lead ${lead_id}`);

  const message = formatFollowupRequired(tenant_id, lead_id, due_in_minutes);
  const result = await sendMessage(message);

  await logEvent(tenant_id, 'telegram.alert_sent', 'followupRequired', result.success ? 'success' : 'failed', {
    lead_id,
    message_type: 'followup.required',
    error: result.error
  });

  return result;
};
