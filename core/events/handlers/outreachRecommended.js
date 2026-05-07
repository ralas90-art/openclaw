const { sendMessage } = require('../../../integrations/telegram/client');
const { formatOutreachRecommended } = require('../../../integrations/telegram/formatter');
const { logEvent } = require('../index');

/**
 * Handler for outreach.recommended
 * Sends a Telegram alert to the operator.
 */
module.exports = async (event) => {
  const { tenant_id, lead_id, payload } = event;
  const { strategy } = payload;

  console.log(`[HANDLER] outreach.recommended: Sending alert for lead ${lead_id}`);

  const message = formatOutreachRecommended(tenant_id, lead_id, strategy);
  const result = await sendMessage(message);

  await logEvent(tenant_id, 'telegram.alert_sent', 'outreachRecommended', result.success ? 'success' : 'failed', {
    lead_id,
    message_type: 'outreach.recommended',
    error: result.error
  });

  return result;
};
