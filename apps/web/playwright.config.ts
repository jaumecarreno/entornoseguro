import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    headless: true,
  },
  webServer: [
    {
      command: "npm run --workspace @entornoseguro/api dev",
      url: "http://127.0.0.1:4000/health",
      cwd: repoRoot,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "npm run --workspace @entornoseguro/web dev",
      url: "http://127.0.0.1:3000",
      cwd: repoRoot,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
