import { useEffect, useState } from "react";
import { useStore } from "../stores/useStore";
import { api } from "../lib/api";
import { AgentCard } from "./AgentCard";
import { TaskList } from "./TaskList";

export function ProjectHome() {
  const { currentProjectId, projects, agents, setAgents, goals, setGoals, tasks, setTasks } =
    useStore();
  const [loading, setLoading] = useState(true);

  const project = projects.find((p) => p.id === currentProjectId);

  useEffect(() => {
    if (!currentProjectId) return;

    setLoading(true);
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

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <div className="text-center">
          <div className="text-4xl mb-4">🚀</div>
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

  const handleAddAgent = async () => {
    const name = prompt("Agent name:");
    if (!name) return;
    const role = prompt("Role (coder/reviewer/marketer/designer/qa):", "coder");
    if (!role) return;
    const agent = await api.agents.create({
      project_id: currentProjectId,
      name,
      role,
    });
    setAgents([...agents, agent]);
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

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto py-8 px-6">
        {/* Project Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
          {project.mission && (
            <p className="text-gray-500 mt-1">{project.mission}</p>
          )}
          <div className="flex gap-2 mt-2">
            <span className="text-xs px-2 py-0.5 bg-green-50 text-green-600 rounded">
              {project.status}
            </span>
            <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded">
              {project.source}
            </span>
          </div>
        </div>

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
            <p className="text-sm text-gray-400">No agents yet. Add one to get started.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
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
            <div key={goal.id} className="mb-4 p-3 border border-gray-200 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-800">
                  {goal.description}
                </span>
                <span className="text-xs text-gray-400">{goal.progress}%</span>
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
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Tasks
          </h2>
          <TaskList tasks={tasks} agents={agents} />
        </section>
      </div>
    </div>
  );
}
