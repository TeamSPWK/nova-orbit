import { useEffect, useState, useCallback } from "react";
import { useStore } from "../stores/useStore";
import { api } from "../lib/api";
import { AgentCard } from "./AgentCard";
import { AgentDetail } from "./AgentDetail";
import { TaskList } from "./TaskList";
import { VerificationLog } from "./VerificationLog";
import { ActivityFeed } from "./ActivityFeed";
import { AddAgentDialog } from "./AddAgentDialog";
import { KanbanBoard } from "./KanbanBoard";
import { ProjectSettings } from "./ProjectSettings";

type Tab = "overview" | "kanban" | "verification" | "settings";

export function ProjectHome() {
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

  const project = projects.find((p) => p.id === currentProjectId);

  const loadData = useCallback(() => {
    if (!currentProjectId) return;
    Promise.all([
      api.agents.list(currentProjectId),
      api.goals.list(currentProjectId),
      api.tasks.list(currentProjectId),
    ]).then(([a, g, t]) => {
      setAgents(a);
      setGoals(g);
      setTasks(t);
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

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <div className="text-center">
          <div className="text-4xl mb-4">&#x1F680;</div>
          <p className="text-lg">Select or create a project to get started</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        Loading...
      </div>
    );
  }

  const handleAddAgent = () => setShowAddAgent(true);

  const handleAgentCreated = (agent: any) => {
    setAgents([...agents, agent]);
    setShowAddAgent(false);
  };

  const handleAddGoal = async () => {
    const description = prompt("Goal description:");
    if (!description) return;
    const goal = await api.goals.create({
      project_id: currentProjectId,
      description,
    });
    setGoals([...goals, goal]);
  };

  const handleDecomposeGoal = async (goalId: string) => {
    try {
      await api.orchestration.decomposeGoal(goalId);
      // Tasks will be created and we'll get a WebSocket notification
    } catch (err) {
      alert("Failed to decompose goal");
    }
  };

  const handleAddTask = async (goalId: string) => {
    const title = prompt("Task title:");
    if (!title) return;
    const task = await api.tasks.create({
      goal_id: goalId,
      project_id: currentProjectId,
      title,
    });
    setTasks([...tasks, task]);
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
      alert("Failed to save mission");
    } finally {
      setSavingMission(false);
    }
  };

  const handleHeaderMissionKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") saveHeaderMission();
    if (e.key === "Escape") cancelEditHeaderMission();
  };

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null;

  return (
    <div className="flex-1 overflow-y-auto">
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
      <div className="max-w-4xl mx-auto py-8 px-6">
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
                  placeholder="Project mission..."
                />
                <button
                  onClick={saveHeaderMission}
                  disabled={savingMission}
                  className="text-xs px-2 py-0.5 bg-gray-900 text-white rounded hover:bg-gray-700 disabled:opacity-50"
                >
                  {savingMission ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={cancelEditHeaderMission}
                  disabled={savingMission}
                  className="text-xs px-2 py-0.5 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <p
                className="text-gray-500 cursor-pointer hover:text-gray-700 group inline-flex items-center gap-1"
                onClick={startEditHeaderMission}
                title="Click to edit"
              >
                {project.mission || <span className="italic text-gray-400">No mission — click to add</span>}
                <span className="text-xs text-gray-300 group-hover:text-gray-400 transition-colors">
                  Edit
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

        {/* Tabs */}
        <div className="flex gap-4 mb-6 border-b border-gray-200 dark:border-gray-700">
          {(["overview", "kanban", "verification", "settings"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pb-2 text-sm capitalize transition-colors ${
                tab === t
                  ? "text-gray-900 dark:text-gray-100 border-b-2 border-gray-900 dark:border-gray-100 font-medium"
                  : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              }`}
            >
              {t === "verification" ? "Verification Log" : t}
            </button>
          ))}
        </div>

        {tab === "settings" ? (
          <ProjectSettings projectId={currentProjectId!} />
        ) : tab === "overview" ? (
          <>
            {/* Agents Section */}
            <section className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                  Agents
                </h2>
                <button
                  onClick={handleAddAgent}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  + Add Agent
                </button>
              </div>
              {agents.length === 0 ? (
                <p className="text-sm text-gray-400">
                  No agents yet. Add one to get started.
                </p>
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
                  Goals
                </h2>
                <button
                  onClick={handleAddGoal}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  + Add Goal
                </button>
              </div>
              {goals.map((goal) => (
                <div
                  key={goal.id}
                  className="mb-4 p-3 border border-gray-200 rounded-lg"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-800">
                      {goal.description}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">
                        {goal.progress}%
                      </span>
                      <button
                        onClick={() => handleDecomposeGoal(goal.id)}
                        className="text-[10px] px-2 py-0.5 bg-purple-50 text-purple-600 rounded hover:bg-purple-100"
                        title="AI Decompose: Break goal into tasks"
                      >
                        Decompose
                      </button>
                      <button
                        onClick={() => handleAddTask(goal.id)}
                        className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded hover:bg-gray-200"
                      >
                        + Task
                      </button>
                    </div>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
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
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Tasks
              </h2>
              <TaskList tasks={tasks} agents={agents} onUpdate={loadData} />
            </section>

            {/* Recent Activity Section */}
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Recent Activity
              </h2>
              <ActivityFeed projectId={currentProjectId!} />
            </section>
          </>
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
