import { useTranslation } from "react-i18next";

interface Task {
  status: string;
}

interface ProjectStatsProps {
  tasks: Task[];
}

export function ProjectStats({ tasks }: ProjectStatsProps) {
  const { t } = useTranslation();

  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === "done").length;
  const inProgress = tasks.filter((t) => t.status === "in_progress").length;
  const verified = tasks.filter((t) => t.status === "verified").length;

  const stats = [
    {
      value: total,
      label: t("statTotalTasks"),
      color: "text-gray-700 dark:text-gray-200",
      labelColor: "text-gray-400 dark:text-gray-500",
    },
    {
      value: completed,
      label: t("statCompleted"),
      color: "text-green-600 dark:text-green-400",
      labelColor: "text-gray-400 dark:text-gray-500",
    },
    {
      value: inProgress,
      label: t("statInProgress"),
      color: "text-blue-600 dark:text-blue-400",
      labelColor: "text-gray-400 dark:text-gray-500",
    },
    {
      value: verified,
      label: t("statVerified"),
      color: "text-purple-600 dark:text-purple-400",
      labelColor: "text-gray-400 dark:text-gray-500",
    },
  ];

  return (
    <div className="flex items-center gap-6 py-3 px-4 bg-gray-50 dark:bg-[#25253d] border border-gray-200 dark:border-gray-700 rounded-lg mb-6">
      {stats.map((stat, index) => (
        <div key={stat.label} className="flex items-center gap-4">
          <div className="text-center">
            <span className={`text-lg font-bold ${stat.color}`}>{stat.value}</span>
            <p className={`text-[11px] leading-none mt-0.5 ${stat.labelColor}`}>{stat.label}</p>
          </div>
          {index < stats.length - 1 && (
            <div className="w-px h-8 bg-gray-200 dark:bg-gray-700" />
          )}
        </div>
      ))}
    </div>
  );
}
