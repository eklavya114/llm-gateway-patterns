<div align="center">

# llm-gateway-patterns

**Production-grade infrastructure patterns for LLM and MCP-based systems**

Schema-validated MCP tooling · role-aware gateway auth · real-time PII redaction · rate-limited failover routing

[![Node](https://img.shields.io/badge/Node-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-6E56CF)](https://modelcontextprotocol.io)
[![SQLite](https://img.shields.io/badge/SQLite-node%3Asqlite-003B57?logo=sqlite&logoColor=white)](https://nodejs.org/api/sqlite.html)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](#license)
[![Tests](https://img.shields.io/badge/Tests-Passing-4CAF50)](#testing)

</div>

---

## Overview

Four independent, standalone services, each solving one operational problem
that shows up in every real LLM/agent deployment: validating tool input at
the protocol boundary, enforcing authorization on privileged tools, keeping
PII out of streamed model output, and surviving upstream provider outages
without leaking internals. Each task ships with its own `package.json`,
tests, and README — no shared dependency tree, no monorepo tooling required.

| # | Service | Solves |
|---|---------|--------|
| 1 | [MCP Server](task-1-mcp-server/) | Schema-validated tool calls over stdio, real JSON-RPC error codes |
| 2 | [MCP Gateway Auth](task-2-mcp-gateway-auth/) | Role-based access control in front of an MCP server |
| 3 | [PII Redaction Gateway](task-3-llm-pii-redaction-gateway/) | Streaming redaction without buffering the response |
| 4 | [Rate Limit & Failover Router](task-4-llm-rate-limit-fallback-router/) | Per-tenant quotas and automatic provider failover |

---

## Architecture

```mermaid
flowchart LR
    subgraph Client
        C[MCP Client / Application]
    end

    subgraph T2["Task 2 — MCP Gateway Auth"]
        G2[Gateway :4000]
        A2["JWT role check<br/>admin_* tool guard"]
        D2["Mock downstream<br/>MCP server :4100"]
        G2 --> A2 --> D2
    end

    subgraph T1["Task 1 — MCP Server (stdio)"]
        S1["get_customer_record<br/>trigger_refund"]
        Z1["Zod validation<br/>-32602 on invalid input"]
        S1 --> Z1
    end

    subgraph T3["Task 3 — PII Redaction Gateway"]
        G3[Gateway :5000]
        R3["Sliding overlap buffer<br/>redacts email / SSN / card"]
        U3["Mock streaming<br/>upstream :5100"]
        G3 --> R3
        U3 -. SSE chunks .-> G3
    end

    subgraph T4["Task 4 — Rate Limit & Failover Router"]
        G4[Gateway :6000]
        RL["Sliding-window limiter<br/>50k tokens/min · SQLite"]
        P["Primary :6100"]
        SEC["Secondary :6200"]
        G4 --> RL
        G4 -->|"3000ms budget"| P
        P -.429 / timeout.-> G4
        G4 -->|failover| SEC
    end

    C -.stdio JSON-RPC.-> S1
    C -->|HTTP JSON-RPC| G2
    C -->|HTTP SSE| G3
    C -->|HTTP| G4

    style T1 fill:#1a1a2e,stroke:#6E56CF,color:#fff
    style T2 fill:#1a1a2e,stroke:#339933,color:#fff
    style T3 fill:#1a1a2e,stroke:#e74c3c,color:#fff
    style T4 fill:#1a1a2e,stroke:#3178C6,color:#fff
```

---

## Services

### 1 · [MCP Server](task-1-mcp-server/)

MCP tool server over stdio, built on the SDK's low-level `Server` class so
Zod validation failures surface as real top-level JSON-RPC errors
(`-32602 Invalid params`) instead of being wrapped into a tool-result payload.

- `get_customer_record(customer_id)` — pattern-validated (`^CUST-[A-Z0-9]{5}$`)
- `trigger_refund(customer_id, amount, reason)` — positive amount, min-length reason
- stdout carries **JSON-RPC only** — all logging routed to stderr via `pino`

```bash
cd task-1-mcp-server && npm install && npm run dev
```

### 2 · [MCP Gateway Auth](task-2-mcp-gateway-auth/)

Reverse proxy in front of a downstream MCP server. Verifies a signed JWT's
`role` claim on every request and blocks non-admins from calling any
`admin_`-prefixed tool — rejected locally, before downstream is ever touched.

```bash
cd task-2-mcp-gateway-auth && npm install && cp .env.example .env && npm run dev
```

### 3 · [PII Redaction Gateway](task-3-llm-pii-redaction-gateway/)

Proxies a streaming completion and redacts emails, SSNs, and card-like
numbers **in flight**, using a sliding overlap buffer so a pattern split
across two chunk boundaries still gets caught — without ever buffering the
full response in memory.

```bash
cd task-3-llm-pii-redaction-gateway && npm install && cp .env.example .env && npm run dev
```

### 4 · [Rate Limit & Failover Router](task-4-llm-rate-limit-fallback-router/)

Per-tenant sliding-window token rate limiter (50,000 tokens/min) backed by
on-disk SQLite, with primary→secondary failover on `429` or a 3000ms
timeout via `AbortController`. Errors returned to the client are sanitized —
no upstream stack traces, URLs, or provider internals ever leak.

```bash
cd task-4-llm-rate-limit-fallback-router && npm install && cp .env.example .env && npm run dev
```

---

## Testing

Each service that has non-trivial logic to verify ships its own test suite:

```bash
cd task-3-llm-pii-redaction-gateway && npm test   # in-chunk, split-boundary, passthrough
cd task-4-llm-rate-limit-fallback-router && npm test   # cap enforcement, sliding window, concurrency
```

Task 4's suite includes a real 20-worker-thread concurrency test that proves
the token cap holds under concurrent load from separate SQLite connections —
not just sequential requests.

---

## Documentation

| Document | Contents |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | Full build log, bugs found and fixed, verification results |
| [DEVIATIONS.md](DEVIATIONS.md) | Every place the implementation diverged from spec, and why |

---

## License

[MIT](LICENSE)

---

<div align="center">

Built and maintained by **Eklavya Prasad**

[GitHub](https://github.com/eklavya114) · [llm-gateway-patterns](https://github.com/eklavya114/llm-gateway-patterns)

</div>
