import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { Toast } from "./Toast";

interface Verification {
  id: string;
  task_id: string;
  verdict: string;
  scope: string;
  severity: string;
  dimensions: Record<string, { value: number; notes: string }>;
  issues: Array<{
    severity: string;
    file?: string;
    line?: number;
    message: string;
    suggestion?: string;
  }>;
  created_at: string;
}

interface VerificationLogProps {
  projectId: string;
}

const VERDICT_COLORS: Record<string, string> = {
  pass: "bg-green-100 text-green-700",
  conditional: "bg-yellow-100 text-yellow-700",
  fail: "bg-red-100 text-red-700",
};

const SEVERITY_COLORS: Record<string, string> = {
  "auto-resolve": "text-gray-500",
  "soft-block": "text-yellow-600",
  "hard-block": "text-red-600 font-semibold",
};

const DIM_LABEL_KEYS: Record<string, string> = {
  functionality: "dimFunctionality",
  dataFlow: "dimDataFlow",
  designAlignment: "dimDesignAlignment",
  craft: "dimCraft",
  edgeCases: "dimEdgeCases",
};

export function VerificationLog({ projectId }: VerificationLogProps) {
  const { t } = useTranslation();
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [creatingFix, setCreatingFix] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    api.verifications.list(projectId).then(setVerifications);
  }, [projectId]);

  const handleCreateFixTask = async (e: React.MouseEvent, verificationId: string) => {
    e.stopPropagation();
    setCreatingFix(verificationId);
    try {
      await api.verifications.createFixTask(verificationId);
      setToast(t("fixTaskCreated"));
    } finally {
      setCreatingFix(null);
    }
  };

  if (verifications.length === 0) {
    return (
      <div className="py-6 px-4 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg text-center">
        <p className="text-sm text-gray-400 dark:text-gray-500">{t("noVerification")}</p>
      </div>
    );
  }

  return (
    <>
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    <div className="space-y-3">
      {verifications.map((v) => (
        <div key={v.id} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-[#25253d]">
          {/* Header */}
          <div className="w-full flex items-center justify-between px-4 py-3">
            <button
              onClick={() => setExpanded(expanded === v.id ? null : v.id)}
              className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80 transition-opacity text-left"
            >
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${VERDICT_COLORS[v.verdict]}`}>
                {v.verdict === "pass" ? t("verdictPass") : v.verdict === "conditional" ? t("verdictConditional") : t("verdictFail")}
              </span>
              <span className={`text-xs shrink-0 ${SEVERITY_COLORS[v.severity]}`}>
                {v.severity}
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">{v.scope}</span>
            </button>
            <div className="flex items-center gap-2 shrink-0">
              {(v.verdict === "fail" || v.verdict === "conditional") && (
                <button
                  onClick={(e) => handleCreateFixTask(e, v.id)}
                  disabled={creatingFix === v.id}
                  className="text-[10px] px-2 py-0.5 rounded font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 hover:bg-orange-200 dark:hover:bg-orange-900/50 disabled:opacity-50"
                >
                  {creatingFix === v.id ? "..." : t("createFixTask")}
                </button>
              )}
              <span className="text-[10px] text-gray-300 dark:text-gray-600">
                {new Date(v.created_at).toLocaleString()}
              </span>
            </div>
          </div>

          {/* Expanded Details */}
          {expanded === v.id && (
            <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 bg-gray-50/50 dark:bg-gray-800/50">
              {/* 5-Dimension Score Bar */}
              <div className="mb-4">
                <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t("dimensionScore")}</h4>
                <div className="space-y-1.5">
                  {Object.entries(v.dimensions).map(([key, dim]) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 w-20 shrink-0">
                        {DIM_LABEL_KEYS[key] ? t(DIM_LABEL_KEYS[key]) : key}
                      </span>
                      <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            dim.value >= 8
                              ? "bg-green-400"
                              : dim.value >= 5
                                ? "bg-yellow-400"
                                : "bg-red-400"
                          }`}
                          style={{ width: `${dim.value * 10}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-500 dark:text-gray-400 w-6 text-right">
                        {dim.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Issues */}
              {v.issues.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                    {t("issues")} ({v.issues.length})
                  </h4>
                  <div className="space-y-2">
                    {v.issues.map((issue, i) => (
                      <div
                        key={i}
                        className={`text-xs p-2 rounded border-l-2 ${
                          issue.severity === "critical"
                            ? "border-red-500 bg-red-50 dark:bg-red-900/20"
                            : issue.severity === "high"
                              ? "border-orange-400 bg-orange-50 dark:bg-orange-900/20"
                              : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700/50"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="font-medium uppercase text-[10px]">
                            {issue.severity}
                          </span>
                          {issue.file && (
                            <span className="text-gray-400 dark:text-gray-500">
                              {issue.file}
                              {issue.line ? `:${issue.line}` : ""}
                            </span>
                          )}
                        </div>
                        <p className="text-gray-700 dark:text-gray-300">{issue.message}</p>
                        {issue.suggestion && (
                          <p className="text-gray-400 dark:text-gray-500 mt-1">Fix: {issue.suggestion}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
    </>
  );
}
