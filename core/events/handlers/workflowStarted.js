module.exports = async (event) => {
  console.log(`[HANDLER] workflow.started triggered for tenant ${event.tenant_id}`);
  return { success: true };
};
