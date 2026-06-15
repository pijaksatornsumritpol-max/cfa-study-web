// Daily reminder cron. Triggered by Vercel Cron (see vercel.json). Builds today's
// study-plan nudge and pushes it to every subscribed device.
//
// Security: if CRON_SECRET is set, Vercel injects `Authorization: Bearer <secret>`
// on its scheduled calls and we reject anything else. If it's unset the endpoint
// is open (fine for a low-stakes daily reminder, but setting it is recommended).
import { ensureInit } from "@/lib/db";
import { buildDailyReminder, pushConfigured, sendToAll } from "@/lib/push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }
  if (!pushConfigured()) {
    return Response.json({ ok: false, error: "push not configured" });
  }
  await ensureInit();
  const payload = await buildDailyReminder();
  const res = await sendToAll(payload);
  return Response.json({ ok: true, ...res });
}
