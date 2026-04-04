import { useEffect } from "react";
import { useStore } from "./stores/useStore";
import { useWebSocket } from "./hooks/useWebSocket";
import { api } from "./lib/api";
import { Sidebar } from "./components/Sidebar";
import { ProjectHome } from "./components/ProjectHome";

function App() {
  const { setProjects, setCurrentProject, connected } = useStore();

  useWebSocket();

  // Load projects on mount
  useEffect(() => {
    api.projects.list().then((projects) => {
      setProjects(projects);
      if (projects.length > 0) {
        setCurrentProject(projects[0].id);
      }
    });
  }, [setProjects, setCurrentProject]);

  // Listen for refresh events from WebSocket
  useEffect(() => {
    const handler = () => {
      api.projects.list().then(setProjects);
    };
    window.addEventListener("nova:refresh", handler);
    return () => window.removeEventListener("nova:refresh", handler);
  }, [setProjects]);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-10 border-b border-gray-200 flex items-center justify-end px-4 shrink-0">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                connected ? "bg-green-400" : "bg-red-400"
              }`}
            />
            <span className="text-[10px] text-gray-400">
              {connected ? "Connected" : "Disconnected"}
            </span>
          </div>
        </header>

        <ProjectHome />
      </main>
    </div>
  );
}

export default App;
