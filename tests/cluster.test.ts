import { describe, test, expect } from "bun:test";
import { canonicalizeUrl, trigramJaccard, clusterStories } from "../src/cluster";
import type { StoryRow } from "../src/archive";

describe("canonicalizeUrl", () => {
  test("strips utm_* query params", () => {
    expect(canonicalizeUrl("https://example.com/a?utm_source=rss&id=1"))
      .toBe("https://example.com/a?id=1");
  });
  test("lowercases host, drops fragment, strips trailing slash", () => {
    expect(canonicalizeUrl("HTTPS://EXAMPLE.COM/path/#section"))
      .toBe("https://example.com/path");
  });
});

describe("trigramJaccard", () => {
  test("identical strings return 1.0", () => {
    expect(trigramJaccard("hello world", "hello world")).toBeCloseTo(1.0);
  });
  test("totally different strings are near 0", () => {
    expect(trigramJaccard("apple", "zebra")).toBeLessThan(0.1);
  });
  test("similar titles score > 0.5", () => {
    expect(trigramJaccard(
      "Anthropic releases Claude Opus 4.7",
      "Anthropic releases Opus 4.7 model"
    )).toBeGreaterThan(0.5);
  });
});

describe("clusterStories", () => {
  const mk = (url: string, title: string): StoryRow => ({
    url_canonical: url, url_original: null, title,
    source_name: "S", source_domain: "s.com",
    published_at: new Date(), first_para: null,
  });

  test("groups stories with similar titles into the same cluster", () => {
    const stories = [
      mk("https://a.com/1", "Anthropic releases Claude Opus 4.7"),
      mk("https://b.com/2", "Anthropic releases Opus 4.7 model"),
      mk("https://c.com/3", "SpaceX launches Starship"),
    ];
    const clusters = clusterStories(stories, 0.5);
    expect(clusters).toHaveLength(2);
    const multiCluster = clusters.find((c) => c.length > 1)!;
    expect(multiCluster).toHaveLength(2);
  });
});
