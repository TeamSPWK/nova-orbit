import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "./AgentAvatar";
import { AgentDetail } from "./AgentDetail";

interface Agent {
  id: string;
  name: string;
  role: string;
  status: string;
  parent_id: string | null;
  current_task_id: string | null;
  system_prompt?: string;
  session_id?: string;
}

interface OrgChartProps {
  agents: any[];
  tasks: any[];
  onAddAgent: () => void;
  onAgentDeleted: () => void;
  onAgentKilled: () => void;
}

const STATUS_DOT: Record<string, string> = {
  working: "bg-green-400 animate-pulse",
  paused: "bg-yellow-400",
  waiting_approval: "bg-yellow-400",
  terminated: "bg-red-400",
  idle: "bg-gray-300 dark:bg-gray-600",
};

const STATUS_LABEL: Record<string, string> = {
  working: "working",
  paused: "paused",
  waiting_approval: "waiting",
  terminated: "terminated",
  idle: "idle",
};

/** 특정 노드의 모든 자식(직계)을 반환 */
function getChildren(agents: Agent[], parentId: string): Agent[] {
  return agents.filter((a) => a.parent_id === parentId);
}

interface NodeProps {
  agent: Agent;
  agents: Agent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth: number;
  isLast: boolean;
}

function OrgNode({ agent, agents, selectedId, onSelect, depth }: NodeProps) {
  const children = getChildren(agents, agent.id);
  const isSelected = selectedId === agent.id;

  return (
    <div className="flex flex-col items-center">
      {/* Node card */}
      <button
        onClick={() => onSelect(agent.id)}
        className={`relative flex flex-col items-center gap-1 px-3 py-2 rounded-xl border transition-all w-[120px] shrink-0 text-center ${
          isSelected
            ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-sm shadow-blue-200 dark:shadow-blue-900/40"
            : agent.status === "working"
            ? "border-green-300 dark:border-green-700 bg-green-50/60 dark:bg-green-900/10 hover:border-green-400"
            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#25253d] hover:border-gray-300 dark:hover:border-gray-600"
        }`}
      >
        <AgentAvatar name={agent.name} role={agent.role} size="sm" showBadge={true} />
        <span className="text-[11px] font-medium text-gray-800 dark:text-gray-200 leading-tight truncate w-full">
          {agent.name}
        </span>
        <div className="flex items-center gap-1 justify-center">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              STATUS_DOT[agent.status] ?? STATUS_DOT.idle
            }`}
          />
          <span className="text-[9px] text-gray-400 dark:text-gray-500 capitalize">
            {STATUS_LABEL[agent.status] ?? "idle"}
          </span>
        </div>
      </button>

      {/* Children */}
      {children.length > 0 && (
        <div className="flex flex-col items-center w-full">
          {/* Vertical connector from parent */}
          <div className="w-px h-5 bg-gray-200 dark:bg-gray-700" />

          {/* Horizontal bar + children */}
          <div className="flex items-start">
            {children.map((child, idx) => {
              const isFirstChild = idx === 0;
              const isLastChild = idx === children.length - 1;
              const isOnlyChild = children.length === 1;

              return (
                <div key={child.id} className="flex flex-col items-center">
                  {/* T-connector */}
                  {!isOnlyChild && (
                    <div className="flex items-center w-full h-5">
                      {/* Left horizontal arm */}
                      <div
                        className={`h-px bg-gray-200 dark:bg-gray-700 flex-1 ${
                          isFirstChild ? "invisible" : ""
                        }`}
                      />
                      {/* Vertical drop */}
                      <div className="w-px h-5 bg-gray-200 dark:bg-gray-700" />
                      {/* Right horizontal arm */}
                      <div
                        className={`h-px bg-gray-200 dark:bg-gray-700 flex-1 ${
                          isLastChild ? "invisible" : ""
                        }`}
                      />
                    </div>
                  )}

                  {/* Recursive child */}
                  <div className="px-3">
                    <OrgNode
                      agent={child}
                      agents={agents}
                      selectedId={selectedId}
                      onSelect={onSelect}
                      depth={depth + 1}
                      isLast={isLastChild}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function OrgChart({ agents, tasks, onAddAgent, onAgentDeleted, onAgentKilled }: OrgChartProps) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedAgent = agents.find((a) => a.id === selectedId) ?? null;

  // parent_id가 null인 루트 노드들
  const roots = agents.filter((a) => !a.parent_id);

  const handleClose = () => setSelectedId(null);
  const handleKill = () => {
    onAgentKilled();
    setSelectedId(null);
  };
  const handleDeleted = () => {
    onAgentDeleted();
    setSelectedId(null);
  };

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="text-4xl mb-3 opacity-30">🤖</div>
        <p className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">
          {t("noAgentsOrgChart")}
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-6 max-w-xs">
          {t("noAgentsOrgChartDesc")}
        </p>
        <button
          onClick={onAddAgent}
          className="text-xs px-4 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-100 transition-colors font-medium"
        >
          {t("addAgent")}
        </button>
      </div>
    );
  }

  return (
    <>
      {/* AgentDetail slide-over */}
      {selectedAgent && (
        <AgentDetail
          agent={selectedAgent}
          tasks={tasks}
          onClose={handleClose}
          onKill={handleKill}
          onDeleted={handleDeleted}
        />
      )}

      <div className="flex gap-6 items-start">
        {/* Org tree — left panel */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                {t("orgChartTitle")}
              </h2>
              <span className="text-[11px] text-gray-400 dark:text-gray-500">
                {t("agentCount", { count: agents.length })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onAddAgent}
                className="text-xs px-3 py-1.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-100 transition-colors font-medium"
              >
                {t("addAgent")}
              </button>
            </div>
          </div>

          {/* Tree */}
          <div className="overflow-x-auto pb-4">
            <div className="inline-flex gap-12 items-start min-w-max px-4">
              {roots.map((root) => (
                <OrgNode
                  key={root.id}
                  agent={root}
                  agents={agents}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  depth={0}
                  isLast={true}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Selected agent detail — right hint panel (lightweight, not the slide-over) */}
        {!selectedAgent && (
          <div className="w-[200px] shrink-0 hidden lg:block">
            <div className="border border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-4 text-center">
              <p className="text-[11px] text-gray-400 dark:text-gray-500">
                노드를 클릭하면<br />에이전트 상세가 열립니다
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
