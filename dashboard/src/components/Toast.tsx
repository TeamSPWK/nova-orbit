import { useEffect } from "react";
import { useNotifications } from "../stores/useNotifications";
import type { NotificationType } from "../stores/useNotifications";

interface ToastProps {
  message: string;
  type?: NotificationType;
  onDismiss: () => void;
  durationMs?: number;
}

const TYPE_STYLES: Record<NotificationType, string> = {
  info: "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900",
  success: "bg-emerald-600 dark:bg-emerald-500 text-white",
  error: "bg-red-600 dark:bg-red-500 text-white",
};

const TYPE_ICONS: Record<NotificationType, string> = {
  info: "",
  success: "\u2713",
  error: "!",
};

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
      className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-[100] text-sm px-4 py-2.5 rounded-lg shadow-lg max-w-sm text-center flex items-center gap-2 ${TYPE_STYLES[type]}`}
      onClick={onDismiss}
      role="status"
      aria-live="polite"
    >
      {TYPE_ICONS[type] && (
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/20 text-[10px] font-bold shrink-0">
          {TYPE_ICONS[type]}
        </span>
      )}
      {message}
    </div>
  );
}
