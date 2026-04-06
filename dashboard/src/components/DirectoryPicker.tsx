import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getApiKey } from "../lib/api";

interface DirectoryPickerProps {
  onSubmit: (path: string) => void;
  onCancel: () => void;
}

interface BrowseResult {
  path: string;
  dirs: string[];
  isGitRepo: boolean;
}

export function DirectoryPicker({ onSubmit, onCancel }: DirectoryPickerProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const browse = async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = path ? `?path=${encodeURIComponent(path)}` : "";
      const key = getApiKey();
      const res = await fetch(`/api/fs/browse${params}`, {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error);
        return;
      }
      setData(await res.json());
    } catch {
      setError("Failed to browse directory");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    browse();
  }, []);

  const parentPath = data?.path.split("/").slice(0, -1).join("/") || "/";

  return (
    <div
      className="fixed inset-0 bg-black/20 dark:bg-black/50 flex items-center justify-center z-50"
      onClick={onCancel}
    >
      <div
        className="bg-white dark:bg-[#25253d] rounded-xl shadow-lg w-[480px] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">
            {t("selectDirectory")}
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => browse(parentPath)}
              disabled={data?.path === "/"}
              className="text-xs px-2 py-1 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-30"
            >
              ↑
            </button>
            <div className="flex-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-[#1a1a2e] rounded border border-gray-200 dark:border-gray-600 truncate font-mono">
              {data?.path ?? "..."}
            </div>
          </div>
        </div>

        {/* Directory list */}
        <div className="h-[300px] overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center h-full text-xs text-gray-400">
              Loading...
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center h-full text-xs text-red-400">
              {error}
            </div>
          )}
          {!loading && !error && data && (
            <>
              {data.dirs.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-gray-400">
                  {t("noSubdirectories")}
                </div>
              ) : (
                <div className="py-1">
                  {data.dirs.map((dir) => (
                    <button
                      key={dir}
                      onClick={() => browse(`${data.path}/${dir}`)}
                      className="w-full text-left px-5 py-1.5 text-sm flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                    >
                      <span className="text-base">📁</span>
                      <span className="truncate text-gray-700 dark:text-gray-300">
                        {dir}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <div className="text-xs text-gray-400">
            {data?.isGitRepo && (
              <span className="text-green-500 dark:text-green-400">✓ Git repo</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="text-xs px-3 py-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 rounded"
            >
              {t("cancel")}
            </button>
            <button
              onClick={() => data && onSubmit(data.path)}
              disabled={!data}
              className="text-xs px-4 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-40"
            >
              {t("selectThisFolder")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
