module.exports = async (event) => {
  console.log(`[HANDLER] workflow.completed triggered for tenant ${event.tenant_id}`);
  return { success: true };
};
