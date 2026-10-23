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

      const endpoint = teamId
        ? `https://api.football-data.org/v4/teams/${teamId}/matches`
        : `https://api.football-data.org/v4/competitions/${competition}/matches`;
      const upstream = new URL(endpoint);
      upstream.searchParams.set("status", status);

      if (teamId) {
        const requestedLimit = Number(url.searchParams.get("limit") || "10");
        const limit = Number.isFinite(requestedLimit)
          ? Math.max(1, Math.min(20, Math.floor(requestedLimit)))
          : 10;
        upstream.searchParams.set("limit", String(limit));
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
          data.matches = data.matches.slice(0, 10);
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

    const requestedSport = url.searchParams.get("sport") || "basketball_nba";
    const mapped = sportMap[requestedSport];
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
        return Response.json(
          {
            error:
              providerError?.error?.message ||
              providerError?.message ||
              providerError?.error ||
              `OddsLink returned HTTP ${response.status}`,
            provider: "OddsLink",
            status: response.status,
            code: providerError?.error?.code || providerError?.error_code,
          },
          { status: response.status, headers: { ...corsHeaders, "Cache-Control": "no-store" } }
        );
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

      return Response.json(events, {
        headers: {
          ...corsHeaders,
          "Cache-Control": "no-store",
          "X-Provider": "OddsLink",
        },
      });
    } catch {
      return jsonError("OddsLink provider unavailable", 502);
    }
  },
};
