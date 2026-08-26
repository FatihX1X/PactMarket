import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: { trace: "retain-on-failure" },
  webServer: [
    {
      command: "node e2e/start-vite.mjs demo",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: true,
    },
    {
      command: "node e2e/start-vite.mjs pending",
      url: "http://127.0.0.1:4174",
      reuseExistingServer: true,
    },
  ],
  projects: [
    {
      name: "demo",
      testMatch: "demo.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4173" },
    },
    {
      name: "desktop-pending",
      testMatch: "pending.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4174" },
    },
    {
      name: "mobile-pending",
      testMatch: "pending.spec.ts",
      use: { ...devices["Pixel 7"], baseURL: "http://127.0.0.1:4174" },
    },
  ],
});
