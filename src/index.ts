/**
 * PropLine MCP server — stdio entry point.
 *
 * Run via:   npx -y propline-mcp
 * Hosted:    https://mcp.prop-line.com/mcp (Streamable HTTP, see http.ts)
 *
 * All tools live in server.ts; this file only connects the stdio transport.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer, usingDemoKey, VERSION } from "./server.js";

export { VERSION, DEMO_KEY, filterByMinEv } from "./server.js";

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
// stderr is fine in MCP — clients route it to logs without breaking the
// JSON-RPC stream on stdout.
console.error(`[propline-mcp ${VERSION}] connected via stdio`);
if (usingDemoKey) {
  console.error(
    "[propline-mcp] note: no PROPLINE_API_KEY set — running on the shared " +
      "free demo key. Tool calls work; paid features are redacted and limits " +
      "are pooled. Get your own free key: https://prop-line.com",
  );
}
