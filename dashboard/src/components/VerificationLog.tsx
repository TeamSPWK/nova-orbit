import { useEffect, useState } from "react";
import { api } from "../lib/api";

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

const DIM_LABELS: Record<string, string> = {
  functionality: "Functionality",
  dataFlow: "Data Flow",
  designAlignment: "Design",
  craft: "Craft",
  edgeCases: "Edge Cases",
};

export function VerificationLog({ projectId }: VerificationLogProps) {
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    api.verifications.list(projectId).then(setVerifications);
  }, [projectId]);

  if (verifications.length === 0) {
    return <p className="text-sm text-gray-400">No verifications yet.</p>;
  }

  return (
    <div className="space-y-3">
      {verifications.map((v) => (
        <div key={v.id} className="border border-gray-200 rounded-lg overflow-hidden">
          {/* Header */}
          <button
            onClick={() => setExpanded(expanded === v.id ? null : v.id)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${VERDICT_COLORS[v.verdict]}`}>
                {v.verdict.toUpperCase()}
              </span>
              <span className={`text-xs ${SEVERITY_COLORS[v.severity]}`}>
                {v.severity}
              </span>
              <span className="text-xs text-gray-400">{v.scope}</span>
            </div>
            <span className="text-[10px] text-gray-300">
              {new Date(v.created_at).toLocaleString()}
            </span>
          </button>

          {/* Expanded Details */}
          {expanded === v.id && (
            <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/50">
              {/* 5-Dimension Score Bar */}
              <div className="mb-4">
                <h4 className="text-xs font-medium text-gray-500 mb-2">5-Dimension Score</h4>
                <div className="space-y-1.5">
                  {Object.entries(v.dimensions).map(([key, dim]) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400 w-20 shrink-0">
                        {DIM_LABELS[key] ?? key}
                      </span>
                      <div className="flex-1 bg-gray-200 rounded-full h-2">
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
                      <span className="text-[10px] text-gray-500 w-6 text-right">
                        {dim.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Issues */}
              {v.issues.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-gray-500 mb-2">
                    Issues ({v.issues.length})
                  </h4>
                  <div className="space-y-2">
                    {v.issues.map((issue, i) => (
                      <div
                        key={i}
                        className={`text-xs p-2 rounded border-l-2 ${
                          issue.severity === "critical"
                            ? "border-red-500 bg-red-50"
                            : issue.severity === "high"
                              ? "border-orange-400 bg-orange-50"
                              : "border-gray-300 bg-white"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="font-medium uppercase text-[10px]">
                            {issue.severity}
                          </span>
                          {issue.file && (
                            <span className="text-gray-400">
                              {issue.file}
                              {issue.line ? `:${issue.line}` : ""}
                            </span>
                          )}
                        </div>
                        <p className="text-gray-700">{issue.message}</p>
                        {issue.suggestion && (
                          <p className="text-gray-400 mt-1">Fix: {issue.suggestion}</p>
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
  );
}
