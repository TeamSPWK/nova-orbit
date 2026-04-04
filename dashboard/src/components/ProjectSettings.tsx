import { useState } from "react";
import { useStore } from "../stores/useStore";
import { api } from "../lib/api";

interface Props {
  projectId: string;
}

export function ProjectSettings({ projectId }: Props) {
  const { projects, updateProject, removeProject, setCurrentProject } = useStore();
  const project = projects.find((p) => p.id === projectId);

  const [editingMission, setEditingMission] = useState(false);
  const [missionDraft, setMissionDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [autoPush, setAutoPush] = useState(project?.github?.autoPush ?? false);
  const [prMode, setPrMode] = useState(project?.github?.prMode ?? false);

  if (!project) return null;

  const startEditMission = () => {
    setMissionDraft(project.mission ?? "");
    setEditingMission(true);
  };

  const cancelEditMission = () => {
    setEditingMission(false);
    setMissionDraft("");
  };

  const saveMission = async () => {
    if (missionDraft === project.mission) { cancelEditMission(); return; }
    setSaving(true);
    try {
      const updated = await api.projects.update(projectId, { mission: missionDraft });
      updateProject(updated);
      setEditingMission(false);
    } catch { alert("Failed to save mission"); }
    finally { setSaving(false); }
  };

  const handleMissionKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") saveMission();
    if (e.key === "Escape") cancelEditMission();
  };

  const saveGithubField = async (patch: Partial<typeof project.github>) => {
    try {
      const updated = await api.projects.update(projectId, { github: { ...project.github, ...patch } });
      updateProject(updated);
    } catch { alert("Failed to save setting"); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.projects.delete(projectId);
      removeProject(projectId);
      setCurrentProject(null);
    } catch {
      alert("Failed to delete project");
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const sourceLabel: Record<string, string> = {
    new: "New", local_import: "Local Import", github: "GitHub",
  };

  return (
    <div className="space-y-8">
      {/* Mission */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Mission</h2>
        <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-[#25253d]">
          {editingMission ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus type="text" value={missionDraft}
                onChange={(e) => setMissionDraft(e.target.value)}
                onKeyDown={handleMissionKeyDown} disabled={saving}
                className="flex-1 text-sm border border-blue-400 rounded px-2 py-1 bg-white dark:bg-[#1a1a2e] text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
                placeholder="Project mission..."
              />
              <button onClick={saveMission} disabled={saving}
                className="text-xs px-3 py-1 bg-gray-900 dark:bg-gray-200 text-white dark:text-gray-900 rounded hover:bg-gray-700 dark:hover:bg-gray-300 disabled:opacity-50">
                {saving ? "Saving..." : "Save"}
              </button>
              <button onClick={cancelEditMission} disabled={saving}
                className="text-xs px-3 py-1 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300">
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-start gap-2 group cursor-pointer" onClick={startEditMission} title="Click to edit">
              <p className="flex-1 text-sm text-gray-700 dark:text-gray-300">
                {project.mission || <span className="text-gray-400 dark:text-gray-500 italic">No mission set</span>}
              </p>
              <span className="text-xs text-gray-300 dark:text-gray-600 group-hover:text-gray-500 dark:group-hover:text-gray-400 transition-colors mt-0.5">Edit</span>
            </div>
          )}
        </div>
      </section>

      {/* Project Info */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Project Info</h2>
        <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-[#25253d] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">Work Directory</span>
            <span className="text-sm font-mono text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-[#1a1a2e] px-2 py-0.5 rounded">
              {project.workdir || "\u2014"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">Source Type</span>
            <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded">
              {sourceLabel[project.source] ?? project.source}
            </span>
          </div>
        </div>
      </section>

      {/* GitHub Config */}
      {project.source === "github" && project.github && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">GitHub</h2>
          <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-[#25253d] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">Repository</span>
              <span className="text-sm font-mono text-gray-700 dark:text-gray-300">{project.github.repoUrl}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">Branch</span>
              <span className="text-xs px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded font-mono">
                {project.github.branch}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">Auto Push</span>
              <Toggle checked={autoPush} onChange={() => { const n = !autoPush; setAutoPush(n); saveGithubField({ autoPush: n }); }} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">PR Mode</span>
              <Toggle checked={prMode} onChange={() => { const n = !prMode; setPrMode(n); saveGithubField({ prMode: n }); }} />
            </div>
          </div>
        </section>
      )}

      {/* Danger Zone */}
      <section>
        <h2 className="text-sm font-semibold text-red-400 uppercase tracking-wider mb-3">Danger Zone</h2>
        <div className="p-4 border border-red-100 dark:border-red-900/50 rounded-lg bg-white dark:bg-[#25253d]">
          {confirmDelete ? (
            <div className="flex items-center gap-3">
              <p className="text-sm text-red-600 dark:text-red-400 flex-1">Are you sure? This action cannot be undone.</p>
              <button onClick={handleDelete} disabled={deleting}
                className="text-xs px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50">
                {deleting ? "Deleting..." : "Yes, delete"}
              </button>
              <button onClick={() => setConfirmDelete(false)} disabled={deleting}
                className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300">
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Delete Project</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Permanently remove this project and all associated data.</p>
              </div>
              <button onClick={() => setConfirmDelete(true)}
                className="text-xs px-3 py-1.5 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-900/30">
                Delete
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

interface ToggleProps { checked: boolean; onChange: () => void; }

function Toggle({ checked, onChange }: ToggleProps) {
  return (
    <button onClick={onChange} role="switch" aria-checked={checked}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
        checked ? "bg-blue-500" : "bg-gray-200 dark:bg-gray-600"
      }`}>
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
        checked ? "translate-x-4.5" : "translate-x-0.5"
      }`} />
    </button>
  );
}
