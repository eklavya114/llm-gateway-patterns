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

    // primary healthy -> its response comes straight back, no failover
    {
      const result = await routeCompletion(PRIMARY_URL, SECONDARY_URL, { mode: "ok" });
      assert.equal(result.provider, "primary", "a healthy primary should answer directly, no failover");
      console.log("PASS: healthy primary answers without touching secondary");
    }

    // primary returns 429 -> failover to a healthy secondary
    {
      const result = await routeCompletion(PRIMARY_URL, SECONDARY_URL, { mode: "429" }, { mode: "ok" });
      assert.equal(result.provider, "secondary", "a 429 from primary should fail over to secondary");
      console.log("PASS: primary 429 fails over to secondary");
    }

    // primary hangs past its 3000ms budget -> aborted, failover to secondary,
    // and the whole thing should resolve close to 3s, not wait out the hang
    {
      const start = Date.now();
      const result = await routeCompletion(PRIMARY_URL, SECONDARY_URL, { mode: "hang" }, { mode: "ok" });
      const elapsedMs = Date.now() - start;

      assert.equal(result.provider, "secondary", "a hung primary should fail over to secondary");
      assert.ok(elapsedMs >= 2900, `should not fail over before the 3000ms budget, took ${elapsedMs}ms`);
      assert.ok(elapsedMs < 4000, `should fail over close to the 3000ms budget, not wait out the full 60s hang, took ${elapsedMs}ms`);
      console.log(`PASS: hung primary aborted and failed over in ${elapsedMs}ms`);
    }

    // both providers fail -> a single sanitized GatewayError, not a raw
    // upstream error or an unhandled rejection
    {
      try {
        await routeCompletion(PRIMARY_URL, SECONDARY_URL, { mode: "429" }, { mode: "429" });
        assert.fail("expected routeCompletion to throw when both providers fail");
      } catch (err) {
        assert.ok(err instanceof GatewayError, "should throw a GatewayError, not a raw error");
        assert.equal((err as GatewayError).code, "all_providers_failed");
        const message = (err as GatewayError).message;
        assert.ok(!message.includes(PRIMARY_URL), "sanitized error should not leak the primary URL");
        assert.ok(!message.includes(SECONDARY_URL), "sanitized error should not leak the secondary URL");
        console.log("PASS: both providers failing throws a single sanitized GatewayError");
      }
    }

    console.log("\nRouter test harness passed.");
  } finally {
    providers.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
