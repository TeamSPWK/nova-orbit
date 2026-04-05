import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        configure: (proxy) => {
          proxy.on("error", () => {}); // Suppress proxy errors (server restart)
        },
      },
      // /ws proxy 제거 — Vite proxy가 WS 탐침 연결을 시도해 EPIPE 유발
      // dev 환경에서는 useWebSocket이 VITE_WS_URL로 직접 연결
    },
  },
});
