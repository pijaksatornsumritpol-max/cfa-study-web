// Google Calendar via a SERVICE ACCOUNT (server-to-server, no user login).
// Set env GOOGLE_SERVICE_ACCOUNT = the full service-account JSON key, and
// GOOGLE_CALENDAR_ID = the calendar to write to (your Gmail address, after you
// share that calendar with the service account's email). Raw fetch + node crypto.
import crypto from "node:crypto";

const TOKEN = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const TAG = "cfaStudyPlan";
const calBase = (id: string) =>
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events`;

interface SA {
  client_email: string;
  private_key: string;
}
function serviceAccount(): SA | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as { client_email?: string; private_key?: string };
    if (j.client_email && j.private_key) {
      return { client_email: j.client_email, private_key: j.private_key.replace(/\\n/g, "\n") };
    }
  } catch {
    /* malformed JSON */
  }
  return null;
}

export function calendarId(): string {
  return process.env.GOOGLE_CALENDAR_ID || "";
}
export function serviceAccountEmail(): string {
  return serviceAccount()?.client_email || "";
}
export function googleConfigured(): boolean {
  return !!serviceAccount() && !!calendarId();
}

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function getAccessToken(): Promise<string | null> {
  const sa = serviceAccount();
  if (!sa) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: TOKEN,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signature = b64url(
    crypto.sign("RSA-SHA256", Buffer.from(signingInput), sa.private_key),
  );
  const assertion = `${signingInput}.${signature}`;
  const r = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!r.ok) throw new Error(`service-account token failed: ${r.status} ${await r.text()}`);
  const j = (await r.json()) as { access_token?: string };
  return j.access_token ?? null;
}

export interface CalEvent {
  summary: string;
  description?: string;
  startDate: string; // YYYY-MM-DD (all-day)
  endDateExclusive: string; // YYYY-MM-DD (exclusive)
}

/** Delete our previously-created plan events, then create the new set. Returns count created. */
export async function syncPlanEvents(events: CalEvent[]): Promise<number> {
  const token = await getAccessToken();
  if (!token) throw new Error("Service account not configured");
  const id = calendarId();
  if (!id) throw new Error("GOOGLE_CALENDAR_ID is not set");
  const base = calBase(id);
  const auth = { Authorization: `Bearer ${token}` };

  // 1) delete existing tagged events
  const listUrl = `${base}?privateExtendedProperty=${encodeURIComponent(TAG + "=1")}&maxResults=2500&singleEvents=true`;
  const lr = await fetch(listUrl, { headers: auth });
  if (lr.ok) {
    const j = (await lr.json()) as { items?: { id: string }[] };
    for (const it of j.items ?? []) {
      await fetch(`${base}/${it.id}`, { method: "DELETE", headers: auth });
    }
  } else if (lr.status === 404) {
    throw new Error("Calendar not found — share your calendar with the service-account email.");
  }

  // 2) create the new events
  let created = 0;
  for (const e of events) {
    const r = await fetch(base, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
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
