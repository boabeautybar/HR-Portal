/* ============================================================================
   BOA HR — Google Maps proxy (Netlify Function)
   ----------------------------------------------------------------------------
   The recruitment / trial store picker uses this to show REAL public-transport
   commute times and address suggestions. Google's Places + Distance Matrix web
   services can't be called from the browser (no CORS; would leak the key), so
   this server-side proxy holds the key and forwards two actions.

   Setup: add GOOGLE_MAPS_API_KEY in Netlify → Site settings → Environment
   variables. Enable "Places API" + "Distance Matrix API" on the key.

   POST JSON, one of:
     { action: "autocomplete", input: "<typed text>" }
       → { suggestions: [{ description, placeId }] }
     { action: "distances", origin: "<address>",
       destinations: [{ name, lat, lng }], mode: "transit" }
       → { results: [{ name, status, durationText, durationSeconds,
                        distanceText, distanceMeters }] }
     { action: "directions", origin: "<address>",
       destination: { lat, lng }, mode: "transit", arrivalTime: <unix s?> }
       → { durationText, durationSeconds, departureText, departureValue,
           arrivalText, arrivalValue, startLocation:{lat,lng}, steps:[...] }
     { action: "nearbyTaxi", lat, lng }
       → { taxi: { name, vicinity, lat, lng } | null }

   On any failure it returns a non-200 with { error }, so the UI keeps the
   offline ranking + deep links and never blocks onboarding. (directions needs
   the "Directions API" enabled on the key; nearbyTaxi uses the Places API.)
   ============================================================================ */

