import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../stores/useStore";
import { api } from "../lib/api";
import { AgentCard } from "./AgentCard";
import { AgentChatLog } from "./AgentChatLog";
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

type Tab = "overview" | "kanban" | "verification" | "settings";

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

  // Dialog / toast state
  const [showDialog, setShowDialog] = useState<"addGoal" | "addTask" | null>(null);
  const [addTaskGoalId, setAddTaskGoalId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [decomposingGoalId, setDecomposingGoalId] = useState<string | null>(null);
  const [queueToggling, setQueueToggling] = useState(false);

  const project = projects.find((p) => p.id === currentProjectId);

  const loadData = useCallback(() => {
    if (!currentProjectId) return;
    Promise.all([
      api.agents.list(currentProjectId),
      api.goals.list(currentProjectId),
      api.tasks.list(currentProjectId),
      api.orchestration.queueStatus(currentProjectId).catch(() => ({ running: false })),
    ]).then(([a, g, t, qs]) => {
      setAgents(a);
      setGoals(g);
      setTasks(t);
      setQueueRunning(qs.running);
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
      if (tab === "kanban" || tab === "verification" || tab === "settings" || tab === "overview") {
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

  // Derive in-progress task and its assigned agent for the chat panel
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
          onCreated={handleAgentCreated}
          onClose={() => setShowAddAgent(false)}
        />
      )}
      {selectedAgent && (
        <AgentDetail
          agent={selectedAgent}
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
          <div className="flex gap-2 mt-2">
            <span className="text-xs px-2 py-0.5 bg-green-50 text-green-600 rounded">
              {project.status}
            </span>
            <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded">
              {project.source}
            </span>
            {project.workdir && (
              <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-400 rounded font-mono">
                {project.workdir}
              </span>
            )}
          </div>
        </div>

        {/* Project Stats */}
        <ProjectStats tasks={tasks} />

        {/* Tabs */}
        <div className="flex gap-4 mb-6 border-b border-gray-200 dark:border-gray-700">
          {(["overview", "kanban", "verification", "settings"] as Tab[]).map((tabId) => {
            const tabLabel: Record<Tab, string> = {
              overview: t("tabOverview"),
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
              {/* Agents Section */}
              <section className="mb-8">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                    {t("agents")}
                  </h2>
                  <button
                    onClick={handleAddAgent}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    {t("addAgent")}
                  </button>
                </div>
                {agents.length === 0 ? (
                  <div className="py-8 px-4 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg text-center">
                    <div className="text-3xl mb-2 opacity-40">🤖</div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">
                      {t("emptyAgentsTitle")}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-4 max-w-xs mx-auto">
                      {t("emptyAgentsDesc")}
                    </p>
                    <button
                      onClick={handleAddAgent}
                      className="text-xs px-3 py-1.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-100 transition-colors"
                    >
                      {t("addAgent")}
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {agents.map((agent) => (
                      <AgentCard
                        key={agent.id}
                        agent={agent}
                        tasks={tasks}
                        onKill={loadData}
                        onClick={() => setSelectedAgentId(agent.id)}
                      />
                    ))}
                  </div>
                )}
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
                {goals.map((goal) => (
                  <div
                    key={goal.id}
                    className="mb-4 p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-[#25253d]"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                        {goal.description}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {goal.progress}%
                        </span>
                        <button
                          onClick={() => handleDecomposeGoal(goal.id)}
                          disabled={decomposingGoalId !== null}
                          className={`text-[10px] px-2 py-0.5 rounded flex items-center gap-1 ${
                            decomposingGoalId === goal.id
                              ? "bg-purple-100 dark:bg-purple-900/50 text-purple-400 cursor-wait"
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
                        <button
                          onClick={() => handleAddTask(goal.id)}
                          className="text-[10px] px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                        >
                          {t("addTask")}
                        </button>
                      </div>
                    </div>
                    <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
                      <div
                        className="bg-blue-500 h-1.5 rounded-full transition-all"
                        style={{ width: `${goal.progress}%` }}
                      />
                    </div>
                  </div>
                ))}
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
                <TaskList tasks={tasks} agents={agents} onUpdate={loadData} />
              </section>
            </div>

            {/* Side panel — sticky, fixed width, scrollable within */}
            <div className="w-[360px] shrink-0 sticky top-0 self-start max-h-[calc(100vh-200px)] overflow-y-auto space-y-4">
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
                <div className="h-[300px] bg-white dark:bg-[#1e1e2e]">
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
