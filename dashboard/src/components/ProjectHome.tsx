import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../stores/useStore";
import { api } from "../lib/api";
import { AgentChatLog } from "./AgentChatLog";
import { OrgChart } from "./OrgChart";
import { AgentDetail } from "./AgentDetail";
import { TaskList } from "./TaskList";
import { VerificationLog } from "./VerificationLog";
import { ActivityFeed } from "./ActivityFeed";
import { AddAgentDialog } from "./AddAgentDialog";
import { KanbanBoard } from "./KanbanBoard";
import { ProjectSettings } from "./ProjectSettings";
import { InputDialog } from "./InputDialog";
import { Toast } from "./Toast";
import { WelcomeGuide } from "./WelcomeGuide";
import { ProjectStats } from "./ProjectStats";

type Tab = "overview" | "agents" | "kanban" | "verification" | "settings";

export function ProjectHome() {
  const { t } = useTranslation();
  const { currentProjectId, projects, agents, setAgents, goals, setGoals, tasks, setTasks, updateProject } =
    useStore();
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  // Header mission inline edit state
  const [editingHeaderMission, setEditingHeaderMission] = useState(false);
  const [headerMissionDraft, setHeaderMissionDraft] = useState("");
  const [savingMission, setSavingMission] = useState(false);

  // Queue state
  const [queueRunning, setQueueRunning] = useState(false);

  // Dev server state
  const [devServerStatus, setDevServerStatus] = useState<{
    running: boolean;
    port: number | null;
    url: string | null;
  }>({ running: false, port: null, url: null });
  const [devServerStarting, setDevServerStarting] = useState(false);

  // Dialog / toast state
  const [showDialog, setShowDialog] = useState<"addGoal" | "addTask" | null>(null);
  const [addTaskGoalId, setAddTaskGoalId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [decomposingGoalId, setDecomposingGoalId] = useState<string | null>(null);
  const [queueToggling, setQueueToggling] = useState(false);

  // Direct prompt state (side panel)
  const [panelPromptMessage, setPanelPromptMessage] = useState("");
  const [panelPromptAgentId, setPanelPromptAgentId] = useState<string>("");
  const [panelPromptSending, setPanelPromptSending] = useState(false);
  const [panelPromptToast, setPanelPromptToast] = useState<string | null>(null);

  // Multi-agent prompt state
  const [multiAgentMode, setMultiAgentMode] = useState(false);
  const [multiAgentIds, setMultiAgentIds] = useState<string[]>([]);
  const [multiPromptProgress, setMultiPromptProgress] = useState<{ current: number; total: number } | null>(null);
  const [multiPromptResults, setMultiPromptResults] = useState<{ agentId: string; agentName: string; result: string }[]>([]);

  const project = projects.find((p) => p.id === currentProjectId);

  const loadData = useCallback(() => {
    if (!currentProjectId) return;
    Promise.all([
      api.agents.list(currentProjectId),
      api.goals.list(currentProjectId),
      api.tasks.list(currentProjectId),
      api.orchestration.queueStatus(currentProjectId).catch(() => ({ running: false })),
      api.projects.devServerStatus(currentProjectId).catch(() => ({ running: false, port: null, url: null })),
    ]).then(([a, g, t, qs, ds]) => {
      setAgents(a);
      setGoals(g);
      setTasks(t);
      setQueueRunning(qs.running);
      setDevServerStatus({ running: ds.running, port: ds.port ?? null, url: ds.url ?? null });
      setLoading(false);
    });
  }, [currentProjectId, setAgents, setGoals, setTasks]);

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  // Listen for WebSocket refresh events
  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener("nova:refresh", handler);
    return () => window.removeEventListener("nova:refresh", handler);
  }, [loadData]);

  // Listen for CommandPalette navigation events
  useEffect(() => {
    const onGoTab = (e: Event) => {
      const { tab } = (e as CustomEvent<{ tab: string }>).detail;
      if (tab === "kanban" || tab === "verification" || tab === "settings" || tab === "overview" || tab === "agents") {
        setTab(tab as Tab);
      }
    };
    const onAddAgent = () => setShowAddAgent(true);
    const onAddGoal = () => {
      if (!currentProjectId) return;
      setShowDialog("addGoal");
    };

    window.addEventListener("nova:go-tab", onGoTab);
    window.addEventListener("nova:add-agent", onAddAgent);
    window.addEventListener("nova:add-goal", onAddGoal);
    return () => {
      window.removeEventListener("nova:go-tab", onGoTab);
      window.removeEventListener("nova:add-agent", onAddAgent);
      window.removeEventListener("nova:add-goal", onAddGoal);
    };
  }, [currentProjectId]);

  // Listen for prompt-complete to reset sending state
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ agentId: string; error?: string }>).detail;
      if (detail.agentId === panelPromptAgentId) {
        setPanelPromptSending(false);
        setPanelPromptToast(detail.error ?? t("promptComplete"));
      }
    };
    window.addEventListener("nova:prompt-complete", handler);
    return () => window.removeEventListener("nova:prompt-complete", handler);
  }, [panelPromptAgentId, t]);

  // Listen for multi-prompt WebSocket events
  useEffect(() => {
    const onAgentDone = (e: Event) => {
      const { agentName, result, index, total } = (e as CustomEvent).detail;
      void agentName;
      setMultiPromptProgress({ current: index + 1, total });
      setMultiPromptResults((prev) => [...prev, { agentId: (e as CustomEvent).detail.agentId, agentName, result }]);
    };
    const onComplete = (e: Event) => {
      const { results } = (e as CustomEvent).detail;
      setMultiPromptResults(results);
      setMultiPromptProgress(null);
      setPanelPromptSending(false);
    };
    const onSingleComplete = () => {
      if (!multiAgentMode) setPanelPromptSending(false);
    };

    window.addEventListener("nova:multi-agent-done", onAgentDone);
    window.addEventListener("nova:multi-complete", onComplete);
    window.addEventListener("nova:prompt-complete", onSingleComplete);
    return () => {
      window.removeEventListener("nova:multi-agent-done", onAgentDone);
      window.removeEventListener("nova:multi-complete", onComplete);
      window.removeEventListener("nova:prompt-complete", onSingleComplete);
    };
  }, [multiAgentMode]);

  if (!project) {
    return <WelcomeGuide />;
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        {t("loading")}
      </div>
    );
  }

  const handleAddAgent = () => setShowAddAgent(true);

  const handleAgentCreated = (agent: any) => {
    setAgents([...agents, agent]);
    setShowAddAgent(false);
  };

  const handleAddGoal = () => setShowDialog("addGoal");

  const handleAddGoalSubmit = async (description: string) => {
    setShowDialog(null);
    if (!currentProjectId) return;
    const goal = await api.goals.create({ project_id: currentProjectId, description });
    setGoals([...goals, goal]);
  };

  const handleDecomposeGoal = async (goalId: string) => {
    setDecomposingGoalId(goalId);
    try {
      await api.orchestration.decomposeGoal(goalId);
      loadData();
      setToast(t("decomposeSuccess"));
    } catch {
      setToast(t("decomposeFailed"));
    } finally {
      setDecomposingGoalId(null);
    }
  };

  const handleAddTask = (goalId: string) => {
    setAddTaskGoalId(goalId);
    setShowDialog("addTask");
  };

  const handleAddTaskSubmit = async (title: string) => {
    setShowDialog(null);
    if (!addTaskGoalId) return;
    const task = await api.tasks.create({
      goal_id: addTaskGoalId,
      project_id: currentProjectId,
      title,
    });
    setTasks([...tasks, task]);
    setAddTaskGoalId(null);
  };

  const startEditHeaderMission = () => {
    setHeaderMissionDraft(project?.mission ?? "");
    setEditingHeaderMission(true);
  };

  const cancelEditHeaderMission = () => {
    setEditingHeaderMission(false);
    setHeaderMissionDraft("");
  };

  const saveHeaderMission = async () => {
    if (!currentProjectId || !project) return;
    if (headerMissionDraft === project.mission) {
      cancelEditHeaderMission();
      return;
    }
    setSavingMission(true);
    try {
      const updated = await api.projects.update(currentProjectId, { mission: headerMissionDraft });
      updateProject(updated);
      setEditingHeaderMission(false);
    } catch {
      setToast(t("errorSaveMissionFailed"));
    } finally {
      setSavingMission(false);
    }
  };

  const handleHeaderMissionKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") saveHeaderMission();
    if (e.key === "Escape") cancelEditHeaderMission();
  };

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null;

  const handleToggleQueue = async () => {
    if (!currentProjectId || queueToggling) return;
    setQueueToggling(true);
    try {
      if (queueRunning) {
        await api.orchestration.stopQueue(currentProjectId);
        setQueueRunning(false);
      } else {
        await api.orchestration.startQueue(currentProjectId);
        setQueueRunning(true);
      }
    } catch {
      // 409 = already running, just sync state
      const status = await api.orchestration.queueStatus(currentProjectId).catch(() => ({ running: false }));
      setQueueRunning(status.running);
    } finally {
      setQueueToggling(false);
    }
  };

  const handleStartDevServer = async () => {
    if (!currentProjectId || devServerStarting) return;
    setDevServerStarting(true);
    try {
      const result = await api.projects.startDevServer(currentProjectId);
      setDevServerStatus({ running: true, port: result.port, url: result.url });
    } catch (err: any) {
      setToast(err.message ?? "Failed to start dev server");
    } finally {
      setDevServerStarting(false);
    }
  };

  const handleStopDevServer = async () => {
    if (!currentProjectId) return;
    try {
      await api.projects.stopDevServer(currentProjectId);
      setDevServerStatus({ running: false, port: null, url: null });
    } catch (err: any) {
      setToast(err.message ?? "Failed to stop dev server");
    }
  };

  const handleSendPanelPrompt = async () => {
    if (!panelPromptMessage.trim() || !panelPromptAgentId || panelPromptSending) return;
    setPanelPromptSending(true);
    setPanelPromptToast(null);
    try {
      await api.orchestration.sendPrompt(panelPromptAgentId, panelPromptMessage.trim());
      setPanelPromptMessage("");
      // Don't set sending=false here — wait for prompt-complete event
    } catch (err: any) {
      setPanelPromptToast(err.message ?? t("promptSendError"));
      setPanelPromptSending(false);
    }
  };

  const handleSendMultiPrompt = async () => {
    if (!panelPromptMessage.trim() || multiAgentIds.length < 2 || panelPromptSending || !currentProjectId) return;
    setPanelPromptSending(true);
    setPanelPromptToast(null);
    setMultiPromptProgress({ current: 0, total: multiAgentIds.length });
    setMultiPromptResults([]);
    try {
      await api.orchestration.multiPrompt(multiAgentIds, panelPromptMessage.trim(), currentProjectId);
      setPanelPromptMessage("");
      // Don't set sending=false — wait for multi-prompt:complete event
    } catch (err: any) {
      setPanelPromptToast(err.message ?? t("promptSendError"));
      setPanelPromptSending(false);
      setMultiPromptProgress(null);
    }
  };

  const toggleMultiAgentId = (agentId: string) => {
    setMultiAgentIds((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]
    );
  };

  // Derive in-progress task and its assigned agent for the chat panel
  const agentMap = Object.fromEntries(agents.map((a) => [a.id, a]));
  const inProgressTask = tasks.find((t) => t.status === "in_progress") ?? null;
  const inProgressAgent = inProgressTask?.assignee_id
    ? agents.find((a) => a.id === inProgressTask.assignee_id) ?? null
    : null;

  return (
    <div className="flex-1 overflow-y-auto">
      {showDialog === "addGoal" && (
        <InputDialog
          title={t("promptGoalDesc")}
          placeholder={t("promptGoalDescHint")}
          onSubmit={handleAddGoalSubmit}
          onCancel={() => setShowDialog(null)}
        />
      )}
      {showDialog === "addTask" && (
        <InputDialog
          title={t("promptTaskTitle")}
          placeholder={t("promptTaskTitleHint")}
          onSubmit={handleAddTaskSubmit}
          onCancel={() => { setShowDialog(null); setAddTaskGoalId(null); }}
        />
      )}
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
      {showAddAgent && currentProjectId && (
        <AddAgentDialog
          projectId={currentProjectId}
          mission={project?.mission ?? undefined}
          existingAgents={agents}
          onCreated={handleAgentCreated}
          onClose={() => setShowAddAgent(false)}
        />
      )}
      {selectedAgent && (
        <AgentDetail
          agent={selectedAgent}
          agents={agents}
          tasks={tasks}
          onClose={() => setSelectedAgentId(null)}
          onKill={() => {
            setSelectedAgentId(null);
            loadData();
          }}
        />
      )}
      <div className="max-w-6xl mx-auto py-8 px-6">
        {/* Project Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{project.name}</h1>
          <div className="mt-1">
            {editingHeaderMission ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  type="text"
                  value={headerMissionDraft}
                  onChange={(e) => setHeaderMissionDraft(e.target.value)}
                  onKeyDown={handleHeaderMissionKeyDown}
                  disabled={savingMission}
                  className="flex-1 text-sm border border-blue-400 rounded px-2 py-0.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  placeholder={t("projectMissionPlaceholder")}
                />
                <button
                  onClick={saveHeaderMission}
                  disabled={savingMission}
                  className="text-xs px-2 py-0.5 bg-gray-900 text-white rounded hover:bg-gray-700 disabled:opacity-50"
                >
                  {savingMission ? t("savingLabel") : t("saveLabel")}
                </button>
                <button
                  onClick={cancelEditHeaderMission}
                  disabled={savingMission}
                  className="text-xs px-2 py-0.5 border border-gray-300 rounded hover:bg-gray-50"
                >
                  {t("cancelLabel")}
                </button>
              </div>
            ) : (
              <p
                className="text-gray-500 cursor-pointer hover:text-gray-700 group inline-flex items-center gap-1"
                onClick={startEditHeaderMission}
                title={t("clickToEdit")}
              >
                {project.mission || <span className="italic text-gray-400">{t("noMission")}</span>}
                <span className="text-xs text-gray-300 group-hover:text-gray-400 transition-colors">
                  {t("edit")}
                </span>
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 mt-2 items-center">
            <span className="text-xs px-2 py-0.5 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded">
              {t(`projectStatus_${project.status}`)}
            </span>
            <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded">
              {t(`projectSource_${project.source}`)}
            </span>
            {project.workdir && (
              <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-400 rounded font-mono">
                {project.workdir}
              </span>
            )}
            {/* Dev server controls */}
            {project.workdir && (
              <div className="flex items-center gap-1.5 ml-auto">
                {devServerStatus.running ? (
                  <>
                    <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                      {t("devServerRunning", { port: devServerStatus.port })}
                    </span>
                    {devServerStatus.url && (
                      <a
                        href={devServerStatus.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                      >
                        {t("openInBrowser")}
                      </a>
                    )}
                    <button
                      onClick={handleStopDevServer}
                      className="text-xs px-2.5 py-0.5 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded hover:bg-red-100 dark:hover:bg-red-900/50 font-medium"
                    >
                      {t("stopDevServer")}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleStartDevServer}
                    disabled={devServerStarting}
                    className={`text-xs px-2.5 py-0.5 rounded font-medium transition-colors ${
                      devServerStarting
                        ? "bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-wait"
                        : "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/50"
                    }`}
                  >
                    {devServerStarting ? t("devServerStarting") : t("startDevServer")}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Project Stats */}
        <ProjectStats tasks={tasks} projectId={currentProjectId ?? undefined} />

        {/* Tabs */}
        <div className="flex gap-4 mb-6 border-b border-gray-200 dark:border-gray-700">
          {(["overview", "agents", "kanban", "verification", "settings"] as Tab[]).map((tabId) => {
            const tabLabel: Record<Tab, string> = {
              overview: t("tabOverview"),
              agents: t("tabAgents"),
              kanban: t("tabKanban"),
              verification: t("tabVerification"),
              settings: t("tabSettings"),
            };
            return (
              <button
                key={tabId}
                onClick={() => setTab(tabId)}
                className={`pb-2 text-sm transition-colors ${
                  tab === tabId
                    ? "text-gray-900 dark:text-gray-100 border-b-2 border-gray-900 dark:border-gray-100 font-medium"
                    : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                }`}
              >
                {tabLabel[tabId]}
              </button>
            );
          })}
        </div>

        {tab === "settings" ? (
          <ProjectSettings projectId={currentProjectId!} />
        ) : tab === "overview" ? (
          <div className="flex gap-6">
            {/* Main column — scrollable, takes remaining width */}
            <div className="flex-1 min-w-0">
              {/* Agents Section — compact summary */}
              <section className="mb-8">
                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <span className="font-medium text-gray-700 dark:text-gray-300 shrink-0">{t("agents")}:</span>
                  {agents.length === 0 ? (
                    <button
                      onClick={handleAddAgent}
                      className="text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                    >
                      {t("addAgent")}
                    </button>
                  ) : (
                    <>
                      <span className="flex flex-wrap gap-1 items-center min-w-0">
                        {agents.map((a, idx) => (
                          <span key={a.id} className="inline-flex items-center gap-0.5">
                            {a.status === "working" && (
                              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
                            )}
                            <span className="text-gray-700 dark:text-gray-300">{a.name}</span>
                            {idx < agents.length - 1 && (
                              <span className="text-gray-300 dark:text-gray-600">,</span>
                            )}
                          </span>
                        ))}
                        <span className="text-gray-400 dark:text-gray-500">
                          ({t("agentCount", { count: agents.length })})
                        </span>
                      </span>
                      <button
                        onClick={() => setTab("agents")}
                        className="shrink-0 text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors whitespace-nowrap"
                      >
                        {t("goToAgentsTab")}
                      </button>
                    </>
                  )}
                </div>
              </section>

              {/* Goals Section */}
              <section className="mb-8">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                    {t("goals")}
                  </h2>
                  <button
                    onClick={handleAddGoal}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    {t("addGoal")}
                  </button>
                </div>
                {goals.length === 0 && (
                  <div className="py-8 px-4 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg text-center">
                    <div className="text-3xl mb-2 opacity-40">🎯</div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">
                      {t("emptyGoalsTitle")}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
                      {t("emptyGoalsDesc")}
                    </p>
                    <button
                      onClick={handleAddGoal}
                      className="text-xs px-3 py-1.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-100 transition-colors"
                    >
                      {t("addGoal")}
                    </button>
                  </div>
                )}
                {goals.map((goal) => {
                  const goalTasks = tasks.filter((tk) => tk.goal_id === goal.id);
                  const doneTasks = goalTasks.filter((tk) => tk.status === "done");
                  const activeTasks = goalTasks.filter((tk) => tk.status !== "done");
                  const pct = goalTasks.length > 0 ? Math.round((doneTasks.length / goalTasks.length) * 100) : 0;
                  const isComplete = pct === 100 && goalTasks.length > 0;
                  return (
                  <div
                    key={goal.id}
                    className="mb-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-[#25253d] overflow-hidden"
                  >
                    <div className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className={`text-sm font-medium min-w-0 ${isComplete ? "text-gray-400 dark:text-gray-500" : "text-gray-800 dark:text-gray-100"}`}>
                        {goal.description}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                          {doneTasks.length}/{goalTasks.length} ({pct}%)
                        </span>
                        {tasks.some((t) => t.goal_id === goal.id) ? (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 whitespace-nowrap">
                            {t("decomposed")}
                          </span>
                        ) : (
                          <button
                            onClick={() => handleDecomposeGoal(goal.id)}
                            disabled={decomposingGoalId !== null}
                            className={`text-[10px] px-2 py-0.5 rounded flex items-center gap-1 transition-colors whitespace-nowrap ${
                              decomposingGoalId === goal.id
                                ? "bg-purple-200 dark:bg-purple-800/60 text-purple-500 dark:text-purple-300 cursor-wait"
                                : decomposingGoalId !== null
                                  ? "bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 opacity-50 cursor-not-allowed"
                                  : "bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/50"
                            }`}
                          >
                            {decomposingGoalId === goal.id ? (
                              <>
                                <svg className="animate-spin w-2.5 h-2.5" viewBox="0 0 24 24" fill="none">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                </svg>
                                {t("decomposing")}
                              </>
                            ) : (
                              t("decompose")
                            )}
                          </button>
                        )}
                        <button
                          onClick={() => handleAddTask(goal.id)}
                          className="text-[10px] px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded hover:bg-gray-200 dark:hover:bg-gray-600 whitespace-nowrap"
                        >
                          {t("addTask")}
                        </button>
                      </div>
                    </div>
                    <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1 mx-3">
                      <div className="bg-blue-500 h-1 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    {/* Inline tasks for this goal */}
                    {activeTasks.length > 0 && (
                      <div className="px-3 pb-2 space-y-1">
                        {activeTasks.map((tk) => (
                          <div key={tk.id} className="flex items-center gap-2 text-[11px] py-0.5">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              tk.status === "in_progress" ? "bg-blue-500 animate-pulse"
                              : tk.status === "in_review" ? "bg-purple-500"
                              : tk.status === "blocked" ? "bg-red-500"
                              : "bg-gray-300 dark:bg-gray-600"
                            }`} />
                            <span className="text-gray-700 dark:text-gray-300 truncate flex-1">{tk.title}</span>
                            {tk.assignee_id && agentMap[tk.assignee_id] && (
                              <span className="text-[9px] text-gray-400 dark:text-gray-500 shrink-0">{agentMap[tk.assignee_id].name}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {doneTasks.length > 0 && (
                      <div className="px-3 pb-2">
                        <span className="text-[10px] text-gray-400 dark:text-gray-500">{t("doneCount", { count: doneTasks.length })}</span>
                      </div>
                    )}
                  </div>
                  );
                })}
              </section>

              {/* Tasks Section */}
              <section className="mb-8">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                    {t("tasks")}
                  </h2>
                  <button
                    onClick={handleToggleQueue}
                    disabled={queueToggling}
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
                      queueToggling
                        ? "bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-wait"
                        : queueRunning
                          ? "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50"
                          : "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50"
                    }`}
                  >
                    {queueRunning && !queueToggling && (
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                    )}
                    {queueToggling ? "..." : queueRunning ? t("stopQueue") : t("runQueue")}
                  </button>
                </div>
                {queueRunning && (
                  <p className="text-[10px] text-blue-500 dark:text-blue-400 flex items-center gap-1 mb-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                    {t("queueRunning")}
                  </p>
                )}
                <TaskList tasks={tasks} agents={agents} projectId={currentProjectId ?? undefined} onUpdate={loadData} />
              </section>
            </div>

            {/* Side panel — sticky, fixed width, scrollable within */}
            <div className="w-[360px] max-w-[calc(100vw-2rem)] shrink-0 sticky top-0 self-start max-h-[calc(100vh-140px)] overflow-y-auto space-y-4">
              {/* Agent Output */}
              <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  {inProgressTask ? (
                    <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" />
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-600 shrink-0" />
                  )}
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                    {t("agentOutput")}
                  </span>
                  {inProgressTask && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                      — {inProgressTask.title}
                    </span>
                  )}
                </div>
                <div className={`${inProgressTask ? "h-[260px]" : "h-[120px]"} bg-white dark:bg-[#1e1e2e] transition-all`}>
                  {inProgressTask ? (
                    <AgentChatLog
                      taskId={inProgressTask.id}
                      agentName={inProgressAgent?.name}
                      agentRole={inProgressAgent?.role}
                      isWorking={inProgressAgent?.status === "working"}
                    />
                  ) : (
                    <div className="h-full flex items-center justify-center text-xs text-gray-400 dark:text-gray-500 px-4 text-center">
                      {t("waitingForAgent")}
                    </div>
                  )}
                </div>
              </div>

              {/* Direct Prompt — only when no task is running */}
              {!inProgressTask && agents.length > 0 && (
                <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <h2 className="text-xs font-medium text-gray-600 dark:text-gray-300">
                      {t("directPromptTitle")}
                    </h2>
                    {/* Mode toggle */}
                    <button
                      onClick={() => {
                        setMultiAgentMode((m) => !m);
                        setMultiAgentIds([]);
                        setMultiPromptResults([]);
                        setMultiPromptProgress(null);
                      }}
                      disabled={panelPromptSending}
                      className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors disabled:opacity-40 ${
                        multiAgentMode
                          ? "bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-600 text-blue-600 dark:text-blue-400"
                          : "bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-blue-300"
                      }`}
                    >
                      {multiAgentMode ? t("multiAgentMode") : t("singleAgentMode")}
                    </button>
                  </div>
                  <div className="p-3 bg-white dark:bg-[#1e1e2e] space-y-2">
                    {multiAgentMode ? (
                      <>
                        {/* Multi-agent checkbox list */}
                        <div className="space-y-1">
                          <p className="text-[10px] text-gray-400 dark:text-gray-500">{t("selectMultipleAgents")}</p>
                          <div className="max-h-[120px] overflow-y-auto space-y-1 border border-gray-100 dark:border-gray-700 rounded-lg p-2">
                            {agents.map((a) => {
                              const isSelected = multiAgentIds.includes(a.id);
                              const order = multiAgentIds.indexOf(a.id);
                              return (
                                <label
                                  key={a.id}
                                  className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer transition-colors ${
                                    isSelected
                                      ? "bg-blue-50 dark:bg-blue-900/20"
                                      : "hover:bg-gray-50 dark:hover:bg-gray-800"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    disabled={panelPromptSending}
                                    onChange={() => toggleMultiAgentId(a.id)}
                                    className="rounded border-gray-300 text-blue-500 focus:ring-blue-400 disabled:opacity-50"
                                  />
                                  <span className="flex-1 text-xs text-gray-700 dark:text-gray-300">
                                    {a.name}
                                    <span className="ml-1 text-[10px] text-gray-400 dark:text-gray-500">({a.role})</span>
                                  </span>
                                  {isSelected && (
                                    <span className="text-[10px] font-medium text-blue-500 dark:text-blue-400 w-4 text-center">
                                      {order + 1}
                                    </span>
                                  )}
                                </label>
                              );
                            })}
                          </div>
                          {multiAgentIds.length > 0 && (
                            <p className="text-[10px] text-gray-400 dark:text-gray-500">
                              {t("agentOrder")}: {multiAgentIds.map((id) => agents.find((a) => a.id === id)?.name ?? id).join(" → ")}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={panelPromptMessage}
                            onChange={(e) => setPanelPromptMessage(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleSendMultiPrompt(); }}
                            disabled={panelPromptSending || multiAgentIds.length < 2}
                            placeholder={t("promptPlaceholder")}
                            className="flex-1 text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-1.5 border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-blue-400 dark:focus:border-blue-500 disabled:opacity-50"
                          />
                          <button
                            onClick={handleSendMultiPrompt}
                            disabled={panelPromptSending || !panelPromptMessage.trim() || multiAgentIds.length < 2}
                            className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                          >
                            {panelPromptSending && multiPromptProgress
                              ? t("multiPromptRunning", { current: multiPromptProgress.current, total: multiPromptProgress.total })
                              : t("sendPrompt")}
                          </button>
                        </div>
                        {/* Multi-prompt results */}
                        {multiPromptResults.length > 0 && (
                          <div className="mt-2 space-y-2 max-h-[200px] overflow-y-auto">
                            {multiPromptResults.map((r, i) => (
                              <div key={r.agentId + i} className="border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
                                <div className="px-2 py-1 bg-gray-50 dark:bg-gray-800 flex items-center gap-1.5">
                                  <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">
                                    {i + 1}. {r.agentName}
                                  </span>
                                </div>
                                <div className="px-3 py-2 text-[11px] text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words max-h-[80px] overflow-y-auto">
                                  {r.result}
                                </div>
                              </div>
                            ))}
                            {!panelPromptSending && multiPromptResults.length === multiAgentIds.length && (
                              <p className="text-[10px] text-center text-green-600 dark:text-green-400 font-medium">
                                {t("multiPromptComplete")}
                              </p>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <select
                          value={panelPromptAgentId}
                          onChange={(e) => setPanelPromptAgentId(e.target.value)}
                          disabled={panelPromptSending}
                          className="w-full text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-1.5 border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-blue-400 dark:focus:border-blue-500 disabled:opacity-50"
                        >
                          <option value="">{t("selectAgent")}</option>
                          {agents.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name} ({a.role})
                            </option>
                          ))}
                        </select>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={panelPromptMessage}
                            onChange={(e) => setPanelPromptMessage(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleSendPanelPrompt(); }}
                            disabled={panelPromptSending || !panelPromptAgentId}
                            placeholder={t("promptPlaceholder")}
                            className="flex-1 text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-1.5 border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-blue-400 dark:focus:border-blue-500 disabled:opacity-50"
                          />
                          <button
                            onClick={handleSendPanelPrompt}
                            disabled={panelPromptSending || !panelPromptMessage.trim() || !panelPromptAgentId}
                            className="px-3 py-1.5 text-xs font-medium bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                          >
                            {panelPromptSending ? t("promptRunning") : t("sendPrompt")}
                          </button>
                        </div>
                      </>
                    )}
                    {panelPromptToast && (
                      <p className="text-[10px] text-gray-500 dark:text-gray-400">{panelPromptToast}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Recent Activity */}
              <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <h2 className="text-xs font-medium text-gray-600 dark:text-gray-300">
                    {t("recentActivity")}
                  </h2>
                </div>
                <div className="max-h-[200px] overflow-y-auto bg-white dark:bg-[#1e1e2e]">
                  <ActivityFeed projectId={currentProjectId!} />
                </div>
              </div>
            </div>
          </div>
        ) : tab === "agents" ? (
          <OrgChart
            agents={agents}
            tasks={tasks}
            onAddAgent={handleAddAgent}
            onAgentDeleted={() => { setSelectedAgentId(null); loadData(); }}
            onAgentKilled={() => { setSelectedAgentId(null); loadData(); }}
          />
        ) : tab === "kanban" ? (
          <KanbanBoard tasks={tasks} agents={agents} onUpdate={loadData} />
        ) : (
          <section>
            <VerificationLog projectId={currentProjectId!} />
          </section>
        )}
      </div>
    </div>
  );
}
