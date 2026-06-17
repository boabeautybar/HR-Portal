// HTTP Basic Auth gate for the entire BOA HR Portal.
//
// WHY: the portal talks to Supabase with a PUBLIC anon key embedded in
// index.html and has no real server-side authentication — the PIN login is
// client-side UI only. Without a gate, anyone who loads the page can copy the
// anon key from "View Source" and read/write all HR data (ID numbers,
// addresses, cash-ups, incident reports). This password-walls the whole site
// (including app.jsx / data.js) so the key isn't reachable by the public.
// It is an INTERIM measure — the proper fix is real auth + Supabase RLS.
//
// Credentials come from Netlify environment variables — NEVER hardcode them:
//   BOA_PORTAL_PASSWORD  (required)  the shared password
//   BOA_PORTAL_USER      (optional)  the username, defaults to "boa"
// Set them in Netlify → Site configuration → Environment variables BEFORE
// this deploys, otherwise the site fails secure (503) until they exist.

export default async (request, context) => {
  const expectedPass = Netlify.env.get("BOA_PORTAL_PASSWORD");
  const expectedUser = Netlify.env.get("BOA_PORTAL_USER") || "boa";

  // Fail secure: never serve the app if no password is configured.
  if (!expectedPass) {
    return new Response(
      "BOA HR Portal is not configured yet. Set the BOA_PORTAL_PASSWORD " +
        "environment variable in Netlify, then redeploy.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }

  const header = request.headers.get("authorization") || "";
  if (header.startsWith("Basic ")) {
    let decoded = "";
    try {
      decoded = atob(header.slice(6));
    } catch (_) {
      decoded = "";
    }
    const idx = decoded.indexOf(":");
    const user = idx >= 0 ? decoded.slice(0, idx) : "";
    const pass = idx >= 0 ? decoded.slice(idx + 1) : "";
    if (safeEqual(user, expectedUser) && safeEqual(pass, expectedPass)) {
      // Authenticated — hand off to the normal static-asset pipeline.
      return context.next();
    }
  }

  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="BOA HR Portal", charset="UTF-8"',
      "content-type": "text/plain; charset=utf-8",
    },
  });
};

// Length-independent comparison to avoid leaking the password length or an
// early-exit timing signal. Not a perfect constant-time guarantee on a CDN
// edge, but materially better than a plain === on user-supplied input.
function safeEqual(a, b) {
  const ea = new TextEncoder().encode(String(a));
  const eb = new TextEncoder().encode(String(b));
  let diff = ea.length ^ eb.length;
  const len = Math.max(ea.length, eb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ea[i] || 0) ^ (eb[i] || 0);
  }
  return diff === 0;
}
