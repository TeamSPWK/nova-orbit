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
      "/ws": {
        target: "ws://127.0.0.1:3000",
        ws: true,
        configure: (proxy) => {
          proxy.on("error", () => {}); // Suppress WS proxy errors
        },
      },
    },
  },
});
