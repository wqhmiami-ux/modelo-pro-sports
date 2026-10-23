const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
};

const sportMap = {
  americanfootball_nfl: { sport: "nfl" },
  basketball_nba: { sport: "nba" },
  baseball_mlb: { sport: "mlb" },
  icehockey_nhl: { sport: "nhl" },
  soccer: { sport: "soccer" },
  soccer_epl: { sport: "soccer", league: "epl" },
  mma_mixed_martial_arts: { sport: "mma" },
};

const allowedMarkets = new Set(["h2h", "spreads", "totals"]);

function jsonError(message, status = 500, extra = {}) {
  return Response.json(
    { error: message, ...extra },
    { status, headers: { ...corsHeaders, "Cache-Control": "no-store" } }
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "GET") {
      return jsonError("Method not allowed", 405);
    }

    if (path === "/") {
      return Response.json(
        {
          ok: true,
          service: "Modelo PRO Sports API",
          oddsProvider: "OddsLink",
          endpoints: ["/api/odds", "/api/football"],
          sports: Object.keys(sportMap),
        },
        { headers: corsHeaders }
      );
    }

    // Se conserva la ruta existente para resultados y partidos de fútbol.
    if (path === "/api/football") {
      if (!env.FOOTBALL_DATA_TOKEN) {
        return jsonError("Football data token not configured");
      }

      const competition = (url.searchParams.get("competition") || "PL").toUpperCase();
      const teamId = url.searchParams.get("teamId");
      const status = (url.searchParams.get("status") || "FINISHED").toUpperCase();
      const allowedStatuses = new Set([
        "FINISHED", "SCHEDULED", "LIVE", "IN_PLAY", "PAUSED",
        "POSTPONED", "SUSPENDED", "CANCELLED",
      ]);

      if (!/^[A-Z0-9]{2,4}$/.test(competition)) {
        return jsonError("Invalid competition code", 400);
      }
      if (!allowedStatuses.has(status)) {
        return jsonError("Invalid match status", 400);
      }
      if (teamId && !/^\d+$/.test(teamId)) {
        return jsonError("Invalid team ID", 400);
      }

      const homeTeamQuery = (url.searchParams.get("homeTeam") || "").trim();
      const awayTeamQuery = (url.searchParams.get("awayTeam") || "").trim();

      // The prediction model needs each team's own recent match sample.
      // Competition match lists may omit older matches, so resolve team IDs first
      // and then request the recent results for each team separately.
      if (homeTeamQuery || awayTeamQuery) {
        if (!homeTeamQuery || !awayTeamQuery || homeTeamQuery.toLowerCase() === awayTeamQuery.toLowerCase()) {
          return jsonError("Provide two different team names", 400);
        }
        if (status !== "FINISHED") {
          return jsonError("Team-based prediction samples require FINISHED matches", 400);
        }

        const normalizeTeamName = (value) => String(value || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/\b(fc|afc|cf|sc)\b/g, "")
          .replace(/[^a-z0-9]/g, "");
        const teamsUrl = `https://api.football-data.org/v4/competitions/${competition}/teams`;
        try {
          const teamsResponse = await fetch(teamsUrl, {
            headers: { Accept: "application/json", "X-Auth-Token": env.FOOTBALL_DATA_TOKEN },
          });
          const teamsBody = await teamsResponse.text();
          if (!teamsResponse.ok) {
            return new Response(teamsBody, {
              status: teamsResponse.status,
              headers: { ...corsHeaders, "Cache-Control": "no-store" },
            });
          }
          const teamsPayload = JSON.parse(teamsBody);
          const teams = Array.isArray(teamsPayload.teams) ? teamsPayload.teams : [];
          const resolveTeam = (query) => {
            const key = normalizeTeamName(query);
            const candidates = teams.filter((team) =>
              [team.name, team.shortName, team.tla].some((name) => normalizeTeamName(name) === key)
            );
            return candidates.length === 1 ? candidates[0] : null;
          };
          const homeTeam = resolveTeam(homeTeamQuery);
          const awayTeam = resolveTeam(awayTeamQuery);
          if (!homeTeam || !awayTeam || homeTeam.id === awayTeam.id) {
            return jsonError("Team name not matched exactly. Use the official team names returned by the selected competition.", 400, {
              availableTeams: teams.map((team) => team.name).filter(Boolean),
              unmatched: [!homeTeam ? homeTeamQuery : null, !awayTeam ? awayTeamQuery : null].filter(Boolean),
            });
          }

          const fetchTeamMatches = async (teamId) => {
            const teamUrl = new URL(`https://api.football-data.org/v4/teams/${teamId}/matches`);
            teamUrl.searchParams.set("competitions", competition);
            teamUrl.searchParams.set("status", "FINISHED");
            teamUrl.searchParams.set("limit", "20");
            const response = await fetch(teamUrl.toString(), {
              headers: { Accept: "application/json", "X-Auth-Token": env.FOOTBALL_DATA_TOKEN },
            });
            const body = await response.text();
            if (!response.ok) throw new Error(`Football data provider returned HTTP ${response.status}`);
            const payload = JSON.parse(body);
            return Array.isArray(payload.matches) ? payload.matches : [];
          };

          const [homeMatches, awayMatches] = await Promise.all([
            fetchTeamMatches(homeTeam.id),
            fetchTeamMatches(awayTeam.id),
          ]);
          const matchMap = new Map();
          for (const match of [...homeMatches, ...awayMatches]) {
            if (match && match.id !== undefined && match.id !== null) matchMap.set(String(match.id), match);
          }
          const matches = [...matchMap.values()].sort(
            (a, b) => new Date(b.utcDate || b.date || 0).getTime() - new Date(a.utcDate || a.date || 0).getTime()
          );
          return Response.json({
            matches,
            sampleTeams: { home: homeTeam.name, away: awayTeam.name },
            sampleCounts: { home: homeMatches.length, away: awayMatches.length },
          }, {
            headers: { ...corsHeaders, "Cache-Control": "public, max-age=120" },
          });
        } catch (error) {
          return jsonError(error.message || "Could not load team match history", 502);
        }
      }

      const requestedLimit = Number(url.searchParams.get("limit") || "10");
      const competitionLimit = Number.isFinite(requestedLimit)
        ? Math.max(1, Math.min(200, Math.floor(requestedLimit)))
        : 10;
      const endpoint = teamId
        ? `https://api.football-data.org/v4/teams/${teamId}/matches`
        : `https://api.football-data.org/v4/competitions/${competition}/matches`;
      const upstream = new URL(endpoint);
      upstream.searchParams.set("status", status);

      if (teamId) {
        // Keep the per-team request within the provider's supported range.
        upstream.searchParams.set("limit", String(Math.min(20, competitionLimit)));
      }

      const dateFrom = url.searchParams.get("dateFrom");
      const dateTo = url.searchParams.get("dateTo");
      if (dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
        upstream.searchParams.set("dateFrom", dateFrom);
      }
      if (dateTo && /^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
        upstream.searchParams.set("dateTo", dateTo);
      }

      try {
        const response = await fetch(upstream.toString(), {
          headers: {
            Accept: "application/json",
            "X-Auth-Token": env.FOOTBALL_DATA_TOKEN,
          },
        });
        const body = await response.text();
        if (!response.ok) {
          return new Response(body, {
            status: response.status,
            headers: { ...corsHeaders, "Cache-Control": "no-store" },
          });
        }

        let data;
        try {
          data = JSON.parse(body);
        } catch {
          return jsonError("Invalid response from football data provider", 502);
        }

        if (!teamId && Array.isArray(data.matches)) {
          data.matches.sort(
            (a, b) => new Date(b.utcDate).getTime() - new Date(a.utcDate).getTime()
          );
          data.matches = data.matches.slice(0, competitionLimit);
        }

        return Response.json(data, {
          headers: { ...corsHeaders, "Cache-Control": "public, max-age=300" },
        });
      } catch {
        return jsonError("Football data provider unavailable", 502);
      }
    }

    if (path !== "/api/odds") {
      return jsonError("Endpoint not found", 404, {
        requestedPath: path,
        expectedPaths: ["/api/odds", "/api/football"],
      });
    }

    const oddsApiKey = env.ODDSLINK_API_KEY || env.ODDS_API_KEY;
    if (!oddsApiKey) {
      return jsonError("OddsLink API key not configured", 500);
    }

    const requestedSport = String(url.searchParams.get("sport") || "basketball_nba").trim().toLowerCase();
    const mapped = sportMap[requestedSport] ||
      (["football", "fútbol", "soccer_premier_league"].includes(requestedSport)
        ? { sport: "soccer", ...(requestedSport === "soccer_premier_league" ? { league: "epl" } : {}) }
        : null);
    if (!mapped) {
      return jsonError("Unsupported sport", 400, {
        sport: requestedSport,
        allowedSports: Object.keys(sportMap),
      });
    }

    const markets = (url.searchParams.get("markets") || "h2h")
      .split(",")
      .map((market) => market.trim())
      .filter(Boolean);
    if (!markets.length || !markets.every((market) => allowedMarkets.has(market))) {
      return jsonError("Unsupported market", 400, {
        allowedMarkets: [...allowedMarkets],
      });
    }

    const upstream = new URL(`https://oddslink.app/v1/sports/${mapped.sport}/odds`);
    upstream.searchParams.set("markets", markets.join(","));
    upstream.searchParams.set("oddsFormat", "american");
    upstream.searchParams.set("dateFormat", "iso");
    if (mapped.league) upstream.searchParams.set("league", mapped.league);

    const cacheKey = new Request(upstream.toString(), { method: "GET" });
    try {
      const cachedResponse = await caches.default.match(cacheKey);
      if (cachedResponse) {
        return new Response(cachedResponse.body, {
          status: cachedResponse.status,
          headers: { ...Object.fromEntries(cachedResponse.headers), "X-Cache": "HIT" },
        });
      }
    } catch {
      // Cache is an optimization; continue to the provider if unavailable.
    }

    try {
      const response = await fetch(upstream.toString(), {
        headers: {
          Accept: "application/json",
          "X-API-Key": oddsApiKey,
        },
      });
      const body = await response.text();

      if (!response.ok) {
        let providerError;
        try {
          providerError = JSON.parse(body);
        } catch {
          providerError = { message: body || "OddsLink request failed" };
        }
        const isRateLimit = response.status === 429 ||
          providerError?.error?.code === "SPEED_LIMIT" ||
          /speed limit|rate limit/i.test(providerError?.error?.message || providerError?.message || "");
        const retryAfter = response.headers.get("Retry-After") || "15";
        const errorResponse = Response.json(
          {
            error:
              providerError?.error?.message ||
              providerError?.message ||
              providerError?.error ||
              `OddsLink returned HTTP ${response.status}`,
            provider: "OddsLink",
            status: response.status,
            code: providerError?.error?.code || providerError?.error_code,
            ...(isRateLimit ? { retryAfterSeconds: Number(retryAfter) || 15 } : {}),
          },
          {
            status: response.status,
            headers: {
              ...corsHeaders,
              "Cache-Control": isRateLimit ? "public, max-age=15" : "no-store",
              ...(isRateLimit ? { "Retry-After": retryAfter } : {}),
            },
          }
        );
        // Briefly cache provider throttling responses to avoid retry storms.
        if (isRateLimit) {
          try { await caches.default.put(cacheKey, errorResponse.clone()); } catch {}
        }
        return errorResponse;
      }

      let data;
      try {
        data = JSON.parse(body);
      } catch {
        return jsonError("Invalid response from OddsLink", 502);
      }

      const events = Array.isArray(data)
        ? data
        : Array.isArray(data.events)
        ? data.events
        : Array.isArray(data.data)
        ? data.data
        : null;
      if (!events) {
        return jsonError("Unexpected response format from OddsLink", 502);
      }

      const oddsResponse = Response.json(events, {
        headers: {
          ...corsHeaders,
          "Cache-Control": "public, max-age=30",
          "X-Provider": "OddsLink",
          "X-Cache": "MISS",
        },
      });
      try {
        await caches.default.put(cacheKey, oddsResponse.clone());
      } catch {
        // A cache write failure must not prevent live odds from being returned.
      }
      return oddsResponse;
    } catch {
      return jsonError("OddsLink provider unavailable", 502);
    }
  },
};
