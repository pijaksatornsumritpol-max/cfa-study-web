import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRelated, renderContextBlock, toValidHistory, type TutorContext } from "./tutor.ts";

test("parseRelated: well-formed pipe footer -> body without the line + 3 chips", () => {
  const r = parseRelated("Ease drops when you miss a card.\nRelated: Why 21 days? | What is SM-2? | When to suspend?");
  assert.equal(r.body, "Ease drops when you miss a card.");
  assert.deepEqual(r.followups, ["Why 21 days?", "What is SM-2?", "When to suspend?"]);
});

test("parseRelated: pipe footer preserves a comma inside a question", () => {
  const r = parseRelated("Body.\nRelated: If ease drops, what happens? | Two? | Three?");
  assert.deepEqual(r.followups, ["If ease drops, what happens?", "Two?", "Three?"]);
});

test("parseRelated: bullet-delimited footer -> 3 chips", () => {
  const r = parseRelated("Body.\nRelated: One? • Two? • Three?");
  assert.equal(r.body, "Body.");
  assert.deepEqual(r.followups, ["One?", "Two?", "Three?"]);
});

test("parseRelated: comma-only footer -> falls back to comma splitting", () => {
  const r = parseRelated("Ease drops when you miss a card.\nRelated: Why 21 days?, What is SM-2?, When to suspend?");
  assert.equal(r.body, "Ease drops when you miss a card.");
  assert.deepEqual(r.followups, ["Why 21 days?", "What is SM-2?", "When to suspend?"]);
});

test("parseRelated: bracketed footer -> brackets stripped", () => {
  const r = parseRelated("Body.\nRelated: [One? | Two? | Three?]");
  assert.equal(r.body, "Body.");
  assert.deepEqual(r.followups, ["One?", "Two?", "Three?"]);
});

test("parseRelated: bracketed comma footer -> brackets stripped via fallback", () => {
  const r = parseRelated("Body.\nRelated: [One?, Two?, Three?]");
  assert.equal(r.body, "Body.");
  assert.deepEqual(r.followups, ["One?", "Two?", "Three?"]);
});

test("parseRelated: bold markdown footer -> delimiters stripped, no garbage chip", () => {
  const r = parseRelated("Body.\n**Related:** One? | Two? | Three?");
  assert.equal(r.body, "Body.");
  assert.deepEqual(r.followups, ["One?", "Two?", "Three?"]);
});

test("parseRelated: list-item italic label -> footer stripped from body, 3 chips", () => {
  const r = parseRelated("Body.\n- _Related_: One? | Two? | Three?");
  assert.equal(r.body, "Body.");
  assert.deepEqual(r.followups, ["One?", "Two?", "Three?"]);
});

test("parseRelated: blockquoted label -> footer stripped from body, 3 chips", () => {
  const r = parseRelated("Body.\n> Related: One? | Two? | Three?");
  assert.equal(r.body, "Body.");
  assert.deepEqual(r.followups, ["One?", "Two?", "Three?"]);
});

test("parseRelated: italic label with trailing underscore -> 3 chips", () => {
  const r = parseRelated("Body.\n_Related:_ One? | Two? | Three?");
  assert.equal(r.body, "Body.");
  assert.deepEqual(r.followups, ["One?", "Two?", "Three?"]);
});

test("parseRelated: per-item markdown emphasis stripped from chips", () => {
  const r = parseRelated("Body.\nRelated: **One?** | _Two?_ | Three?");
  assert.deepEqual(r.followups, ["One?", "Two?", "Three?"]);
});

test("parseRelated: never returns more than 3 chips", () => {
  const r = parseRelated("Body.\nRelated: One? | Two? | Three? | Four?");
  assert.equal(r.followups.length, 3);
  assert.deepEqual(r.followups, ["One?", "Two?", "Three?"]);
});

test("parseRelated: no footer -> text unchanged, zero chips", () => {
  const r = parseRelated("Just an answer.");
  assert.equal(r.body, "Just an answer.");
  assert.deepEqual(r.followups, []);
});

test("parseRelated: malformed footer -> line removed, zero chips", () => {
  const r = parseRelated("Body.\nRelated:");
  assert.equal(r.body, "Body.");
  assert.deepEqual(r.followups, []);
});

const ctx: TutorContext = {
  topicCode: "ETH", topicName: "Ethical & Professional Standards",
  front: "What is Standard I(A)?", back: "Knowledge of the Law.", tags: "standards",
  reps: 4, ease: 1.85, interval: 2, missed: 3,
  topicCards: 42, topicMature: 9, topicAttempts: 18, topicCorrect: 11,
};

