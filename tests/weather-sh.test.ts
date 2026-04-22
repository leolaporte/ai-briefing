import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";

const WEATHER_SH = join(import.meta.dir, "..", "bin", "weather.sh");

const SAMPLE_JSON = JSON.stringify({
  daily: {
    temperature_2m_max: [61.3],
    temperature_2m_min: [49.1],
    weathercode: [63],
    sunrise: ["2026-04-22T06:24"],
    sunset: ["2026-04-22T19:53"],
  },
});

function runWeather(jsonBody: string, args: string[] = []): { stdout: string; code: number } {
  const dir = mkdtempSync(join(tmpdir(), "weather-"));
  const file = join(dir, "in.json");
  writeFileSync(file, jsonBody);
  try {
    const result = spawnSync(WEATHER_SH, args, {
      env: { ...process.env, WEATHER_JSON_FILE: file },
      encoding: "utf-8",
    });
    return { stdout: result.stdout ?? "", code: result.status ?? 1 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("weather.sh", () => {
  test("emits the canonical 🌍 line format with rain icon and rounded temps", () => {
    const { stdout, code } = runWeather(SAMPLE_JSON, [
      "38.23242",
      "-122.63665",
      "Petaluma, California",
    ]);
    expect(code).toBe(0);
    // Format: 🌍 <name>: <icon> ⬆️ X°F | ⬇️ Y°F | 🌅 HH:MM AM | 🌇 HH:MM PM | <moon>
    expect(stdout.trim()).toMatch(
      /^🌍 Petaluma, California: 🌧️ ⬆️ 61°F \| ⬇️ 49°F \| 🌅 06:24 AM \| 🌇 07:53 PM \| [🌑🌒🌓🌔🌕🌖🌗🌘]$/u
    );
  });

  test("defaults to Petaluma when called with no args", () => {
    const { stdout, code } = runWeather(SAMPLE_JSON);
    expect(code).toBe(0);
    expect(stdout).toContain("🌍 Petaluma, California:");
  });

  test("maps weather codes to icons correctly", () => {
    const mkJson = (code: number) =>
      JSON.stringify({
        daily: {
          temperature_2m_max: [70],
          temperature_2m_min: [50],
          weathercode: [code],
          sunrise: ["2026-04-22T06:00"],
          sunset: ["2026-04-22T19:00"],
        },
      });

    expect(runWeather(mkJson(0)).stdout).toContain("☀️");
    expect(runWeather(mkJson(2)).stdout).toContain("⛅");
    expect(runWeather(mkJson(45)).stdout).toContain("🌫️");
    expect(runWeather(mkJson(63)).stdout).toContain("🌧️");
    expect(runWeather(mkJson(73)).stdout).toContain("❄️");
    expect(runWeather(mkJson(95)).stdout).toContain("⛈️");
  });
});
