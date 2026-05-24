# propline-mcp

[![npm version](https://img.shields.io/npm/v/propline-mcp.svg)](https://www.npmjs.com/package/propline-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

Listed in the official [MCP Registry](https://registry.modelcontextprotocol.io) as `io.github.proplineapi/propline-mcp` — discoverable from Claude Code, Claude Desktop, and any MCP-aware client.

**Model Context Protocol server** for the [PropLine](https://prop-line.com) player props betting odds API. Plug it into Claude Desktop, Claude Code, or any MCP-compatible client and ask natural-language questions about live odds, prop resolution, cross-book +EV, scores, and box-score stats — the model picks the right tool, calls the API, and answers from real data.

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
| `propline_list_sports` | Discover what sports PropLine polls (38 today) |
| `propline_list_events` | Upcoming events for a sport, with ids |
| `propline_list_event_markets` | Available market types for an event |
| `propline_get_odds` | Live odds — bulk by sport or full props per event. Accepts `period` (q1/h1/p1/f5/…) to scope to game-period markets. |
| `propline_get_odds_history` | Hobby+: snapshot history per outcome; supports `period` (q1/h1/…) plus time-window filters (from/to, relative_from/relative_to, interval, changes_only) |
| `propline_get_odds_closing` | Hobby+: closing line per (book, market, outcome) — CLV helper. Accepts `period` to scope to a specific game period. |
| `propline_get_scores` | Game scores + status (free) |
| `propline_get_resolution_summary` | Graded-prop volume + per-sport/market breakdown (free) |
| `propline_get_event_stats` | Raw box-score stats (free, book-agnostic) |
| `propline_get_event_results` | Pro: graded won/lost/push per prop |
| `propline_get_player_history` | Player prop history with resolution |
| `propline_get_event_ev` | Pro: cross-book +EV with no-vig fair lines |

## Install

### 1. Get a PropLine API key

[prop-line.com](https://prop-line.com) — free tier is 1,000 requests/day, no credit card. Pro at $19/mo unlocks resolution, history, and +EV.

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

Restart Claude Desktop. The hammer icon should show 10 PropLine tools.

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
| `PROPLINE_API_KEY` | yes | — | Get a free key at [prop-line.com](https://prop-line.com) |
| `PROPLINE_BASE_URL` | no | `https://api.prop-line.com` | Override for self-hosted setups |

## Comparison with the-odds-api

PropLine is API-compatible at the response level (same `bookmakers[].markets[].outcomes[]` shape) and adds three things the-odds-api doesn't offer at any tier:

1. **Prop resolution** — every Over/Under graded against the actual box-score stat after the game
2. **Cross-book +EV** — Pinnacle-anchored no-vig fair lines per book, sorted with +EV plays at the top
3. **Webhooks** — push delivery on Streaming tier, not pull-only

Pricing: free at 1,000 req/day (vs their 500/month), Pro at $19/mo for 25,000 req/day, Streaming at $79/mo for 1,000,000 req/day. No credit math.

## License

MIT
