import assert from "node:assert/strict";
import { spawn, ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "../dist");
const SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";
const GATEWAY_URL = "http://localhost:4300";
const DOWNSTREAM_URL = "http://localhost:4301";

function sign(role: "admin" | "viewer"): string {
  return jwt.sign({ role }, SECRET, { expiresIn: "1h" });
}

interface JsonRpcResponseBody {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

function waitForPort(url: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (async function poll() {
      while (Date.now() - start < timeoutMs) {
        try {
          await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
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
  const children: ChildProcess[] = [];

  const downstream = spawn("node", [path.join(DIST, "downstream.js")], {
    env: { ...process.env, DOWNSTREAM_PORT: "4301" },
  });
  children.push(downstream);

  let downstreamLog = "";
  downstream.stderr.on("data", (chunk) => {
    downstreamLog += chunk.toString();
  });

  const gateway = spawn("node", [path.join(DIST, "gateway.js")], {
    env: { ...process.env, GATEWAY_PORT: "4300", DOWNSTREAM_URL: DOWNSTREAM_URL, JWT_SECRET: SECRET },
  });
  children.push(gateway);

  try {
    await waitForPort(DOWNSTREAM_URL);
    await waitForPort(GATEWAY_URL);

    const viewerToken = sign("viewer");
    const adminToken = sign("admin");

    // no Authorization header -> 401
    {
      const res = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      assert.equal(res.status, 401, "missing auth header should return HTTP 401");
      const body = (await res.json()) as JsonRpcResponseBody;
      assert.ok(body.error, "401 response should still carry a JSON-RPC shaped error");
      console.log("PASS: missing Authorization header returns 401");
    }

    // viewer calling a normal tool -> forwarded and allowed
    {
      const res = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${viewerToken}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_weather", arguments: {} } }),
      });
      const body = (await res.json()) as JsonRpcResponseBody;
      assert.ok(body.result, "viewer calling a normal tool should succeed");
      console.log("PASS: viewer calling a normal tool is forwarded and allowed");
    }

    const downstreamLogLengthBeforeBlockedCall = downstreamLog.length;

    // viewer calling admin_ tool -> blocked locally, -32001, downstream never touched
    {
      const res = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${viewerToken}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "admin_reset_key", arguments: {} } }),
      });
      const body = (await res.json()) as JsonRpcResponseBody;
      assert.equal(body.error?.code, -32001, "viewer calling admin_ tool should get -32001 Unauthorized Tool Call");

      await new Promise((r) => setTimeout(r, 200));
      assert.equal(
        downstreamLog.length,
        downstreamLogLengthBeforeBlockedCall,
        "downstream should never receive the blocked admin_ call, its log should not grow",
      );
      console.log("PASS: viewer calling admin_ tool is blocked before reaching downstream");
    }

    // admin calling admin_ tool -> allowed
    {
      const res = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "admin_reset_key", arguments: {} } }),
      });
      const body = (await res.json()) as JsonRpcResponseBody;
      assert.ok(body.result, "admin calling admin_ tool should succeed");
      console.log("PASS: admin calling admin_ tool is allowed");
    }

    console.log("\nAll gateway integration tests passed.");
  } finally {
    for (const child of children) child.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
