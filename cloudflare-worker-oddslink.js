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

function respondWithOddsView(events, requestUrl) {
 const selectedId=String(requestUrl.searchParams.get("eventId")||"");
 const mode=String(requestUrl.searchParams.get("view")||"");
 if(selectedId){
  const match=events.find(e=>String(e?.id||"")===selectedId);
  return Response.json(match?[match]:[],{headers:{...corsHeaders,"Cache-Control":"public, max-age=30","X-Provider":"OddsLink","X-View":"event"}});
 }
 if(mode==="compact"){
  const now=Date.now(),days=Math.max(1,Math.min(14,Number(requestUrl.searchParams.get("days"))||7)),limit=Math.max(10,Math.min(400,Number(requestUrl.searchParams.get("limit"))||200));
  const preferred=new Set(["hardrock","pinnacle","bet365","draftkings","fanduel","betmgm","betfair","caesars","betonline","unibet"]);
  const active=events.filter(e=>{const t=Date.parse(e?.commence_time||"");return Number.isFinite(t)&&t>=now-2*3600000&&t<now+days*86400000})
   .sort((a,b)=>Date.parse(a.commence_time)-Date.parse(b.commence_time)).slice(0,limit);
  const smaller=active.map(e=>({
   id:e.id,sport_key:e.sport_key,sport_title:e.sport_title,commence_time:e.commence_time,is_live:e.is_live,status:e.status,
   home_team:e.home_team,away_team:e.away_team,league:e.league,
   bookmakers:(Array.isArray(e.bookmakers)?e.bookmakers:[]).filter(b=>preferred.has(String(b.key||"").toLowerCase())).map(b=>({
    key:b.key,title:b.title,last_update:b.last_update,
    markets:(Array.isArray(b.markets)?b.markets:[]).map(m=>({key:m.key,last_update:m.last_update,outcomes:m.outcomes}))
   })),
   __compact:true
  }));
  return Response.json(smaller,{headers:{...corsHeaders,"Cache-Control":"public, max-age=30","X-Provider":"OddsLink","X-View":"compact"}});
 }
 return null;
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
          endpoints: ["/api/odds", "/api/football", "/api/advanced/fixtures", "/api/advanced/statistics", "/api/standings", "/api/soccer-extras"],
          sports: Object.keys(sportMap),
        },
        { headers: corsHeaders }
      );
    }

    // Clasificaciones de temporada en curso proporcionadas por football-data.org.
    // El token permanece secreto en Cloudflare; no se expone al navegador.
    if (path === "/api/standings") {
      if (!env.FOOTBALL_DATA_TOKEN) {
        return jsonError("Football data token not configured", 503);
      }
      const competition = String(url.searchParams.get("competition") || "").toUpperCase();
      const supported = new Set(["PL", "PD", "BL1", "SA", "FL1", "DED", "PPL"]);
      if (!supported.has(competition)) {
        return jsonError("Standings unavailable for this competition", 400, { competition });
      }
      const upstream = new URL("https://api.football-data.org/v4/competitions/" + competition + "/standings");
      const cacheKey = new Request(upstream.toString());
      try {
        const stored = await caches.default.match(cacheKey);
        if (stored) return new Response(stored.body, { status: stored.status, headers: { ...Object.fromEntries(stored.headers), "X-Cache": "HIT" } });
      } catch {}
      try {
        const response = await fetch(upstream.toString(), {
          headers: { Accept: "application/json", "X-Auth-Token": env.FOOTBALL_DATA_TOKEN }
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) return jsonError("Standings provider returned HTTP " + response.status, response.status === 429 ? 429 : 502, { provider: "football-data.org", retryAfterSeconds: response.status === 429 ? 60 : undefined });
        const standings = Array.isArray(data?.standings) ? data.standings : [];
        const total = standings.find(item => item.type === "TOTAL");
        if (!total || !Array.isArray(total.table)) {
          return jsonError("Current league table not available", 404, { competition });
        }
        const table = total.table.map(row => ({
          position: row.position,
          team: { id: row.team?.id, name: row.team?.name, shortName: row.team?.shortName, tla: row.team?.tla },
          playedGames: row.playedGames, won: row.won, draw: row.draw, lost: row.lost,
          points: row.points, goalsFor: row.goalsFor, goalsAgainst: row.goalsAgainst,
          goalDifference: row.goalDifference, form: row.form
        }));
        const result = Response.json({
          ok: true, provider: "football-data.org", competition: data?.competition?.name || competition,
          season: data?.season?.startDate || null,
          matchday: data?.season?.currentMatchday || null, table
        }, { headers: { ...corsHeaders, "Cache-Control": "public, max-age=1800" } });
        try { await caches.default.put(cacheKey, result.clone()) } catch {}
        return result;
      } catch {
        return jsonError("Standings provider unavailable", 502);
      }
    }

    // Optional additional soccer game-lines and player shots, discovered from the provider's live catalogue.
    // We never manufacture market names or prices. Player props may require a higher OddsLink plan.
    if (path === "/api/soccer-extras") {
      const key = env.ODDSLINK_API_KEY || env.ODDS_API_KEY;
      if (!key) return jsonError("OddsLink key not configured", 503);
      const eventId = String(url.searchParams.get("eventId") || "");
      if (!/^soccer:[a-z0-9_:.-]{6,190}$/i.test(eventId)) return jsonError("Invalid soccer event ID", 400);
      const headers = {"X-API-Key": key, Accept:"application/json"};
      const catalogKey=new Request("https://oddslink.app/v1/markets?sport=soccer");
      let catalog;
      try {
        const cacheHit=await caches.default.match(catalogKey);
        if(cacheHit)catalog=await cacheHit.json();
        else{
          const r=await fetch(catalogKey.url,{headers});
          if(!r.ok)return jsonError("OddsLink market catalogue unavailable",502,{providerStatus:r.status});
          catalog=await r.json();
          if(Array.isArray(catalog)){
            const cacheResp=Response.json(catalog,{headers:{"Cache-Control":"public, max-age=3600"}});
            try{await caches.default.put(catalogKey,cacheResp)}catch{}
          }
        }
      }catch{return jsonError("Market catalogue connection failed",502)}
      const all=Array.isArray(catalog)?catalog:Array.isArray(catalog?.markets)?catalog.markets:[];
      const wanted=e=>/both.?teams|btts|double.?chance|draw.?no.?bet|corner|shot|booking|card|goal/i.test(String(e.key||"")+" "+String(e.description||""));
      const additional=all.filter(e=>!e.period&&e.kind==="game_line"&&wanted(e)&&!["h2h","totals","spreads"].includes(e.key))
        .map(e=>String(e.key)).filter((x,i,a)=>a.indexOf(x)===i).slice(0,12);
      const props=all.filter(e=>!e.period&&e.kind==="player_prop"&&/shot|on.?target/i.test(String(e.key||"")+" "+String(e.description||"")))
        .map(e=>String(e.key)).filter((x,i,a)=>a.indexOf(x)===i).slice(0,6);
      const base="https://oddslink.app/v1/sports/soccer/events/"+encodeURIComponent(eventId);
      const oddsUrl=new URL(base+"/odds");
      oddsUrl.searchParams.set("markets",["h2h","spreads","totals",...additional].join(","));
      oddsUrl.searchParams.set("oddsFormat","american");
      const propUrl=new URL(base+"/props");
      propUrl.searchParams.set("markets",props.join(","));
      propUrl.searchParams.set("oddsFormat","american");
      const fetchJson=async target=>{
        const r=await fetch(target.toString(),{headers});
        const body=await r.json().catch(()=>null);
        return {ok:r.ok,status:r.status,data:body};
      };
      const [oddsResult,propResult]=await Promise.all([
        fetchJson(oddsUrl).catch(()=>({ok:false,status:502})),
        props.length?fetchJson(propUrl).catch(()=>({ok:false,status:502})):Promise.resolve({ok:false,status:204})
      ]);
      // Prop errors are informative; they do not hide game lines.
      return Response.json({
        ok:oddsResult.ok,provider:"OddsLink",availableGameMarkets:additional,availableShotProps:props,
        fixture:oddsResult.ok?oddsResult.data:null,
        oddsStatus:oddsResult.status,
        playerProps:propResult.ok?propResult.data:null,
        propsStatus:propResult.status,
        note:propResult.status===403?"Player prop access may require the Growth plan":null
      },{headers:{...corsHeaders,"Cache-Control":"public, max-age=30"}});
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

    // API-Football v3: credencial exclusivamente desde Cloudflare Secret.
    // No compartir la clave con GitHub Pages ni el cliente.
    if (path === "/api/advanced/fixtures" || path === "/api/advanced/statistics") {
      const key = env.API_FOOTBALL_KEY;
      if (!key) return jsonError("API-Football secret not configured in Cloudflare", 503, { provider: "API-Football" });
      const isStats = path.endsWith("/statistics");
      const isoDay = /^\d{4}-\d{2}-\d{2}$/;
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const fixture = url.searchParams.get("fixture") || "";
      const league = url.searchParams.get("league") || "";
      const season = url.searchParams.get("season") || "";
      const allowedLeagues = new Set(["39","140","135","78","61","253"]);
      if (isStats ? !/^[0-9]{1,12}$/.test(fixture) : !(isoDay.test(from) && isoDay.test(to) && from <= to && (Date.parse(to)-Date.parse(from)) <= 2*86400000 && allowedLeagues.has(league) && /^20[0-9]{2}$/.test(season))) {
        return jsonError("Invalid date range, league, season or fixture identifier", 400);
      }
      const upstream = new URL("https://v3.football.api-sports.io/" + (isStats ? "fixtures/statistics" : "fixtures"));
      if (isStats) upstream.searchParams.set("fixture",fixture);
      else { upstream.searchParams.set("from",from);upstream.searchParams.set("to",to);upstream.searchParams.set("league",league);upstream.searchParams.set("season",season); }
      const cacheRequest = new Request(upstream.toString());
      try {
        const cached = await caches.default.match(cacheRequest);
        if (cached) return new Response(cached.body, {status:cached.status, headers:{...Object.fromEntries(cached.headers),"X-Cache":"HIT"}});
      } catch {}
      try {
        const upstreamResponse = await fetch(upstream.toString(),{
          headers:{"x-apisports-key":key,Accept:"application/json"}
        });
        const data = await upstreamResponse.json().catch(()=>null);
        if(!upstreamResponse.ok || !data || (data.errors && Object.keys(data.errors).length)){
          const providerErrors=data?.errors || {};
          const errorText=JSON.stringify(providerErrors);
          const limited=upstreamResponse.status===429 || /rate.?limit|too many requests|requests per minute|quota|daily limit/i.test(errorText);
          const retryAfterHeader=Number(upstreamResponse.headers.get("Retry-After"));
          const retryAfterSeconds=limited ? Math.max(60,Math.min(3600,Number.isFinite(retryAfterHeader)&&retryAfterHeader>0?retryAfterHeader:60)) : 0;
          const errorResponse=Response.json({
            error:limited?"API-Football rate limit reached":"API-Football rejected the request",
            provider:"API-Football",providerStatus:upstreamResponse.status,
            detail:providerErrors,
            ...(limited?{retryAfterSeconds}:{})
          },{
            status:limited?429:upstreamResponse.status>=400&&upstreamResponse.status<500?upstreamResponse.status:502,
            headers:{...corsHeaders,"Cache-Control":limited?"public, max-age=60":"no-store",...(limited?{"Retry-After":String(retryAfterSeconds)}:{})}
          });
          // Short negative cache prevents repeated identical requests from hitting provider.
          if(limited){try{await caches.default.put(cacheRequest,errorResponse.clone())}catch{}}
          return errorResponse;
        }
        const rows=Array.isArray(data.response)?data.response:[];
        const response=Response.json({
          ok:true,provider:"API-Football",response:rows,
          count:rows.length,coverage:"Varies by league, season and plan"
        },{headers:{...corsHeaders,"Cache-Control":isStats?"public, max-age=3600":"public, max-age=900"}});
        try {await caches.default.put(cacheRequest,response.clone())}catch{}
        return response;
      }catch{
        return jsonError("API-Football provider unavailable",502,{provider:"API-Football"});
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
        if (cachedResponse.ok && (url.searchParams.has("eventId") || url.searchParams.get("view")==="compact")) {
          const cachedEvents=await cachedResponse.clone().json().catch(()=>null);
          if(Array.isArray(cachedEvents)){
            const view=respondWithOddsView(cachedEvents,url);
            if(view)return view;
          }
        }
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
      return respondWithOddsView(events,url)||oddsResponse;
    } catch {
      return jsonError("OddsLink provider unavailable", 502);
    }
  },
};
