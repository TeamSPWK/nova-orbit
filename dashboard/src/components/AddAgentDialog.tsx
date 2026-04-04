import { useEffect, useState } from "react";
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
  const [presets, setPresets] = useState<Preset[]>([]);
  const [customName, setCustomName] = useState("");
  const [mode, setMode] = useState<"preset" | "custom">("preset");

  useEffect(() => {
    api.agents.presets().then(setPresets).catch(() => {
      // Fallback presets
      setPresets([
        { name: "Developer", role: "coder", description: "Implements code" },
        { name: "Reviewer", role: "reviewer", description: "Reviews code quality" },
      ]);
    });
  }, []);

  const handleSelectPreset = async (preset: Preset) => {
    const agent = await api.agents.create({
      project_id: projectId,
      name: preset.name,
      role: preset.role,
    });
    onCreated(agent);
  };

  const handleCreateCustom = async () => {
    if (!customName.trim()) return;
    const agent = await api.agents.create({
      project_id: projectId,
      name: customName,
      role: "custom",
    });
    onCreated(agent);
  };

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-lg w-[480px] max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-800">Add Agent</h3>
          <p className="text-xs text-gray-400 mt-0.5">Choose a role preset or create custom</p>
        </div>

        <div className="p-5 space-y-2">
          {presets.map((p) => (
            <button
              key={p.role}
              onClick={() => handleSelectPreset(p)}
              className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
            >
              <div className="text-sm font-medium text-gray-800">{p.name}</div>
              <div className="text-xs text-gray-400 mt-0.5">{p.description}</div>
            </button>
          ))}

          <div className="pt-3 border-t border-gray-100">
            <div className="flex gap-2">
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Custom agent name..."
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400"
                onKeyDown={(e) => e.key === "Enter" && handleCreateCustom()}
              />
              <button
                onClick={handleCreateCustom}
                disabled={!customName.trim()}
                className="px-4 py-2 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 disabled:opacity-40"
              >
                Create
              </button>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
          <button
            onClick={onClose}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
