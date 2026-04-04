import { useStore } from "../stores/useStore";
import { api } from "../lib/api";

export function Sidebar() {
  const { projects, currentProjectId, setCurrentProject, setProjects } = useStore();

  const handleNewProject = async () => {
    const name = prompt("Project name:");
    if (!name) return;
    const project = await api.projects.create({ name, source: "new" });
    setProjects([...projects, project]);
    setCurrentProject(project.id);
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
              {p.source === "github" ? "\uD83D\uDD17" : "\uD83D\uDCC1"}
            </span>
            <span className="truncate">{p.name}</span>
          </button>
        ))}
      </nav>

      {/* New Project Button */}
      <div className="p-3 border-t border-gray-200">
        <button
          onClick={handleNewProject}
          className="w-full py-1.5 text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors"
        >
          + New Project
        </button>
      </div>
    </aside>
  );
}
