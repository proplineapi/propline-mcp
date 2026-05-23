/**
 * Thin REST client for the PropLine API. Mirrors the public surface of
 * the `propline` npm package but kept inline here so the MCP server has
 * zero non-MCP runtime dependencies (the official SDK is the right choice
 * for application code; MCP servers want the tightest possible install).
 */

const DEFAULT_BASE_URL = "https://api.prop-line.com";

export class PropLineHTTPError extends Error {
  constructor(public statusCode: number, public body: string) {
    super(`PropLine HTTP ${statusCode}: ${body.slice(0, 200)}`);
    this.name = "PropLineHTTPError";
  }
}

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class PropLineClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: ClientOptions) {
    if (!opts.apiKey) {
      throw new Error(
        "PROPLINE_API_KEY is required. Get one at https://prop-line.com",
      );
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }

  private async request<T = unknown>(
    path: string,
    query: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const r = await fetch(url, {
        headers: {
          "X-API-Key": this.apiKey,
          Accept: "application/json",
          "User-Agent": "propline-mcp/0.1.0",
        },
        signal: controller.signal,
      });
      const text = await r.text();
      if (!r.ok) {
        throw new PropLineHTTPError(r.status, text);
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // ----- Discovery -----

  listSports(): Promise<unknown> {
    return this.request("/v1/sports");
  }

  listEvents(sportKey: string, opts: { live?: boolean } = {}): Promise<unknown> {
    return this.request(`/v1/sports/${sportKey}/events`, {
      live: opts.live ? "true" : undefined,
    });
  }

  listEventMarkets(sportKey: string, eventId: string | number): Promise<unknown> {
    return this.request(`/v1/sports/${sportKey}/events/${eventId}/markets`);
  }

  // ----- Odds -----

  getOdds(
    sportKey: string,
    opts: {
      markets?: string;
      bookmakers?: string;
      eventId?: string | number;
    } = {},
  ): Promise<unknown> {
    if (opts.eventId) {
      return this.request(
        `/v1/sports/${sportKey}/events/${opts.eventId}/odds`,
        {
          markets: opts.markets,
          bookmakers: opts.bookmakers,
        },
      );
    }
    return this.request(`/v1/sports/${sportKey}/odds`, {
      markets: opts.markets,
      bookmakers: opts.bookmakers,
    });
  }

  getOddsHistory(
    sportKey: string,
    eventId: string | number,
    opts: { markets?: string } = {},
  ): Promise<unknown> {
    return this.request(
      `/v1/sports/${sportKey}/events/${eventId}/odds/history`,
      { markets: opts.markets },
    );
  }

  // ----- Scores + stats + resolution -----

  getScores(sportKey: string, opts: { daysFrom?: number } = {}): Promise<unknown> {
    return this.request(`/v1/sports/${sportKey}/scores`, {
      daysFrom: opts.daysFrom,
    });
  }

  getMlbGrandSalami(opts: { date?: string } = {}): Promise<unknown> {
    return this.request(`/v1/sports/baseball_mlb/grand-salami`, {
      date: opts.date,
    });
  }

  getResolutionSummary(opts: { days?: number } = {}): Promise<unknown> {
    return this.request(`/v1/markets/resolution-summary`, {
      days: opts.days,
    });
  }

  getEventStats(sportKey: string, eventId: string | number): Promise<unknown> {
    return this.request(`/v1/sports/${sportKey}/events/${eventId}/stats`);
  }

  getEventResults(sportKey: string, eventId: string | number): Promise<unknown> {
    return this.request(`/v1/sports/${sportKey}/events/${eventId}/results`);
  }

  // ----- Player history -----

  getPlayerHistory(
    sportKey: string,
    playerName: string,
    opts: { limit?: number; markets?: string } = {},
  ): Promise<unknown> {
    return this.request(
      `/v1/sports/${sportKey}/players/${encodeURIComponent(playerName)}/history`,
      { limit: opts.limit, markets: opts.markets },
    );
  }

  // ----- Cross-book +EV -----

  getEventEv(
    sportKey: string,
    eventId: string | number,
    opts: { markets?: string; minEvPct?: number } = {},
  ): Promise<unknown> {
    return this.request(`/v1/sports/${sportKey}/events/${eventId}/ev`, {
      markets: opts.markets,
      min_ev_pct: opts.minEvPct,
    });
  }
}
