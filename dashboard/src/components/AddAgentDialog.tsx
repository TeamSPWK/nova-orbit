import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";

interface Preset {
  name: string;
  role: string;
  description: string;
}

interface AddAgentDialogProps {
  projectId: string;
  onCreated: (agent: any) => void;
  onClose: () => void;
}

export function AddAgentDialog({ projectId, onCreated, onClose }: AddAgentDialogProps) {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [customName, setCustomName] = useState("");

  useEffect(() => {
    api.agents.presets().then(setPresets).catch(() => {
      setPresets([
        { name: "Developer", role: "coder", description: "Implements code" },
        { name: "Reviewer", role: "reviewer", description: "Reviews code quality" },
      ]);
    });
  }, []);

  const handleSelectPreset = async (preset: Preset) => {
    try {
      const agent = await api.agents.create({
        project_id: projectId,
        name: preset.name,
        role: preset.role,
      });
      onCreated(agent);
    } catch {
      // Silently fail — user will see no change
    }
  };

  const handleCreateCustom = async () => {
    if (!customName.trim()) return;
    try {
      const agent = await api.agents.create({
        project_id: projectId,
        name: customName,
        role: "custom",
      });
      onCreated(agent);
    } catch {
      // Silently fail
    }
  };

  return (
    <div className="fixed inset-0 bg-black/20 dark:bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#25253d] rounded-xl shadow-lg w-[480px] max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{t("addAgentTitle")}</h3>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t("addAgentSubtitle")}</p>
        </div>

        <div className="p-5 space-y-2">
          {presets.map((p) => (
            <button
              key={p.role}
              onClick={() => handleSelectPreset(p)}
              className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-500 hover:bg-blue-50/30 dark:hover:bg-blue-900/20 transition-colors"
            >
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{p.name}</div>
              <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{p.description}</div>
            </button>
          ))}

          <div className="pt-3 border-t border-gray-100 dark:border-gray-700">
            <div className="flex gap-2">
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder={t("customAgentPlaceholder")}
                className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-[#1a1a2e] text-gray-800 dark:text-gray-200 focus:outline-none focus:border-blue-400"
                onKeyDown={(e) => e.key === "Enter" && handleCreateCustom()}
              />
              <button
                onClick={handleCreateCustom}
                disabled={!customName.trim()}
                className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40"
              >
                {t("create")}
              </button>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            {t("cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
