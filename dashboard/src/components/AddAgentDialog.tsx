import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";

interface Preset {
  name: string;
  role: string;
  description: string;
  systemPrompt?: string;
}

interface AddAgentDialogProps {
  projectId: string;
  onCreated: (agent: any) => void;
  onClose: () => void;
}

const PRESET_I18N: Record<string, { nameKey: string; descKey: string }> = {
  coder: { nameKey: "presetCoderName", descKey: "presetCoderDesc" },
  reviewer: { nameKey: "presetReviewerName", descKey: "presetReviewerDesc" },
  qa: { nameKey: "presetQaName", descKey: "presetQaDesc" },
  marketer: { nameKey: "presetMarketerName", descKey: "presetMarketerDesc" },
  designer: { nameKey: "presetDesignerName", descKey: "presetDesignerDesc" },
};

type Step = "select" | "preview";

export function AddAgentDialog({ projectId, onCreated, onClose }: AddAgentDialogProps) {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [step, setStep] = useState<Step>("select");
  const [selectedName, setSelectedName] = useState("");
  const [selectedRole, setSelectedRole] = useState("");
  const [editablePrompt, setEditablePrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Custom agent fields
  const [customName, setCustomName] = useState("");
  const [customPrompt] = useState("");

  useEffect(() => {
    api.agents.presets().then(setPresets).catch(() => {
      setPresets([
        { name: "Coder", role: "coder", description: "" },
        { name: "Reviewer", role: "reviewer", description: "" },
      ]);
    });
  }, []);

  // Step 1 → Step 2: select preset → show prompt preview
  const handleSelectPreset = (preset: Preset) => {
    setSelectedName(preset.name);
    setSelectedRole(preset.role);
    setEditablePrompt(preset.systemPrompt ?? "");
    setStep("preview");
  };

  // Step 1 → Step 2: custom agent
  const handleCustomNext = () => {
    if (!customName.trim()) return;
    setSelectedName(customName.trim());
    setSelectedRole("custom");
    const defaultPrompt = customPrompt.trim()
      || `You are a ${customName.trim()}. Implement assigned tasks following best practices.`;
    setEditablePrompt(defaultPrompt);
    setStep("preview");
  };

  // Step 2: confirm and create
  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const agent = await api.agents.create({
        project_id: projectId,
        name: selectedName,
        role: selectedRole,
        system_prompt: editablePrompt,
      });
      onCreated(agent);
    } catch (err: any) {
      setError(err.message || t("createAgentFailed"));
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/20 dark:bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#25253d] rounded-xl shadow-lg w-[520px] max-w-[calc(100vw-2rem)] max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {step === "select" ? (
          <>
            {/* Step 1: Select role */}
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
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    {PRESET_I18N[p.role] ? t(PRESET_I18N[p.role].nameKey) : p.name}
                  </div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    {PRESET_I18N[p.role] ? t(PRESET_I18N[p.role].descKey) : p.description}
                  </div>
                </button>
              ))}

              <div className="pt-3 border-t border-gray-100 dark:border-gray-700 space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder={t("customAgentPlaceholder")}
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-[#1a1a2e] text-gray-800 dark:text-gray-200 focus:outline-none focus:border-blue-400"
                    onKeyDown={(e) => e.key === "Enter" && handleCustomNext()}
                  />
                  <button
                    onClick={handleCustomNext}
                    disabled={!customName.trim()}
                    className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40"
                  >
                    {t("next")}
                  </button>
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 flex justify-end">
              <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                {t("cancel")}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Step 2: Preview prompt → Confirm */}
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                {selectedName} <span className="text-xs text-gray-400 font-normal">({selectedRole})</span>
              </h3>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t("previewPromptDesc")}</p>
            </div>

            <div className="p-5">
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1.5 block font-medium">
                {t("systemPrompt")}
              </label>
              <textarea
                value={editablePrompt}
                onChange={(e) => setEditablePrompt(e.target.value)}
                rows={8}
                className="w-full px-3 py-2 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-[#1a1a2e] text-gray-700 dark:text-gray-300 focus:outline-none focus:border-blue-400 font-mono resize-y leading-relaxed"
              />
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1.5 italic">
                {t("promptHint")}
              </p>
              {error && (
                <p className="text-xs text-red-500 mt-2">{error}</p>
              )}
            </div>

            <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 flex justify-between">
              <button
                onClick={() => setStep("select")}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                {t("back")}
              </button>
              <div className="flex gap-2">
                <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                  {t("cancel")}
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="text-xs px-4 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                >
                  {creating ? "..." : t("addAgentConfirm")}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
