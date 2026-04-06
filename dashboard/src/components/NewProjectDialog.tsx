import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DirectoryPicker } from "./DirectoryPicker";

interface NewProjectDialogProps {
  onSubmit: (name: string, mission: string, workdir: string, autoAgents: boolean) => void;
  onCancel: () => void;
}

export function NewProjectDialog({ onSubmit, onCancel }: NewProjectDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [mission, setMission] = useState("");
  const [workdir, setWorkdir] = useState("");
  const [autoAgents, setAutoAgents] = useState(true);
  const [showBrowser, setShowBrowser] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    if (name.trim() && workdir.trim()) onSubmit(name.trim(), mission.trim(), workdir.trim(), autoAgents);
  };

  if (showBrowser) {
    return (
      <DirectoryPicker
        onSubmit={(path) => {
          setWorkdir(path);
          setShowBrowser(false);
        }}
        onCancel={() => setShowBrowser(false)}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 bg-black/20 dark:bg-black/50 flex items-center justify-center z-50"
      onClick={onCancel}
    >
      <div
        className="bg-white dark:bg-[#25253d] rounded-xl shadow-lg w-[460px] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {t("newProject")}
          </h3>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
              {t("promptProjectName")} *
            </label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
              placeholder={t("promptProjectNameHint")}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-[#1a1a2e] text-gray-800 dark:text-gray-200 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
              {t("promptWorkdir")} *
            </label>
            <div className="flex gap-2">
              <div
                onClick={() => setShowBrowser(true)}
                className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-[#1a1a2e] text-gray-800 dark:text-gray-200 font-mono cursor-pointer hover:border-blue-400 transition-colors truncate"
              >
                {workdir || (
                  <span className="text-gray-400 dark:text-gray-500">
                    {t("promptWorkdirHint")}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowBrowser(true)}
                className="px-3 py-2 text-xs font-medium border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors shrink-0"
              >
                {t("browse")}
              </button>
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
              {t("promptWorkdirDesc")}
            </p>
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
              {t("promptMission")}
            </label>
            <input
              type="text"
              value={mission}
              onChange={(e) => setMission(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
                if (e.key === "Escape") onCancel();
              }}
              placeholder={t("promptMissionHint")}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-[#1a1a2e] text-gray-800 dark:text-gray-200 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </div>
          {/* Auto-create agents toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoAgents}
              onChange={(e) => setAutoAgents(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-500 focus:ring-blue-400"
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t("autoCreateAgents")}
            </span>
          </label>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-xs px-3 py-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 rounded"
          >
            {t("cancel")}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || !workdir.trim()}
            className="text-xs px-4 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-40"
          >
            {t("create")}
          </button>
        </div>
      </div>
    </div>
  );
}
