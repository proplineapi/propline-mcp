/**
 * PropLine MCP server.
 *
 * Exposes the PropLine REST API as Model Context Protocol tools so AI
 * clients (Claude Desktop, Claude Code, ChatGPT desktop with MCP, etc.)
 * can pull live odds, prop resolution, cross-book +EV, scores, and
 * box-score stats directly via tool calls.
 *
 * Run via:   npx -y propline-mcp
 * Auth:      PROPLINE_API_KEY env var (free key at https://prop-line.com)
 * Optional:  PROPLINE_BASE_URL env var (override for self-hosted setups)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { PropLineClient, PropLineHTTPError } from "./client.js";

export const VERSION = "0.2.2";

const apiKey = process.env.PROPLINE_API_KEY;
const baseUrl = process.env.PROPLINE_BASE_URL;

if (!apiKey) {
  console.error(
    "[propline-mcp] PROPLINE_API_KEY not set. Get a free key at " +
      "https://prop-line.com and set it in your MCP client config.",
  );
  process.exit(1);
}

const client = new PropLineClient({ apiKey, baseUrl });

// ---------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------

interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  // Returns either JSON-serializable data (will be JSON.stringify'd in the
  // tool result) or a string (returned as-is).
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

const tools: ToolDef[] = [
  {
    name: "propline_list_sports",
    description:
      "List all sports PropLine currently polls. Returns sport keys " +
      "(e.g. baseball_mlb, basketball_nba, soccer_epl) along with human " +
      "titles and active status. Use this first to discover what " +
      "sport_key values are valid for the other tools.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    handler: () => client.listSports(),
  },
  {
    name: "propline_list_events",
    description:
      "List upcoming events for a sport. Returns each event's id, " +
      "home_team, away_team, commence_time. Use the returned event_id " +
      "to drill into per-event odds, props, +EV, or results.",
    inputSchema: {
      type: "object",
      properties: {
        sport_key: {
          type: "string",
          description:
            "Sport key from propline_list_sports — e.g. baseball_mlb, basketball_nba",
        },
        live: {
          type: "boolean",
          description:
            "If true, only return in-progress (live) events. Defaults to false.",
        },
      },
      required: ["sport_key"],
      additionalProperties: false,
    },
    handler: (args) =>
      client.listEvents(args.sport_key as string, {
        live: args.live as boolean | undefined,
      }),
  },
  {
    name: "propline_list_event_markets",
    description:
      "List the market types available for a specific event (e.g. h2h, " +
      "spreads, totals, player_points, pitcher_strikeouts). Useful when " +
      "you don't know which prop markets a given event carries.",
    inputSchema: {
      type: "object",
      properties: {
        sport_key: { type: "string" },
        event_id: { type: ["string", "number"] },
      },
      required: ["sport_key", "event_id"],
      additionalProperties: false,
    },
    handler: (args) =>
      client.listEventMarkets(
        args.sport_key as string,
        args.event_id as string | number,
      ),
  },
  {
    name: "propline_get_odds",
    description:
      "Get live odds. If event_id is supplied, returns full per-event " +
      "props for that event; otherwise returns bulk game-line odds for " +
      "the whole sport. Pass markets as a comma-separated list (e.g. " +
      "'h2h,spreads,totals' or 'player_points,player_rebounds'). " +
      "Response includes a bookmakers[] array across every book that " +
      "carries the requested markets (currently up to 13: Bovada, " +
      "DraftKings, FanDuel, Pinnacle, BetMGM, BetRivers, Unibet, " +
      "Underdog, PrizePicks, Kalshi, Polymarket, Matchbook, Smarkets " +
      "— coverage varies by sport).",
    inputSchema: {
      type: "object",
      properties: {
        sport_key: { type: "string" },
        event_id: {
          type: ["string", "number"],
          description: "Optional. If set, returns props for this event.",
        },
        markets: {
          type: "string",
          description:
            "Comma-separated market keys. Defaults to h2h on bulk; h2h,spreads,totals on event. Pass an explicit list to fetch player props (sport-specific — e.g. player_points,player_rebounds for NBA; pitcher_strikeouts,batter_home_runs for MLB).",
        },
        bookmakers: {
          type: "string",
          description:
            "Comma-separated subset of book keys (bovada, draftkings, fanduel, pinnacle, betmgm, betrivers, unibet, underdog, prizepicks, kalshi, polymarket, matchbook, smarkets). Default returns all available.",
        },
      },
      required: ["sport_key"],
      additionalProperties: false,
    },
    handler: (args) =>
      client.getOdds(args.sport_key as string, {
        eventId: args.event_id as string | number | undefined,
        markets: args.markets as string | undefined,
        bookmakers: args.bookmakers as string | undefined,
      }),
  },
  {
    name: "propline_get_odds_history",
    description:
      "Pro-tier endpoint. Returns the historical line-movement snapshot " +
      "series for an event (every recorded price/point change per " +
      "outcome over the event's lifetime). Free tier returns market " +
      "structure with redacted snapshots and an upgrade pointer.",
    inputSchema: {
      type: "object",
      properties: {
        sport_key: { type: "string" },
        event_id: { type: ["string", "number"] },
        markets: { type: "string" },
      },
      required: ["sport_key", "event_id"],
      additionalProperties: false,
    },
    handler: (args) =>
      client.getOddsHistory(
        args.sport_key as string,
        args.event_id as string | number,
        { markets: args.markets as string | undefined },
      ),
  },
  {
    name: "propline_get_scores",
    description:
      "Free-tier endpoint. Returns recent and live game scores plus " +
      "status (scheduled, live, final) for a sport. Useful for: 'is " +
      "this game over yet, what was the final score'.",
    inputSchema: {
      type: "object",
      properties: {
        sport_key: { type: "string" },
        days_from: {
          type: "number",
          description:
            "How many past days of completed games to include. Defaults to 1.",
        },
      },
      required: ["sport_key"],
      additionalProperties: false,
    },
    handler: (args) =>
      client.getScores(args.sport_key as string, {
        daysFrom: args.days_from as number | undefined,
      }),
  },
  {
    name: "propline_get_resolution_summary",
    description:
      "Free-tier endpoint. Returns the factual volume of player props " +
      "PropLine has graded against real box scores over the last N days " +
      "(aggregated counts only): total graded/settled, games, sports " +
      "covered, plus per-sport and top-market breakdowns. Useful for: " +
      "'how much graded prop data does PropLine have, what's the " +
      "coverage'. A coverage proof, never a profitability claim.",
    inputSchema: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "Look-back window, 1-90. Defaults to 30.",
        },
      },
      required: [],
      additionalProperties: false,
    },
    handler: (args) =>
      client.getResolutionSummary({ days: args.days as number | undefined }),
  },
  {
    name: "propline_get_event_stats",
    description:
      "Book-agnostic raw box-score stats for a completed event. Returns " +
      "per-player stats (e.g. strikeouts, hits, points, rebounds, " +
      "shots-on-goal) decoupled from any sportsbook's lines. Free tier.",
    inputSchema: {
      type: "object",
      properties: {
        sport_key: { type: "string" },
        event_id: { type: ["string", "number"] },
      },
      required: ["sport_key", "event_id"],
      additionalProperties: false,
    },
    handler: (args) =>
      client.getEventStats(
        args.sport_key as string,
        args.event_id as string | number,
      ),
  },
  {
    name: "propline_get_event_results",
    description:
      "Pro-tier endpoint. Returns graded prop outcomes for a completed " +
      "event — every Over/Under marked won, lost, push, or void with " +
      "the actual stat value next to the line. The single most " +
      "distinctive feature vs the-odds-api: they don't grade props at " +
      "any tier. Free tier returns the same structure with resolution " +
      "and actual_value redacted plus an upgrade pointer.",
    inputSchema: {
      type: "object",
      properties: {
        sport_key: { type: "string" },
        event_id: { type: ["string", "number"] },
      },
      required: ["sport_key", "event_id"],
      additionalProperties: false,
    },
    handler: (args) =>
      client.getEventResults(
        args.sport_key as string,
        args.event_id as string | number,
      ),
  },
  {
    name: "propline_get_player_history",
    description:
      "Player prop history across recent games. Returns each prior prop " +
      "this player took with line, prices, resolution, and actual value. " +
      "Pro tier returns full data; free tier returns redacted " +
      "resolution/actual_value with an upgrade pointer.",
    inputSchema: {
      type: "object",
      properties: {
        sport_key: { type: "string" },
        player_name: {
          type: "string",
          description:
            "Player name as it appears in box scores — e.g. 'Aaron Judge', 'Nikola Jokic'",
        },
        limit: {
          type: "number",
          description: "Max number of past games (default 20, max 100)",
        },
        markets: {
          type: "string",
          description:
            "Comma-separated subset of markets (e.g. 'player_points,player_rebounds')",
        },
      },
      required: ["sport_key", "player_name"],
      additionalProperties: false,
    },
    handler: (args) =>
      client.getPlayerHistory(
        args.sport_key as string,
        args.player_name as string,
        {
          limit: args.limit as number | undefined,
          markets: args.markets as string | undefined,
        },
      ),
  },
  {
    name: "propline_get_event_ev",
    description:
      "Pro-tier endpoint. Returns cross-book +EV per outcome for an " +
      "event. We anchor on Pinnacle's sharp line, remove vig, derive a " +
      "no-vig fair line, and compute EV% per book at the same line. " +
      "Outcomes are sorted with +EV plays floated to the top of each " +
      "line group. PrizePicks is excluded from EV math (DFS payouts " +
      "aren't comparable to per-book prices).",
    inputSchema: {
      type: "object",
      properties: {
        sport_key: { type: "string" },
        event_id: { type: ["string", "number"] },
        markets: { type: "string" },
        min_ev_pct: {
          type: "number",
          description: "Filter to outcomes with EV ≥ this percent (e.g. 2.0).",
        },
      },
      required: ["sport_key", "event_id"],
      additionalProperties: false,
    },
    handler: (args) =>
      client.getEventEv(
        args.sport_key as string,
        args.event_id as string | number,
        {
          markets: args.markets as string | undefined,
          minEvPct: args.min_ev_pct as number | undefined,
        },
      ),
  },
];

// ---------------------------------------------------------------------
// MCP server wiring
// ---------------------------------------------------------------------

const server = new Server(
  { name: "propline-mcp", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = tools.find((t) => t.name === req.params.name);
  if (!tool) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Unknown tool: ${req.params.name}`,
        },
      ],
    };
  }

  try {
    const data = await tool.handler(req.params.arguments ?? {});
    const text =
      typeof data === "string" ? data : JSON.stringify(data, null, 2);
    return {
      content: [{ type: "text", text }],
    };
  } catch (err) {
    const msg =
      err instanceof PropLineHTTPError
        ? `PropLine API error ${err.statusCode}: ${err.body.slice(0, 500)}`
        : err instanceof Error
        ? err.message
        : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: msg }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
// stderr is fine in MCP — clients route it to logs without breaking the
// JSON-RPC stream on stdout.
console.error(`[propline-mcp ${VERSION}] connected via stdio`);
