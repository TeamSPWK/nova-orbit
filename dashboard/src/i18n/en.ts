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
} as const;

export default en;
