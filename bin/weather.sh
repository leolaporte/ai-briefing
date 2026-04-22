#!/usr/bin/env bash
# Produce the canonical 🌍 weather line for a lat/lon.
# Usage: weather.sh [LAT] [LON] [DISPLAY_NAME] [TIMEZONE]
# Defaults: Petaluma, California
# Override the network call for testing by setting WEATHER_JSON_FILE.

set -euo pipefail

LAT="${1:-38.23242}"
LON="${2:--122.63665}"
NAME="${3:-Petaluma, California}"
TZ_NAME="${4:-America/Los_Angeles}"

TZ_ENC=$(printf '%s' "$TZ_NAME" | jq -sRr @uri)
URL="https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&daily=temperature_2m_max,temperature_2m_min,weathercode,sunrise,sunset&temperature_unit=fahrenheit&timezone=${TZ_ENC}"

if [[ -n "${WEATHER_JSON_FILE:-}" ]]; then
  JSON=$(cat "$WEATHER_JSON_FILE")
else
  JSON=$(curl -sfL --max-time 10 "$URL") || { echo "weather.sh: fetch failed" >&2; exit 1; }
fi

HI=$(jq -r '.daily.temperature_2m_max[0] | round' <<<"$JSON")
LO=$(jq -r '.daily.temperature_2m_min[0] | round' <<<"$JSON")
CODE=$(jq -r '.daily.weathercode[0]' <<<"$JSON")
SUNRISE_ISO=$(jq -r '.daily.sunrise[0]' <<<"$JSON")
SUNSET_ISO=$(jq -r '.daily.sunset[0]' <<<"$JSON")

fmt_12h() {
  local iso="$1"
  local hhmm="${iso##*T}"
  local h="${hhmm%%:*}"
  local rest="${hhmm#*:}"
  local m="${rest%%:*}"
  h=$((10#$h))
  local ampm="AM"
  (( h >= 12 )) && ampm="PM"
  h=$(( h % 12 ))
  (( h == 0 )) && h=12
  printf '%02d:%s %s' "$h" "$m" "$ampm"
}

icon_for_code() {
  case "$1" in
    95|96|99) printf '⛈️' ;;
    71|73|75|77|85|86) printf '❄️' ;;
    56|57|66|67) printf '🥶' ;;
    51|53|55) printf '🌦️' ;;
    61|63|65|80|81|82) printf '🌧️' ;;
    45|48) printf '🌫️' ;;
    2|3) printf '⛅' ;;
    0|1) printf '☀️' ;;
    *) printf '☀️' ;;
  esac
}

moon_emoji() {
  local now ref days frac
  now=$(date +%s)
  ref=$(date -d '2000-01-06T18:14:00Z' +%s)
  frac=$(awk -v n="$now" -v r="$ref" 'BEGIN{
    s=29.530588853;
    d=(n-r)/86400.0;
    f=d - int(d/s)*s;
    if (f<0) f+=s;
    print f/s;
  }')
  awk -v p="$frac" 'BEGIN{
    if (p<0.0625 || p>=0.9375) print "🌑";
    else if (p<0.1875) print "🌒";
    else if (p<0.3125) print "🌓";
    else if (p<0.4375) print "🌔";
    else if (p<0.5625) print "🌕";
    else if (p<0.6875) print "🌖";
    else if (p<0.8125) print "🌗";
    else print "🌘";
  }'
}

SUNRISE=$(fmt_12h "$SUNRISE_ISO")
SUNSET=$(fmt_12h "$SUNSET_ISO")
ICON=$(icon_for_code "$CODE")
MOON=$(moon_emoji)

printf '🌍 %s: %s ⬆️ %s°F | ⬇️ %s°F | 🌅 %s | 🌇 %s | %s\n' \
  "$NAME" "$ICON" "$HI" "$LO" "$SUNRISE" "$SUNSET" "$MOON"