test("renderContextBlock: includes card, stats, topic accuracy and the question", () => {
  const s = renderContextBlock(ctx, "Why do I keep missing this?");
  assert.match(s, /\[CARD\] ETH — Ethical & Professional Standards/);
  assert.match(s, /What is Standard I\(A\)\?/);
  assert.match(s, /missed 3 times/);
  assert.match(s, /42 cards \(9 mature\)/);
  assert.match(s, /61% \(11\/18\)/);
  assert.match(s, /\[QUESTION\] Why do I keep missing this\?/);
});

test("renderContextBlock: zero attempts -> no division by zero", () => {
  const s = renderContextBlock({ ...ctx, topicAttempts: 0, topicCorrect: 0 }, "Hi");
  assert.match(s, /no attempts yet/);
  assert.doesNotMatch(s, /NaN/);
});

test("renderContextBlock: empty tags -> Tags line omitted", () => {
  assert.doesNotMatch(renderContextBlock({ ...ctx, tags: "" }, "Hi"), /Tags:/);
});

test("renderContextBlock: whole-number ease renders with 2 decimals", () => {
  assert.match(renderContextBlock({ ...ctx, ease: 2.5 }, "Hi"), /ease 2\.50/);
});

// ---------------------------------------------------------------- toValidHistory
// The Anthropic Messages API 400s on a history that does not start with `user`,
// does not strictly alternate, or (once the new question is appended) repeats a
// role. Each shape below is reachable from a real session; see toValidHistory.
type Msg = { id: number; role: "user" | "assistant" };

// Build from a role string: "uua" -> u1, u2, a3 (ids are 1-based positions).
const hist = (roles: string): Msg[] =>
  [...roles].map((c, i) => ({ id: i + 1, role: c === "u" ? "user" : "assistant" }));
const shape = (ms: Msg[]): string => ms.map((m) => (m.role === "user" ? "u" : "a")).join("");

/** Starts with `user` and strictly alternates — what the API requires of any request. */
function assertAlternatesFromUser(ms: Msg[]): void {
  if (!ms.length) return;
  assert.equal(ms[0].role, "user", "must start with user");
  for (let i = 1; i < ms.length; i++) {
    assert.notEqual(ms[i].role, ms[i - 1].role, `consecutive ${ms[i].role} at index ${i}`);
  }
}

/** A stored history is additionally required to end with `assistant`. */
function assertLegalPrefix(ms: Msg[]): void {
  assertAlternatesFromUser(ms);
  if (ms.length) assert.equal(ms[ms.length - 1].role, "assistant", "history must end with assistant");
}

test("toValidHistory: (a) failed turn -> unpaired trailing user is dropped", () => {
  const r = toValidHistory(hist("u"));
  assert.equal(shape(r), "");
  assertLegalPrefix(r);
});

test("toValidHistory: (b) window boundary -> leading assistant is dropped", () => {
  const r = toValidHistory(hist("auauauau"));
  assert.equal(shape(r), "uauaua");
  assertLegalPrefix(r);
});

test("toValidHistory: (c) two failed turns then success -> consecutive users collapsed", () => {
  const r = toValidHistory(hist("uua"));
  assert.equal(shape(r), "ua");
  assertLegalPrefix(r);
});

test("toValidHistory: (d) retry after fail mid-window -> stays alternating", () => {
  const r = toValidHistory(hist("uauua"));
  assert.equal(shape(r), "uaua");
  assertLegalPrefix(r);
});

test("toValidHistory: (e) all assistants -> empty", () => {
  const r = toValidHistory(hist("aa"));
  assert.equal(shape(r), "");
  assertLegalPrefix(r);
});

test("toValidHistory: (f) empty -> empty", () => {
  assert.deepEqual(toValidHistory([]), []);
});

test("toValidHistory: keeps the NEWEST of a duplicate run (the question that produced the answer)", () => {
  // [u1,u2,a3]: u2 is the question a3 actually answers — keeping u1 would pair
  // the answer with an abandoned question.
  assert.deepEqual(toValidHistory(hist("uua")).map((m) => m.id), [2, 3]);
  // [u1,a2,u3,u4,a5]: likewise u4, not u3.
  assert.deepEqual(toValidHistory(hist("uauua")).map((m) => m.id), [1, 2, 4, 5]);
});

test("toValidHistory: appending the new question keeps it legal for every shape", () => {
  // What Task 4 actually sends: trimmed history + the new user turn. This is the
  // request the API sees, so it must start with user and strictly alternate.
  for (const roles of ["u", "auauauau", "uua", "uauua", "aa", "", "uuu", "aua", "uaua", "uu", "au"]) {
    const sent: Msg[] = [...toValidHistory(hist(roles)), { id: 99, role: "user" }];
    assertAlternatesFromUser(sent);
  }
});

test("toValidHistory: does not mutate its input", () => {
  const rows = hist("uua");
  toValidHistory(rows);
  assert.equal(shape(rows), "uua");
});
