import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL("../", import.meta.url)), "");
  const frontend = new URL(env.FRONTEND_URL || "http://localhost:5173");
  const backendPort = Number(env.PORT || 3000);
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: env.FRONTEND_HOST || "0.0.0.0",
      port: Number(
        frontend.port || (frontend.protocol === "https:" ? 443 : 80),
      ),
      strictPort: true,
      proxy: { "/api": `http://127.0.0.1:${backendPort}` },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            charts: ["recharts"],
            react: ["react", "react-dom", "react-router-dom"],
          },
        },
      },
    },
  };
});
