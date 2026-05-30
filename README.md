# CFA Level 1 — Study App (Web)

A spaced-repetition flashcard + quiz + progress tracker for the CFA Level 1
exam, built as a **Next.js** app (React frontend + server-action backend) that
deploys to **Vercel** as a single URL. Data lives in a **Turso** (libSQL/SQLite)
database in production, or a local SQLite file in development.

This is the web rebuild of the original local Streamlit app, with the same
features and the official **2026 CFA Level 1 topic weights**.

## Features

- **Dashboard** — cards due today, quiz accuracy, study streak, and a per-topic
  table comparing your *mastery* against the *official exam weight*. High-weight,
  low-mastery topics are flagged so you study where it counts.
- **Flashcards** — SM-2 spaced repetition. Rate each card Again / Hard / Good /
  Easy; the app schedules the next review automatically.
- **Quiz** — multiple-choice practice filtered by topic, instant feedback,
  explanations, and an end-of-set per-topic breakdown.
- **Manage** — add cards/questions by hand, bulk-import via CSV, browse/delete,
  or load a sample set.

## Tech

| Layer | Tech |
|-------|------|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS v4 |
| Backend | Next.js Server Functions (`"use server"`) |
| Database | libSQL — Turso in prod, local SQLite file in dev |
| Hosting | Vercel |

## Local development

```bash
npm install
npm run dev          # http://localhost:3000
```

With no environment variables, it uses a local SQLite file at `./cfa_study.db`
(gitignored). The 10 CFA topics seed automatically on first run.

## Deploy to Vercel

1. **Create a Turso database** at [turso.tech](https://turso.tech) and copy its
   **Database URL** (`libsql://…`) and an **auth token**.
2. **Push this folder to GitHub.**
3. **Import the repo into [Vercel](https://vercel.com)** and add these
   Environment Variables:
   - `TURSO_DATABASE_URL` = your `libsql://…` URL
   - `TURSO_AUTH_TOKEN` = your token
   - `APP_TZ` = `Asia/Bangkok` (optional; controls "due today" / streak day)
4. **Deploy.** Every push to the main branch redeploys automatically.

The schema and topic seed are created automatically on first request.

## Importing your content

**Manage → Import CSV.** Two formats:

- **Flashcards:** `topic_code, front, back, tags`
- **Questions:** `topic_code, stem, choice_a, choice_b, choice_c, correct, explanation`

`topic_code` ∈ `ETH, QM, ECO, FSA, CI, EI, FI, DER, AI, PM`; `correct` ∈ `A, B, C`.
Blank templates are downloadable from the Import tab.

## Project structure

| Path | Purpose |
|------|---------|
| `src/app/page.tsx` | Dashboard |
| `src/app/flashcards/` | Flashcard review |
| `src/app/quiz/` | Quiz |
| `src/app/manage/` | Add / import / browse content |
| `src/app/actions.ts` | Server Functions (the backend API) |
| `src/lib/db.ts` | libSQL client + schema + data access |
| `src/lib/srs.ts` | SM-2 scheduling |
| `src/lib/topics.ts` | CFA topics + 2026 weights |
| `src/components/` | Sidebar nav + shared UI |
