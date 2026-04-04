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
} as const;

export default ko;
