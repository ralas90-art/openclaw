const { sendMessage } = require('../../../integrations/telegram/client');
const { formatHighValueLead } = require('../../../integrations/telegram/formatter');
const { logEvent } = require('../index');

/**
 * Handler for high_value_lead
 * Sends an urgent Telegram alert for top-tier prospects.
 */
module.exports = async (event) => {
  const { tenant_id, lead_id, payload } = event;
  const { score, grade } = payload;

  console.log(`[HANDLER] high_value_lead: Sending priority alert for lead ${lead_id}`);

  const message = formatHighValueLead(tenant_id, lead_id, score, grade);
  const result = await sendMessage(message);

  await logEvent(tenant_id, 'telegram.alert_sent', 'highValueLead', result.success ? 'success' : 'failed', {
    lead_id,
    message_type: 'high_value_lead',
    error: result.error
  });

  return result;
};
