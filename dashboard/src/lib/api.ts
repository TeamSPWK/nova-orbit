const BASE = "/api";

// Global server status — components can check this
let serverDown = false;
export function isServerDown() { return serverDown; }

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    // Server responded — mark as up
    if (serverDown) {
      serverDown = false;
      window.dispatchEvent(new CustomEvent("nova:server-status", { detail: { up: true } }));
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? "Request failed");
    }
    return res.json();
  } catch (err: any) {
    // Network error = server is down
    if (err instanceof TypeError && err.message.includes("fetch")) {
      serverDown = true;
      window.dispatchEvent(new CustomEvent("nova:server-status", { detail: { up: false } }));
    }
    throw err;
  }
}

// Projects
export const api = {
  projects: {
    list: () => request<any[]>("/projects"),
    get: (id: string) => request<any>(`/projects/${id}`),
    create: (data: any) => request<any>("/projects", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: any) =>
      request<any>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    delete: (id: string) => request<any>(`/projects/${id}`, { method: "DELETE" }),
  },
  agents: {
    list: (projectId: string) => request<any[]>(`/agents?projectId=${projectId}`),
    presets: () => request<any[]>("/agents/presets"),
    create: (data: any) => request<any>("/agents", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: any) =>
      request<any>(`/agents/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  },
  goals: {
    list: (projectId: string) => request<any[]>(`/goals?projectId=${projectId}`),
    create: (data: any) => request<any>("/goals", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: any) =>
      request<any>(`/goals/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  },
  tasks: {
    list: (projectId: string) => request<any[]>(`/tasks?projectId=${projectId}`),
    listByGoal: (goalId: string) => request<any[]>(`/tasks?goalId=${goalId}`),
    create: (data: any) => request<any>("/tasks", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: any) =>
      request<any>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    approve: (id: string) =>
      request<any>(`/tasks/${id}/approve`, { method: "POST" }),
    reject: (id: string, feedback?: string) =>
      request<any>(`/tasks/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ feedback }),
      }),
  },
  activities: {
    list: (projectId: string) => request<any[]>(`/activities?projectId=${projectId}`),
  },
  verifications: {
    list: (projectId: string) => request<any[]>(`/verifications?projectId=${projectId}`),
    listByTask: (taskId: string) => request<any[]>(`/verifications?taskId=${taskId}`),
    createFixTask: (id: string) =>
      request<any>(`/verifications/${id}/create-fix-task`, { method: "POST" }),
  },
  orchestration: {
    executeTask: (taskId: string, scope = "standard") =>
      request<any>(`/orchestration/tasks/${taskId}/execute`, {
        method: "POST",
        body: JSON.stringify({ verificationScope: scope }),
      }),
    decomposeGoal: (goalId: string) =>
      request<any>(`/orchestration/goals/${goalId}/decompose`, { method: "POST" }),
    killAgent: (agentId: string) =>
      request<any>(`/orchestration/agents/${agentId}/kill`, { method: "POST" }),
    killAll: () =>
      request<any>("/orchestration/sessions/kill-all", { method: "POST" }),
    startQueue: (projectId: string) =>
      request<any>(`/orchestration/projects/${projectId}/run-queue`, { method: "POST" }),
    stopQueue: (projectId: string) =>
      request<any>(`/orchestration/projects/${projectId}/stop-queue`, { method: "POST" }),
    pauseAgent: (agentId: string) =>
      request<any>(`/orchestration/agents/${agentId}/pause`, { method: "POST" }),
    resumeAgent: (agentId: string) =>
      request<any>(`/orchestration/agents/${agentId}/resume`, { method: "POST" }),
  },
};
