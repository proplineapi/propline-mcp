/**
 * PropLine MCP server — hosted Streamable HTTP entry point.
 *
 * Serves the SAME tool table as the stdio build, at
 *
 *     https://mcp.prop-line.com/mcp
 *
 * so any remote-capable MCP client (Claude.ai / Claude Desktop connectors,
 * Claude Code `--transport http`, Cursor, ChatGPT, Smithery/PulseMCP "try
 * it" buttons) can use PropLine with no install step.
 *
 * Auth — per request, first match wins:
 *   Authorization: Bearer <PropLine API key>
 *   X-API-Key: <key>
 *   ?apiKey=<key>            (query string, for clients that cannot set headers)
 *   none                     → shared free demo key, same fallback as stdio
 *
 * The key is never stored: each request builds its own PropLineClient and
 * runs the JSON-RPC handling inside `withClient()`, so tool handlers pick
 * it up off AsyncLocalStorage. Stateless transport (no session ids): one
 * Server + one transport per request, closed when the response ends. That
 * is the simplest shape that is safe across users and scales horizontally.
 *
 * Also serves:
 *   GET /          — JSON manifest (name, version, endpoint, tool count, docs)
 *   GET /health    — 200 "ok" for Fly health checks
 *
 * Env: PORT (default 8080), PROPLINE_BASE_URL (override API origin).
 */

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import {
  createServer,
  DEMO_KEY,
  PropLineClient,
  tools,
  VERSION,
  withClient,
} from "./server.js";

const PORT = Number(process.env.PORT ?? 8080);
const BASE_URL = process.env.PROPLINE_BASE_URL;
const PUBLIC_URL = process.env.MCP_PUBLIC_URL ?? "https://mcp.prop-line.com";

/** Pull the caller's PropLine key out of the request, or fall back to demo. */
export function extractApiKey(req: IncomingMessage): { key: string; demo: boolean } {
  const auth = req.headers.authorization;
  if (typeof auth === "string") {
    const m = /^Bearer\s+(\S+)$/i.exec(auth.trim());
    if (m) return { key: m[1], demo: false };
  }
  const hdr = req.headers["x-api-key"];
  if (typeof hdr === "string" && hdr.trim()) return { key: hdr.trim(), demo: false };
  const url = new URL(req.url ?? "/", "http://localhost");
  const q = url.searchParams.get("apiKey") ?? url.searchParams.get("api_key");
  if (q && q.trim()) return { key: q.trim(), demo: false };
  return { key: DEMO_KEY, demo: true };
}

// Browser-based MCP clients (the MCP Inspector, web IDEs) preflight. Keep
// it permissive: the endpoint is public and every call is authenticated by
// the caller's own key, not by origin.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-API-Key, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", ...CORS_HEADERS });
  res.end(JSON.stringify(body, null, 2));
}

async function handleMcp(req: IncomingMessage, res: ServerResponse) {
  const { key, demo } = extractApiKey(req);
  const client = new PropLineClient({ apiKey: key, baseUrl: BASE_URL });
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  if (demo) res.setHeader("X-PropLine-Demo-Key", "1");
  await server.connect(transport);
  await withClient(client, demo, () => transport.handleRequest(req, res));
}

const manifest = () => ({
  name: "propline-mcp",
  version: VERSION,
  transport: "streamable-http",
  endpoint: `${PUBLIC_URL}/mcp`,
  tools: tools.length,
  auth: {
    header: "Authorization: Bearer <PropLine API key>  (or X-API-Key, or ?apiKey=)",
    without_key:
      "shared free demo key — tools work, paid features are redacted, limits are pooled",
    get_key: "https://prop-line.com/?ref=mcp-hosted",
  },
  docs: "https://prop-line.com/for-ai-agents?ref=mcp-hosted",
  stdio_alternative: "npx -y propline-mcp",
});

const httpServer = createHttpServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }
  if (path === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain", ...CORS_HEADERS });
    res.end("ok");
    return;
  }
  if (path === "/") {
    json(res, 200, manifest());
    return;
  }
  if (path === "/mcp") {
    try {
      await handleMcp(req, res);
    } catch (err) {
      console.error("[propline-mcp http] request failed:", err);
      if (!res.headersSent) {
        json(res, 500, {
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
    return;
  }
  json(res, 404, { error: "not_found", endpoint: `${PUBLIC_URL}/mcp` });
});

httpServer.listen(PORT, () => {
  console.error(
    `[propline-mcp ${VERSION}] streamable HTTP listening on :${PORT} (endpoint ${PUBLIC_URL}/mcp, ${tools.length} tools)`,
  );
});
