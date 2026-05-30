// SM-2 spaced repetition (SuperMemo 2), ported 1:1 from the original srs.py.
// Pure functions, no I/O or date logic — client-safe so the UI can preview
// intervals instantly. The actual due-date is computed in the server action.
//
// Quality scale used by the app's 4 buttons:
//   Again -> 2  (failed recall, resets the card)
//   Hard  -> 3  (recalled with serious difficulty)
//   Good  -> 4  (recalled correctly)
//   Easy  -> 5  (recalled easily)

export const QUALITY = { Again: 2, Hard: 3, Good: 4, Easy: 5 } as const;

export type Rating = keyof typeof QUALITY;

export const RATINGS = Object.keys(QUALITY) as Rating[];

export interface ScheduleResult {
  ease: number;
  interval: number; // days
  reps: number; // successful reps in a row
}

/**
 * Given a card's current state and a review quality, return the new
 * (ease, interval, reps). A quality < 3 resets repetitions; otherwise the
 * interval grows. Mirrors srs.schedule() from the Python app.
 */
export function schedule(
  ease: number | null,
  interval: number | null,
  reps: number | null,
  quality: number,
): ScheduleResult {
  let e = ease ?? 2.5;
  let iv = interval || 0;
  let r = reps || 0;

  if (quality < 3) {
    r = 0;
    iv = 1; // see it again tomorrow
  } else {
    if (r === 0) iv = 1;
    else if (r === 1) iv = 6;
    else iv = Math.round(iv * e);
    r += 1;
  }

  // update ease factor
  e = e + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  e = Math.max(1.3, e);

  return { ease: round3(e), interval: Math.trunc(iv), reps: Math.trunc(r) };
}

/** Roughly what each button will do (interval in days) — shown under the buttons. */
export function intervalPreview(
  ease: number,
  interval: number,
  reps: number,
): Record<Rating, number> {
  const out = {} as Record<Rating, number>;
  for (const label of RATINGS) {
    out[label] = schedule(ease, interval, reps, QUALITY[label]).interval;
  }
  return out;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
