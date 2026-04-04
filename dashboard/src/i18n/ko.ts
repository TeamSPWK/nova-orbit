const ko = {
  // Sidebar
  appName: "Nova Orbit",
  appSubtitle: "AI 팀 오케스트레이션",
  projects: "프로젝트",
  newProject: "+ 새 프로젝트",
  importLocal: "로컬 가져오기",
  connectGitHub: "GitHub 연결",

  // ProjectHome tabs
  tabOverview: "개요",
  tabKanban: "칸반",
  tabVerification: "검증 로그",
  tabSettings: "설정",

  // ProjectHome sections
  agents: "에이전트",
  addAgent: "+ 에이전트 추가",
  goals: "목표",
  addGoal: "+ 목표 추가",
  tasks: "태스크",
  decompose: "분해",
  addTask: "+ 태스크",
  noMission: "미션 없음 — 클릭하여 추가",
  edit: "편집",
  noProject: "프로젝트를 선택하거나 새로 만드세요",
  loading: "로딩 중...",

  // AgentCard roles
  roleCoder: "코더",
  roleReviewer: "리뷰어",
  roleMarketer: "마케터",
  roleDesigner: "디자이너",
  roleQa: "QA",

  // AgentCard status
  statusIdle: "대기",
  statusWorking: "작업 중",
  statusWaitingApproval: "승인 대기",
  statusPaused: "일시정지",
  statusTerminated: "종료",
  stopAgent: "중지",

  // TaskList status labels
  statusTodo: "할 일",
  statusInProgress: "진행 중",
  statusInReview: "검토 중",
  statusDone: "완료",
  statusBlocked: "블록",

  run: "실행",
  running: "실행 중...",
  thinking: "생각 중...",
  taskRunning: "실행 중... {{seconds}}초",
  taskCompleted: "태스크 완료",
  verificationPassed: "검증: 통과",
  verificationFailed: "검증: 실패",
  agentOutput: "에이전트 출력",
  collapsePanel: "접기",
  expandPanel: "펼치기",
  approve: "승인",
  reject: "반려",
  rejectFeedbackPrompt: "반려 사유 (선택):",
  assign: "담당자 지정",
  verified: "검증됨",
  noTasks: "태스크가 없습니다.",

  // KanbanBoard
  dropHere: "여기에 놓기",

  // VerificationLog
  verdictPass: "통과",
  verdictConditional: "조건부",
  verdictFail: "실패",
  dimensionScore: "5차원 점수",
  issues: "이슈",
  dimFunctionality: "기능성",
  dimDataFlow: "데이터 흐름",
  dimDesignAlignment: "디자인",
  dimCraft: "완성도",
  dimEdgeCases: "엣지 케이스",

  // AddAgentDialog
  addAgentTitle: "에이전트 추가",
  addAgentSubtitle: "역할 프리셋 선택 또는 커스텀 생성",
  customAgentPlaceholder: "커스텀 에이전트 이름...",
  create: "생성",
  cancel: "취소",

  // ActivityFeed
  noActivity: "아직 활동이 없습니다. 에이전트가 태스크를 실행하면 여기에 표시됩니다.",
  loadingActivity: "활동 로딩 중...",

  // ThemeToggle
  switchToDark: "다크 모드로 전환",
  switchToLight: "라이트 모드로 전환",

  // App connection status
  connected: "연결됨",
  disconnected: "연결 끊김",
  serverDown: "서버가 응답하지 않습니다. 서버가 실행 중인지 확인해주세요 (npm run dev:server).",

  // CommandPalette
  cmdPlaceholder: "명령어를 입력하세요...",
  cmdNewProject: "새 프로젝트",
  cmdImportLocal: "로컬 프로젝트 가져오기",
  cmdConnectGitHub: "GitHub 연결",
  cmdAddAgent: "에이전트 추가",
  cmdAddGoal: "목표 추가",
  cmdSwitchToDark: "다크 모드로 전환",
  cmdSwitchToLight: "라이트 모드로 전환",
  cmdSwitchLang: "언어 전환 (EN/KO)",
  cmdGoKanban: "칸반으로 이동",
  cmdGoVerification: "검증 로그로 이동",
  cmdGoSettings: "설정으로 이동",
  cmdNoResults: "결과 없음",

  // AgentTerminal
  terminalTitle: "실시간 출력",
  terminalClear: "지우기",
  terminalWaiting: "출력 대기 중...",

  // Prompt dialogs
  promptProjectName: "프로젝트 이름",
  promptProjectNameHint: "프로젝트 이름을 입력하세요...",
  promptWorkdir: "작업 디렉토리",
  promptWorkdirHint: "예: ~/projects/my-app",
  promptWorkdirDesc: "에이전트가 코드를 작성할 디렉토리입니다. 실제 경로여야 합니다.",
  promptMission: "미션 (선택)",
  promptMissionHint: "무엇을 만드시나요?",
  promptLocalPath: "로컬 경로",
  promptLocalPathHint: "예: ~/projects/my-app",
  promptGitHubUrl: "GitHub URL",
  promptGitHubUrlHint: "예: user/my-app 또는 전체 URL",
  promptGoalDesc: "목표 설명",
  promptGoalDescHint: "무엇을 달성하고 싶으신가요?",
  promptTaskTitle: "태스크 제목",
  promptTaskTitleHint: "무엇을 해야 하나요?",
  promptAssignAgent: "에이전트 지정",
  promptAssignAgentHint: "에이전트 이름 또는 ID 앞부분...",
  confirmKillAgent: "이 에이전트 세션을 종료하시겠습니까?",
  confirm: "확인",
  recentActivity: "최근 활동",

  // Error / status messages (inline)
  errorImportFailed: "가져오기 실패",
  errorGitHubFailed: "GitHub 연결 실패",
  errorAgentNotFound: "에이전트를 찾을 수 없습니다",
  errorDecomposeFailed: "목표 분해 실패",
  errorSaveMissionFailed: "미션 저장 실패",
  errorSaveSettingFailed: "설정 저장 실패",
  errorDeleteFailed: "프로젝트 삭제 실패",

  // ProjectSettings hardcoded strings
  settingsMission: "미션",
  settingsProjectInfo: "프로젝트 정보",
  settingsWorkDirectory: "작업 디렉토리",
  settingsSourceType: "소스 유형",
  settingsGitHub: "GitHub",
  settingsRepository: "저장소",
  settingsBranch: "브랜치",
  settingsAutoPush: "자동 푸시",
  settingsPrMode: "PR 모드",
  settingsDangerZone: "위험 구역",
  settingsDeleteProject: "프로젝트 삭제",
  settingsDeleteDesc: "이 프로젝트와 모든 관련 데이터를 영구적으로 삭제합니다.",
  settingsDeleteConfirm: "정말로 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.",
  settingsDelete: "삭제",
  settingsYesDelete: "예, 삭제합니다",
  settingsDeleting: "삭제 중...",
  settingsSave: "저장",
  settingsSaving: "저장 중...",
  settingsNoMission: "미션이 설정되지 않았습니다",
  settingsEdit: "편집",
  settingsCancel: "취소",
  settingsSourceNew: "새 프로젝트",
  settingsSourceLocalImport: "로컬 가져오기",
  settingsSourceGitHub: "GitHub",

  // AgentDetail hardcoded strings
  agentDetailSessionInfo: "세션 정보",
  agentDetailStatus: "상태",
  agentDetailSessionId: "세션 ID",
  agentDetailCurrentTask: "현재 태스크",
  agentDetailSystemPrompt: "시스템 프롬프트",
  agentDetailVerificationStats: "검증 통계",
  agentDetailVerified: "검증됨",
  agentDetailBlocked: "블록",
  agentDetailTotal: "전체",
  agentDetailTaskHistory: "태스크 이력",
  agentDetailNoTasks: "아직 할당된 태스크가 없습니다.",
  agentDetailKillSession: "세션 종료",

  // TaskDetail modal
  taskDetail: "태스크 상세",
  closeDetail: "닫기",

  // VerificationLog fix button
  createFixTask: "수정 태스크 생성",
  fixTaskCreated: "수정 태스크가 생성되었습니다",

  // Queue controls
  runQueue: "큐 실행",
  stopQueue: "큐 중지",
  queueRunning: "큐 실행 중",

  // Agent pause/resume
  pauseAgent: "일시정지",
  resumeAgent: "재개",

  // ProjectHome hardcoded strings
  noAgents: "에이전트가 없습니다. 추가하여 시작하세요.",
  projectMissionPlaceholder: "프로젝트 미션...",
  savingLabel: "저장 중\u2026",
  saveLabel: "저장",
  cancelLabel: "취소",
  clickToEdit: "클릭하여 편집",

  // WelcomeGuide
  welcomeTitle: "Nova Orbit에 오신 것을 환영합니다",
  welcomeSubtitle: "혼자서도 팀처럼 개발하세요.",
  welcomeStep1Title: "프로젝트 생성",
  welcomeStep1Desc: "또는 기존 프로젝트 가져오기",
  welcomeStep2Title: "AI 에이전트 추가",
  welcomeStep2Desc: "코더 + 리뷰어",
  welcomeStep3Title: "목표 설정",
  welcomeStep3Desc: "AI가 태스크로 분해",
  welcomeStep4Title: "실행 & 검증",
  welcomeStep4Desc: "Quality Gate 검사",
  welcomeCmdK: "\u2318K 로 빠른 명령",

  // Empty states
  emptyAgentsTitle: "에이전트가 없습니다",
  emptyAgentsDesc: "첫 번째 AI 에이전트를 추가하세요. 코드 구현, 품질 리뷰 등을 수행합니다.",
  emptyGoalsTitle: "목표가 없습니다",
  emptyGoalsDesc: "목표를 설정하면 AI가 태스크로 분해합니다.",
  emptyTasksTitle: "태스크가 없습니다",
  emptyTasksDesc: "직접 태스크를 추가하거나 목표에서 \"분해\"를 사용하세요.",

  // ProjectStats
  statTotalTasks: "전체 태스크",
  statCompleted: "완료",
  statInProgress: "진행 중",
  statVerified: "검증됨",

  // KeyboardShortcuts
  keyboardShortcuts: "키보드 단축키",
  shortcutCmdPalette: "명령 팔레트",
  shortcutHelp: "이 도움말",

  // NotificationPanel
  notifications: "알림",
  noNotifications: "알림이 없습니다",
  clearAll: "전체 지우기",
  notificationBell: "알림 내역",
} as const;

export default ko;
