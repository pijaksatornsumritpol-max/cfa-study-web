import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRelated, renderContextBlock, type TutorContext } from "./tutor.ts";

test("parseRelated: well-formed footer -> body without the line + 3 chips", () => {
  const r = parseRelated("Ease drops when you miss a card.\nRelated: Why 21 days?, What is SM-2?, When to suspend?");
  assert.equal(r.body, "Ease drops when you miss a card.");
  assert.deepEqual(r.followups, ["Why 21 days?", "What is SM-2?", "When to suspend?"]);
});

test("parseRelated: bracketed footer -> brackets stripped", () => {
  const r = parseRelated("Body.\nRelated: [One?, Two?, Three?]");
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
