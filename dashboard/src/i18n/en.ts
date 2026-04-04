const en = {
  // Sidebar
  appName: "Nova Orbit",
  appSubtitle: "AI Team Orchestration",
  projects: "Projects",
  newProject: "+ New Project",
  importLocal: "Import Local",
  connectGitHub: "Connect GitHub",

  // ProjectHome tabs
  tabOverview: "Overview",
  tabKanban: "Kanban",
  tabVerification: "Verification Log",
  tabSettings: "Settings",

  // ProjectHome sections
  agents: "Agents",
  addAgent: "+ Add Agent",
  goals: "Goals",
  addGoal: "+ Add Goal",
  tasks: "Tasks",
  decompose: "Decompose",
  addTask: "+ Task",
  noMission: "No mission — click to add",
  edit: "Edit",
  noProject: "Select or create a project to get started",
  loading: "Loading...",

  // AgentCard roles
  roleCoder: "coder",
  roleReviewer: "reviewer",
  roleMarketer: "marketer",
  roleDesigner: "designer",
  roleQa: "qa",

  // AgentCard status
  statusIdle: "idle",
  statusWorking: "working",
  statusWaitingApproval: "waiting approval",
  statusPaused: "paused",
  statusTerminated: "terminated",
  stopAgent: "Stop",

  // TaskList status labels
  statusTodo: "Todo",
  statusInProgress: "In Progress",
  statusInReview: "In Review",
  statusDone: "Done",
  statusBlocked: "Blocked",

  run: "Run",
  running: "Running...",
  thinking: "Thinking...",
  taskRunning: "Running... {{seconds}}s",
  taskCompleted: "Task completed",
  verificationPassed: "Verification: PASS",
  verificationFailed: "Verification: FAIL",
  agentOutput: "Agent Output",
  collapsePanel: "Collapse",
  expandPanel: "Expand",
  assign: "assign",
  verified: "verified",
  noTasks: "No tasks yet.",

  // KanbanBoard
  dropHere: "Drop here",

  // VerificationLog
  verdictPass: "PASS",
  verdictConditional: "CONDITIONAL",
  verdictFail: "FAIL",
  dimensionScore: "5-Dimension Score",
  issues: "Issues",
  dimFunctionality: "Functionality",
  dimDataFlow: "Data Flow",
  dimDesignAlignment: "Design",
  dimCraft: "Craft",
  dimEdgeCases: "Edge Cases",

  // AddAgentDialog
  addAgentTitle: "Add Agent",
  addAgentSubtitle: "Choose a role preset or create custom",
  customAgentPlaceholder: "Custom agent name...",
  create: "Create",
  cancel: "Cancel",

  // ActivityFeed
  noActivity: "No activity yet. Activity will appear here when agents run tasks.",
  loadingActivity: "Loading activity...",

  // ThemeToggle
  switchToDark: "Switch to dark mode",
  switchToLight: "Switch to light mode",

  // App connection status
  connected: "Connected",
  disconnected: "Disconnected",

  // CommandPalette
  cmdPlaceholder: "Type a command...",
  cmdNewProject: "New Project",
  cmdImportLocal: "Import Local Project",
  cmdConnectGitHub: "Connect GitHub",
  cmdAddAgent: "Add Agent",
  cmdAddGoal: "Add Goal",
  cmdSwitchToDark: "Switch to Dark Mode",
  cmdSwitchToLight: "Switch to Light Mode",
  cmdSwitchLang: "Switch Language (EN/KO)",
  cmdGoKanban: "Go to Kanban",
  cmdGoVerification: "Go to Verification Log",
  cmdGoSettings: "Go to Settings",
  cmdNoResults: "No results",

  // AgentTerminal
  terminalTitle: "Live Output",
  terminalClear: "Clear",
  terminalWaiting: "Waiting for output...",

  // Prompt dialogs
  promptProjectName: "Project Name",
  promptProjectNameHint: "Enter project name...",
  promptWorkdir: "Working Directory",
  promptWorkdirHint: "e.g., ~/projects/my-app",
  promptWorkdirDesc: "The directory where agents will write code. Must exist on disk.",
  promptMission: "Mission (optional)",
  promptMissionHint: "What are you building?",
  promptLocalPath: "Local Path",
  promptLocalPathHint: "e.g., ~/projects/my-app",
  promptGitHubUrl: "GitHub URL",
  promptGitHubUrlHint: "e.g., user/my-app or full URL",
  promptGoalDesc: "Goal Description",
  promptGoalDescHint: "What do you want to achieve?",
  promptTaskTitle: "Task Title",
  promptTaskTitleHint: "What needs to be done?",
  promptAssignAgent: "Assign Agent",
  promptAssignAgentHint: "Agent name or ID prefix...",
  confirmKillAgent: "Kill this agent session?",
  confirm: "Confirm",
  recentActivity: "Recent Activity",

  // Error / status messages (inline)
  errorImportFailed: "Import failed",
  errorGitHubFailed: "GitHub connect failed",
  errorAgentNotFound: "Agent not found",
  errorDecomposeFailed: "Failed to decompose goal",
  errorSaveMissionFailed: "Failed to save mission",
  errorSaveSettingFailed: "Failed to save setting",
  errorDeleteFailed: "Failed to delete project",

  // ProjectSettings hardcoded strings
  settingsMission: "Mission",
  settingsProjectInfo: "Project Info",
  settingsWorkDirectory: "Work Directory",
  settingsSourceType: "Source Type",
  settingsGitHub: "GitHub",
  settingsRepository: "Repository",
  settingsBranch: "Branch",
  settingsAutoPush: "Auto Push",
  settingsPrMode: "PR Mode",
  settingsDangerZone: "Danger Zone",
  settingsDeleteProject: "Delete Project",
  settingsDeleteDesc: "Permanently remove this project and all associated data.",
  settingsDeleteConfirm: "Are you sure? This action cannot be undone.",
  settingsDelete: "Delete",
  settingsYesDelete: "Yes, delete",
  settingsDeleting: "Deleting...",
  settingsSave: "Save",
  settingsSaving: "Saving...",
  settingsNoMission: "No mission set",
  settingsEdit: "Edit",
  settingsCancel: "Cancel",
  settingsSourceNew: "New",
  settingsSourceLocalImport: "Local Import",
  settingsSourceGitHub: "GitHub",

  // AgentDetail hardcoded strings
  agentDetailSessionInfo: "Session Info",
  agentDetailStatus: "Status",
  agentDetailSessionId: "Session ID",
  agentDetailCurrentTask: "Current Task",
  agentDetailSystemPrompt: "System Prompt",
  agentDetailVerificationStats: "Verification Stats",
  agentDetailVerified: "Verified",
  agentDetailBlocked: "Blocked",
  agentDetailTotal: "Total",
  agentDetailTaskHistory: "Task History",
  agentDetailNoTasks: "No tasks assigned yet.",
  agentDetailKillSession: "Kill Session",

  // ProjectHome hardcoded strings
  noAgents: "No agents yet. Add one to get started.",
  projectMissionPlaceholder: "Project mission...",
  savingLabel: "Saving\u2026",
  saveLabel: "Save",
  cancelLabel: "Cancel",
  clickToEdit: "Click to edit",
} as const;

export default en;
