import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "../lib/api";

const COLUMNS = [
  { id: "todo", label: "Todo", color: "border-gray-300", bg: "bg-gray-50" },
  { id: "in_progress", label: "In Progress", color: "border-blue-400", bg: "bg-blue-50/50" },
  { id: "in_review", label: "In Review", color: "border-purple-400", bg: "bg-purple-50/50" },
  { id: "done", label: "Done", color: "border-green-400", bg: "bg-green-50/50" },
  { id: "blocked", label: "Blocked", color: "border-red-400", bg: "bg-red-50/50" },
] as const;

interface Task {
  id: string;
  title: string;
  status: string;
  assignee_id: string | null;
  verification_id: string | null;
}

interface Agent {
  id: string;
  name: string;
}

interface KanbanBoardProps {
  tasks: Task[];
  agents: Agent[];
  onUpdate?: () => void;
}

function SortableCard({ task, agents }: { task: Task; agents: Agent[] }) {
  const agent = agents.find((a) => a.id === task.assignee_id);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, data: { task } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="bg-white border border-gray-200 rounded-lg px-3 py-2.5 shadow-sm hover:shadow cursor-grab active:cursor-grabbing dark:bg-gray-800 dark:border-gray-700"
    >
      <div className="text-sm text-gray-800 dark:text-gray-200 mb-1.5">{task.title}</div>
      <div className="flex items-center gap-1.5">
        {agent && (
          <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-gray-500 dark:text-gray-400">
            {agent.name}
          </span>
        )}
        {task.verification_id && (
          <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-600 rounded">
            verified
          </span>
        )}
      </div>
    </div>
  );
}

function TaskCard({ task, agents }: { task: Task; agents: Agent[] }) {
  const agent = agents.find((a) => a.id === task.assignee_id);
  return (
    <div className="bg-white border border-blue-300 rounded-lg px-3 py-2.5 shadow-md dark:bg-gray-800">
      <div className="text-sm text-gray-800 dark:text-gray-200 mb-1">{task.title}</div>
      {agent && (
        <span className="text-[10px] text-gray-400">{agent.name}</span>
      )}
    </div>
  );
}

export function KanbanBoard({ tasks, agents, onUpdate }: KanbanBoardProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === event.active.id);
    if (task) setActiveTask(task);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = active.id as string;
    // Determine target column — over could be a column or another task
    let targetStatus: string;

    // Check if dropped on a column
    const column = COLUMNS.find((c) => c.id === over.id);
    if (column) {
      targetStatus = column.id;
    } else {
      // Dropped on another task — use that task's status
      const overTask = tasks.find((t) => t.id === over.id);
      if (!overTask) return;
      targetStatus = overTask.status;
    }

    const currentTask = tasks.find((t) => t.id === taskId);
    if (!currentTask || currentTask.status === targetStatus) return;

    // Update task status
    await api.tasks.update(taskId, { status: targetStatus });
    onUpdate?.();
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4">
        {COLUMNS.map((col) => {
          const columnTasks = tasks.filter((t) => t.status === col.id);

          return (
            <div
              key={col.id}
              className={`flex-shrink-0 w-[220px] rounded-lg border-t-2 ${col.color} ${col.bg} dark:bg-gray-900/50`}
            >
              <div className="px-3 py-2 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  {col.label}
                </span>
                <span className="text-[10px] text-gray-300 dark:text-gray-600">
                  {columnTasks.length}
                </span>
              </div>

              <SortableContext
                id={col.id}
                items={columnTasks.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="px-2 pb-2 space-y-2 min-h-[60px]">
                  {columnTasks.map((task) => (
                    <SortableCard key={task.id} task={task} agents={agents} />
                  ))}
                  {columnTasks.length === 0 && (
                    <div className="text-[10px] text-gray-300 dark:text-gray-600 text-center py-4">
                      Drop here
                    </div>
                  )}
                </div>
              </SortableContext>
            </div>
          );
        })}
      </div>

      <DragOverlay>
        {activeTask ? <TaskCard task={activeTask} agents={agents} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