const GOOGLE = "https://maps.googleapis.com/maps/api";
// Cape Town bias for autocomplete (keeps suggestions local + cheap).
const CT_BIAS = { lat: -33.9249, lng: 18.4241, radius: 60000 };

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    },
    body: JSON.stringify(obj)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST." });

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return json(503, { error: "Maps not configured (GOOGLE_MAPS_API_KEY missing)." });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (_e) { return json(400, { error: "Invalid JSON body." }); }

  try {
    if (body.action === "autocomplete") {
      const input = String(body.input || "").trim();
      if (input.length < 3) return json(200, { suggestions: [] });
      const url = GOOGLE + "/place/autocomplete/json"
        + "?input=" + encodeURIComponent(input)
        + "&components=country:za"
        + "&location=" + CT_BIAS.lat + "," + CT_BIAS.lng
        + "&radius=" + CT_BIAS.radius
        + "&key=" + key;
      const r = await fetch(url);
      const d = await r.json();
      if (d.status !== "OK" && d.status !== "ZERO_RESULTS") {
        return json(502, { error: "Places error: " + (d.error_message || d.status) });
      }
      const suggestions = (d.predictions || []).slice(0, 6).map((p) => ({
        description: p.description, placeId: p.place_id
      }));
      return json(200, { suggestions });
    }

    if (body.action === "distances") {
      const origin = String(body.origin || "").trim();
      const dests = Array.isArray(body.destinations) ? body.destinations : [];
      if (!origin) return json(400, { error: "origin required." });
      if (!dests.length) return json(400, { error: "destinations required." });
      const mode = body.mode === "driving" ? "driving" : "transit";
      const destStr = dests.map((x) => x.lat + "," + x.lng).join("|");
      const url = GOOGLE + "/distancematrix/json"
        + "?origins=" + encodeURIComponent(origin)
        + "&destinations=" + encodeURIComponent(destStr)
        + "&mode=" + mode
        + "&region=za"
        + "&key=" + key;
      const r = await fetch(url);
      const d = await r.json();
      if (d.status !== "OK") {
        return json(502, { error: "Distance Matrix error: " + (d.error_message || d.status) });
      }
      const elements = (d.rows && d.rows[0] && d.rows[0].elements) || [];
      const results = dests.map((dest, i) => {
        const el = elements[i] || {};
        const ok = el.status === "OK";
        return {
          name: dest.name,
          status: el.status || "UNKNOWN",
          durationText: ok && el.duration ? el.duration.text : null,
          durationSeconds: ok && el.duration ? el.duration.value : null,
          distanceText: ok && el.distance ? el.distance.text : null,
          distanceMeters: ok && el.distance ? el.distance.value : null
        };
      });
      return json(200, { results, mode });
    }

    if (body.action === "directions") {
      const origin = String(body.origin || "").trim();
      const dest = body.destination || {};
      if (!origin) return json(400, { error: "origin required." });
      if (typeof dest.lat !== "number" || typeof dest.lng !== "number") {
        return json(400, { error: "destination {lat,lng} required." });
      }
      const mode = body.mode === "driving" ? "driving" : "transit";
      let url = GOOGLE + "/directions/json"
        + "?origin=" + encodeURIComponent(origin)
        + "&destination=" + dest.lat + "," + dest.lng
        + "&mode=" + mode
        + "&region=za"
        + "&alternatives=false"
        + "&key=" + key;
      // arrival_time lets Google return the route that ARRIVES BY the target,
      // and a departure_time we surface as "leave home by".
      const arr = Number(body.arrivalTime);
      if (mode === "transit" && arr && isFinite(arr) && arr > 0) {
        url += "&arrival_time=" + Math.floor(arr);
      }
      const r = await fetch(url);
      const d = await r.json();
      if (d.status !== "OK") {
        return json(502, { error: "Directions error: " + (d.error_message || d.status) });
      }
      const route = d.routes && d.routes[0];
      const leg = route && route.legs && route.legs[0];
      if (!leg) return json(502, { error: "No route returned." });
      const steps = (leg.steps || []).map((s) => {
        const td = s.transit_details;
        const line = td && td.line ? (td.line.short_name || td.line.name || "") : "";
        const veh = td && td.line && td.line.vehicle ? (td.line.vehicle.type || "") : "";
        return {
          travelMode: s.travel_mode,
          instruction: s.html_instructions
            ? String(s.html_instructions).replace(/<[^>]+>/g, "") : "",
          durationText: s.duration ? s.duration.text : null,
          transit: td ? {
            line: line,
            vehicle: veh,
            departureStop: td.departure_stop ? td.departure_stop.name : null,
            arrivalStop: td.arrival_stop ? td.arrival_stop.name : null,
            departureText: td.departure_time ? td.departure_time.text : null,
            numStops: typeof td.num_stops === "number" ? td.num_stops : null,
            headsign: td.headsign || null
          } : null
        };
      });
      return json(200, {
        mode,
        durationText: leg.duration ? leg.duration.text : null,
        durationSeconds: leg.duration ? leg.duration.value : null,
        distanceText: leg.distance ? leg.distance.text : null,
        distanceMeters: leg.distance ? leg.distance.value : null,
        departureText: leg.departure_time ? leg.departure_time.text : null,
        departureValue: leg.departure_time ? leg.departure_time.value : null,
        arrivalText: leg.arrival_time ? leg.arrival_time.text : null,
        arrivalValue: leg.arrival_time ? leg.arrival_time.value : null,
        startLocation: leg.start_location || null,
        steps: steps
      });
    }

    if (body.action === "nearbyTaxi") {
      const lat = Number(body.lat), lng = Number(body.lng);
      if (!isFinite(lat) || !isFinite(lng)) return json(400, { error: "lat/lng required." });
      const url = GOOGLE + "/place/nearbysearch/json"
        + "?location=" + lat + "," + lng
        + "&rankby=distance"
        + "&keyword=" + encodeURIComponent("taxi rank")
        + "&key=" + key;
      const r = await fetch(url);
      const d = await r.json();
      if (d.status !== "OK" && d.status !== "ZERO_RESULTS") {
        return json(502, { error: "Places nearby error: " + (d.error_message || d.status) });
      }
      const p = (d.results || [])[0];
      const taxi = p ? {
        name: p.name,
        vicinity: p.vicinity || null,
        lat: p.geometry && p.geometry.location ? p.geometry.location.lat : null,
        lng: p.geometry && p.geometry.location ? p.geometry.location.lng : null
      } : null;
      return json(200, { taxi });
    }

    return json(400, { error: "Unknown action." });
  } catch (e) {
    return json(500, { error: "Proxy failure: " + ((e && e.message) || String(e)) });
  }
};
