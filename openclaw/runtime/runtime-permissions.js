const config = require('./runtime-config');

/**
 * Command Permissions Risk Registry mapping all runtime commands
 * to risk tiers and security properties.
 */
const COMMAND_PERMISSIONS = {
  run_status: {
    commands: ['/run_status', '/runstatus'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'Inspect runtime status safely.'
  },
  run_latest: {
    commands: ['/run_latest', '/runlatest'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'Inspect details of the latest result.'
  },
  run_history: {
    commands: ['/run_history', '/runhistory'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'View recent execution history.'
  },
  run_metrics: {
    commands: ['/run_metrics', '/runmetrics'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'View execution and publishing metrics.'
  },
  run_errors: {
    commands: ['/run_errors', '/runerrors'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'view_errors',
    description: 'View recent sanitized runtime error logs.'
  },
  run_config: {
    commands: ['/run_config', '/runconfig'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'view_config',
    description: 'View safe runtime configuration.'
  },
  run_job: {
    commands: ['/run_job', '/runjob'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'Inspect one runtime job by ID.'
  },
  run_search: {
    commands: ['/run_search', '/runsearch'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'Search runtime jobs by keyword.'
  },
  run_by_bot: {
    commands: ['/run_by_bot', '/runbybot'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'View recent jobs for a specific approved bot.'
  },
  preset_list: {
    commands: ['/preset_list', '/presetlist'],
    tier: 'read_only',
    category: 'presets_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'Show available runtime presets.'
  },
  preset_info: {
    commands: ['/preset_info', '/presetinfo'],
    tier: 'read_only',
    category: 'presets_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'View detailed configuration for a preset.'
  },
  drive_latest: {
    commands: ['/drive_latest', '/drivelatest'],
    tier: 'read_only',
    category: 'drive_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'Show the latest published file info.'
  },
  run_permissions: {
    commands: ['/run_permissions', '/runpermissions'],
    tier: 'read_only',
    category: 'permissions_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'Shows runtime command permissions.'
  },
  run_roles: {
    commands: ['/run_roles', '/runroles'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'Shows safe role system summary.'
  },
  my_role: {
    commands: ['/my_role', '/myrole'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'Shows the current user\'s effective role and capabilities.'
  },
  run_bot: {
    commands: ['/run_bot', '/run', '/runtime_run'],
    tier: 'generate_only',
    category: 'runtime_generation',
    requiresAdmin: true,
    mutatesState: true,
    generatesOutput: true,
    publishesExternally: false,
    externalAction: false,
    capability: 'generate_runtime',
    description: 'Generate a runtime result plan using an approved bot.'
  },
  run_preset: {
    commands: ['/run_preset', '/runpreset'],
    tier: 'generate_only',
    category: 'presets_generation',
    requiresAdmin: true,
    mutatesState: true,
    generatesOutput: true,
    publishesExternally: false,
    externalAction: false,
    capability: 'generate_runtime',
    description: 'Generate a runtime result using a configured preset.'
  },
  run_publish: {
    commands: ['/run_publish', '/rp', '/run_bot_publish'],
    tier: 'publish',
    category: 'controlled_publishing',
    requiresAdmin: true,
    requiresApproval: true,
    mutatesState: true,
    generatesOutput: true,
    publishesExternally: true,
    externalAction: false,
    capability: 'request_publish',
    description: 'Run approved bot and publish generated file atomically.'
  },
  run_preset_publish: {
    commands: ['/run_preset_publish', '/runpresetpublish'],
    tier: 'publish',
    category: 'presets_publishing',
    requiresAdmin: true,
    requiresApproval: true,
    mutatesState: true,
    generatesOutput: true,
    publishesExternally: true,
    externalAction: false,
    capability: 'request_publish',
    description: 'Run preset bot and publish generated file atomically.'
  },
  drive_publish_pending: {
    commands: ['/drive_publish_pending', '/drivepublishpending'],
    tier: 'publish',
    category: 'drive_publishing',
    requiresAdmin: true,
    mutatesState: true,
    generatesOutput: false,
    publishesExternally: true,
    externalAction: false,
    capability: 'drive_publish',
    description: 'Publish pending output files manually.'
  },
  drive_publish_latest: {
    commands: ['/drive_publish_latest', '/drivepublishlatest'],
    tier: 'publish',
    category: 'drive_publishing',
    requiresAdmin: true,
    mutatesState: true,
    generatesOutput: false,
    publishesExternally: true,
    externalAction: false,
    capability: 'drive_publish',
    description: 'Publish the latest output file.'
  },
  drive_republish_latest: {
    commands: ['/drive_republish_latest', '/driverepublishlatest'],
    tier: 'publish',
    category: 'drive_publishing',
    requiresAdmin: true,
    requiresApproval: true,
    mutatesState: true,
    generatesOutput: false,
    publishesExternally: true,
    externalAction: false,
    capability: 'request_publish',
    description: 'Force republishing of the latest output file.'
  },
  drive_publish_file: {
    commands: ['/drive_publish_file', '/drivepublishfile'],
    tier: 'publish',
    category: 'drive_publishing',
    requiresAdmin: true,
    mutatesState: true,
    generatesOutput: false,
    publishesExternally: true,
    externalAction: false,
    capability: 'drive_publish',
    description: 'Publish a specific result file.'
  },
  drive_publish_campaign: {
    commands: ['/drive_publish_campaign', '/drivepublishcampaign'],
    tier: 'publish',
    category: 'drive_publishing',
    requiresAdmin: true,
    mutatesState: true,
    generatesOutput: false,
    publishesExternally: true,
    externalAction: false,
    capability: 'drive_publish',
    description: 'Publish a campaign folder.'
  },
  run_reindex: {
    commands: ['/run_reindex', '/runreindex'],
    tier: 'admin_maintenance',
    category: 'system_maintenance',
    requiresAdmin: true,
    mutatesState: true,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'admin_maintenance',
    description: 'Rebuild the job index from logs and results.'
  },
  approval_list: {
    commands: ['/approval_list', '/approvallist'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'approval_audit',
    description: 'Show pending runtime approvals.'
  },
  approval_info: {
    commands: ['/approval_info', '/approvalinfo'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'approval_audit',
    description: 'Show details of a pending runtime approval.'
  },
  approve_run: {
    commands: ['/approve_run', '/approverun'],
    tier: 'publish',
    category: 'controlled_publishing',
    requiresAdmin: true,
    mutatesState: true,
    generatesOutput: true,
    publishesExternally: true,
    externalAction: false,
    capability: 'approve_publish',
    description: 'Approve and execute a pending runtime approval.'
  },
  reject_run: {
    commands: ['/reject_run', '/rejectrun'],
    tier: 'publish',
    category: 'controlled_publishing',
    requiresAdmin: true,
    mutatesState: true,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'reject_approval',
    description: 'Reject a pending runtime approval.'
  },
  approval_history: {
    commands: ['/approval_history', '/approvalhistory'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'approval_audit',
    description: 'Show recent approval activity.'
  },
  approval_search: {
    commands: ['/approval_search', '/approvalsearch'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'approval_audit',
    description: 'Search approval records.'
  },
  approval_by_status: {
    commands: ['/approval_by_status', '/approvalbystatus'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'approval_audit',
    description: 'List approvals by status.'
  },
  approval_cleanup_expired: {
    commands: ['/approval_cleanup_expired', '/approvalcleanupexpired'],
    tier: 'admin_maintenance',
    category: 'system_maintenance',
    requiresAdmin: true,
    mutatesState: true,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'admin_maintenance',
    description: 'Clean up expired pending approvals.'
  },
  dryrun_types: {
    commands: ['/dryrun_types', '/dryruntypes'],
    tier: 'read_only',
    category: 'dryrun_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'dryrun_view',
    description: 'List supported dry-run action types.'
  },
  dryrun_history: {
    commands: ['/dryrun_history', '/dryrunhistory'],
    tier: 'read_only',
    category: 'dryrun_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'dryrun_view',
    description: 'Show history of recent dry-runs.'
  },
  dryrun_info: {
    commands: ['/dryrun_info', '/dryruninfo'],
    tier: 'read_only',
    category: 'dryrun_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'dryrun_view',
    description: 'Show details of a dry-run record.'
  },
  dryrun_action: {
    commands: ['/dryrun_action', '/dryrunaction'],
    tier: 'generate_only',
    category: 'dryrun_simulation',
    requiresAdmin: true,
    mutatesState: true,
    generatesOutput: true,
    publishesExternally: false,
    externalAction: false,
    capability: 'dryrun_create',
    description: 'Create a dry-run external action preview.'
  },
  dryrun_publish: {
    commands: ['/dryrun_publish', '/dryrunpublish'],
    tier: 'publish',
    category: 'dryrun_simulation',
    requiresAdmin: true,
    requiresApproval: true,
    mutatesState: true,
    generatesOutput: true,
    publishesExternally: true,
    externalAction: false,
    capability: 'dryrun_publish_request',
    description: 'Create an approval-gated dry-run action preview.'
  },
  connector_list: {
    commands: ['/connector_list', '/connectorlist'],
    tier: 'read_only',
    category: 'connector_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'List future external action connectors in dry-run-only mode.'
  },
  connector_info: {
    commands: ['/connector_info', '/connectorinfo'],
    tier: 'read_only',
    category: 'connector_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'Show metadata for a specific connector.'
  },
  connector_validate: {
    commands: ['/connector_validate', '/connectorvalidate'],
    tier: 'read_only',
    category: 'connector_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'view_config',
    description: 'Check required environment variables presence for a connector.'
  },
  jarvis_brief: {
    commands: ['/jarvis_brief'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'Inspect live daily briefs.'
  },
  jarvis_yesterday: {
    commands: ['/jarvis_yesterday'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'View completed work log from yesterday.'
  },
  jarvis_project: {
    commands: ['/jarvis_project'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'Show project memory status cards.'
  },
  jarvis_next: {
    commands: ['/jarvis_next'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'List pending recommended actions.'
  },
  jarvis_mobile_inbox: {
    commands: ['/jarvis_mobile_inbox'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'Show recent mobile uploads.'
  },
  jarvis_mark_processed: {
    commands: ['/jarvis_mark_processed'],
    tier: 'state_mutation',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: true,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'Mark a mobile upload as processed.'
  },
  jarvis_process_inbox: {
    commands: ['/jarvis_process_inbox'],
    tier: 'state_mutation',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: true,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'Assign a mobile upload to a project and mark it as processed.'
  },
  jarvis_process_latest: {
    commands: ['/jarvis_process_latest'],
    tier: 'state_mutation',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: true,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'Triage the most recent unprocessed mobile upload directly to a project.'
  },
  jarvis_archive_processed: {
    commands: ['/jarvis_archive_processed'],
    tier: 'admin_maintenance',
    category: 'system_maintenance',
    requiresAdmin: true,
    mutatesState: true,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'admin_maintenance',
    description: 'Archive all processed mobile uploads.'
  },
  jarvis_folders: {
    commands: ['/jarvis_folders'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'List all registered local folders.'
  },
  jarvis_add_folder: {
    commands: ['/jarvis_add_folder'],
    tier: 'state_mutation',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: true,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'Register a local folder (pending approval).'
  },
  jarvis_approve_folder: {
    commands: ['/jarvis_approve_folder'],
    tier: 'admin_maintenance',
    category: 'system_maintenance',
    requiresAdmin: true,
    mutatesState: true,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'admin_maintenance',
    description: 'Approve a registered folder path.'
  },
  jarvis_scan: {
    commands: ['/jarvis_scan'],
    tier: 'state_mutation',
    category: 'system_maintenance',
    requiresAdmin: true,
    mutatesState: true,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'admin_maintenance',
    description: 'Read-only filesystem scan + Supabase index mutation. Writes index records but does not modify local files.'
  },
  jarvis_files: {
    commands: ['/jarvis_files'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'List indexed local files and mapping suggestions.'
  },
  jarvis_connectors: {
    commands: ['/jarvis_connectors'],
    tier: 'read_only',
    category: 'connector_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'List registered connectors and their authorization status.'
  },
  jarvis_email_summary: {
    commands: ['/jarvis_email_summary'],
    tier: 'read_only',
    category: 'connector_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'List unread important emails from Gmail.'
  },
  jarvis_drive_recent: {
    commands: ['/jarvis_drive_recent'],
    tier: 'read_only',
    category: 'connector_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'List recently modified files from Google Drive.'
  },
  jarvis_reconnect_google: {
    commands: ['/jarvis_reconnect_google'],
    tier: 'read_only',
    category: 'connector_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'Get secure reconnect URL for Gmail or Google Drive connectors.'
  },
  jarvis_priorities: {
    commands: ['/jarvis_priorities'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'List top priorities for today.'
  },
  jarvis_followups: {
    commands: ['/jarvis_followups'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'List client and project follow-ups.'
  },
  jarvis_blockers: {
    commands: ['/jarvis_blockers'],
    tier: 'read_only',
    category: 'runtime_visibility',
    requiresAdmin: true,
    mutatesState: false,
    generatesOutput: false,
    publishesExternally: false,
    externalAction: false,
    capability: 'read_runtime',
    description: 'List active and stale blockers.'
  }
};

/**
 * Normalizes any command trigger or key into its canonical command key.
 * E.g. '/rp' -> 'run_publish', '/runpermissions' -> 'run_permissions'.
 * If the command is unrecognized, returns the command string normalized to lowercase without slash as fallback.
 * @param {string} commandText
 * @returns {string}
 */
function normalizeCommand(commandText) {
  if (!commandText) return 'unknown';
  const cleanCmd = commandText.trim().split(/\s+/)[0].toLowerCase();
  const cleanKey = cleanCmd.startsWith('/') ? cleanCmd.substring(1) : cleanCmd;

  // Exact mappings from aliases to canonical keys
  const aliasMap = {
    'runstatus': 'run_status',
    'runlatest': 'run_latest',
    'runhistory': 'run_history',
    'runmetrics': 'run_metrics',
    'runerrors': 'run_errors',
    'runconfig': 'run_config',
    'runjob': 'run_job',
    'runsearch': 'run_search',
    'runbybot': 'run_by_bot',
    'presetlist': 'preset_list',
    'presetinfo': 'preset_info',
    'drivelatest': 'drive_latest',
    'runpermissions': 'run_permissions',
    'runroles': 'run_roles',
    'myrole': 'my_role',
    'run': 'run_bot',
    'runtime_run': 'run_bot',
    'runpreset': 'run_preset',
    'rp': 'run_publish',
    'run_bot_publish': 'run_publish',
    'runpresetpublish': 'run_preset_publish',
    'drivepublishpending': 'drive_publish_pending',
    'drivepublishlatest': 'drive_publish_latest',
    'driverepublishlatest': 'drive_republish_latest',
    'drivepublishfile': 'drive_publish_file',
    'drivepublishcampaign': 'drive_publish_campaign',
    'runreindex': 'run_reindex',
    'approvallist': 'approval_list',
    'approvalinfo': 'approval_info',
    'approverun': 'approve_run',
    'rejectrun': 'reject_run',
    'approvalhistory': 'approval_history',
    'approvalsearch': 'approval_search',
    'approvalbystatus': 'approval_by_status',
    'approvalcleanupexpired': 'approval_cleanup_expired',
    'dryrunaction': 'dryrun_action',
    'dryrunpublish': 'dryrun_publish',
    'dryruninfo': 'dryrun_info',
    'dryrunhistory': 'dryrun_history',
    'dryruntypes': 'dryrun_types',
    'connectorlist': 'connector_list',
    'connectorinfo': 'connector_info',
    'connectorvalidate': 'connector_validate',
    'jarvisbrief': 'jarvis_brief',
    'jarvisyesterday': 'jarvis_yesterday',
    'jarvisproject': 'jarvis_project',
    'jarvisnext': 'jarvis_next',
    'jarvismobileinbox': 'jarvis_mobile_inbox',
    'jarvismarkprocessed': 'jarvis_mark_processed',
    'jarvisprocessinbox': 'jarvis_process_inbox',
    'jarvisprocesslatest': 'jarvis_process_latest',
    'jarvisarchiveprocessed': 'jarvis_archive_processed',
    'jarvisfolders': 'jarvis_folders',
    'jarvisaddfolder': 'jarvis_add_folder',
    'jarvisapprovefolder': 'jarvis_approve_folder',
    'jarvisscan': 'jarvis_scan',
    'jarvisfiles': 'jarvis_files',
    'jarvisconnectors': 'jarvis_connectors',
    'jarvisemailsummary': 'jarvis_email_summary',
    'jarvisdriverecent': 'jarvis_drive_recent',
    'jarvisreconnectgoogle': 'jarvis_reconnect_google',
    'jarvispriorities': 'jarvis_priorities',
    'jarvisfollowups': 'jarvis_followups',
    'jarvisblockers': 'jarvis_blockers'
  };

  if (COMMAND_PERMISSIONS[cleanKey]) {
    return cleanKey;
  }
  if (aliasMap[cleanKey]) {
    return aliasMap[cleanKey];
  }
  return cleanKey;
}

function findPermissionConfig(commandText) {
  const canonicalKey = normalizeCommand(commandText);
  if (COMMAND_PERMISSIONS[canonicalKey]) {
    return { key: canonicalKey, ...COMMAND_PERMISSIONS[canonicalKey] };
  }
  return null;
}

/**
 * Returns command risk level tier.
 * @param {string} command
 * @returns {string|null}
 */
function getCommandRiskLevel(command) {
  const perm = findPermissionConfig(command);
  return perm ? perm.tier : null;
}

/**
 * Returns command configuration details.
 * @param {string} command
 * @returns {object|null}
 */
function getCommandPermission(command) {
  const perm = findPermissionConfig(command);
  return perm || null;
}

/**
 * Returns list of all command configurations.
 * @returns {object[]}
 */
function listCommandPermissions() {
  return Object.entries(COMMAND_PERMISSIONS).map(([key, config]) => ({
    key,
    ...config
  }));
}

/**
 * Checks if the given command string is registered in permissions.
 * @param {string} command
 * @returns {boolean}
 */
function isRuntimeCommand(command) {
  return findPermissionConfig(command) !== null;
}

/**
 * Returns whether a command is authorized for a chat. Fail closed if not matched.
 * @param {string} command
 * @param {object|string|number} messageOrChatId
 * @returns {boolean}
 */
function isCommandAllowed(command, messageOrChatId) {
  try {
    let chatIdStr = '';
    if (messageOrChatId && typeof messageOrChatId === 'object') {
      chatIdStr = messageOrChatId.chat?.id ? String(messageOrChatId.chat.id).trim() : 'unknown';
    } else if (messageOrChatId !== undefined && messageOrChatId !== null) {
      chatIdStr = String(messageOrChatId).trim();
    } else {
      chatIdStr = 'unknown';
    }

    const perm = findPermissionConfig(command);
    if (!perm) {
      // Unrecognized commands fail closed
      return false;
    }

    // Load roles system
    const roles = require('./runtime-roles');

    // super_admin always overrides and has access to all registered commands
    if (roles.hasRole(chatIdStr, 'super_admin')) {
      return true;
    }

    // Check capabilities
    const userCaps = roles.getEffectiveCapabilities(chatIdStr);
    if (perm.capability && userCaps.has(perm.capability)) {
      return true;
    }

    return false;
  } catch (err) {
    // Fail closed on error
    return false;
  }
}

/**
 * Evaluates permission check and returns structured details.
 * @param {string} command
 * @param {object|string|number} messageOrChatId
 * @returns {{ allowed: boolean, reason: string|null, config: object|null }}
 */
function requireCommandPermission(command, messageOrChatId) {
  const perm = findPermissionConfig(command);
  if (!perm) {
    return {
      allowed: false,
      reason: 'unknown_command',
      config: null
    };
  }

  const allowed = isCommandAllowed(command, messageOrChatId);
  if (!allowed) {
    return {
      allowed: false,
      reason: 'unauthorized',
      config: perm
    };
  }

  return {
    allowed: true,
    reason: null,
    config: perm
  };
}

/**
 * Formats Telegram warning text for blocked requests.
 * Enforces exact formatting to prevent regression test breaks.
 */
function formatPermissionDenied(command, reason, messageOrChatId) {
  const cleanCmd = command.trim().split(/\s+/)[0];
  let chatIdStr = '';
  if (messageOrChatId && typeof messageOrChatId === 'object') {
    chatIdStr = messageOrChatId.chat?.id ? String(messageOrChatId.chat.id).trim() : 'unknown';
  } else if (messageOrChatId !== undefined && messageOrChatId !== null) {
    chatIdStr = String(messageOrChatId).trim();
  } else {
    chatIdStr = 'unknown';
  }

  if (cleanCmd === '/run_status' || cleanCmd === '/runstatus') {
    return `❌ Access Denied: You are not authorized to inspect runtime state (Your Chat ID: ${chatIdStr}).`;
  }
  if (cleanCmd === '/run_publish' || cleanCmd === '/rp' || cleanCmd === '/run_bot_publish') {
    return `❌ Access Denied: You are not authorized to use /run_publish (Your Chat ID: ${chatIdStr}).`;
  }
  if (cleanCmd === '/run_bot' || cleanCmd === '/run' || cleanCmd === '/runtime_run') {
    return `❌ Access Denied: You are not authorized to execute runtime bots (Your Chat ID: ${chatIdStr}).`;
  }
  if (cleanCmd === '/run_reindex' || cleanCmd === '/runreindex') {
    return `❌ Access Denied: You are not authorized to rebuild the job index (Your Chat ID: ${chatIdStr}).`;
  }
  if (cleanCmd === '/run_metrics' || cleanCmd === '/runmetrics') {
    return `❌ Access Denied: You are not authorized to view runtime metrics (Your Chat ID: ${chatIdStr}).`;
  }
  if (cleanCmd === '/run_errors' || cleanCmd === '/runerrors') {
    return `❌ Access Denied: You are not authorized to view runtime error logs (Your Chat ID: ${chatIdStr}).`;
  }
  if (cleanCmd === '/run_config' || cleanCmd === '/runconfig') {
    return `❌ Access Denied: You are not authorized to view runtime configuration (Your Chat ID: ${chatIdStr}).`;
  }

  return `❌ Access Denied: You are not authorized to use ${cleanCmd} (Your Chat ID: ${chatIdStr}).`;
}

/**
 * Returns safe permission systems status for Telegram displays.
 */
function getPermissionSummary() {
  const tiers = {
    read_only: [],
    generate_only: [],
    publish: [],
    admin_maintenance: [],
    external_action: [],
    state_mutation: []
  };

  for (const [key, config] of Object.entries(COMMAND_PERMISSIONS)) {
    const tier = config.tier;
    const primaryCmd = config.commands[0];
    const suffix = config.requiresApproval ? ' (gated)' : '';
    const capInfo = config.capability ? ` [${config.capability}]` : '';
    if (tiers[tier]) {
      tiers[tier].push(`${primaryCmd}${suffix}${capInfo}`);
    }
  }

  return [
    `🛡️ *OpenClaw Command Permissions*`,
    ``,
    `Permission system status: Enabled`,
    `Access model: Admin-only`,
    ``,
    `*Tier Summary:*`,
    `• *Read Only:*`,
    `  ` + (tiers.read_only.join(', ') || 'None'),
    `• *State Mutation:*`,
    `  ` + (tiers.state_mutation.join(', ') || 'None'),
    `• *Generate Only:*`,
    `  ` + (tiers.generate_only.join(', ') || 'None'),
    `• *Publish:*`,
    `  ` + (tiers.publish.join(', ') || 'None'),
    `• *Admin Maintenance:*`,
    `  ` + (tiers.admin_maintenance.join(', ') || 'None'),
    `• *External Action Reserved:*`,
    `  ` + (tiers.external_action.join(', ') || 'None'),
    ``,
    `*Note:* No external-action commands are enabled in this version.`
  ].join('\n');
}

module.exports = {
  normalizeCommand,
  getCommandRiskLevel,
  getCommandPermission,
  listCommandPermissions,
  isRuntimeCommand,
  isCommandAllowed,
  requireCommandPermission,
  formatPermissionDenied,
  getPermissionSummary
};
