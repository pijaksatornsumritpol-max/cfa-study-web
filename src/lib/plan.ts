// Dynamic CFA study-plan generator. Pure + client-safe (no server imports).
// Turns per-topic quiz stats + the exam date into a weighted, paced study plan.

export interface TopicStatLite {
  code: string;
  name: string;
  weight_low: number;
  weight_high: number;
  questions: number;
  attempts: number;
  correct: number;
  mature: number; // mature flashcards (interval >= 21d)
}

export interface TopicPlan {
  code: string;
  name: string;
  weight: number; // midpoint exam weight %
  accuracy: number; // 0..100 (of attempted)
  readiness: number; // 0..100 (accuracy discounted by how much practiced)
  status: "not-started" | "learning" | "strong";
  priority: number; // higher = study sooner / more
  weeks: number; // allocated learning weeks
}

export interface WeekBlock {
  index: number; // 1-based week number from now
  startISO: string;
  endISO: string;
  kind: "learn" | "review";
  codes: string[]; // topic codes (learn) — empty for review
  label: string;
}

export interface StudyPlan {
  examISO: string;
  daysLeft: number;
  weeksLeft: number;
  totalWeeks: number;
  weeksElapsed: number;
  overallReadiness: number; // 0..100
  pace: "ahead" | "on-track" | "behind" | "no-exam";
  paceMsg: string;
  topics: TopicPlan[]; // sorted by priority desc
  startNow: TopicPlan | null;
  schedule: WeekBlock[];
  thisWeek: WeekBlock | null;
}

const TARGET = 75; // target readiness per topic (rough passing guide)

function diffDays(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + "T00:00:00");
  const b = new Date(toISO + "T00:00:00");
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function topicReadiness(t: TopicStatLite): {
  accuracy: number;
  readiness: number;
  status: TopicPlan["status"];
} {
  const accuracy = t.attempts > 0 ? (t.correct / t.attempts) * 100 : 0;
  // Confidence grows with the number of attempts (full weight by ~20 attempts).
  const confidence = Math.min(1, t.attempts / 20);
  let readiness = Math.round(accuracy * confidence);
  // A little credit for mature flashcards even before quizzing.
  if (t.attempts === 0 && t.mature > 0) readiness = Math.min(40, t.mature * 2);
  const status: TopicPlan["status"] =
    t.attempts === 0 && t.mature === 0
      ? "not-started"
      : readiness >= 70
        ? "strong"
        : "learning";
  return { accuracy: Math.round(accuracy), readiness, status };
}

