# propline-mcp

[![npm version](https://img.shields.io/npm/v/propline-mcp.svg)](https://www.npmjs.com/package/propline-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

Listed in the official [MCP Registry](https://registry.modelcontextprotocol.io) as `io.github.proplineapi/propline-mcp` — discoverable from Claude Code, Claude Desktop, and any MCP-aware client.

**Model Context Protocol server** for the [PropLine](https://prop-line.com/?ref=mcp) player props betting odds API. Plug it into Claude Desktop, Claude Code, or any MCP-compatible client and ask natural-language questions about live odds, prop resolution, cross-book +EV, scores, and box-score stats — the model picks the right tool, calls the API, and answers from real data.

> No more "I'd need an API for that" deflections from your AI assistant. PropLine MCP turns sports-betting research into a chat.

## What you can ask

Once installed, you can prompt the model with things like:

- *"What's the +EV on Yankees vs Red Sox tonight across all books?"*
- *"Pull Aaron Judge's last 20 prop-bet history with hit/miss outcomes."*
- *"List today's MLB pitcher strikeout props from DraftKings and Pinnacle side by side."*
- *"Did Nikola Jokic's points prop hit last night? What was the line?"*
- *"Compare PrizePicks DFS projections to Bovada lines for tonight's NBA slate."*
- *"What's the first-quarter total on Lakers vs Celtics, and which book has the best Over?"*

The model uses these tools transparently:

| Tool | What it does |
|------|--------------|
| `propline_list_sports` | Discover what sports PropLine polls (54 today) |
| `propline_list_events` | Upcoming events for a sport, with ids |
| `propline_list_event_markets` | Available market types for an event |
| `propline_get_odds` | Live odds — bulk by sport or full props per event. Accepts `period` (q1/h1/p1/f5/…) to scope to game-period markets. |
| `propline_get_odds_history` | Hobby+: snapshot history per outcome; supports `period` (q1/h1/…) plus time-window filters (from/to, relative_from/relative_to, interval, changes_only) |
| `propline_get_odds_closing` | Hobby+: opening **and** closing line per (book, market, outcome) — CLV helper. Accepts `period` to scope to a specific game period. |
| `propline_grade_clv` | Hobby+: grade **placed** bets against their closing lines. Returns closing price, de-vigged closing fair (`fair_source` = sharpest book at close, not yours), `clv_pct` (price-vs-price, vig-blind) **and** `ev_vs_close_pct` (the honest number), plus the graded result once the game settles. Fail-closed matching; unstarted events come back `closing_is_final: false` and are excluded from the averages. |
| `propline_export_odds_history` | Backfill-pass / Enterprise: bulk line-movement tick history (every snapshot, per book) for a sport. Requires a `since`/`until` window; result capped to 200 rows (use the REST endpoint directly for the full file). |
| `propline_get_futures` | Season-long futures — championship/division/conference winners, MVP + awards, season win totals — across Bovada/FanDuel/DraftKings/Pinnacle/Kalshi (free) |
| `propline_get_scores` | Game scores + status (free) |
| `propline_get_dfs_payouts` | PrizePicks Power/Flex payout schedule + per-leg breakeven win probability (free) |
| `propline_get_mlb_grand_salami` | Synthetic daily MLB Grand Salami — total runs + each book's implied line (free) |
| `propline_get_nhl_daily_goals_total` | Synthetic daily NHL goals total — hockey's Grand Salami (free) |
| `propline_get_resolution_summary` | Graded-prop volume + per-sport/market breakdown (free) |
| `propline_get_event_stats` | Raw box-score stats (free, book-agnostic) |
| `propline_get_event_context` | Game conditions a prop settles under — probable pitchers, lineup flag, home-plate umpire, first-pitch weather (free) |
| `propline_get_event_movement` | Line movement + steam detection (sharp-money signal across all books) from the tick history (Hobby+) |
| `propline_get_event_results` | Pro: graded won/lost/push per prop |
| `propline_get_player_history` | Player prop history with resolution |
| `propline_get_player_games` | Player game log — recent games with every raw box-score stat per game, one call instead of one per event; `opponent` gives head-to-head (last N *meetings*). Raw-stat archive, so it includes games no book priced |
| `propline_get_player_trends` | Hit-rate trends — over/under/push splits over last 5/10/20/50 graded games, streak, avg actual (optional `dfs_odds_type` to scope to a PrizePicks flavor) |
| `propline_get_event_ev` | Pro: cross-book +EV with no-vig fair lines |
| `propline_get_event_projections` | Hobby+: market-implied consensus projection per (market, player) |
| `propline_get_best_line` | Hobby+: cross-book line shopping — best price per (market, player, line) across all comparable books, `all_prices` sorted best-first; optional `bookmakers` filter |
| `propline_list_webhooks` | Streaming Lite+: list webhook subscriptions (read-only, secrets masked) |
| `propline_get_webhook_deliveries` | Streaming Lite+: recent delivery attempts for a webhook — status, HTTP code, attempts, payload; `before_id` pages backwards. The "why isn't my webhook firing" tool |

## Hosted endpoint (no install)

The same 27 tools are served over **Streamable HTTP** at

```
https://mcp.prop-line.com/mcp
```

Use it from any remote-capable client — nothing to install, nothing to run.

| Client | How |
|---|---|
| Claude Code | `claude mcp add --transport http propline https://mcp.prop-line.com/mcp` |
| Claude.ai / Claude Desktop | Settings → Connectors → Add custom connector → URL above |
| Cursor | Settings → MCP → Add server → type `http`, URL above ([one-click](https://cursor.com/en/install-mcp?name=propline&config=eyJ1cmwiOiJodHRwczovL21jcC5wcm9wLWxpbmUuY29tL21jcCJ9)) |
| ChatGPT (developer mode) | Settings → Connectors → Create → MCP server URL above |
| Any client | Streamable HTTP, endpoint `/mcp`; `GET /` returns a JSON manifest |

**Auth is per request.** Send your PropLine key as `Authorization: Bearer <key>` (or `X-API-Key: <key>`, or `?apiKey=<key>` for clients that cannot set headers). With no key the endpoint falls back to the shared free demo key — every tool works, paid features are redacted, limits are pooled. Keys are used for the one request and never stored.

Claude Code with your own key:

```bash
claude mcp add --transport http propline https://mcp.prop-line.com/mcp \
  --header "Authorization: Bearer YOUR_KEY"
```

The stdio build below (`npx -y propline-mcp`) is the same code; pick whichever your client prefers.

## Zero-config quick start

No key needed to try it. The server falls back to a shared public demo key, so this just works:

```bash
npx -y propline-mcp
```

Your agent can immediately pull live odds, scores, and stats. The demo key is free-tier and shared — paid features (resolution, +EV, history, exports) return a redacted teaser, and limits are pooled across everyone. For full access and your own limits, set `PROPLINE_API_KEY` (below). Get a free personal key at [prop-line.com](https://prop-line.com/?ref=mcp).

While the demo key is in use, every tool result carries a second content block noting the pooling and redaction, so the assistant can explain an empty field or a 429 accurately. It disappears the moment you set your own key.

## Install (with your own key)

### 1. Get a PropLine API key

[prop-line.com](https://prop-line.com/?ref=mcp) — free tier is 1,000 requests/day, no credit card. Hobby at $9/mo unlocks resolution, history, closing lines and +EV — Pro at $19/mo is that same feature set at 25,000 requests/day.

### 2. Add to your MCP client

#### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "propline": {
      "command": "npx",
      "args": ["-y", "propline-mcp"],
      "env": {
        "PROPLINE_API_KEY": "YOUR_KEY_HERE"
      }
    }
  }
}
```

Restart Claude Desktop. The hammer icon should show 27 PropLine tools. (Or skip the install and add `https://mcp.prop-line.com/mcp` as a custom connector — see the hosted endpoint above.)

#### Claude Code

```bash
claude mcp add propline \
  --env PROPLINE_API_KEY=YOUR_KEY \
  -- npx -y propline-mcp
```

#### Any other MCP client

Run `propline-mcp` as a stdio server. Most clients accept a command + env. See the [MCP spec](https://modelcontextprotocol.io/) for client-specific config.

## Configuration

| Env var | Required | Default | Notes |
|--------|:--------:|---------|-------|
| `PROPLINE_API_KEY` | no | shared demo key | Unset = shared free demo key (paid features redacted, pooled limits). Set your own free key from [prop-line.com](https://prop-line.com/?ref=mcp) for full access. |
| `PROPLINE_BASE_URL` | no | `https://api.prop-line.com` | Override for self-hosted setups |

## Comparison with the-odds-api

PropLine is API-compatible at the response level (same `bookmakers[].markets[].outcomes[]` shape) and adds three things the-odds-api doesn't offer at any tier:

1. **Prop resolution** — every Over/Under graded against the actual box-score stat after the game
2. **Cross-book +EV** — Pinnacle-anchored no-vig fair lines per book, sorted with +EV plays at the top
3. **Webhooks** — push delivery on Streaming tier, not pull-only

Pricing: free at 1,000 req/day (vs their 500/month), Hobby at $9/mo for 5,000 req/day, Pro at $19/mo for 25,000, Streaming at $79/mo for 1,000,000. No credit math.

## Links

- **Hosted MCP endpoint**: `https://mcp.prop-line.com/mcp` (Streamable HTTP)
- **Privacy policy**: [prop-line.com/privacy](https://prop-line.com/privacy)
- **Website**: [prop-line.com](https://prop-line.com/?ref=mcp)
- **API Docs**: [prop-line.com/docs](https://prop-line.com/docs?ref=mcp)
- **Recipes** (code for common jobs): [prop-line.com/recipes](https://prop-line.com/recipes?ref=mcp)
- **Odds API by sport and market** (live line, books, graded hit rate): [prop-line.com/odds-api](https://prop-line.com/odds-api?ref=mcp)
- **Prop resolution** (every prop graded against the box score): [prop-line.com/prop-resolution-api](https://prop-line.com/prop-resolution-api?ref=mcp)
- **Cross-book +EV**: [prop-line.com/ev](https://prop-line.com/ev?ref=mcp)
- **Pricing**: [prop-line.com/pricing](https://prop-line.com/pricing?ref=mcp)
- **Dashboard**: [prop-line.com/dashboard](https://prop-line.com/dashboard)
- **OpenAPI reference**: [api.prop-line.com/docs](https://api.prop-line.com/docs)
- **For AI agents** (llms.txt, MCP setup): [prop-line.com/for-ai-agents](https://prop-line.com/for-ai-agents?ref=mcp)
- **Python SDK**: [`pip install propline`](https://pypi.org/project/propline/)
- **Node SDK**: [`npm install propline`](https://www.npmjs.com/package/propline)

## License

MIT
