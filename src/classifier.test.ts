// src/classifier.test.ts
import { test, expect } from "bun:test";
import { shortlistByScore } from "./classifier";

test("shortlistByScore returns top-K cluster indices by score", () => {
  const scores = [
    { idx: 0, score: 0.1 },
    { idx: 1, score: 0.9 },
    { idx: 2, score: 0.5 },
    { idx: 3, score: 0.7 },
  ];
  const top2 = shortlistByScore(scores, 2);
  expect(top2.sort()).toEqual([1, 3]);
});

test("shortlistByScore with K >= len returns all", () => {
  const scores = [{ idx: 0, score: 0.5 }];
  expect(shortlistByScore(scores, 10)).toEqual([0]);
});
