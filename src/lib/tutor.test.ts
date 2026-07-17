import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRelated, renderContextBlock, type TutorContext } from "./tutor.ts";

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
