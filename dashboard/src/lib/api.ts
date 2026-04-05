const BASE = "/api";

// Auth — API key management
let apiKey: string | null = localStorage.getItem("nova-orbit-api-key");

export function setApiKey(key: string): void {
  apiKey = key;
  localStorage.setItem("nova-orbit-api-key", key);
}

export function getApiKey(): string | null {
  return apiKey;
}

export async function initAuth(): Promise<void> {
  if (apiKey) return;
  const res = await fetch("/api/auth/key?init=true");
  if (res.ok) {
    const data = await res.json();
    setApiKey(data.key);
  }
}

// Global server status — components can check this
let serverDown = false;
export function isServerDown() { return serverDown; }

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    };
    const res = await fetch(`${BASE}${path}`, {
      headers,
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
    getCost: (id: string) =>
      request<{ costs: Array<{ agentId: string; agentName: string; totalTokens: number; totalCost: number }> }>(
        `/projects/${id}/cost`,
      ),
    startDevServer: (id: string) =>
      request<{ status: string; port: number; url: string }>(`/projects/${id}/dev-server/start`, { method: "POST" }),
    stopDevServer: (id: string) =>
      request<{ status: string }>(`/projects/${id}/dev-server/stop`, { method: "POST" }),
    devServerStatus: (id: string) =>
      request<{ running: boolean; port: number | null; pid: number | null; url: string | null }>(
        `/projects/${id}/dev-server/status`,
      ),
  },
  agents: {
    list: (projectId: string) => request<any[]>(`/agents?projectId=${projectId}`),
    get: (id: string) => request<any>(`/agents/${id}`),
    presets: () => request<any[]>("/agents/presets"),
    teamPresets: () => request<any[]>("/agents/team-presets"),
    createTeam: (projectId: string, presetId: string) =>
      request<any>("/agents/create-team", {
        method: "POST",
        body: JSON.stringify({ project_id: projectId, preset_id: presetId }),
      }),
    suggest: (mission: string, techStack?: any) =>
      request<any[]>("/agents/suggest", { method: "POST", body: JSON.stringify({ mission, techStack }) }),
    suggestAndCreate: (projectId: string, mission: string, techStack?: any) =>
      request<any>("/agents/suggest-and-create", {
        method: "POST",
        body: JSON.stringify({ project_id: projectId, mission, techStack }),
      }),
    scanProject: (projectId: string) =>
      request<any>("/agents/scan-project", {
        method: "POST",
        body: JSON.stringify({ project_id: projectId }),
      }),
    create: (data: any) => request<any>("/agents", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: any) =>
      request<any>(`/agents/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    delete: (id: string) => request<any>(`/agents/${id}`, { method: "DELETE" }),
    deleteAll: (projectId: string) => request<{ success: boolean; deleted: number }>(`/agents/bulk/${projectId}`, { method: "DELETE" }),
    stats: (id: string) =>
      request<{ taskCount: number; totalTokens: number; totalCostUsd: number }>(`/agents/${id}/stats`),
  },
  goals: {
    list: (projectId: string) => request<any[]>(`/goals?projectId=${projectId}`),
    create: (data: any) => request<any>("/goals", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: any) =>
      request<any>(`/goals/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    delete: (id: string) => request<any>(`/goals/${id}`, { method: "DELETE" }),
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
    bulkApprove: (projectId: string) =>
      request<{ approved: number }>("/tasks/bulk-approve", {
        method: "POST",
        body: JSON.stringify({ projectId }),
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
    queueStatus: (projectId: string) =>
      request<{ running: boolean; paused: boolean; activeTasks: number; maxConcurrency: number; rateLimitRetries: number; nextRetryAt: string | null }>(
        `/orchestration/projects/${projectId}/queue-status`,
      ),
    startQueue: (projectId: string) =>
      request<any>(`/orchestration/projects/${projectId}/run-queue`, { method: "POST" }),
    stopQueue: (projectId: string) =>
      request<any>(`/orchestration/projects/${projectId}/stop-queue`, { method: "POST" }),
    resumeQueue: (projectId: string) =>
      request<any>(`/orchestration/projects/${projectId}/resume-queue`, { method: "POST" }),
    pauseAgent: (agentId: string) =>
      request<any>(`/orchestration/agents/${agentId}/pause`, { method: "POST" }),
    resumeAgent: (agentId: string) =>
      request<any>(`/orchestration/agents/${agentId}/resume`, { method: "POST" }),
    verifyTask: (taskId: string, scope = "standard") =>
      request<any>(`/orchestration/tasks/${taskId}/verify`, {
        method: "POST",
        body: JSON.stringify({ scope }),
      }),
    sendPrompt: (agentId: string, message: string) =>
      request<{ status: string; agentId: string }>(`/orchestration/agents/${agentId}/prompt`, {
        method: "POST",
        body: JSON.stringify({ message }),
      }),
    multiPrompt: (agentIds: string[], message: string, projectId: string) =>
      request<{ status: string; sessionId: string }>("/orchestration/multi-prompt", {
        method: "POST",
        body: JSON.stringify({ agentIds, message, projectId }),
      }),
    approveTask: (projectId: string, taskId: string) =>
      request<any>(`/orchestration/${projectId}/tasks/${taskId}/approve`, { method: "POST" }),
    rejectTask: (projectId: string, taskId: string, reason?: string) =>
      request<any>(`/orchestration/${projectId}/tasks/${taskId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    approveAll: (projectId: string) =>
      request<{ approved: number }>(`/orchestration/${projectId}/tasks/approve-all`, { method: "POST" }),
  },
};
