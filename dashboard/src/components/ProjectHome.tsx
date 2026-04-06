import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../stores/useStore";
import { api } from "../lib/api";
import type { NotificationType } from "../stores/useNotifications";
import { TaskTimeline } from "./TaskTimeline";
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
import { AutopilotModal } from "./AutopilotModal";
import GoalSpecPanel from "./GoalSpecPanel";
import { ConfirmDialog } from "./ConfirmDialog";

type Tab = "overview" | "agents" | "kanban" | "verification" | "settings";

// ─── AddGoalDialog ───────────────────────────────────
function AddGoalDialog({
  onCreateDirect,
  onCreateWithSpec,
  onCancel,
}: {
  onCreateDirect: (description: string) => void;
  onCreateWithSpec: (description: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = (mode: "direct" | "spec") => {
    if (!value.trim() || submitting) return;
    setSubmitting(true);
    if (mode === "spec") {
      onCreateWithSpec(value.trim());
    } else {
      onCreateDirect(value.trim());
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/20 dark:bg-black/50 flex items-center justify-center z-50"
      onClick={onCancel}
    >
      <div
        className="bg-white dark:bg-[#25253d] rounded-xl shadow-lg w-[480px] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">
            {t("addGoalTitle")}
          </h3>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) handleSubmit("direct");
              if (e.key === "Escape") onCancel();
            }}
            placeholder={t("promptGoalDescHint")}
            disabled={submitting}
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-[#1a1a2e] text-gray-800 dark:text-gray-200 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
          />
        </div>
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              onClick={() => handleSubmit("direct")}
              disabled={!value.trim() || submitting}
              className="flex-1 text-xs px-4 py-2.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-100 disabled:opacity-40 transition-colors text-left"
            >
              <div className="font-semibold">{t("addGoalCreateDirect")}</div>
              <div className="mt-0.5 opacity-60">{t("addGoalCreateDirectDesc")}</div>
            </button>
            <button
              onClick={() => handleSubmit("spec")}
              disabled={!value.trim() || submitting}
              className="flex-1 text-xs px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors text-left"
            >
              {submitting ? (
                <div className="flex items-center gap-2">
                  <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span>{t("loading")}</span>
                </div>
              ) : (
                <>
                  <div className="font-semibold">{t("addGoalWithSpec")}</div>
                  <div className="mt-0.5 opacity-60">{t("addGoalWithSpecDesc")}</div>
                </>
              )}
            </button>
          </div>
          <button
            onClick={onCancel}
            disabled={submitting}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 py-1"
          >
            {t("cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const [queuePaused, setQueuePaused] = useState(false);
  const [queuePausedInfo, setQueuePausedInfo] = useState<{
    nextRetryAt: string | null;
    retryNumber: number;
    maxRetries: number;
  } | null>(null);

  // Autopilot state
  const [autopilotMode, setAutopilotMode] = useState<"off" | "goal" | "full">("off");
  const [autopilotChanging, setAutopilotChanging] = useState(false);
  const [showAutopilotModal, setShowAutopilotModal] = useState(false);

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
  const [toast, setToast] = useState<{ message: string; type: NotificationType } | null>(null);
  const [decomposingGoalId, setDecomposingGoalId] = useState<string | null>(null);
  const [reDecomposeGoalId, setReDecomposeGoalId] = useState<string | null>(null);
  const [deleteGoalId, setDeleteGoalId] = useState<string | null>(null);
  const [queueToggling, setQueueToggling] = useState(false);

  // Spec generation tracking (goal IDs currently generating)
  const [generatingSpecGoalIds, setGeneratingSpecGoalIds] = useState<Set<string>>(new Set());

  // Goals 접기 상태
  const [showCompletedGoals, setShowCompletedGoals] = useState(false);
  const COMPLETED_GOALS_THRESHOLD = 3;

  // Goal Spec state
  const [specGoalId, setSpecGoalId] = useState<string | null>(null);

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

  const specPollRefs = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const showToast = useCallback((message: string, type: NotificationType = "info") => {
    setToast({ message, type });
  }, []);

  const loadData = useCallback(() => {
    if (!currentProjectId) return;
    Promise.all([
      api.agents.list(currentProjectId),
      api.goals.list(currentProjectId),
      api.tasks.list(currentProjectId),
      api.orchestration.queueStatus(currentProjectId).catch(() => ({ running: false, paused: false, rateLimitRetries: 0, nextRetryAt: null as string | null })),
      api.projects.devServerStatus(currentProjectId).catch(() => ({ running: false, port: null, url: null })),
    ]).then(([a, g, t, qs, ds]) => {
      setAgents(a);
      setGoals(g);
      setTasks(t);
      setQueueRunning(qs.running);
      setQueuePaused(qs.paused ?? false);
      if (qs.paused && qs.nextRetryAt) {
        setQueuePausedInfo({
          nextRetryAt: qs.nextRetryAt,
          retryNumber: qs.rateLimitRetries ?? 0,
          maxRetries: 3,
        });
      } else {
        setQueuePausedInfo(null);
      }
      setDevServerStatus({ running: ds.running, port: ds.port ?? null, url: ds.url ?? null });
      setLoading(false);
    });
  }, [currentProjectId, setAgents, setGoals, setTasks]);

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  // Sync autopilot mode from project data
  useEffect(() => {
    if (project) {
      setAutopilotMode((project as any).autopilot ?? "off");
    }
  }, [project]);

  // Listen for WebSocket refresh events
  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener("nova:refresh", handler);
    return () => window.removeEventListener("nova:refresh", handler);
  }, [loadData]);

  // Listen for queue pause/resume/stop events
  useEffect(() => {
    const onPaused = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setQueuePaused(true);
      setQueuePausedInfo({
        nextRetryAt: detail.nextRetryAt,
        retryNumber: detail.retryNumber,
        maxRetries: detail.maxRetries,
      });
    };
    const onResumed = () => {
      setQueuePaused(false);
      setQueuePausedInfo(null);
    };
    const onStopped = () => {
      setQueueRunning(false);
      setQueuePaused(false);
      setQueuePausedInfo(null);
    };
    const onAutopilotChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.projectId === currentProjectId) {
        setAutopilotMode(detail.mode);
      }
    };
    window.addEventListener("nova:queue-paused", onPaused);
    window.addEventListener("nova:queue-resumed", onResumed);
    window.addEventListener("nova:queue-stopped", onStopped);
    window.addEventListener("nova:autopilot-changed", onAutopilotChanged);
    return () => {
      window.removeEventListener("nova:queue-paused", onPaused);
      window.removeEventListener("nova:queue-resumed", onResumed);
      window.removeEventListener("nova:queue-stopped", onStopped);
      window.removeEventListener("nova:autopilot-changed", onAutopilotChanged);
    };
  }, [currentProjectId]);

  // Listen for system:error events — show as toast
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ message?: string }>).detail;
      showToast(detail?.message ?? t("systemErrorGeneric"), "error");
    };
    window.addEventListener("nova:system-error", handler);
    return () => window.removeEventListener("nova:system-error", handler);
  }, [t]);

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

  // Spec polling — cleanup on unmount
  useEffect(() => {
    return () => {
      specPollRefs.current.forEach((timer) => clearInterval(timer));
      specPollRefs.current.clear();
    };
  }, []);

  // useMemo MUST be called before any early returns (Rules of Hooks)
  const agentMap = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents]);
  const activeTasks = useMemo(() => tasks.filter((t) => t.status === "in_progress" || t.status === "in_review"), [tasks]);
  const hasActiveTasks = activeTasks.length > 0;
  const pendingApprovalCount = useMemo(() => tasks.filter((t) => t.status === "pending_approval").length, [tasks]);

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto py-8 px-6 animate-pulse">
          {/* Header skeleton */}
          <div className="mb-6">
            <div className="h-7 w-48 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
            <div className="h-4 w-80 bg-gray-100 dark:bg-gray-800 rounded mb-3" />
            <div className="flex gap-2">
              <div className="h-5 w-16 bg-gray-100 dark:bg-gray-800 rounded" />
              <div className="h-5 w-20 bg-gray-100 dark:bg-gray-800 rounded" />
            </div>
          </div>
          {/* Tabs skeleton */}
          <div className="flex gap-4 mb-6 border-b border-gray-100 dark:border-gray-800 pb-2">
            {[56, 64, 48, 72, 48].map((w, i) => (
              <div key={i} className="h-4 rounded bg-gray-100 dark:bg-gray-800" style={{ width: w }} />
            ))}
          </div>
          {/* Content skeleton */}
          <div className="grid grid-cols-3 gap-6">
            <div className="col-span-2 space-y-4">
              <div className="h-24 bg-gray-100 dark:bg-gray-800 rounded-lg" />
              <div className="h-32 bg-gray-100 dark:bg-gray-800 rounded-lg" />
              <div className="h-20 bg-gray-100 dark:bg-gray-800 rounded-lg" />
            </div>
            <div className="space-y-4">
              <div className="h-28 bg-gray-100 dark:bg-gray-800 rounded-lg" />
              <div className="h-36 bg-gray-100 dark:bg-gray-800 rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return <WelcomeGuide />;
  }

  const handleAddAgent = () => setShowAddAgent(true);

  const handleAgentCreated = (agent: any) => {
    setAgents([...agents, agent]);
    setShowAddAgent(false);
  };

  const handleAddGoal = () => setShowDialog("addGoal");

  const startSpecPolling = (goalId: string) => {
    // Prevent duplicate polling
    if (specPollRefs.current.has(goalId)) return;
    setGeneratingSpecGoalIds((prev) => new Set(prev).add(goalId));
    const timer = setInterval(async () => {
      try {
        const data = await api.goals.getSpec(goalId);
        const status = data?.prd_summary?._status;
        if (status !== "generating") {
          clearInterval(timer);
          specPollRefs.current.delete(goalId);
          setGeneratingSpecGoalIds((prev) => {
            const next = new Set(prev);
            next.delete(goalId);
            return next;
          });
          if (status === "failed") {
            showToast(t("specGenerateFailed"), "error");
          } else {
            showToast(t("specGenerateComplete"), "success");
          }
        }
      } catch {
        clearInterval(timer);
        specPollRefs.current.delete(goalId);
        setGeneratingSpecGoalIds((prev) => {
          const next = new Set(prev);
          next.delete(goalId);
          return next;
        });
        showToast(t("specGenerateFailed"), "error");
      }
    }, 3000);
    specPollRefs.current.set(goalId, timer);
  };

  const handleAddGoalDirect = async (description: string) => {
    setShowDialog(null);
    if (!currentProjectId) return;
    try {
      const goal = await api.goals.create({ project_id: currentProjectId, description });
      setGoals([...goals, goal]);
      showToast(t("addGoalSuccess"), "success");
    } catch (err: any) {
      showToast(err.message ?? t("decomposeFailed"), "error");
    }
  };

  const handleAddGoalWithSpec = async (description: string) => {
    setShowDialog(null);
    if (!currentProjectId) return;
    try {
      const goal = await api.goals.create({ project_id: currentProjectId, description });
      setGoals([...goals, goal]);
      showToast(t("addGoalSuccess"), "success");
      // Start spec generation
      await api.goals.generateSpec(goal.id);
      startSpecPolling(goal.id);
    } catch (err: any) {
      showToast(err.message ?? t("specGenerateFailed"), "error");
    }
  };

  const handleDecomposeGoal = async (goalId: string) => {
    // If tasks already exist (re-decompose), show confirm modal
    const existingTasks = tasks.filter((tk) => tk.goal_id === goalId);
    if (existingTasks.length > 0) {
      setReDecomposeGoalId(goalId);
      return;
    }
    await executeDecompose(goalId, false);
  };

  const executeDecompose = async (goalId: string, isReDecompose: boolean) => {
    setDecomposingGoalId(goalId);
    try {
      await api.orchestration.decomposeGoal(goalId);
      loadData();
      showToast(isReDecompose ? t("reDecomposeSuccess") : t("decomposeSuccess"), "success");
    } catch {
      showToast(t("decomposeFailed"), "error");
    } finally {
      setDecomposingGoalId(null);
    }
  };

  const handleAddTask = (goalId: string) => {
    setAddTaskGoalId(goalId);
    setShowDialog("addTask");
  };

  const handleDeleteGoal = (goalId: string) => {
    setDeleteGoalId(goalId);
  };

  const executeDeleteGoal = async (goalId: string) => {
    await api.goals.delete(goalId);
    loadData();
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
      showToast(t("errorSaveMissionFailed"), "error");
    } finally {
      setSavingMission(false);
    }
  };

  const handleHeaderMissionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      saveHeaderMission();
    }
    if (e.key === "Escape") cancelEditHeaderMission();
  };

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null;

  const handleAutopilotChange = async (mode: "off" | "goal" | "full") => {
    if (!currentProjectId || autopilotChanging) return;
    setShowAutopilotModal(false);
    setAutopilotChanging(true);
    try {
      const updated = await api.projects.update(currentProjectId, { autopilot: mode });
      updateProject(updated);
      setAutopilotMode(mode);
    } catch (err: any) {
      showToast(err.message ?? "Failed to change autopilot mode", "error");
    } finally {
      setAutopilotChanging(false);
    }
  };

  const handleResumeQueue = async () => {
    if (!currentProjectId) return;
    try {
      await api.orchestration.resumeQueue(currentProjectId);
      setQueuePaused(false);
      setQueuePausedInfo(null);
    } catch (err: any) {
      showToast(err.message ?? "Failed to resume queue", "error");
    }
  };

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
      showToast(err.message ?? "Failed to start dev server", "error");
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
      showToast(err.message ?? "Failed to stop dev server", "error");
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

  // activeTasks / hasActiveTasks are defined above (before early returns)

  return (
    <div className="flex-1 overflow-y-auto">
      {showDialog === "addGoal" && (
        <AddGoalDialog
          onCreateDirect={handleAddGoalDirect}
          onCreateWithSpec={handleAddGoalWithSpec}
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
      {deleteGoalId && (
        <ConfirmDialog
          message={t("deleteGoalConfirm")}
          onConfirm={() => {
            const goalId = deleteGoalId;
            setDeleteGoalId(null);
            executeDeleteGoal(goalId);
          }}
          onCancel={() => setDeleteGoalId(null)}
        />
      )}
      {reDecomposeGoalId && (() => {
        const goalTasks = tasks.filter((tk) => tk.goal_id === reDecomposeGoalId);
        const doneCount = goalTasks.filter((tk) => tk.status === "done").length;
        const msg = doneCount > 0
          ? t("reDecomposeConfirmWithDone").replace("{count}", String(goalTasks.length)).replace("{done}", String(doneCount))
          : t("reDecomposeConfirm").replace("{count}", String(goalTasks.length));
        return (
          <ConfirmDialog
            message={msg}
            onConfirm={() => {
              const goalId = reDecomposeGoalId;
              setReDecomposeGoalId(null);
              executeDecompose(goalId, true);
            }}
            onCancel={() => setReDecomposeGoalId(null)}
          />
        );
      })()}
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
      {specGoalId && (
        <GoalSpecPanel goalId={specGoalId} onClose={() => setSpecGoalId(null)} />
      )}
      {showAutopilotModal && (
        <AutopilotModal
          currentMode={autopilotMode}
          hasMission={!!project?.mission?.trim()}
          hasCto={agents.some((a) => a.role === "cto")}
          onConfirm={handleAutopilotChange}
          onClose={() => setShowAutopilotModal(false)}
        />
      )}
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
              <div className="flex items-start gap-2">
                <textarea
                  autoFocus
                  rows={3}
                  value={headerMissionDraft}
                  onChange={(e) => setHeaderMissionDraft(e.target.value)}
                  onKeyDown={handleHeaderMissionKeyDown}
                  disabled={savingMission}
                  className="flex-1 text-sm border border-blue-400 rounded px-2 py-1 text-gray-700 dark:text-gray-200 dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                  placeholder={t("missionPlaceholderDetailed")}
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
        <div className="flex gap-4 mb-6 border-b border-gray-200 dark:border-gray-700 items-center">
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
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("nova:show-guide"))}
            title={t("viewGuide")}
            className="ml-auto mb-2 text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 transition-colors text-sm font-medium w-5 h-5 flex items-center justify-center rounded-full border border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500"
          >
            ?
          </button>
        </div>

        {tab === "settings" ? (
          <ProjectSettings projectId={currentProjectId!} />
        ) : tab === "overview" ? (
          <div className="flex gap-6">
            {/* Main column — scrollable, takes remaining width */}
            <div className="flex-1 min-w-0">
              {/* Autopilot Trigger */}
              <section className="mb-6">
                <button
                  onClick={() => setShowAutopilotModal(true)}
                  disabled={autopilotChanging}
                  className="flex items-center gap-2.5 px-4 py-2.5 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-gray-300 dark:hover:border-gray-600 transition-colors w-full text-left"
                >
                  <span className={`text-xs font-semibold uppercase tracking-wider shrink-0 ${
                    autopilotMode === "full"
                      ? "text-orange-500 dark:text-orange-400"
                      : autopilotMode === "goal"
                        ? "text-blue-500 dark:text-blue-400"
                        : "text-gray-400 dark:text-gray-500"
                  }`}>
                    Autopilot
                  </span>
                  <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${
                    autopilotMode === "full"
                      ? "bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400"
                      : autopilotMode === "goal"
                        ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                        : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                  }`}>
                    {autopilotMode === "off" ? "Manual" : autopilotMode === "goal" ? "Goal" : "Full"}
                  </span>
                  <span className="text-[11px] text-gray-400 dark:text-gray-500 flex-1 truncate">
                    {autopilotMode === "off" && t("autopilotDescManual")}
                    {autopilotMode === "goal" && t("autopilotDescGoal")}
                    {autopilotMode === "full" && t("autopilotDescFull")}
                  </span>
                  {autopilotChanging && (
                    <svg className="animate-spin w-3.5 h-3.5 text-gray-400 shrink-0" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  )}
                  <svg className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </section>

              {/* Rate Limit Banner */}
              {queuePaused && queuePausedInfo && (
                <section className="mb-4">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                    <div className="flex items-center gap-2">
                      <span className="text-amber-500 text-sm">&#9208;</span>
                      <span className="text-xs text-amber-700 dark:text-amber-300 font-medium">
                        Rate limit — {t("retryIn")} ({queuePausedInfo.retryNumber}/{queuePausedInfo.maxRetries})
                      </span>
                    </div>
                    <button
                      onClick={handleResumeQueue}
                      className="text-[11px] px-2.5 py-1 bg-amber-100 dark:bg-amber-800/40 text-amber-700 dark:text-amber-300 rounded hover:bg-amber-200 dark:hover:bg-amber-800/60 font-medium"
                    >
                      {t("resumeNow")}
                    </button>
                  </div>
                </section>
              )}

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
                  <div className="flex items-center gap-1.5">
                    <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                      {t("goals")}
                    </h2>
                    <div className="relative group">
                      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 dark:bg-gray-700 text-[9px] font-bold text-gray-500 dark:text-gray-400 cursor-help">?</span>
                      <div className="absolute left-0 top-6 z-50 w-64 p-3 bg-white dark:bg-[#2a2a3d] border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg text-xs text-gray-600 dark:text-gray-300 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity">
                        <p className="font-semibold text-gray-800 dark:text-gray-100 mb-1">{t("specGuideTitle")}</p>
                        <p>{t("specGuideBody")}</p>
                      </div>
                    </div>
                  </div>
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
                {(() => {
                  const renderGoalCard = (goal: typeof goals[0]) => {
                    const goalTasks = tasks.filter((tk) => tk.goal_id === goal.id);
                    const doneTasks = goalTasks.filter((tk) => tk.status === "done");
                    const activeTasks = goalTasks.filter((tk) => tk.status !== "done");
                    const pct = goalTasks.length > 0 ? Math.round((doneTasks.length / goalTasks.length) * 100) : 0;
                    const isComplete = pct === 100 && goalTasks.length > 0;
                    const TASK_PREVIEW = 3;
                    const visibleActiveTasks = activeTasks.slice(0, TASK_PREVIEW);
                    const hiddenTaskCount = activeTasks.length - visibleActiveTasks.length;
                    const isDecomposing = decomposingGoalId === goal.id;
                    const isGeneratingSpec = generatingSpecGoalIds.has(goal.id);
                    return (
                      <div
                        key={goal.id}
                        className={`mb-3 border rounded-lg overflow-hidden transition-all ${
                          isDecomposing
                            ? "border-purple-300 dark:border-purple-600 bg-purple-50/50 dark:bg-purple-900/10 ring-1 ring-purple-200 dark:ring-purple-800 animate-pulse"
                            : isGeneratingSpec
                              ? "border-indigo-300 dark:border-indigo-600 bg-indigo-50/30 dark:bg-indigo-900/10 ring-1 ring-indigo-200 dark:ring-indigo-800"
                              : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#25253d]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 px-3 py-2">
                          <span className={`text-sm font-medium min-w-0 ${isComplete ? "text-gray-400 dark:text-gray-500" : "text-gray-800 dark:text-gray-100"}`}>
                            {goal.description}
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                              {doneTasks.length}/{goalTasks.length} ({pct}%)
                            </span>
                            <button
                              onClick={() => handleDeleteGoal(goal.id)}
                              title={t("deleteGoal")}
                              className="text-gray-300 dark:text-gray-600 hover:text-red-400 dark:hover:text-red-400 transition-colors p-0.5"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                              </svg>
                            </button>
                            {isGeneratingSpec ? (
                              <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-500 dark:text-indigo-400 whitespace-nowrap flex items-center gap-1">
                                <svg className="animate-spin w-2.5 h-2.5" viewBox="0 0 24 24" fill="none">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                </svg>
                                {t("specGeneratingInCard")}
                              </span>
                            ) : (
                              <button
                                onClick={() => setSpecGoalId(goal.id)}
                                className="text-[10px] px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors whitespace-nowrap"
                              >
                                {t("specView")}
                              </button>
                            )}
                            {(() => {
                              const goalTasks = tasks.filter((tk) => tk.goal_id === goal.id);
                              const hasRunning = goalTasks.some((tk) => tk.status === "in_progress" || tk.status === "in_review");
                              if (goalTasks.length > 0 && !hasRunning) return (
                                <button
                                  onClick={() => handleDecomposeGoal(goal.id)}
                                  disabled={decomposingGoalId !== null}
                                  className={`text-[10px] px-2 py-0.5 rounded flex items-center gap-1 transition-colors whitespace-nowrap ${
                                    decomposingGoalId === goal.id
                                      ? "bg-orange-200 dark:bg-orange-800/60 text-orange-500 dark:text-orange-300 cursor-wait"
                                      : "bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/50"
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
                                    t("reDecompose")
                                  )}
                                </button>
                              );
                              if (goalTasks.length > 0 && hasRunning) return (
                                <span className="text-[10px] px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 whitespace-nowrap">
                                  {t("decomposed")}
                                </span>
                              );
                              return null;
                            })()}
                            {!tasks.some((tk) => tk.goal_id === goal.id) && (
                              autopilotMode !== "off" ? (
                                <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-400 dark:text-blue-500 whitespace-nowrap flex items-center gap-1">
                                  <svg className="animate-spin w-2.5 h-2.5" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                  </svg>
                                  {t("autoDecompose")}
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
                              )
                            )}
                            <button
                              onClick={() => handleAddTask(goal.id)}
                              className="text-[10px] px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded hover:bg-gray-200 dark:hover:bg-gray-600 whitespace-nowrap"
                            >
                              {t("addTask")}
                            </button>
                          </div>
                        </div>
                        <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1 mx-3 overflow-hidden">
                          {isDecomposing ? (
                            <div className="h-1 rounded-full bg-gradient-to-r from-purple-400 via-purple-300 to-purple-400 animate-shimmer" style={{ width: "100%", backgroundSize: "200% 100%" }} />
                          ) : (
                            <div className="bg-blue-500 h-1 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          )}
                        </div>
                        {/* Inline tasks for this goal — 최대 3개 */}
                        {visibleActiveTasks.length > 0 && (
                          <div className="px-3 pb-2 space-y-1">
                            {visibleActiveTasks.map((tk) => (
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
                            {hiddenTaskCount > 0 && (
                              <span className="text-[10px] text-gray-400 dark:text-gray-500 pl-3.5">
                                {t("showMoreTasks", { count: hiddenTaskCount })}
                              </span>
                            )}
                          </div>
                        )}
                        {doneTasks.length > 0 && (
                          <div className="px-3 pb-2">
                            <span className="text-[10px] text-gray-400 dark:text-gray-500">{t("doneCount", { count: doneTasks.length })}</span>
                          </div>
                        )}
                      </div>
                    );
                  };

                  const activeGoals = goals.filter((g) => {
                    const goalTasks = tasks.filter((tk) => tk.goal_id === g.id);
                    const pct = goalTasks.length > 0
                      ? Math.round((goalTasks.filter((tk) => tk.status === "done").length / goalTasks.length) * 100)
                      : 0;
                    return !(pct === 100 && goalTasks.length > 0);
                  });
                  const completedGoals = goals.filter((g) => {
                    const goalTasks = tasks.filter((tk) => tk.goal_id === g.id);
                    const pct = goalTasks.length > 0
                      ? Math.round((goalTasks.filter((tk) => tk.status === "done").length / goalTasks.length) * 100)
                      : 0;
                    return pct === 100 && goalTasks.length > 0;
                  });
                  const visibleCompleted = showCompletedGoals
                    ? completedGoals
                    : completedGoals.slice(0, COMPLETED_GOALS_THRESHOLD);
                  const hiddenCompletedCount = completedGoals.length - visibleCompleted.length;

                  return (
                    <>
                      {/* Active 목표 */}
                      {activeGoals.map(renderGoalCard)}

                      {/* 완료 목표 섹션 */}
                      {completedGoals.length > 0 && (
                        <div className="mt-4">
                          <button
                            onClick={() => setShowCompletedGoals((v) => !v)}
                            className="flex items-center gap-2 mb-2 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                          >
                            <svg
                              className={`w-3 h-3 transition-transform ${showCompletedGoals ? "rotate-90" : ""}`}
                              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                            >
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                            <span>{t("completedGoals")} ({completedGoals.length})</span>
                          </button>
                          {showCompletedGoals && (
                            <>
                              {visibleCompleted.map(renderGoalCard)}
                              {hiddenCompletedCount > 0 && (
                                <button
                                  onClick={() => setShowCompletedGoals(true)}
                                  className="text-[11px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                                >
                                  {t("showMoreGoals", { count: hiddenCompletedCount })}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </section>

              {/* Tasks Section */}
              <section className="mb-8">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                    {t("tasks")}
                  </h2>
                  <div className="flex items-center gap-2">
                    {autopilotMode !== "off" && queueRunning && (
                      <span className="text-[10px] text-blue-500 dark:text-blue-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                        Auto
                      </span>
                    )}
                    {pendingApprovalCount > 0 && currentProjectId && (
                      <button
                        onClick={async () => {
                          await api.orchestration.approveAll(currentProjectId);
                          loadData();
                        }}
                        className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg font-medium bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                        {t("approveAll", { count: pendingApprovalCount })}
                      </button>
                    )}
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
              {/* Task Timeline */}
              <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  {hasActiveTasks ? (
                    <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" />
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-600 shrink-0" />
                  )}
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                    {t("taskTimeline")}
                  </span>
                  {hasActiveTasks && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">
                      {activeTasks.length} {t("active")}
                    </span>
                  )}
                </div>
                <div className={`${hasActiveTasks ? "h-[300px]" : "h-[120px]"} bg-white dark:bg-[#1e1e2e] transition-all`}>
                  <TaskTimeline activeTasks={activeTasks} agents={agents} />
                </div>
              </div>

              {/* Direct Prompt — only when no task is running */}
              {!hasActiveTasks && agents.length > 0 && (
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
