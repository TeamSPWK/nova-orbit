import { create } from "zustand";
import type { NotificationType } from "./useNotifications";
import { useNotifications } from "./useNotifications";

export interface ToastItem {
  id: string;
  message: string;
  type: NotificationType;
  detail?: string;
  /** error toasts stay until dismissed; others auto-dismiss */
  persistent: boolean;
}

interface ToastStore {
  toasts: ToastItem[];
  /** Show a toast. Error toasts persist until dismissed; others auto-dismiss after 3s. */
  showToast: (message: string, type?: NotificationType, detail?: string) => void;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

let _seq = 0;

export const useToast = create<ToastStore>((set) => ({
  toasts: [],
  showToast: (message, type = "info", detail) => {
    const id = `toast-${++_seq}-${Date.now()}`;
    const persistent = type === "error";
    set((s) => ({ toasts: [...s.toasts, { id, message, type, detail, persistent }] }));

    // Also record in notification history (bell icon)
    useNotifications.getState().addNotification(message, type);

    if (!persistent) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, 5000);
    }
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  dismissAll: () => set({ toasts: [] }),
}));
