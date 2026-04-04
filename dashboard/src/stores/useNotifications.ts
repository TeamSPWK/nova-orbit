import { create } from "zustand";

export type NotificationType = "success" | "error" | "info";

export interface NotificationEntry {
  id: string;
  message: string;
  type: NotificationType;
  timestamp: Date;
}

interface NotificationsState {
  notifications: NotificationEntry[];
  addNotification: (message: string, type?: NotificationType) => void;
  clearAll: () => void;
}

let counter = 0;

export const useNotifications = create<NotificationsState>((set) => ({
  notifications: [],
  addNotification: (message, type = "info") => {
    const entry: NotificationEntry = {
      id: `notif-${Date.now()}-${++counter}`,
      message,
      type,
      timestamp: new Date(),
    };
    set((state) => ({
      notifications: [entry, ...state.notifications].slice(0, 50),
    }));
  },
  clearAll: () => set({ notifications: [] }),
}));
