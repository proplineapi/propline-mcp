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

  /**
   * POST with a JSON body. Kept separate from `request` because every other
   * endpoint on this server is a GET with query params; folding a body into
   * that signature would make the common case harder to read.
   */
  private async postRequest<T = unknown>(
    path: string,
    body: unknown,
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "X-API-Key": this.apiKey,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "propline-mcp/0.1.0",
        },
        body: JSON.stringify(body),
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
      period?: string;
      includeLinks?: boolean;
      includeBookIds?: boolean;
    } = {},
  ): Promise<unknown> {
    const params = {
      markets: opts.markets,
      bookmakers: opts.bookmakers,
      period: opts.period,
      includeLinks: opts.includeLinks ? "true" : undefined,
      includeBookIds: opts.includeBookIds ? "true" : undefined,
    };
    if (opts.eventId) {
      return this.request(
        `/v1/sports/${sportKey}/events/${opts.eventId}/odds`,
        params,
      );
    }
    return this.request(`/v1/sports/${sportKey}/odds`, params);
  }

  getOddsHistory(
    sportKey: string,
    eventId: string | number,
    opts: {
      markets?: string;
      bookmakers?: string;
      from?: string;
      to?: string;
      relativeFrom?: string;
      relativeTo?: string;
      interval?: string;
      changesOnly?: boolean;
      period?: string;
    } = {},
  ): Promise<unknown> {
    return this.request(
      `/v1/sports/${sportKey}/events/${eventId}/odds/history`,
      {
        markets: opts.markets,
        bookmakers: opts.bookmakers,
        from: opts.from,
        to: opts.to,
        relative_from: opts.relativeFrom,
        relative_to: opts.relativeTo,
        interval: opts.interval,
        changes_only: opts.changesOnly ? "true" : undefined,
        period: opts.period,
      },
    );
  }

  getOddsClosing(
    sportKey: string,
    eventId: string | number,
    opts: { markets?: string; bookmakers?: string; period?: string } = {},
  ): Promise<unknown> {
    return this.request(
      `/v1/sports/${sportKey}/events/${eventId}/odds/closing`,
      { markets: opts.markets, bookmakers: opts.bookmakers, period: opts.period },
    );
  }

  /**
   * Grade placed bets against their closing lines (CLV). Hobby+.
   * See the propline_grade_clv tool description for the semantics that
   * matter when presenting the result.
   */
  gradeClv(bets: unknown[]): Promise<unknown> {
    return this.postRequest("/v1/clv/grade", bets);
  }

  // ----- Bulk exports -----

  /**
   * Full line-movement tick history as CSV text (Backfill pass / Enterprise
   * only — other tiers get a 403). Returns the raw CSV string; the MCP tool
   * layer caps the row count so a large pull never floods the context.
   * A time window (since/until) is required at the tool layer to bound the
   * download.
   */
  exportOddsHistory(
    sportKey: string,
    opts: {
      market?: string;
      bookmaker?: string;
      since?: string;
      until?: string;
    } = {},
  ): Promise<string> {
    return this.request<string>(`/v1/exports/odds-history`, {
      sport: sportKey,
      market: opts.market,
      bookmaker: opts.bookmaker,
      since: opts.since,
      until: opts.until,
    });
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

  getDfsPayouts(
    opts: { platform?: string; legWinProb?: number } = {},
  ): Promise<unknown> {
    return this.request(`/v1/dfs/payouts`, {
      platform: opts.platform ?? "prizepicks",
      leg_win_prob: opts.legWinProb,
    });
  }

  getNhlDailyGoalsTotal(opts: { date?: string } = {}): Promise<unknown> {
    return this.request(`/v1/sports/hockey_nhl/daily-goals-total`, {
      date: opts.date,
    });
  }

  getResolutionSummary(opts: { days?: number } = {}): Promise<unknown> {
    return this.request(`/v1/markets/resolution-summary`, {
      days: opts.days,
    });
  }

  getFutures(sportKey: string): Promise<unknown> {
    return this.request(`/v1/sports/${sportKey}/futures`);
  }

  getEventStats(sportKey: string, eventId: string | number): Promise<unknown> {
    return this.request(`/v1/sports/${sportKey}/events/${eventId}/stats`);
  }

  getEventResults(sportKey: string, eventId: string | number): Promise<unknown> {
    return this.request(`/v1/sports/${sportKey}/events/${eventId}/results`);
  }

  getEventContext(sportKey: string, eventId: string | number): Promise<unknown> {
    return this.request(`/v1/sports/${sportKey}/events/${eventId}/context`);
  }

  getEventMovement(
    sportKey: string,
    eventId: string | number,
    opts: { markets?: string; bookmakers?: string; period?: string } = {},
  ): Promise<unknown> {
    return this.request(
      `/v1/sports/${sportKey}/events/${eventId}/movement`,
      { markets: opts.markets, bookmakers: opts.bookmakers, period: opts.period },
    );
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

  // ----- Player game log / H2H -----

  getPlayerGames(
    sportKey: string,
    playerName: string,
    opts: { limit?: number; opponent?: string; statType?: string } = {},
  ): Promise<unknown> {
    return this.request(
      `/v1/sports/${sportKey}/players/${encodeURIComponent(playerName)}/games`,
      { limit: opts.limit, opponent: opts.opponent, stat_type: opts.statType },
    );
  }

  // ----- Player trends -----

  getPlayerTrends(
    sportKey: string,
    playerName: string,
    opts: { market?: string; dfsOddsType?: string } = {},
  ): Promise<unknown> {
    return this.request(
      `/v1/sports/${sportKey}/players/${encodeURIComponent(playerName)}/trends`,
      { market: opts.market, dfs_odds_type: opts.dfsOddsType },
    );
  }

  // ----- Cross-book +EV -----

  getEventEv(
    sportKey: string,
    eventId: string | number,
    opts: { markets?: string; bookmakers?: string } = {},
  ): Promise<unknown> {
    // NB: no min_ev_pct here. This client used to send one, but /ev has
    // never accepted that parameter — FastAPI drops unknown query params,
    // so the request succeeded and the threshold was silently ignored.
    // The tool handler filters on ev_pct itself instead.
    return this.request(`/v1/sports/${sportKey}/events/${eventId}/ev`, {
      markets: opts.markets,
      bookmakers: opts.bookmakers,
    });
  }

  getEventProjections(
    sportKey: string,
    eventId: string | number,
    opts: { markets?: string } = {},
  ): Promise<unknown> {
    return this.request(
      `/v1/sports/${sportKey}/events/${eventId}/projections`,
      { markets: opts.markets },
    );
  }

  getEventBestLine(
    sportKey: string,
    eventId: string | number,
    opts: { markets?: string; bookmakers?: string; includeLinks?: boolean } = {},
  ): Promise<unknown> {
    return this.request(`/v1/sports/${sportKey}/events/${eventId}/best-line`, {
      markets: opts.markets,
      bookmakers: opts.bookmakers,
      includeLinks: opts.includeLinks ? "true" : undefined,
    });
  }

  // ----- Webhooks (READ-ONLY on purpose) -----
  // Create is excluded because it returns the HMAC signing secret exactly
  // once — through MCP that lands in a model context window and whatever
  // logs it. Update/delete/test are excluded as side-effectful. The read
  // surface (list shows the secret MASKED; deliveries is the debugging
  // log) is what an agent needs to answer "why isn't my webhook firing".

  listWebhooks(): Promise<unknown> {
    return this.request("/v1/webhooks");
  }

  listWebhookDeliveries(
    webhookId: string | number,
    opts: { limit?: number; beforeId?: number } = {},
  ): Promise<unknown> {
    return this.request(`/v1/webhooks/${webhookId}/deliveries`, {
      limit: opts.limit,
      before_id: opts.beforeId,
    });
  }
}
