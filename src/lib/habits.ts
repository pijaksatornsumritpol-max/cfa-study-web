// Atomic Habits workflow helpers. Pure + client-safe (no server imports).
// Maps James Clear's framework onto the CFA study loop.

export interface HabitSettings {
  identity: string; // identity-based habits
  goalCards: number; // daily system target (cards)
  goalQuestions: number; // daily system target (questions)
  cue: string; // implementation intention / habit stack
  reward: string; // temptation bundling — "after I study, I get to ___"
  examDate: string; // optional "YYYY-MM-DD" for systems-vs-goals framing
}

export const DEFAULT_SETTINGS: HabitSettings = {
  identity: "I am someone who shows up to study CFA every day.",
  goalCards: 10,
  goalQuestions: 5,
  cue: "",
  reward: "",
  examDate: "",
};

/** Merge stored string settings with defaults + coerce types. */
export function parseSettings(raw: Record<string, string>): HabitSettings {
  return {
    identity: raw.identity?.trim() || DEFAULT_SETTINGS.identity,
    goalCards: clampInt(raw.goalCards, DEFAULT_SETTINGS.goalCards, 1, 500),
    goalQuestions: clampInt(raw.goalQuestions, DEFAULT_SETTINGS.goalQuestions, 0, 500),
    cue: raw.cue ?? "",
    reward: raw.reward ?? "",
    examDate: raw.examDate ?? "",
  };
}

function clampInt(v: string | undefined, dflt: number, lo: number, hi: number): number {
  const n = parseInt(v ?? "", 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

/**
 * "1% better every day compounds." Returns the multiplier (e.g. 37.78 for 365)
 * and the percentage gain for a given run of consistent days.
 */
export function compounding(days: number): { multiplier: number; gainPct: number } {
  const multiplier = Math.pow(1.01, Math.max(0, days));
  return { multiplier, gainPct: (multiplier - 1) * 100 };
}

export interface HeatCell {
  date: string; // YYYY-MM-DD
  count: number;
  inFuture: boolean;
}

/**
 * Build a weeks x 7 grid (most recent `weeks` weeks, ending this week) for a
 * "don't break the chain" calendar. `activity` maps date -> count.
 */
export function buildHeatmap(
  todayISO: string,
  activity: Record<string, number>,
  weeks = 12,
): HeatCell[][] {
  const today = new Date(todayISO + "T00:00:00");
  // Sunday-based column. Find the start (Sunday) of the current week.
  const dow = today.getDay(); // 0=Sun
  const endOfGrid = addDays(today, 6 - dow); // Saturday of this week
  const start = addDays(endOfGrid, -(weeks * 7 - 1)); // go back `weeks` weeks

  const cols: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d);
      const iso = fmt(date);
      col.push({
        date: iso,
        count: activity[iso] ?? 0,
        inFuture: iso > todayISO,
      });
    }
    cols.push(col);
  }
  return cols;
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
