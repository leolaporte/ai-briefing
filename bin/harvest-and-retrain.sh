#!/usr/bin/env bash
# Usage: harvest-and-retrain.sh <show>   (show ∈ twit|mbw|im)
set -euo pipefail

SHOW="${1:?usage: harvest-and-retrain.sh <show>}"
PROJECT="$HOME/Projects/ai-briefing"
LABELS_DB="$HOME/.local/share/ai-briefing/labels.db"
MODEL_DIR="$HOME/.local/share/ai-briefing/models"
EVAL_DIR="$HOME/Obsidian/lgl/AI/News/eval"

cd "$PROJECT"

echo "[$(date -Is)] harvesting $SHOW"
bun bin/harvest.ts "$SHOW"

echo "[$(date -Is)] retraining $SHOW"
uv run python bin/train.py --train --show "$SHOW" \
  --labels-db "$LABELS_DB" \
  --model-dir "$MODEL_DIR" \
  --eval-dir "$EVAL_DIR"

# Voice the result. Source: ~/.claude/rules/voice-summary.md
RECALL=$(grep -m1 'recall_at_40' "$EVAL_DIR/$(date +%F)-$SHOW.md" 2>/dev/null | awk '{print $2}' || echo "n/a")
curl -s -X POST http://localhost:8888/notify \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"Classifier retrained\",\"message\":\"$SHOW classifier retrained, recall@40 $RECALL\",\"voice\":true,\"name\":\"main\"}" \
  >/dev/null || true
