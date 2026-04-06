import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { ConfirmDialog } from "./ConfirmDialog";

interface GoalSpecPanelProps {
  goalId: string;
  onClose: () => void;
}

interface PrdSummary {
  background: string;
  objective: string;
  scope: string;
  success_metrics?: string[];
  successMetrics?: string[];
  _status?: string;
  _error?: string;
}

interface FeatureSpec {
  name: string;
  description: string;
  requirements: string[];
  priority: "must" | "should" | "could";
}

interface FlowStep {
  step: number;
  action: string;
  expected: string;
}

interface SpecData {
  id: string;
  goal_id: string;
  prd_summary: PrdSummary;
  feature_specs: FeatureSpec[];
  user_flow: FlowStep[];
  acceptance_criteria: string[];
  tech_considerations: string[];
  generated_by: "ai" | "manual";
  version: number;
  created_at: string;
  updated_at: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  must: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800",
  should: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800",
  could: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800",
};

const PRIORITY_BG: Record<string, string> = {
  must: "border-l-red-400",
  should: "border-l-yellow-400",
  could: "border-l-green-400",
};

// ─── Editable Text ──────────────────────────────────
function EditableText({
  value,
  onChange,
  multiline = false,
  placeholder = "Click to edit...",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  const save = () => {
    setEditing(false);
    if (draft.trim() !== value) onChange(draft.trim());
  };

  if (editing) {
    const props = {
      ref: ref as any,
      value: draft,
      onChange: (e: any) => setDraft(e.target.value),
      onBlur: save,
      onKeyDown: (e: any) => {
        if (e.key === "Enter" && !e.shiftKey && !multiline) { e.preventDefault(); save(); }
        if (e.key === "Escape") { setDraft(value); setEditing(false); }
      },
      className: `w-full bg-white dark:bg-[#2a2a3d] border border-blue-300 dark:border-blue-600 rounded px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-blue-400 ${className}`,
      placeholder,
    };
    return multiline
      ? <textarea {...props} rows={3} />
      : <input type="text" {...props} />;
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className={`cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded px-1 -mx-1 transition-colors ${!value ? "text-gray-400 italic" : ""} ${className}`}
      title="Click to edit"
    >
      {value || placeholder}
    </span>
  );
}

// ─── Flow Diagram ──────────────────────────────────
function FlowDiagram({
  steps,
  onUpdate,
  onAdd,
  onRemove,
}: {
  steps: FlowStep[];
  onUpdate: (idx: number, step: FlowStep) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  if (steps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
        <p className="text-sm mb-3">{t("specFlowEmpty")}</p>
        <button onClick={onAdd} className="text-xs px-3 py-1.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 transition-colors">
          + {t("specFlowAddStep")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Visual flow — horizontal scroll */}
      <div ref={scrollRef} className="overflow-x-auto pb-4">
        <div className="flex items-stretch gap-0 min-w-max">
          {steps.map((step, i) => (
            <div key={i} className="flex items-stretch">
              {/* Step card */}
              <div className="relative w-56 shrink-0">
                <div className={`h-full border rounded-lg p-3 ${
                  i === 0 ? "border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-900/20" :
                  i === steps.length - 1 ? "border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/20" :
                  "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#25253d]"
                }`}>
                  {/* Step number badge */}
                  <div className="flex items-center justify-between mb-2">
                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold ${
                      i === 0 ? "bg-blue-500 text-white" :
                      i === steps.length - 1 ? "bg-green-500 text-white" :
                      "bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200"
                    }`}>
                      {step.step}
                    </span>
                    <button
                      onClick={() => onRemove(i)}
                      className="text-gray-300 hover:text-red-400 transition-colors p-0.5"
                      title="Remove step"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                  {/* Action */}
                  <div className="mb-2">
                    <span className="text-[9px] uppercase tracking-wider text-gray-400 font-medium">Action</span>
                    <EditableText
                      value={step.action}
                      onChange={(v) => onUpdate(i, { ...step, action: v })}
                      className="text-xs text-gray-800 dark:text-gray-100 font-medium block mt-0.5"
                      placeholder="User does..."
                    />
                  </div>
                  {/* Expected */}
                  <div>
                    <span className="text-[9px] uppercase tracking-wider text-gray-400 font-medium">Expected</span>
                    <EditableText
                      value={step.expected}
                      onChange={(v) => onUpdate(i, { ...step, expected: v })}
                      className="text-xs text-gray-600 dark:text-gray-400 block mt-0.5"
                      placeholder="System responds..."
                    />
                  </div>
                </div>
              </div>
              {/* Arrow connector */}
              {i < steps.length - 1 && (
                <div className="flex items-center px-1 shrink-0">
                  <svg width="28" height="24" viewBox="0 0 28 24" className="text-gray-300 dark:text-gray-600">
                    <line x1="0" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="2" />
                    <polygon points="18,6 28,12 18,18" fill="currentColor" />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {/* Add step */}
      <button
        onClick={onAdd}
        className="text-xs px-3 py-1.5 rounded border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors"
      >
        + {t("specFlowAddStep")}
      </button>
    </div>
  );
}

// ─── Editable List ──────────────────────────────────
function EditableList({
  items,
  onUpdate,
  icon = "•",
  iconColor = "text-gray-400",
  placeholder = "New item...",
  addLabel = "+ Add",
}: {
  items: string[];
  onUpdate: (items: string[]) => void;
  icon?: string;
  iconColor?: string;
  placeholder?: string;
  addLabel?: string;
}) {
  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2 group">
          <span className={`mt-1 shrink-0 text-xs ${iconColor}`}>{icon}</span>
          <EditableText
            value={item}
            onChange={(v) => {
              const next = [...items];
              next[i] = v;
              onUpdate(next);
            }}
            className="flex-1 text-sm text-gray-700 dark:text-gray-300"
            placeholder={placeholder}
          />
          <button
            onClick={() => onUpdate(items.filter((_, j) => j !== i))}
            className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all p-0.5 mt-0.5"
          >
            <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      ))}
      <button
        onClick={() => onUpdate([...items, ""])}
        className="text-xs text-gray-400 hover:text-blue-500 transition-colors pl-5"
      >
        {addLabel}
      </button>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────
export default function GoalSpecPanel({ goalId, onClose }: GoalSpecPanelProps) {
  const { t } = useTranslation();
  const [spec, setSpec] = useState<SpecData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string>("prd");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showRefine, setShowRefine] = useState(false);
  const [refinePrompt, setRefinePrompt] = useState("");
  const [refining, setRefining] = useState(false);
  const [refineElapsed, setRefineElapsed] = useState(0);
  const [confirmClose, setConfirmClose] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refineTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refineInputRef = useRef<HTMLTextAreaElement>(null);

  const busy = refining || generating;

  const isGeneratingStatus = (s: SpecData | null) =>
    s?.prd_summary && (s.prd_summary as any)._status === "generating";

  const isFailedStatus = (s: SpecData | null) =>
    s?.prd_summary && (s.prd_summary as any)._status === "failed";

  useEffect(() => {
    loadSpec();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (refineTimerRef.current) clearInterval(refineTimerRef.current);
    };
  }, [goalId]);

  // Prevent browser refresh/close while busy
  useEffect(() => {
    if (!busy) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [busy]);

  const handleClose = useCallback(() => {
    if (busy) {
      setConfirmClose(true);
    } else {
      onClose();
    }
  }, [busy, onClose]);

  async function loadSpec() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.goals.getSpec(goalId);
      setSpec(data);
      // If generating, start polling
      if (isGeneratingStatus(data)) {
        setGenerating(true);
        startPolling();
      }
    } catch {
      setSpec(null);
    } finally {
      setLoading(false);
    }
  }

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const data = await api.goals.getSpec(goalId);
        if (!isGeneratingStatus(data)) {
          // Generation done (or failed)
          setSpec(data);
          setGenerating(false);
          if (isFailedStatus(data)) {
            setError((data.prd_summary as any)._error || "Generation failed");
          }
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        }
      } catch {
        // Spec deleted or error — stop polling
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        setGenerating(false);
      }
    }, 3000);
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      await api.goals.generateSpec(goalId);
      startPolling();
    } catch (err: any) {
      setError(err.message || "Failed to start generation");
      setGenerating(false);
    }
  }

  // ─── Spec mutation helpers (local state, mark dirty) ───
  const updateSpec = useCallback((updater: (s: SpecData) => SpecData) => {
    setSpec((prev) => {
      if (!prev) return prev;
      setDirty(true);
      return updater(prev);
    });
  }, []);

  const updatePrd = useCallback((field: keyof PrdSummary, value: any) => {
    updateSpec((s) => ({
      ...s,
      prd_summary: { ...s.prd_summary, [field]: value },
    }));
  }, [updateSpec]);

  async function handleSave() {
    if (!spec || !dirty) return;
    setSaving(true);
    try {
      const metrics = spec.prd_summary.success_metrics || spec.prd_summary.successMetrics || [];
      const updated = await api.goals.updateSpec(goalId, {
        prd_summary: {
          background: spec.prd_summary.background,
          objective: spec.prd_summary.objective,
          scope: spec.prd_summary.scope,
          success_metrics: metrics,
        },
        feature_specs: spec.feature_specs,
        user_flow: spec.user_flow,
        acceptance_criteria: spec.acceptance_criteria,
        tech_considerations: spec.tech_considerations,
      });
      setSpec(updated);
      setDirty(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRefine() {
    if (!refinePrompt.trim()) return;
    setRefining(true);
    setRefineElapsed(0);
    setError(null);
    // Start elapsed timer
    refineTimerRef.current = setInterval(() => {
      setRefineElapsed((prev) => prev + 1);
    }, 1000);
    try {
      const data = await api.goals.refineSpec(goalId, refinePrompt.trim());
      setSpec(data);
      setRefinePrompt("");
      setShowRefine(false);
      setDirty(false);
    } catch (err: any) {
      setError(err.message || "Refine failed");
    } finally {
      setRefining(false);
      setRefineElapsed(0);
      if (refineTimerRef.current) { clearInterval(refineTimerRef.current); refineTimerRef.current = null; }
    }
  }

  const metrics = spec?.prd_summary?.success_metrics || spec?.prd_summary?.successMetrics || [];

  const sections = [
    { id: "prd", label: t("specPrdSummary"), icon: "📋", count: null },
    { id: "features", label: t("specFeatures"), icon: "⚡", count: spec?.feature_specs?.length },
    { id: "flow", label: t("specUserFlow"), icon: "🔄", count: spec?.user_flow?.length },
    { id: "criteria", label: t("specAcceptanceCriteria"), icon: "✅", count: spec?.acceptance_criteria?.length },
    { id: "tech", label: t("specTechConsiderations"), icon: "🔧", count: spec?.tech_considerations?.length },
  ];

  const hasSpec = spec && !isGeneratingStatus(spec) && !isFailedStatus(spec);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={handleClose}>
      <div
        className="bg-white dark:bg-[#1a1a2e] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: "min(1100px, 92vw)", height: "min(760px, 88vh)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ─── Header ─── */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-gray-200 dark:border-gray-700/50 bg-gray-50/50 dark:bg-[#1e1e32]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
              <span className="text-base">📝</span>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Structured Spec</h2>
              {hasSpec && (
                <span className="text-[10px] text-gray-400 dark:text-gray-500">
                  {t("specVersion", { version: String(spec!.version) })} · {spec!.generated_by === "ai" ? "AI" : t("specEdit")}
                </span>
              )}
            </div>
            {generating && (
              <span className="text-[10px] px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center gap-1.5 animate-pulse">
                <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                {t("specGenerating")}
              </span>
            )}
            {refining && (
              <span className="text-[10px] px-2.5 py-1 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5 animate-pulse">
                <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                {t("specAiRefining")} {refineElapsed > 0 && `${refineElapsed}s`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {dirty && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 font-medium"
              >
                {saving ? "Saving..." : t("specSave")}
              </button>
            )}
            {hasSpec && !generating && !refining && (
              <>
                <button
                  onClick={() => { setShowRefine(!showRefine); setTimeout(() => refineInputRef.current?.focus(), 100); }}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                    showRefine
                      ? "bg-indigo-100 dark:bg-indigo-800/40 text-indigo-600 dark:text-indigo-300"
                      : "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50"
                  }`}
                >
                  {t("specAiRefine")}
                </button>
                <button
                  onClick={handleGenerate}
                  className="text-xs px-3 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors"
                >
                  {t("specRegenerate")}
                </button>
              </>
            )}
            <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>

        {/* ─── AI Refine Bar ─── */}
        {showRefine && (
          <div className="px-6 py-3 border-b border-indigo-100 dark:border-indigo-800/30 bg-indigo-50/30 dark:bg-indigo-900/10">
            <div className="flex gap-2">
              <textarea
                ref={refineInputRef}
                value={refinePrompt}
                onChange={(e) => setRefinePrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleRefine(); }
                  if (e.key === "Escape") { setShowRefine(false); setRefinePrompt(""); }
                }}
                placeholder={t("specAiRefinePlaceholder")}
                rows={2}
                disabled={refining}
                className="flex-1 text-sm bg-white dark:bg-[#25253d] border border-indigo-200 dark:border-indigo-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-400/50 resize-none disabled:opacity-50 placeholder:text-gray-400"
              />
              <div className="flex flex-col gap-1">
                <button
                  onClick={handleRefine}
                  disabled={refining || !refinePrompt.trim()}
                  className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 font-medium"
                >
                  {refining ? `${t("specAiRefining")} ${refineElapsed > 0 ? `${refineElapsed}s` : ""}` : "Send"}
                </button>
                <button
                  onClick={() => { setShowRefine(false); setRefinePrompt(""); }}
                  disabled={refining}
                  className="text-xs px-3 py-1.5 rounded-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                >
                  {t("specCancel")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─── Body ─── */}
        <div className="flex-1 overflow-hidden flex relative">
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
              <svg className="animate-spin w-5 h-5 mr-2" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Loading...
            </div>
          ) : generating && !hasSpec ? (
            /* Generating — first time */
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                  <span className="text-2xl">🧠</span>
                </div>
                <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-amber-400 flex items-center justify-center">
                  <svg className="animate-spin w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                </div>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{t("specGenerating")}</p>
                <p className="text-xs text-gray-400 mt-1">{t("specGeneratingDesc")}</p>
              </div>
              <p className="text-[10px] text-gray-400">{t("specGeneratingHint")}</p>
            </div>
          ) : !hasSpec ? (
            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center gap-5 px-8">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900/30 dark:to-purple-900/30 flex items-center justify-center">
                <span className="text-3xl">📝</span>
              </div>
              <div className="text-center max-w-md">
                <p className="text-base font-medium text-gray-700 dark:text-gray-200 mb-1">{t("specEmpty")}</p>
                <p className="text-xs text-gray-400">{t("specEmptyHint")}</p>
              </div>
              <button
                onClick={handleGenerate}
                className="px-5 py-2.5 text-sm font-medium bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30"
              >
                {t("specGenerate")}
              </button>
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>
          ) : (
            /* ─── Spec Content ─── */
            <>
              {/* Section nav */}
              <div className="w-48 shrink-0 border-r border-gray-200 dark:border-gray-700/50 py-3 bg-gray-50/30 dark:bg-[#1e1e32]/50">
                {sections.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setActiveSection(s.id)}
                    className={`w-full text-left px-4 py-2 text-xs transition-all flex items-center justify-between ${
                      activeSection === s.id
                        ? "bg-white dark:bg-[#25253d] text-gray-900 dark:text-gray-100 font-medium shadow-sm border-r-2 border-indigo-500"
                        : "text-gray-500 dark:text-gray-400 hover:bg-white/50 dark:hover:bg-gray-800/50"
                    }`}
                  >
                    <span>
                      <span className="mr-2">{s.icon}</span>
                      {s.label}
                    </span>
                    {s.count !== null && s.count !== undefined && (
                      <span className="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-full w-5 h-5 flex items-center justify-center">
                        {s.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Section content */}
              <div className="flex-1 overflow-y-auto px-6 py-5">
                {/* ─── PRD Summary ─── */}
                {activeSection === "prd" && (
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 gap-5">
                      <div>
                        <label className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1.5 block">{t("specBackground")}</label>
                        <EditableText
                          value={spec!.prd_summary.background || ""}
                          onChange={(v) => updatePrd("background", v)}
                          multiline
                          className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed"
                        />
                      </div>
                      <div className="p-4 rounded-xl bg-indigo-50/50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-800/30">
                        <label className="text-[10px] uppercase tracking-wider text-indigo-500 font-semibold mb-1.5 block">{t("specObjective")}</label>
                        <EditableText
                          value={spec!.prd_summary.objective || ""}
                          onChange={(v) => updatePrd("objective", v)}
                          className="text-base font-medium text-gray-800 dark:text-gray-100"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1.5 block">{t("specScope")}</label>
                        <EditableText
                          value={spec!.prd_summary.scope || ""}
                          onChange={(v) => updatePrd("scope", v)}
                          multiline
                          className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1.5 block">{t("specSuccessMetrics")}</label>
                        <EditableList
                          items={metrics as string[]}
                          onUpdate={(items) => updatePrd("success_metrics", items)}
                          icon="●"
                          iconColor="text-green-500"
                          addLabel={`+ ${t("specAddMetric")}`}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* ─── Features ─── */}
                {activeSection === "features" && (
                  <div className="space-y-3">
                    {spec!.feature_specs.map((f, i) => (
                      <div key={i} className={`border-l-4 ${PRIORITY_BG[f.priority] || "border-l-gray-300"} border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-[#25253d] group`}>
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2 flex-1">
                            <EditableText
                              value={f.name}
                              onChange={(v) => {
                                const next = [...spec!.feature_specs];
                                next[i] = { ...f, name: v };
                                updateSpec((s) => ({ ...s, feature_specs: next }));
                              }}
                              className="font-medium text-gray-800 dark:text-gray-100"
                            />
                            <select
                              value={f.priority}
                              onChange={(e) => {
                                const next = [...spec!.feature_specs];
                                next[i] = { ...f, priority: e.target.value as any };
                                updateSpec((s) => ({ ...s, feature_specs: next }));
                              }}
                              className={`text-[10px] px-1.5 py-0.5 rounded border ${PRIORITY_COLORS[f.priority]} bg-transparent cursor-pointer appearance-none`}
                            >
                              <option value="must">{t("specPriorityMust")}</option>
                              <option value="should">{t("specPriorityShould")}</option>
                              <option value="could">{t("specPriorityCould")}</option>
                            </select>
                          </div>
                          <button
                            onClick={() => updateSpec((s) => ({ ...s, feature_specs: s.feature_specs.filter((_, j) => j !== i) }))}
                            className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all p-1"
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </div>
                        <EditableText
                          value={f.description}
                          onChange={(v) => {
                            const next = [...spec!.feature_specs];
                            next[i] = { ...f, description: v };
                            updateSpec((s) => ({ ...s, feature_specs: next }));
                          }}
                          multiline
                          className="text-sm text-gray-600 dark:text-gray-400 mb-3 block"
                        />
                        <div className="mt-2">
                          <span className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold">Requirements</span>
                          <EditableList
                            items={f.requirements || []}
                            onUpdate={(items) => {
                              const next = [...spec!.feature_specs];
                              next[i] = { ...f, requirements: items };
                              updateSpec((s) => ({ ...s, feature_specs: next }));
                            }}
                            icon="→"
                            iconColor="text-blue-400"
                            addLabel="+ Add requirement"
                          />
                        </div>
                      </div>
                    ))}
                    <button
                      onClick={() => updateSpec((s) => ({
                        ...s,
                        feature_specs: [...s.feature_specs, { name: "New Feature", description: "", requirements: [], priority: "should" }],
                      }))}
                      className="w-full py-3 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-xs text-gray-400 hover:text-indigo-500 hover:border-indigo-400 transition-colors"
                    >
                      + {t("specAddFeature")}
                    </button>
                  </div>
                )}

                {/* ─── User Flow (Visual) ─── */}
                {activeSection === "flow" && (
                  <FlowDiagram
                    steps={spec!.user_flow}
                    onUpdate={(idx, step) => {
                      const next = [...spec!.user_flow];
                      next[idx] = step;
                      updateSpec((s) => ({ ...s, user_flow: next }));
                    }}
                    onAdd={() => updateSpec((s) => ({
                      ...s,
                      user_flow: [...s.user_flow, { step: s.user_flow.length + 1, action: "", expected: "" }],
                    }))}
                    onRemove={(idx) => updateSpec((s) => ({
                      ...s,
                      user_flow: s.user_flow.filter((_, i) => i !== idx).map((st, i) => ({ ...st, step: i + 1 })),
                    }))}
                  />
                )}

                {/* ─── Acceptance Criteria ─── */}
                {activeSection === "criteria" && (
                  <EditableList
                    items={spec!.acceptance_criteria}
                    onUpdate={(items) => updateSpec((s) => ({ ...s, acceptance_criteria: items }))}
                    icon="✓"
                    iconColor="text-green-500"
                    addLabel={`+ ${t("specAddCriteria")}`}
                    placeholder="Given X, when Y, then Z"
                  />
                )}

                {/* ─── Tech Considerations ─── */}
                {activeSection === "tech" && (
                  <EditableList
                    items={spec!.tech_considerations}
                    onUpdate={(items) => updateSpec((s) => ({ ...s, tech_considerations: items }))}
                    icon="⚙"
                    iconColor="text-orange-500"
                    addLabel={`+ ${t("specAddTech")}`}
                  />
                )}

                {error && <p className="mt-4 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}
              </div>
            </>
          )}

          {/* ─── Refining Overlay ─── */}
          {refining && (
            <div className="absolute inset-0 bg-white/60 dark:bg-[#1a1a2e]/70 backdrop-blur-[2px] flex items-center justify-center z-10">
              <div className="flex flex-col items-center gap-3">
                <div className="relative">
                  <div className="w-14 h-14 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                    <span className="text-xl">✨</span>
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center">
                    <svg className="animate-spin w-3 h-3 text-white" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{t("specAiRefining")}</p>
                  <p className="text-xs text-gray-400 mt-1">{t("specAiRefiningDesc")}</p>
                </div>
                {refineElapsed > 0 && (
                  <span className="text-[10px] text-gray-400 tabular-nums">{refineElapsed}s</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ─── Footer (when dirty) ─── */}
        {dirty && (
          <div className="flex items-center justify-between px-6 py-2.5 border-t border-gray-200 dark:border-gray-700/50 bg-blue-50/50 dark:bg-blue-900/10">
            <span className="text-xs text-blue-600 dark:text-blue-400">{t("specUnsaved")}</span>
            <div className="flex gap-2">
              <button
                onClick={() => { loadSpec(); setDirty(false); }}
                className="text-xs px-3 py-1 rounded-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                {t("specCancel")}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="text-xs px-4 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 font-medium"
              >
                {saving ? "..." : t("specSave")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Confirm close while busy ─── */}
      {confirmClose && (
        <ConfirmDialog
          message={t("specCloseWhileBusy")}
          onConfirm={onClose}
          onCancel={() => setConfirmClose(false)}
        />
      )}
    </div>
  );
}
