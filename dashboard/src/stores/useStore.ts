import { create } from "zustand";

interface Project {
  id: string;
  name: string;
  mission: string;
  source: string;
  status: string;
  workdir: string;
  created_at: string;
}

interface Agent {
  id: string;
  project_id: string;
  name: string;
  role: string;
  status: string;
  current_task_id: string | null;
}

interface Task {
  id: string;
  goal_id: string;
  project_id: string;
  title: string;
  description: string;
  assignee_id: string | null;
  status: string;
  verification_id: string | null;
}

interface Goal {
  id: string;
  project_id: string;
  description: string;
  priority: string;
  progress: number;
}

interface AppStore {
  // Projects
  projects: Project[];
  currentProjectId: string | null;
  setProjects: (projects: Project[]) => void;
  setCurrentProject: (id: string | null) => void;

  // Agents
  agents: Agent[];
  setAgents: (agents: Agent[]) => void;

  // Goals
  goals: Goal[];
  setGoals: (goals: Goal[]) => void;

  // Tasks
  tasks: Task[];
  setTasks: (tasks: Task[]) => void;
  updateTask: (task: Task) => void;

  // WebSocket
  connected: boolean;
  setConnected: (connected: boolean) => void;
}

export const useStore = create<AppStore>((set) => ({
  projects: [],
  currentProjectId: null,
  setProjects: (projects) => set({ projects }),
  setCurrentProject: (id) => set({ currentProjectId: id }),

  agents: [],
  setAgents: (agents) => set({ agents }),

  goals: [],
  setGoals: (goals) => set({ goals }),

  tasks: [],
  setTasks: (tasks) => set({ tasks }),
  updateTask: (task) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === task.id ? task : t)),
    })),

  connected: false,
  setConnected: (connected) => set({ connected }),
}));
