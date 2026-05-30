// Shared types passed between server actions and client components.
// Type-only module — safe to import anywhere (erased at compile time).
import type { HabitSettings, HeatCell } from "./habits";

export interface Topic {
  id: number;
  code: string;
  name: string;
  weight_low: number;
  weight_high: number;
}

export interface Flashcard {
  id: number;
  topic_id: number;
  topic_code: string;
  front: string;
  back: string;
  tags: string;
  ease: number;
  interval: number;
  reps: number;
  due_date: string | null;
  last_reviewed: string | null;
  created_at: string | null;
}

export interface Question {
  id: number;
  topic_id: number;
  topic_code: string;
  stem: string;
  choice_a: string;
  choice_b: string;
  choice_c: string;
  correct: "A" | "B" | "C";
  explanation: string;
  created_at: string | null;
}

export interface TopicStat {
  code: string;
  name: string;
  weight_low: number;
  weight_high: number;
  cards: number;
  due: number;
  mature: number;
  questions: number;
  attempts: number;
  correct: number;
}

export interface RecentAttempt {
  topic_code: string;
  stem: string;
  is_correct: number;
  answered_at: string;
}

export interface DashboardData {
  totals: {
    cards: number;
    due: number;
    questions: number;
    attempts: number;
    correct: number;
  };
  streak: number;
  stats: TopicStat[];
  recent: RecentAttempt[];
}

export interface ImportResult {
  added: number;
  skipped: number;
  error?: string;
}

export interface TodayData {
  today: string;
  settings: HabitSettings;
  cardsReviewedToday: number;
  questionsAnsweredToday: number;
  dueRemaining: number;
  questionsAvailable: number;
  streak: number;
  studiedToday: boolean;
  missedYesterday: boolean;
  totalStudyDays: number;
  heatmap: HeatCell[][];
  examDaysLeft: number | null;
}
