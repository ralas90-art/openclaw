const ruleBasedPlanner = require('./ruleBasedPlanner');

// Future: const llmPlanner = require('./llmPlanner');

const PLANNERS = {
  rule_based: ruleBasedPlanner,
  // llm: llmPlanner
};

function getPlanner(type = 'rule_based') {
  return PLANNERS[type];
}

function orchestrateAction(event, context, plannerType = 'rule_based') {
  const planner = getPlanner(plannerType);
  return planner.planExecution(event, context);
}

module.exports = { orchestrateAction };
