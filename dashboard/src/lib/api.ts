const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "Request failed");
  }
  return res.json();
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
  },
  verifications: {
    list: (projectId: string) => request<any[]>(`/verifications?projectId=${projectId}`),
    listByTask: (taskId: string) => request<any[]>(`/verifications?taskId=${taskId}`),
  },
};
