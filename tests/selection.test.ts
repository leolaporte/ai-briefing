import { describe, test, expect } from "bun:test";
import { selectForShow, splitScored } from "../src/selection";
import type { StoryRow } from "../src/archive";
import type { ClusterScoring } from "../src/scorer";

const mkStory = (url: string, title: string): StoryRow => ({
  url_canonical: url, url_original: null, title,
  source_name: "S", source_domain: "s.com",
  published_at: new Date(), first_para: null,
});
const mkScoring = (twit: number, mbw: number, im: number): ClusterScoring => ({
  twit: { score: twit, canonical_idx: 1, section_guess: null },
  mbw:  { score: mbw,  canonical_idx: 1, section_guess: null },
  im:   { score: im,   canonical_idx: 1, section_guess: null },
});

describe("selectForShow", () => {
  test("returns top N clusters for the given show by score desc", () => {
    const scored = [
      { cluster: [mkStory("a", "A")], scoring: mkScoring(0.9, 0.1, 0.2) },
      { cluster: [mkStory("b", "B")], scoring: mkScoring(0.3, 0.1, 0.2) },
      { cluster: [mkStory("c", "C")], scoring: mkScoring(0.7, 0.1, 0.2) },
    ];
    const result = selectForShow(scored, "twit", 2);
    expect(result.length).toBe(2);
    expect(result[0].cluster[0].url_canonical).toBe("a");
    expect(result[1].cluster[0].url_canonical).toBe("c");
  });
});

describe("splitScored", () => {
  test("puts per-show top-N into buckets, leftovers with anywhere-score > threshold go to other", () => {
    const scored = [
      { cluster: [mkStory("a", "A")], scoring: mkScoring(0.9, 0.1, 0.2) },
      { cluster: [mkStory("b", "B")], scoring: mkScoring(0.1, 0.9, 0.1) },
      { cluster: [mkStory("c", "C")], scoring: mkScoring(0.1, 0.1, 0.9) },
      { cluster: [mkStory("d", "D")], scoring: mkScoring(0.4, 0.1, 0.1) },
      { cluster: [mkStory("e", "E")], scoring: mkScoring(0.1, 0.1, 0.1) },
    ];
    const split = splitScored(scored, { topN: 5, otherThreshold: 0.3 });
    expect(split.twit.length).toBe(2);
    expect(split.mbw.length).toBe(1);
    expect(split.im.length).toBe(1);
    expect(split.other.map(s => s.cluster[0].url_canonical))
      .not.toContain("e");
  });
});
