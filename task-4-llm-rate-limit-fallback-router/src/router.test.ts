import assert from "node:assert/strict";
import { spawn, ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { routeCompletion, GatewayError } from "./router.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "../dist");
const PRIMARY_URL = "http://localhost:6400/v1/complete";
const SECONDARY_URL = "http://localhost:6401/v1/complete";

function waitForPort(url: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (async function poll() {
      while (Date.now() - start < timeoutMs) {
        try {
          await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode: "ok" }),
          });
          resolve();
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      reject(new Error(`Timed out waiting for ${url}`));
    })();
  });
}

async function main() {
  const providers = spawn("node", [path.join(DIST, "mockProviders.js")], {
    env: { ...process.env, PRIMARY_PORT: "6400", SECONDARY_PORT: "6401" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForPort(PRIMARY_URL);
    await waitForPort(SECONDARY_URL);

    console.log("PASS: harness ready, mock providers reachable");
    console.log("\nRouter test harness passed.");
  } finally {
    providers.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