export function buildPlan(
  examISO: string,
  todayISO: string,
  stats: TopicStatLite[],
): StudyPlan {
  // ---- per-topic readiness & priority ----
  const topics: TopicPlan[] = stats.map((t) => {
    const weight = (t.weight_low + t.weight_high) / 2;
    const { accuracy, readiness, status } = topicReadiness(t);
    const gap = Math.max(0, TARGET - readiness) / TARGET; // 0..1
    const priority = weight * (gap + 0.15); // weight-scaled need
    return { code: t.code, name: t.name, weight, accuracy, readiness, status, priority, weeks: 0 };
  });
  topics.sort((a, b) => b.priority - a.priority);

  const totalWeight = topics.reduce((s, t) => s + t.weight, 0) || 1;
  const overallReadiness = Math.round(
    topics.reduce((s, t) => s + t.readiness * t.weight, 0) / totalWeight,
  );

  // ---- timeline ----
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(examISO);
  const daysLeft = valid ? Math.max(0, diffDays(todayISO, examISO)) : 0;
  const weeksLeft = Math.max(0, Math.ceil(daysLeft / 7));

  if (!valid || weeksLeft === 0) {
    return {
      examISO, daysLeft, weeksLeft, totalWeeks: weeksLeft, weeksElapsed: 0,
      overallReadiness, pace: "no-exam",
      paceMsg: "Set your exam date to generate a paced study schedule.",
      topics, startNow: topics.find((t) => t.status !== "strong") ?? null,
      schedule: [], thisWeek: null,
    };
  }

  // Reserve the final ~25% (min 2, max 8 weeks) for review + full mock exams.
  const reviewWeeks = Math.min(8, Math.max(2, Math.round(weeksLeft * 0.25)));
  const learnWeeks = Math.max(topics.length, weeksLeft - reviewWeeks);

  // Allocate learning weeks proportional to weight x need (weak+heavy get more), min 1 each.
  const demand = topics.map((t) => t.weight * (1 + Math.max(0, TARGET - t.readiness) / TARGET));
  const demandSum = demand.reduce((a, b) => a + b, 0) || 1;
  let allocated = 0;
  topics.forEach((t, i) => {
    t.weeks = Math.max(1, Math.round((demand[i] / demandSum) * learnWeeks));
    allocated += t.weeks;
  });
  // trim/extend to fit learnWeeks
  let diff = allocated - learnWeeks;
  for (let i = topics.length - 1; i >= 0 && diff > 0; i--) {
    while (topics[i].weeks > 1 && diff > 0) { topics[i].weeks--; diff--; }
  }
  for (let i = 0; diff < 0; i = (i + 1) % topics.length) { topics[i].weeks++; diff++; }

  // ---- build the week-by-week schedule (learning blocks in priority order) ----
  const schedule: WeekBlock[] = [];
  let cursor = 0; // weeks from now
  for (const t of topics) {
    const startISO = addDaysISO(todayISO, cursor * 7);
    const endISO = addDaysISO(todayISO, (cursor + t.weeks) * 7 - 1);
    schedule.push({
      index: cursor + 1, startISO, endISO, kind: "learn",
      codes: [t.code],
      label: `${t.name} — read notes, drill ${t.code} questions, review flashcards`,
    });
    cursor += t.weeks;
  }
  // review/mock phase
  for (let w = 0; w < reviewWeeks; w++) {
    const startISO = addDaysISO(todayISO, cursor * 7);
    const endISO = addDaysISO(todayISO, (cursor + 1) * 7 - 1);
    const last = w >= reviewWeeks - 2;
    schedule.push({
      index: cursor + 1, startISO, endISO, kind: "review", codes: [],
      label: last
        ? "Final review — full timed Simulation + clear your mistakes"
        : "Review weak topics + a full mock exam (Simulation)",
    });
    cursor += 1;
  }

  const totalWeeks = cursor;
  const weeksElapsed = 0; // schedule starts "now"; elapsed tracked via dates in UI
  const thisWeek = schedule[0] ?? null;

  // ---- pace: compare actual readiness to where it "should" be by now ----
  // Expected overall readiness rises linearly toward TARGET across the learning phase.
  const fractionElapsed = totalWeeks > 0 ? 1 - weeksLeft / totalWeeks : 0;
  const expected = Math.round(TARGET * Math.min(1, fractionElapsed + 0.0));
  let pace: StudyPlan["pace"] = "on-track";
  let paceMsg = "";
  if (overallReadiness >= expected + 8) {
    pace = "ahead";
    paceMsg = `You're ahead of schedule (${overallReadiness}% ready). Keep the streak and start light review.`;
  } else if (overallReadiness < expected - 8) {
    pace = "behind";
    paceMsg = `You're a bit behind pace — accelerate: focus on ${topics[0]?.code ?? "your weakest topic"} and hit your daily targets.`;
  } else {
    paceMsg = `On track (${overallReadiness}% overall readiness). Stay consistent.`;
  }

  return {
    examISO, daysLeft, weeksLeft, totalWeeks, weeksElapsed, overallReadiness,
    pace, paceMsg, topics,
    startNow: topics.find((t) => t.status !== "strong") ?? topics[0] ?? null,
    schedule, thisWeek,
  };
}
