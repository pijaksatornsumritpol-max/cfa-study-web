// Google OAuth (auth-code flow) + Calendar helpers. Server-only (raw fetch).
import {
  getGoogleAuth,
  saveGoogleAuth,
  type GoogleAuth,
} from "@/lib/db";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const USERINFO = "https://www.googleapis.com/oauth2/v2/userinfo";
const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const SCOPE = "openid email https://www.googleapis.com/auth/calendar.events";
const TAG = "cfaStudyPlan"; // private extended-property key tagging our events

export function clientId(): string {
  return process.env.GOOGLE_CLIENT_ID ?? "";
}
function clientSecret(): string {
  return process.env.GOOGLE_CLIENT_SECRET ?? "";
}
export function googleConfigured(): boolean {
  return !!clientId() && !!clientSecret();
}

export function buildAuthUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent select_account",
    state,
  });
  return `${AUTH}?${p.toString()}`;
}

interface TokenResp {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
}

export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<{ email: string; access_token: string; refresh_token?: string; expiry: number }> {
  const body = new URLSearchParams({
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const r = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`token exchange failed: ${r.status} ${await r.text()}`);
  const t = (await r.json()) as TokenResp;
  const email = await fetchUserEmail(t.access_token);
  return {
    email,
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expiry: Date.now() + (t.expires_in - 60) * 1000,
  };
}

async function fetchUserEmail(accessToken: string): Promise<string> {
  try {
    const r = await fetch(USERINFO, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) return "";
    const j = (await r.json()) as { email?: string };
    return j.email ?? "";
  } catch {
    return "";
  }
}

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expiry: number }> {
  const body = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const r = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`token refresh failed: ${r.status}`);
  const t = (await r.json()) as TokenResp;
  return { access_token: t.access_token, expiry: Date.now() + (t.expires_in - 60) * 1000 };
}

/** Return a valid access token for the stored account, refreshing if expired. */
export async function getValidAccessToken(): Promise<string | null> {
  const auth: GoogleAuth | null = await getGoogleAuth();
  if (!auth || !auth.access_token) return null;
  if (Date.now() < auth.expiry) return auth.access_token;
  if (!auth.refresh_token) return null;
  const fresh = await refreshAccessToken(auth.refresh_token);
  await saveGoogleAuth({ email: auth.email, access_token: fresh.access_token, expiry: fresh.expiry });
  return fresh.access_token;
}

export interface CalEvent {
  summary: string;
  description?: string;
  startDate: string; // YYYY-MM-DD (all-day)
  endDateExclusive: string; // YYYY-MM-DD (exclusive)
}

/** Delete the plan events we previously created, then create the new set. Returns count created. */
export async function syncPlanEvents(accessToken: string, events: CalEvent[]): Promise<number> {
  // 1) find + delete existing tagged events
  const listUrl = `${CAL}?privateExtendedProperty=${encodeURIComponent(TAG + "=1")}&maxResults=2500&singleEvents=true`;
  const lr = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (lr.ok) {
    const j = (await lr.json()) as { items?: { id: string }[] };
    for (const it of j.items ?? []) {
      await fetch(`${CAL}/${it.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
    }
  }
  // 2) create the new events
  let created = 0;
  for (const e of events) {
    const r = await fetch(CAL, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: e.summary,
        description: e.description ?? "",
        start: { date: e.startDate },
        end: { date: e.endDateExclusive },
        extendedProperties: { private: { [TAG]: "1" } },
        transparency: "transparent",
        reminders: { useDefault: false },
      }),
    });
    if (r.ok) created++;
  }
  return created;
}
