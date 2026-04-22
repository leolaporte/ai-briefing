import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ensureBingBanner } from "../src/banner";

const DATE = new Date("2026-04-22T10:00:00Z");

const BING_API_JSON = JSON.stringify({
  images: [
    {
      url: "/th?id=OHR.TartuEstonia_EN-US1234567890_1920x1080.jpg",
      urlbase: "/th?id=OHR.TartuEstonia_EN-US1234567890",
      copyright: "Tartu, Estonia",
    },
  ],
});

const FAKE_IMAGE = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]); // JPEG magic

function makeFetch(apiResponse: string | Error, imageBody: Uint8Array | Error): typeof fetch {
  return (async (input: unknown) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("HPImageArchive")) {
      if (apiResponse instanceof Error) throw apiResponse;
      return new Response(apiResponse, { status: 200 });
    }
    if (imageBody instanceof Error) throw imageBody;
    return new Response(imageBody as unknown as BodyInit, { status: 200 });
  }) as unknown as typeof fetch;
}

describe("ensureBingBanner", () => {
  let vault: string;
  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), "vault-banner-"));
  });
  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  test("downloads Bing POTD to pixel-banner-images and returns wikilink ref", async () => {
    const result = await ensureBingBanner(vault, DATE, makeFetch(BING_API_JSON, FAKE_IMAGE));
    expect(result).not.toBeNull();
    expect(result!.ref).toBe(
      "![[Zobs/pixel-banner-images/2026-04-22-TartuEstonia.jpg]]"
    );
    const expectedPath = join(
      vault,
      "Zobs/pixel-banner-images/2026-04-22-TartuEstonia.jpg"
    );
    expect(existsSync(expectedPath)).toBe(true);
    expect(statSync(expectedPath).size).toBe(FAKE_IMAGE.length);
  });

  test("returns existing ref without re-downloading when file already exists", async () => {
    const dir = join(vault, "Zobs/pixel-banner-images");
    mkdirSync(dir, { recursive: true });
    const existing = join(dir, "2026-04-22-TartuEstonia.jpg");
    writeFileSync(existing, "already here");
    // fetch should not be called — pass one that throws to prove it
    const fetchFn = (async () => {
      throw new Error("should not be called");
    }) as unknown as typeof fetch;
    const result = await ensureBingBanner(vault, DATE, fetchFn);
    expect(result).not.toBeNull();
    expect(result!.ref).toBe(
      "![[Zobs/pixel-banner-images/2026-04-22-TartuEstonia.jpg]]"
    );
    expect(readFileSync(existing, "utf-8")).toBe("already here");
  });

  test("returns null when Bing API call fails", async () => {
    const fetchFn = makeFetch(new Error("network down"), FAKE_IMAGE);
    const result = await ensureBingBanner(vault, DATE, fetchFn);
    expect(result).toBeNull();
  });

  test("returns null when image download fails", async () => {
    const fetchFn = makeFetch(BING_API_JSON, new Error("image 500"));
    const result = await ensureBingBanner(vault, DATE, fetchFn);
    expect(result).toBeNull();
  });

  test("falls back to a generic name when urlbase has no OHR prefix", async () => {
    const weirdApi = JSON.stringify({
      images: [{ url: "/th?id=weird.jpg", urlbase: "/th?id=weird", copyright: "" }],
    });
    const result = await ensureBingBanner(vault, DATE, makeFetch(weirdApi, FAKE_IMAGE));
    expect(result).not.toBeNull();
    expect(result!.ref).toMatch(/2026-04-22-[A-Za-z0-9-]+\.jpg/);
  });
});
