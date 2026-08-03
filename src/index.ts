/**
 * PropLine MCP server.
 *
 * Exposes the PropLine REST API as Model Context Protocol tools so AI
 * clients (Claude Desktop, Claude Code, ChatGPT desktop with MCP, etc.)
 * can pull live odds, prop resolution, cross-book +EV, scores, and
 * box-score stats directly via tool calls.
 *
 * Run via:   npx -y propline-mcp
 * Auth:      PROPLINE_API_KEY env var (free key at https://prop-line.com).
 *            If unset, falls back to a shared public DEMO key so an agent
 *            can answer its first question with zero config — see DEMO_KEY.
 * Optional:  PROPLINE_BASE_URL env var (override for self-hosted setups)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { PropLineClient, PropLineHTTPError } from "./client.js";

export const VERSION = "0.18.1";

// Shared public demo key. Baked in on purpose so `npx -y propline-mcp` works
// with ZERO configuration — an AI agent can discover the server and answer
// its first question without a human-issued key in the loop. It's a free-tier,
// read-only, rate-limited key: paid features (resolution, +EV, history,
// exports) still return the redacted teaser + upgrade_url, so the funnel is
// intact, and a generous-but-bounded daily cap nudges real production usage
// toward a personal key. Get your own (higher limits, full features) at
// https://prop-line.com. Rotated by changing this value AND the seed in the
// API repo (scraper/seed.py) together.
export const DEMO_KEY = "be2b8487fcfacb1fbc292a8aa925a84c";

const apiKey = process.env.PROPLINE_API_KEY;
const baseUrl = process.env.PROPLINE_BASE_URL;
const usingDemoKey = !apiKey;

// The API key is intentionally NOT required at startup. MCP clients and
// directory crawlers (Glama, the MCP Registry) must be able to introspect
// the tool list before a key is configured — exiting here would make the
// server undiscoverable and break the install-then-configure UX. tools/list
// never touches the client. When no PROPLINE_API_KEY is set we fall back to
// the shared DEMO_KEY so the first tool call still succeeds (free-tier data).
let _client: PropLineClient | null = null;
function client(): PropLineClient {
  if (!_client) {
    // Demo-key fallback is announced once at startup (see below); no need to
    // repeat it here. apiKey ?? DEMO_KEY keeps the first call working with
    // zero config.
    _client = new PropLineClient({ apiKey: apiKey ?? DEMO_KEY, baseUrl });
  }
  return _client;
}

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
    handler: () => client().listSports(),
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
      client().listEvents(args.sport_key as string, {
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
      client().listEventMarkets(
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
      "— coverage varies by sport). Underdog Fantasy outcomes carry a " +
      "payout_multiplier (DFS boost/discount factor; null = standard pick, " +
      "e.g. 1.5 = boost, 0.75 = discount) — skip non-null values when " +
      "comparing DFS lines to sportsbook consensus.",
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
        period: {
          type: "string",
          description:
            "Game-period filter. Omitted = full-game markets only. Canonical codes: q1..q4 (quarters), h1/h2 (halves), p1..p3 (hockey periods), i1..i9 (innings), f3/f5/f7 (first N innings). Comma-separated for multiple. 'all' = include every period alongside full-game.",
        },
        include_links: {
          type: "boolean",
          description:
            "When true, each bookmaker block carries a link — that book's public event-page URL for click-out (Bovada/DraftKings/FanDuel/BetMGM/Kalshi/Polymarket/Smarkets; others null). Plain navigation, no affiliate tagging.",
        },
      },
      required: ["sport_key"],
      additionalProperties: false,
    },
    handler: (args) =>
      client().getOdds(args.sport_key as string, {
        eventId: args.event_id as string | number | undefined,
        markets: args.markets as string | undefined,
        bookmakers: args.bookmakers as string | undefined,
        period: args.period as string | undefined,
        includeLinks: args.include_links as boolean | undefined,
      }),
  },
  {
    name: "propline_get_odds_history",
    description:
      "Hobby+ endpoint. Returns the historical line-movement snapshot " +
      "series for an event (every recorded price/point change per " +
      "outcome over the event's lifetime). Free tier returns market " +
      "structure with redacted snapshots and an upgrade pointer. " +
      "Supports period-historical filters: from/to (absolute ISO), " +
      "relative_from/relative_to (offsets to commence_time like '-3h' " +
      "or '0'), interval downsample ('30s'/'1m'/'5m'/'15m'/'30m'/'1h'), " +
      "and changes_only=true to drop unchanged adjacent snapshots.",
    inputSchema: {
      type: "object",
      properties: {
        sport_key: { type: "string" },
        event_id: { type: ["string", "number"] },
        markets: { type: "string" },
        bookmakers: {
          type: "string",
          description:
            "Comma-separated subset of book keys (e.g. 'draftkings,fanduel'). Default returns all available.",
        },
        from: {
          type: "string",
          description:
            "ISO timestamp; only include snapshots at or after. Mutually exclusive with relative_from.",
        },
        to: {
          type: "string",
          description:
            "ISO timestamp; only include snapshots at or before. Mutually exclusive with relative_to.",
        },
        relative_from: {
          type: "string",
          description:
            "Offset to commence_time, e.g. '-3h', '-30m', '-90s'. Mutually exclusive with from.",
        },
        relative_to: {
          type: "string",
          description:
            "Offset to commence_time, e.g. '-1m' or '0'. Mutually exclusive with to.",
        },
        interval: {
          type: "string",
          enum: ["30s", "1m", "5m", "15m", "30m", "1h"],
          description: "Downsample bucket. Latest snapshot per bucket wins.",
        },
        changes_only: {
          type: "boolean",
          description:
            "When true, drop snapshots whose (price, point) match the previous one.",
        },
        period: {
          type: "string",
          description:
            "Game-period filter. Omitted = full-game markets only. Canonical codes (q1..q4, h1/h2, p1..p3, i1..i9, f3/f5/f7), comma-separated, or 'all'.",
        },
      },
      required: ["sport_key", "event_id"],
      additionalProperties: false,
    },
    handler: (args) =>
      client().getOddsHistory(
        args.sport_key as string,
        args.event_id as string | number,
        {
          markets: args.markets as string | undefined,
          bookmakers: args.bookmakers as string | undefined,
          from: args.from as string | undefined,
          to: args.to as string | undefined,
          relativeFrom: args.relative_from as string | undefined,
          relativeTo: args.relative_to as string | undefined,
          interval: args.interval as string | undefined,
          changesOnly: args.changes_only as boolean | undefined,
          period: args.period as string | undefined,
        },
      ),
  },
  {
    name: "propline_get_odds_closing",
    description:
      "Hobby+ endpoint. Returns the closing line per (book, market, " +
      "outcome) for an event — the last snapshot at or before " +
      "commence_time. Canonical CLV-tracking helper; one call returns " +
      "the data point your bet should be measured against, instead of " +
      "fetching full history and post-processing. Each outcome carries " +
      "a closing_at field with the snapshot's recorded_at. Free tier " +
      "returns redacted structure with upgrade pointer.",
    inputSchema: {
      type: "object",
      properties: {
        sport_key: { type: "string" },
        event_id: { type: ["string", "number"] },
        markets: { type: "string" },
        bookmakers: {
          type: "string",
          description:
            "Comma-separated subset of book keys (e.g. 'draftkings,fanduel'). Default returns all available.",
        },
        period: {
          type: "string",
          description:
            "Game-period filter. Omitted = full-game markets only. Canonical codes (q1..q4, h1/h2, p1..p3, i1..i9, f3/f5/f7), comma-separated, or 'all'.",
        },
      },
      required: ["sport_key", "event_id"],
      additionalProperties: false,
    },
    handler: (args) =>
      client().getOddsClosing(
        args.sport_key as string,
        args.event_id as string | number,
        {
          markets: args.markets as string | undefined,
          bookmakers: args.bookmakers as string | undefined,
          period: args.period as string | undefined,
        },
      ),
  },
  {
    name: "propline_export_odds_history",
    description:
      "Backfill-pass / Enterprise only. Bulk line-movement tick history " +
      "as CSV — every recorded odds snapshot (price + line, per book, " +
      "including period markets) across a whole sport, one row per " +
      "(outcome, snapshot). This is the raw firehose no subscription tier " +
      "can bulk-pull (Pro/Streaming use propline_get_odds_history per " +
      "event instead). REQUIRES a since/until window to keep the pull " +
      "bounded — the full archive runs to gigabytes per sport. The result " +
      "is capped to the first 200 rows for context safety; for the full " +
      "dataset use the /v1/exports/odds-history endpoint directly with " +
      "curl/SDK and stream to disk. Non-entitled keys get a 403 with an " +
      "upgrade pointer.",
    inputSchema: {
      type: "object",
      properties: {
        sport_key: {
          type: "string",
          description: "Sport key, e.g. baseball_mlb",
        },
        since: {
          type: "string",
          description:
            "ISO datetime lower bound on recorded_at (required, e.g. 2026-04-01T00:00:00Z). Keep the window narrow.",
        },
        until: {
          type: "string",
          description:
            "ISO datetime upper bound on recorded_at (required, e.g. 2026-05-01T00:00:00Z).",
        },
        market: { type: "string", description: "Optional market key filter" },
        bookmaker: { type: "string", description: "Optional bookmaker filter" },
      },
      required: ["sport_key", "since", "until"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const csv = await client().exportOddsHistory(args.sport_key as string, {
        since: args.since as string,
        until: args.until as string,
        market: args.market as string | undefined,
        bookmaker: args.bookmaker as string | undefined,
      });
      const lines = csv.split("\n");
      const CAP = 200; // header + 200 data rows
      if (lines.length <= CAP + 1) return csv;
      return (
        lines.slice(0, CAP + 1).join("\n") +
        `\n# … truncated: ${lines.length - 1} total rows. ` +
        `Narrow since/until or pull the full file via the ` +
        `/v1/exports/odds-history endpoint (curl/SDK) and stream to disk.`
      );
    },
  },
  {
    name: "propline_get_futures",
    description:
      "Free-tier endpoint. Returns season-long futures (outright) markets " +
      "for a sport — championship/Super Bowl/division/conference winners, " +
      "MVP and award winners, season win totals — aggregated across " +
      "Bovada, FanDuel, DraftKings, and Pinnacle. One row per (futures " +
      "event, book, market) with each team/player outcome and its price. " +
      "Marquee markets (Super Bowl winner, MVP, division/conference) are " +
      "quoted by multiple books for comparison; exotic markets are often " +
      "single-book. Useful for: 'who are the Super Bowl favorites across " +
      "books', 'NFL MVP odds', 'NBA championship futures'. Futures are " +
      "unresolved (no settlement grade).",
    inputSchema: {
      type: "object",
      properties: {
        sport_key: {
          type: "string",
          description:
            "Sport key — e.g. football_nfl, basketball_nba, baseball_mlb.",
        },
      },
      required: ["sport_key"],
      additionalProperties: false,
    },
    handler: (args) => client().getFutures(args.sport_key as string),
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
      client().getScores(args.sport_key as string, {
        daysFrom: args.days_from as number | undefined,
      }),
  },
  {
    name: "propline_get_dfs_payouts",
    description:
      "Free-tier reference math. Returns the PrizePicks Power Play (all legs " +
      "must hit) and Flex Play (partial payouts) entry payout schedule for " +
      "2-6 legs, plus the per-leg breakeven win probability for each play. " +
      "Pass leg_win_prob (e.g. 0.58) to also get expected_return (per $1) and " +
      "is_plus_ev per play — the slip-level breakeven. Useful for: 'what hit " +
      "rate do I need to beat a 4-pick PrizePicks Power play', 'is a 3-leg " +
      "flex +EV at 60% per leg'. NOTE: standard published payouts only — " +
      "demon/goblin per-pick modifiers aren't in PrizePicks's feed (see the " +
      "disclaimer field); breakeven assumes independent legs.",
    inputSchema: {
      type: "object",
      properties: {
        leg_win_prob: {
          type: "number",
          description:
            "Optional assumed per-leg win probability in [0,1]. Adds " +
            "expected_return + is_plus_ev to each play.",
        },
      },
      required: [],
      additionalProperties: false,
    },
    handler: (args) =>
      client().getDfsPayouts({
        legWinProb: args.leg_win_prob as number | undefined,
      }),
  },
  {
    name: "propline_get_mlb_grand_salami",
    description:
      "Free-tier endpoint. Returns the synthetic daily MLB Grand Salami " +
      "for a given UTC date — total runs scored across every MLB game " +
      "on the slate plus each book's implied Grand Salami line (median " +
      "of per-game primary totals across our MLB books incl. Pinnacle, " +
      "Polymarket, Matchbook, Smarkets). No retail sportsbook quotes " +
      "this as a single market. Useful for: 'what's the total run line " +
      "for tonight's full MLB slate', 'did the Grand Salami go over " +
      "yesterday', 'historical Grand Salami results for backtesting'.",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description:
            "YYYY-MM-DD UTC date. Defaults to today (UTC) when omitted.",
        },
      },
      required: [],
      additionalProperties: false,
    },
    handler: (args) =>
      client().getMlbGrandSalami({
        date: args.date as string | undefined,
      }),
  },
  {
    name: "propline_get_nhl_daily_goals_total",
    description:
      "Free-tier endpoint. Returns the synthetic daily NHL goals total " +
      "(hockey's equivalent of the MLB Grand Salami) for a given UTC " +
      "date — total goals scored across every NHL game on the slate " +
      "(including OT/SO) plus each book's implied Daily Goals Total " +
      "line (median of per-game primary totals across our NHL books). " +
      "No retail sportsbook quotes this as a single market. Useful " +
      "for: 'what's the total goal line for tonight's full NHL slate', " +
      "'did the Daily Goals Total go over yesterday', 'historical " +
      "NHL daily-goals results for backtesting'.",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description:
            "YYYY-MM-DD UTC date. Defaults to today (UTC) when omitted.",
        },
      },
      required: [],
      additionalProperties: false,
    },
    handler: (args) =>
      client().getNhlDailyGoalsTotal({
        date: args.date as string | undefined,
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
      client().getResolutionSummary({ days: args.days as number | undefined }),
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
      client().getEventStats(
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
      client().getEventResults(
        args.sport_key as string,
        args.event_id as string | number,
      ),
  },
  {
    name: "propline_get_event_context",
    description:
      "Game context for an event — the conditions a prop settles under. " +
      "MLB: probable starting pitchers and their throwing hand (L/R/S — " +
      "platoon-split context for every batter prop), a confirmed-lineup " +
      "flag, the home-plate umpire, and first-pitch weather (temperature, " +
      "wind, precipitation) at outdoor / open-roof venues (indoor venues " +
      "return weather=null). NFL & NCAAF: the venue and kickoff weather. " +
      "The same block is embedded in get_event_results, so every graded " +
      "prop carries its conditions — unique to PropLine. Free tier. 404 " +
      "when no context is on file for the event yet.",
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
      client().getEventContext(
        args.sport_key as string,
        args.event_id as string | number,
      ),
  },
  {
    name: "propline_get_event_movement",
    description:
      "Line movement + steam detection from the snapshot tick history. " +
      "Per (book, market, outcome): opening line, latest line, signed " +
      "implied-probability shift, point shift, direction. The steam[] " +
      "array flags outcomes that multiple books moved the same direction — " +
      "the classic sharp-money signal, computed across all 16 books " +
      "PropLine polls. When a book moves the line itself, that outcome's " +
      "prob_shift is null and direction is 'line_moved' (excluded from the " +
      "steam signal). No pull-only odds API can produce this. Hobby+ full; " +
      "free tier redacted.",
    inputSchema: {
      type: "object",
      properties: {
        sport_key: { type: "string" },
        event_id: { type: ["string", "number"] },
        markets: {
          type: "string",
          description:
            "Comma-separated market keys. Defaults to h2h,spreads,totals.",
        },
        bookmakers: {
          type: "string",
          description:
            "Comma-separated subset of book keys (e.g. 'draftkings,fanduel'). Default returns all available.",
        },
        period: {
          type: "string",
          description:
            "Game-period filter (q1..q4, h1/h2, p1..p3, i1..i9, f3/f5/f7; comma-separated, or 'all'). Omit for full-game.",
        },
      },
      required: ["sport_key", "event_id"],
      additionalProperties: false,
    },
    handler: (args) =>
      client().getEventMovement(
        args.sport_key as string,
        args.event_id as string | number,
        {
          markets: args.markets as string | undefined,
          bookmakers: args.bookmakers as string | undefined,
          period: args.period as string | undefined,
        },
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
      client().getPlayerHistory(
        args.sport_key as string,
        args.player_name as string,
        {
          limit: args.limit as number | undefined,
          markets: args.markets as string | undefined,
        },
      ),
  },
  {
    name: "propline_get_player_trends",
    description:
      "Hit-rate trends / last-N-games over rate for a player — unique to " +
      "PropLine's prop-resolution data. For each market the player has " +
      "graded history in, returns over/under/push splits across the last " +
      "5/10/20/50 graded games, current streak, average actual stat, and " +
      "the recent line. This is the 'did X go over in N of his last M " +
      "games?' surface. Omit `market` for all markets, or pass one to " +
      "scope (e.g. 'player_points', 'batter_hits').",
    inputSchema: {
      type: "object",
      properties: {
        sport_key: { type: "string" },
        player_name: {
          type: "string",
          description:
            "Player name as it appears in box scores — e.g. 'Aaron Judge', 'Nikola Jokic'",
        },
        market: {
          type: "string",
          description:
            "Optional single market to scope trends to (e.g. 'player_points'). Omit for all markets.",
        },
        dfs_odds_type: {
          type: "string",
          enum: ["standard", "goblin", "demon"],
          description:
            "Optional PrizePicks pick-em flavor. When set, the trend is computed against that flavor's PrizePicks line only (e.g. compare a player's goblin-line hit-rate vs his standard-line trend). Omit for the default cross-book behavior.",
        },
      },
      required: ["sport_key", "player_name"],
      additionalProperties: false,
    },
    handler: (args) =>
      client().getPlayerTrends(
        args.sport_key as string,
        args.player_name as string,
        {
          market: args.market as string | undefined,
          dfsOddsType: args.dfs_odds_type as string | undefined,
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
      client().getEventEv(
        args.sport_key as string,
        args.event_id as string | number,
        {
          markets: args.markets as string | undefined,
          minEvPct: args.min_ev_pct as number | undefined,
        },
      ),
  },
  {
    name: "propline_get_best_line",
    description:
      "Cross-book line shopping (Hobby+ for prices; free tier gets the " +
      "full structure with book identities + best-first ranking but " +
      "prices nulled and redacted:true). For every (market, " +
      "player, line) tuple on an event, returns the single best American " +
      "price across all comparable books, plus an all_prices array " +
      "sorted best-first (one row per book, each with last_update). " +
      "Companion to propline_get_event_ev: /ev says whether a price " +
      "beats the no-vig fair line; best-line says which book pays the " +
      "most. DFS pick'em books (PrizePicks, Sleeper, Dabble) are " +
      "excluded; Underdog only at clean two-way lines. Optional " +
      "bookmakers filter to shop only the books the user holds " +
      "accounts at.",
    inputSchema: {
      type: "object",
      properties: {
        sport_key: { type: "string" },
        event_id: { type: ["string", "number"] },
        markets: {
          type: "string",
          description: "Comma-separated market keys (e.g. 'pitcher_strikeouts,h2h').",
        },
        bookmakers: {
          type: "string",
          description:
            "Comma-separated book keys (e.g. 'draftkings,fanduel') to shop only those books.",
        },
        include_links: {
          type: "boolean",
          description:
            "When true, every price row carries a link — that book's public event-page URL, the click-out for 'go bet this'. Books without a verified URL template return null.",
        },
      },
      required: ["sport_key", "event_id"],
      additionalProperties: false,
    },
    handler: (args) =>
      client().getEventBestLine(
        args.sport_key as string,
        args.event_id as string | number,
        {
          markets: args.markets as string | undefined,
          bookmakers: args.bookmakers as string | undefined,
          includeLinks: args.include_links as boolean | undefined,
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
if (usingDemoKey) {
  console.error(
    "[propline-mcp] note: no PROPLINE_API_KEY set — running on the shared " +
      "free demo key. Tool calls work; paid features are redacted and limits " +
      "are pooled. Get your own free key: https://prop-line.com",
  );
}
