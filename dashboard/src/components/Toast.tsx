import { useEffect } from "react";
import { useNotifications } from "../stores/useNotifications";
import type { NotificationType } from "../stores/useNotifications";

interface ToastProps {
  message: string;
  type?: NotificationType;
  onDismiss: () => void;
  durationMs?: number;
}

export function Toast({ message, type = "info", onDismiss, durationMs = 3500 }: ToastProps) {
  const { addNotification } = useNotifications();

  useEffect(() => {
    addNotification(message, type);
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
  // addNotification은 zustand 함수라 레퍼런스 안정적. message/type은 초기 표시 시점에만 기록하면 됨.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[100] bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm px-4 py-2.5 rounded-lg shadow-lg max-w-sm text-center"
      onClick={onDismiss}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}
