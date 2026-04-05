import { useEffect } from "react";
import { useTranslation } from "react-i18next";

interface AgentWorkflowGuideProps {
  onClose: () => void;
}

export function AgentWorkflowGuide({ onClose }: AgentWorkflowGuideProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/20 dark:bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-[#25253d] rounded-xl shadow-lg w-[540px] max-w-[calc(100vw-2rem)] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {t("agentWorkflowTitle")}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Step 1 */}
          <div className="flex gap-4">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
              <span className="text-xs font-bold text-blue-600 dark:text-blue-400">1</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">
                {t("workflowStep1Title")}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                {t("workflowStep1Desc")}
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex gap-4">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
              <span className="text-xs font-bold text-blue-600 dark:text-blue-400">2</span>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">
                {t("workflowStep2Title")}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-3">
                {t("workflowStep2Desc")}
              </p>

              {/* Resolution Chain visual */}
              <div className="bg-gray-50 dark:bg-[#1a1a2e] rounded-lg p-3 border border-gray-100 dark:border-gray-700">
                <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
                  {t("workflowResolutionTitle")}
                </p>
                <div className="space-y-1.5">
                  {[
                    { label: t("workflowResolution1"), badge: "최우선", color: "bg-blue-500" },
                    { label: t("workflowResolution2"), badge: "프로젝트", color: "bg-green-500" },
                    { label: t("workflowResolution3"), badge: "기본값", color: "bg-yellow-500" },
                    { label: t("workflowResolution4"), badge: "안전망", color: "bg-gray-400" },
                  ].map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2.5">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.color}`} />
                      <span className="text-xs text-gray-700 dark:text-gray-300 flex-1">{item.label}</span>
                      <span className="text-[9px] text-gray-400 dark:text-gray-500 font-mono">
                        {idx + 1}순위
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tip */}
              <div className="mt-2 flex items-start gap-1.5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400 mt-0.5 shrink-0">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <p className="text-[11px] text-blue-600 dark:text-blue-400 leading-relaxed">
                  {t("workflowTip")}
                </p>
              </div>
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex gap-4">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
              <span className="text-xs font-bold text-blue-600 dark:text-blue-400">3</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">
                {t("workflowStep3Title")}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                {t("workflowStep3Desc")}
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="text-xs px-4 py-1.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-100 transition-colors font-medium"
          >
            {t("confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
