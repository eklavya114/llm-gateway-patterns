import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.resolve(__dirname, "../dist/index.js");

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

function sendRequests(requests: object[]): Promise<JsonRpcResponse[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SERVER_ENTRY]);
    let stdout = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.on("error", reject);

    const input = requests.map((r) => JSON.stringify(r)).join("\n") + "\n";
    child.stdin.write(input);

    setTimeout(() => {
      child.kill();
      const lines = stdout.split("\n").filter(Boolean);
      resolve(lines.map((l) => JSON.parse(l)) as JsonRpcResponse[]);
    }, 1500);
  });
}

async function main() {
  const responses = await sendRequests([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_customer_record", arguments: { customer_id: "CUST-A1B2C" } },
    },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_customer_record", arguments: { customer_id: "CUST-1" } },
    },
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "trigger_refund", arguments: { customer_id: "CUST-A1B2C", amount: 0, reason: "long enough reason" } },
    },
    {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "trigger_refund", arguments: { customer_id: "CUST-A1B2C", amount: 10, reason: "short" } },
    },
    {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "not_a_real_tool", arguments: {} },
    },
  ]);

  const byId = new Map(responses.map((r) => [r.id, r]));

  const validCall = byId.get(2);
  assert.ok(validCall?.result, "valid get_customer_record call should return a result, not an error");
  console.log("PASS: valid tool call returns a result");

  const invalidId = byId.get(3);
  assert.equal(invalidId?.error?.code, -32602, "malformed customer_id should return -32602 at the top level");
  console.log("PASS: malformed customer_id returns top level -32602");

  const zeroAmount = byId.get(4);
  assert.equal(zeroAmount?.error?.code, -32602, "amount of 0 should return -32602");
  console.log("PASS: amount of 0 returns -32602");

  const shortReason = byId.get(5);
  assert.equal(shortReason?.error?.code, -32602, "short reason should return -32602");
  console.log("PASS: reason under 10 chars returns -32602");

  const unknownTool = byId.get(6);
  assert.equal(unknownTool?.error?.code, -32601, "unknown tool name should return -32601 Method not found");
  console.log("PASS: unknown tool returns -32601");

  console.log("\nAll index integration tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
