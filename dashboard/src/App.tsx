import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "./stores/useStore";
import { useWebSocket } from "./hooks/useWebSocket";
import { api } from "./lib/api";
import { Sidebar } from "./components/Sidebar";
import { ProjectHome } from "./components/ProjectHome";
import { ThemeToggle } from "./components/ThemeToggle";
import { LanguageToggle } from "./components/LanguageToggle";
import { CommandPalette, CMD_EVENTS } from "./components/CommandPalette";

function App() {
  const { t, i18n } = useTranslation();
  const { projects, setProjects, setCurrentProject, connected } = useStore();

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

  // CommandPalette action handlers
  useEffect(() => {
    const onNewProject = async () => {
      const name = prompt("Project name:");
      if (!name) return;
      const mission = prompt("Mission (what are you building?):");
      const project = await api.projects.create({ name, mission: mission ?? "", source: "new" });
      setProjects([...projects, project]);
      setCurrentProject(project.id);
    };

    const onImportLocal = async () => {
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
          alert(err.error ?? "Import failed");
          return;
        }
        const imported = await res.json();
        setProjects([...projects, imported]);
        setCurrentProject(imported.id);
      } catch {
        alert("Import failed");
      }
    };

    const onConnectGitHub = () => {
      // Dispatch a sidebar-level event; Sidebar handles GitHub connection
      window.dispatchEvent(new CustomEvent("nova:connect-github"));
    };

    const onAddAgent = () => {
      window.dispatchEvent(new CustomEvent("nova:add-agent"));
    };

    const onAddGoal = () => {
      window.dispatchEvent(new CustomEvent("nova:add-goal"));
    };

    const onSwitchTheme = () => {
      const root = document.documentElement;
      const isDark = root.classList.contains("dark");
      if (isDark) {
        root.classList.remove("dark");
        root.classList.add("light");
        localStorage.setItem("nova-theme", "light");
      } else {
        root.classList.add("dark");
        root.classList.remove("light");
        localStorage.setItem("nova-theme", "dark");
      }
    };

    const onSwitchLang = () => {
      const current = i18n.language.startsWith("ko") ? "ko" : "en";
      const next = current === "en" ? "ko" : "en";
      i18n.changeLanguage(next);
      localStorage.setItem("nova-lang", next);
    };

    const onGoTab = (e: Event) => {
      const detail = (e as CustomEvent<{ tab: string }>).detail;
      window.dispatchEvent(new CustomEvent("nova:go-tab", { detail }));
    };

    window.addEventListener(CMD_EVENTS.NEW_PROJECT, onNewProject);
    window.addEventListener(CMD_EVENTS.IMPORT_LOCAL, onImportLocal);
    window.addEventListener(CMD_EVENTS.CONNECT_GITHUB, onConnectGitHub);
    window.addEventListener(CMD_EVENTS.ADD_AGENT, onAddAgent);
    window.addEventListener(CMD_EVENTS.ADD_GOAL, onAddGoal);
    window.addEventListener(CMD_EVENTS.SWITCH_THEME, onSwitchTheme);
    window.addEventListener(CMD_EVENTS.SWITCH_LANG, onSwitchLang);
    window.addEventListener(CMD_EVENTS.GO_TAB, onGoTab);

    return () => {
      window.removeEventListener(CMD_EVENTS.NEW_PROJECT, onNewProject);
      window.removeEventListener(CMD_EVENTS.IMPORT_LOCAL, onImportLocal);
      window.removeEventListener(CMD_EVENTS.CONNECT_GITHUB, onConnectGitHub);
      window.removeEventListener(CMD_EVENTS.ADD_AGENT, onAddAgent);
      window.removeEventListener(CMD_EVENTS.ADD_GOAL, onAddGoal);
      window.removeEventListener(CMD_EVENTS.SWITCH_THEME, onSwitchTheme);
      window.removeEventListener(CMD_EVENTS.SWITCH_LANG, onSwitchLang);
      window.removeEventListener(CMD_EVENTS.GO_TAB, onGoTab);
    };
  }, [projects, setProjects, setCurrentProject, i18n]);

  return (
    <div className="flex h-screen bg-white dark:bg-[#1a1a2e]">
      <CommandPalette />
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-10 border-b border-gray-200 dark:border-gray-700 flex items-center justify-end px-4 shrink-0 bg-white dark:bg-[#1a1a2e]">
          <div className="flex items-center gap-3">
            <LanguageToggle />
            <ThemeToggle />
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  connected ? "bg-green-400" : "bg-red-400"
                }`}
              />
              <span className="text-[10px] text-gray-400">
                {connected ? t("connected") : t("disconnected")}
              </span>
            </div>
          </div>
        </header>

        <ProjectHome />
      </main>
    </div>
  );
}

export default App;
