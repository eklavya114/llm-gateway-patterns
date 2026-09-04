# Task 2 — MCP Gateway Auth

An HTTP/JSON-RPC reverse proxy that sits in front of a downstream MCP server
and enforces role-based access on admin-prefixed tools.

- [src/downstream.ts](src/downstream.ts) — minimal mock MCP server (`tools/list`, `tools/call`) exposing
  `get_weather` (normal) and `admin_reset_key` (admin-only) tools.
- [src/gateway.ts](src/gateway.ts) — the proxy.
- [src/auth.ts](src/auth.ts) — token verification.

## Auth scheme

**Signed JWT with a `role` claim.** The gateway expects
`Authorization: Bearer <jwt>` where the JWT is signed with `JWT_SECRET` and
carries `{ role: "admin" | "viewer" }`. This is the only auth mechanism
implemented — there is no separate static-token table.

Mint a test token:

```
npx tsx src/mint-token.ts admin
npx tsx src/mint-token.ts viewer
```

## Gateway logic

1. Missing/malformed `Authorization` header, invalid/expired JWT, or missing
   `role` claim → `401` with a JSON-RPC-shaped error body, before the request
   body is even interpreted as JSON-RPC.
2. `method: "tools/list"` → forwarded to downstream unmodified.
3. `method: "tools/call"` with `params.name` starting with `admin_` and
   `role !== "admin"` → rejected locally without contacting downstream:
   `{ error: { code: -32001, message: "Unauthorized Tool Call" } }`.
4. Otherwise forwarded to downstream and the response relayed as-is.

Stateless per request — no sessions.

## Connecting a real client to this gateway

This gateway speaks plain HTTP JSON-RPC (`POST /` with a JSON-RPC body and a
bearer token) — it does not implement the MCP Streamable HTTP transport spec
(session headers, SSE upgrade, etc.), so it is not something you point an
off-the-shelf MCP client's "remote server URL" field at directly. It
demonstrates the auth/proxy logic an MCP gateway needs; wiring it into the
official Streamable HTTP transport would mean adding that transport layer on
top of the same `checkRole` / forwarding logic in [src/gateway.ts](src/gateway.ts).

What you can do today: call it like any authenticated JSON-RPC HTTP API from
your own application code, a backend service, or a script — anything that
can send a `POST` with an `Authorization: Bearer <jwt>` header and a
JSON-RPC body:

```ts
const res = await fetch("http://localhost:4000", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "authorization": `Bearer ${token}`, // minted via src/mint-token.ts
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "get_weather", arguments: {} },
  }),
});
```

In a real deployment, `JWT_SECRET` would be issued by your actual auth
provider (not `mint-token.ts`, which exists only to generate test tokens
locally), and `DOWNSTREAM_URL` would point at your real MCP server's HTTP
endpoint instead of the mock in `src/downstream.ts`.

## Run

```
npm install
cp .env.example .env
npm run dev          # starts downstream (:4100) and gateway (:4000) together
```

## Try it

```
TOKEN=$(npx tsx src/mint-token.ts viewer)

# allowed: normal tool
curl -s http://localhost:4000 -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_weather","arguments":{}}}'

# blocked: viewer calling admin_ tool -> -32001 Unauthorized Tool Call
curl -s http://localhost:4000 -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"admin_reset_key","arguments":{}}}'

# no Authorization header -> 401
curl -s http://localhost:4000 -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/list"}'
```
