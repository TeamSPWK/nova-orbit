import { useState } from "react";
import { useStore } from "../stores/useStore";
import { api } from "../lib/api";

export function Sidebar() {
  const { projects, currentProjectId, setCurrentProject, setProjects } = useStore();
  const [showImport, setShowImport] = useState(false);

  const handleNewProject = async () => {
    const name = prompt("Project name:");
    if (!name) return;
    const mission = prompt("Mission (what are you building?):");
    const project = await api.projects.create({ name, mission: mission ?? "", source: "new" });
    setProjects([...projects, project]);
    setCurrentProject(project.id);
  };

  const handleImportProject = async () => {
    const path = prompt("Local project path (e.g., ~/projects/my-app):");
    if (!path) return;

    try {
      const res = await fetch("/api/projects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, name: path.split("/").pop() }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(`Import failed: ${err.error}`);
        return;
      }

      const data = await res.json();
      // Reload projects
      const updatedProjects = await api.projects.list();
      setProjects(updatedProjects);
      setCurrentProject(data.project.id);

      const agentNames = data.agents.map((a: any) => `${a.name} (${a.role})`).join(", ");
      alert(
        `Imported! Tech: ${data.analysis.techStack.languages.join(", ")}\n` +
          `Frameworks: ${data.analysis.techStack.frameworks.join(", ") || "none"}\n` +
          `Suggested agents: ${agentNames}`,
      );
    } catch (err: any) {
      alert(`Import failed: ${err.message}`);
    }
  };

  const handleConnectGitHub = async () => {
    const url = prompt("GitHub repo URL or owner/repo (e.g., user/my-app):");
    if (!url) return;

    try {
      const res = await fetch("/api/projects/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(`GitHub connect failed: ${err.error}`);
        return;
      }

      const data = await res.json();
      const updatedProjects = await api.projects.list();
      setProjects(updatedProjects);
      setCurrentProject(data.project.id);

      const agentNames = data.agents.map((a: any) => `${a.name} (${a.role})`).join(", ");
      alert(
        `Connected! Branch: ${data.branch}\n` +
          `Tech: ${data.analysis.techStack.languages.join(", ")}\n` +
          `Agents: ${agentNames}`,
      );
    } catch (err: any) {
      alert(`GitHub connect failed: ${err.message}`);
    }
  };

  return (
    <aside className="w-[260px] h-screen border-r border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-[#16162a] flex flex-col shrink-0">
      {/* Logo */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h1 className="text-sm font-semibold text-gray-800 dark:text-gray-200 tracking-tight">
          Nova Orbit
        </h1>
        <p className="text-xs text-gray-400 dark:text-gray-500">AI Team Orchestration</p>
      </div>

      {/* Project List */}
      <nav className="flex-1 overflow-y-auto py-2">
        <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium">
          Projects
        </div>
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => setCurrentProject(p.id)}
            className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${
              currentProjectId === p.id
                ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium"
                : "text-gray-600 dark:text-gray-300"
            }`}
          >
            <span className="text-base">
              {p.source === "github"
                ? "\uD83D\uDD17"
                : p.source === "local_import"
                  ? "\uD83D\uDCC2"
                  : "\uD83D\uDCC1"}
            </span>
            <span className="truncate">{p.name}</span>
          </button>
        ))}
      </nav>

      {/* Action Buttons */}
      <div className="p-3 border-t border-gray-200 dark:border-gray-700 space-y-1">
        <button
          onClick={handleNewProject}
          className="w-full py-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
        >
          + New Project
        </button>
        <button
          onClick={handleImportProject}
          className="w-full py-1.5 text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
        >
          Import Local
        </button>
        <button
          onClick={handleConnectGitHub}
          className="w-full py-1.5 text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
        >
          Connect GitHub
        </button>
      </div>
    </aside>
  );
}
