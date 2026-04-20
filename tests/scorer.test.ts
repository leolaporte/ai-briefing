import { describe, test, expect } from "bun:test";
import { parseScoringResponse } from "../src/scorer";

describe("parseScoringResponse", () => {
  test("parses valid JSON envelope", () => {
    const raw = `{"twit":{"score":0.8,"canonical_idx":1,"section_guess":"AI"},"mbw":{"score":0.1,"canonical_idx":1,"section_guess":null},"im":{"score":0.95,"canonical_idx":1,"section_guess":"Models"}}`;
    const parsed = parseScoringResponse(raw);
    expect(parsed.twit.score).toBeCloseTo(0.8);
    expect(parsed.im.section_guess).toBe("Models");
  });

  test("extracts JSON from text with preamble", () => {
    const raw = `Here is the scoring:\n\n{"twit":{"score":0.3,"canonical_idx":2,"section_guess":null},"mbw":{"score":0.0,"canonical_idx":1,"section_guess":null},"im":{"score":0.5,"canonical_idx":1,"section_guess":null}}`;
    const parsed = parseScoringResponse(raw);
    expect(parsed.twit.canonical_idx).toBe(2);
    expect(parsed.im.score).toBeCloseTo(0.5);
  });

  test("throws on unparseable response", () => {
    expect(() => parseScoringResponse("nonsense")).toThrow();
  });
});
