import { useEffect } from "react";
import { useTranslation } from "react-i18next";

interface KeyboardShortcutsProps {
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: ["⌘", "K"], descKey: "shortcutCmdPalette" },
  { keys: ["?"], descKey: "shortcutHelp" },
] as const;

export function KeyboardShortcuts({ onClose }: KeyboardShortcutsProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-[#25253d] border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-6 w-80"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">
          {t("keyboardShortcuts")}
        </h2>
        <ul className="space-y-3">
          {SHORTCUTS.map((shortcut) => (
            <li key={shortcut.descKey} className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-300">
                {t(shortcut.descKey)}
              </span>
              <div className="flex items-center gap-1">
                {shortcut.keys.map((key) => (
                  <kbd
                    key={key}
                    className="px-1.5 py-0.5 text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded"
                  >
                    {key}
                  </kbd>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[11px] text-gray-400 text-center">Esc to close</p>
      </div>
    </div>
  );
}
