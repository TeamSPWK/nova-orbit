export const ROLE_COLORS: Record<string, { from: string; to: string }> = {
  coder: { from: "from-blue-500", to: "to-blue-600" },
  reviewer: { from: "from-purple-500", to: "to-purple-600" },
  qa: { from: "from-green-500", to: "to-green-600" },
  marketer: { from: "from-orange-500", to: "to-orange-600" },
  designer: { from: "from-pink-500", to: "to-pink-600" },
  custom: { from: "from-gray-500", to: "to-gray-600" },
};

export const ROLE_BADGE_ICONS: Record<string, string> = {
  coder: "💻",
  reviewer: "🔍",
  marketer: "📣",
  designer: "🎨",
  qa: "🧪",
  custom: "⚙️",
};
