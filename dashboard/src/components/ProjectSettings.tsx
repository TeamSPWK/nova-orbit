import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../stores/useStore";
import { api } from "../lib/api";
import { Toast } from "./Toast";

interface Props {
  projectId: string;
}

export function ProjectSettings({ projectId }: Props) {
  const { t } = useTranslation();
  const { projects, updateProject, removeProject, setCurrentProject } = useStore();
  const project = projects.find((p) => p.id === projectId);

  const [editingMission, setEditingMission] = useState(false);
  const [missionDraft, setMissionDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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
    } catch {
      setToast(t("errorSaveMissionFailed"));
    }
    finally { setSaving(false); }
  };

  const handleMissionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); saveMission(); }
    if (e.key === "Escape") cancelEditMission();
  };

  const saveGithubField = async (patch: Partial<typeof project.github>) => {
    try {
      const updated = await api.projects.update(projectId, { github: { ...project.github, ...patch } });
      updateProject(updated);
    } catch {
      setToast(t("errorSaveSettingFailed"));
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.projects.delete(projectId);
      removeProject(projectId);
      setCurrentProject(null);
    } catch {
      setToast(t("errorDeleteFailed"));
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const sourceLabel: Record<string, string> = {
    new: t("settingsSourceNew"),
    local_import: t("settingsSourceLocalImport"),
    github: t("settingsSourceGitHub"),
  };

  return (
    <div className="space-y-8">
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

      {/* Mission */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
          {t("settingsMission")}
        </h2>
        <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-[#25253d]">
          {editingMission ? (
            <div className="flex flex-col gap-2">
              <textarea
                autoFocus rows={3} value={missionDraft}
                onChange={(e) => setMissionDraft(e.target.value)}
                onKeyDown={handleMissionKeyDown} disabled={saving}
                className="w-full text-sm border border-blue-400 rounded px-2 py-1 bg-white dark:bg-[#1a1a2e] text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                placeholder={t("missionPlaceholderDetailed")}
              />
              <div className="flex items-center gap-2">
                <button onClick={saveMission} disabled={saving}
                  className="text-xs px-3 py-1 bg-gray-900 dark:bg-gray-200 text-white dark:text-gray-900 rounded hover:bg-gray-700 dark:hover:bg-gray-300 disabled:opacity-50">
                  {saving ? t("settingsSaving") : t("settingsSave")}
                </button>
                <button onClick={cancelEditMission} disabled={saving}
                  className="text-xs px-3 py-1 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300">
                  {t("settingsCancel")}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 group cursor-pointer" onClick={startEditMission} title={t("clickToEdit")}>
              <p className="flex-1 text-sm text-gray-700 dark:text-gray-300">
                {project.mission || <span className="text-gray-400 dark:text-gray-500 italic">{t("settingsNoMission")}</span>}
              </p>
              <span className="text-xs text-gray-300 dark:text-gray-600 group-hover:text-gray-500 dark:group-hover:text-gray-400 transition-colors mt-0.5">
                {t("settingsEdit")}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Project Info */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
          {t("settingsProjectInfo")}
        </h2>
        <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-[#25253d] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">{t("settingsWorkDirectory")}</span>
            <span className="text-sm font-mono text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-[#1a1a2e] px-2 py-0.5 rounded">
              {project.workdir || "\u2014"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">{t("settingsSourceType")}</span>
            <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded">
              {sourceLabel[project.source] ?? project.source}
            </span>
          </div>
        </div>
      </section>

      {/* GitHub Config */}
      {project.source === "github" && project.github && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            {t("settingsGitHub")}
          </h2>
          <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-[#25253d] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">{t("settingsRepository")}</span>
              <span className="text-sm font-mono text-gray-700 dark:text-gray-300">{project.github.repoUrl}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">{t("settingsBranch")}</span>
              <span className="text-xs px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded font-mono">
                {project.github.branch}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">{t("settingsAutoPush")}</span>
              <Toggle checked={autoPush} onChange={() => { const n = !autoPush; setAutoPush(n); saveGithubField({ autoPush: n }); }} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">{t("settingsPrMode")}</span>
              <Toggle checked={prMode} onChange={() => { const n = !prMode; setPrMode(n); saveGithubField({ prMode: n }); }} />
            </div>
          </div>
        </section>
      )}

      {/* Danger Zone */}
      <section>
        <h2 className="text-sm font-semibold text-red-400 uppercase tracking-wider mb-3">
          {t("settingsDangerZone")}
        </h2>
        <div className="p-4 border border-red-100 dark:border-red-900/50 rounded-lg bg-white dark:bg-[#25253d]">
          {confirmDelete ? (
            <div className="space-y-3">
              <p className="text-sm text-red-600 dark:text-red-400">{t("settingsDeleteConfirm")}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">{t("settingsDeleteDirNote")}</p>
              <div className="flex items-center gap-3">
                <button onClick={handleDelete} disabled={deleting}
                  className="text-xs px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50">
                  {deleting ? t("settingsDeleting") : t("settingsYesDelete")}
                </button>
                <button onClick={() => setConfirmDelete(false)} disabled={deleting}
                  className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300">
                  {t("settingsCancel")}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t("settingsDeleteProject")}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t("settingsDeleteDesc")}</p>
              </div>
              <button onClick={() => setConfirmDelete(true)}
                className="text-xs px-3 py-1.5 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-900/30">
                {t("settingsDelete")}
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
