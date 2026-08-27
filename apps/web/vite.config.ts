import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  cacheDir: process.env.VITE_E2E_CACHE_DIR ?? "node_modules/.vite",
  build: { target: "es2022", sourcemap: true },
  test: {
    environment: "jsdom",
    exclude: [...configDefaults.exclude, "e2e/**"],
    passWithNoTests: true,
  },
});
