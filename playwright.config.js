import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./frontend/tests",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: ".runtime/playwright-results",
  use: {
    baseURL: "http://127.0.0.1:5173",
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    headless: true,
  },
  webServer:
    process.env.E2E_SERVER_MANAGED === "1"
      ? undefined
      : {
          command:
            "node node_modules/vite/bin/vite.js frontend --config frontend/vite.config.js --host 127.0.0.1 --port 5173 --strictPort",
          url: "http://127.0.0.1:5173",
          reuseExistingServer: true,
          timeout: 30000,
        },
});
