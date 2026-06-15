// Web Push sender (server-only). Uses VAPID keys to push daily study reminders
// to subscribed devices. Configure with env vars:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  (generate with `web-push generate-vapid-keys`)
//   VAPID_SUBJECT  (optional — a mailto: or https: contact, defaults below)
import "server-only";
import webpush from "web-push";
import {
  activityDates,
  addDaysISO,
  allPushSubscriptions,
  countsByTopic,
  deletePushSubscription,
  getSettingsRaw,
  todayISO,
} from "./db";
import { parseSettings } from "./habits";
import { buildPlan } from "./plan";

let vapidReady = false;
function ensureVapid(): boolean {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  if (!vapidReady) {
    const subject =
      process.env.VAPID_SUBJECT || "mailto:pijak.satornsumlitpol@sasin.edu";
    webpush.setVapidDetails(subject, pub, priv);
    vapidReady = true;
  }
  return true;
}

export function pushConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function vapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY || "";
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/** Send a payload to every stored subscription; prune ones the push service has expired. */
export async function sendToAll(
  payload: PushPayload,
): Promise<{ sent: number; failed: number; total: number }> {
  if (!ensureVapid()) return { sent: 0, failed: 0, total: 0 };
  const subs = await allPushSubscriptions();
  const data = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          data,
        );
        sent++;
      } catch (e) {
        failed++;
        const code = (e as { statusCode?: number })?.statusCode;
        // 404/410 = subscription gone (uninstalled / unsubscribed) → drop it.
        if (code === 404 || code === 410) await deletePushSubscription(s.endpoint);
      }
    }),
  );
  return { sent, failed, total: subs.length };
}

function computeStreak(days: Set<string>): number {
  const today = todayISO();
  const yesterday = addDaysISO(today, -1);
  if (!days.has(today) && !days.has(yesterday)) return 0;
  let d = days.has(today) ? today : yesterday;
  let streak = 0;
  while (days.has(d)) {
    streak += 1;
    d = addDaysISO(d, -1);
  }
  return streak;
}

/** Compose today's reminder from the live study plan (days left, focus topic, streak). */
export async function buildDailyReminder(): Promise<PushPayload> {
  const settings = parseSettings(await getSettingsRaw());
  const stats = await countsByTopic();
  const plan = buildPlan(
    settings.examDate,
    todayISO(),
    stats.map((s) => ({
      code: s.code,
      name: s.name,
      weight_low: s.weight_low,
      weight_high: s.weight_high,
      questions: s.questions,
      attempts: s.attempts,
      correct: s.correct,
      mature: s.mature,
    })),
  );
  const streak = computeStreak(await activityDates());
  const focus = plan.startNow?.name ?? "your weakest topic";
  const hasExam = plan.pace !== "no-exam" && plan.daysLeft > 0;

  const title = hasExam
    ? `📚 ${plan.daysLeft} days to CFA Level 1`
    : "📚 CFA Level 1 — study time";
  const streakLine =
    streak > 0
      ? `🔥 ${streak}-day streak — keep it alive! `
      : "Start your streak today! ";
  const body = `${streakLine}Today's focus: ${focus}. Tap to open your plan.`;
  return { title, body, url: "/plan", tag: "cfa-daily" };
}
