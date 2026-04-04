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
      const result = await api.projects.create({}) as any;
      // Actually use the import endpoint
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

  return (
    <aside className="w-[260px] h-screen border-r border-gray-200 bg-gray-50/50 flex flex-col shrink-0">
      {/* Logo */}
      <div className="px-4 py-3 border-b border-gray-200">
        <h1 className="text-sm font-semibold text-gray-800 tracking-tight">
          Nova Orbit
        </h1>
        <p className="text-xs text-gray-400">AI Team Orchestration</p>
      </div>

      {/* Project List */}
      <nav className="flex-1 overflow-y-auto py-2">
        <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-gray-400 font-medium">
          Projects
        </div>
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => setCurrentProject(p.id)}
            className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-gray-100 transition-colors ${
              currentProjectId === p.id
                ? "bg-gray-100 text-gray-900 font-medium"
                : "text-gray-600"
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
      <div className="p-3 border-t border-gray-200 space-y-1">
        <button
          onClick={handleNewProject}
          className="w-full py-1.5 text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors"
        >
          + New Project
        </button>
        <button
          onClick={handleImportProject}
          className="w-full py-1.5 text-sm text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
        >
          Import Local
        </button>
      </div>
    </aside>
  );
}
