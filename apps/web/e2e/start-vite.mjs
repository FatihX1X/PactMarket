import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const mode = process.argv[2] ?? "pending";
const port = mode === "demo" ? "4273" : "4274";
const env = {
  ...process.env,
  VITE_CHAIN_ID: "31337",
  VITE_RPC_URL: "http://127.0.0.1:8545",
  VITE_TECHNOCORE_BASE_URL: "http://technocore.mock",
  VITE_TECHNOCORE_PROXY_URL: "",
  VITE_E2E_CACHE_DIR: `node_modules/.vite-${mode}`,
};
if (mode === "demo") {
  env.VITE_MARKET_ADDRESS = "0x2946259e0334f33a064106302415ad3391bed384";
  env.VITE_USDC_ADDRESS = "0xf2e246bb76df876cef8b38ae84130f4f55de395b";
  env.VITE_DEPLOYMENT_BLOCK = "2";
  env.VITE_COMPUTE_MARKET_ADDRESS = "0xDe09E74d4888Bc4e65F589e8c13Bce9F71DdF4c7";
  env.VITE_COMPUTE_DEPLOYMENT_BLOCK = "3";
} else {
  env.VITE_MARKET_ADDRESS = "";
  env.VITE_USDC_ADDRESS = "";
  env.VITE_DEPLOYMENT_BLOCK = "";
  env.VITE_COMPUTE_MARKET_ADDRESS = "";
  env.VITE_COMPUTE_DEPLOYMENT_BLOCK = "";
}

const vite = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const child = spawn(process.execPath, [vite, "--host", "127.0.0.1", "--port", port], {
  env,
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 0));
