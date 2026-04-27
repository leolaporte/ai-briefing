# bin/test_train.py
import json
import os
import subprocess
import sqlite3
import tempfile
from pathlib import Path

ROOT = Path(__file__).parent.parent

def make_test_db(path: Path) -> None:
    """Create a labels.db with the schema we expect, populated with a tiny dataset."""
    conn = sqlite3.connect(path)
    # Create _migrations table first (normally done by openDb in db.ts)
    conn.execute("CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)")
    conn.executescript(open(ROOT / "src/migrations/002_labels.sql").read())
    conn.executescript(open(ROOT / "src/migrations/003_labels_weight_source.sql").read())
    conn.executescript("INSERT INTO _migrations (id, applied_at) VALUES (0, '');")
    conn.executescript("INSERT INTO _migrations (id, applied_at) VALUES (1, '');")
    rows = []
    # Strong positives — Anthropic / Claude stories
    for i in range(8):
        rows.append(("twit", "2026-04-26", f"https://example.com/anthropic-{i}",
                     f"Anthropic announces new Claude feature {i}", "show_notes", 1.0))
    # Weak positives
    for i in range(4):
        rows.append(("twit", "2026-04-26", f"https://example.com/raindrop-{i}",
                     f"Apple Vision Pro story {i}", "raindrop", 0.5))
    # Negatives — sports/celebrity (clearly off-topic)
    for i in range(20):
        rows.append(("twit", "2026-04-26", f"https://example.com/neg-{i}",
                     f"Celebrity gossip story {i}", "negative", 1.0))
    conn.executemany(
        "INSERT INTO picks (show, episode_date, story_url, story_title, source, weight, scraped_at) "
        "VALUES (?, ?, ?, ?, ?, ?, '')",
        rows
    )
    conn.commit()
    conn.close()

def test_score_returns_probabilities():
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "labels.db"
        model_dir = Path(tmp) / "models"
        make_test_db(db)
        # Train first
        subprocess.run(
            ["uv", "run", "python", str(ROOT / "bin/train.py"),
             "--train", "--show", "twit",
             "--labels-db", str(db), "--model-dir", str(model_dir), "--no-eval"],
            check=True, cwd=ROOT, capture_output=True,
        )
        # Score
        candidates = [
            {"url": "https://example.com/anthropic-new", "title": "Anthropic releases Claude 5"},
            {"url": "https://example.com/celeb", "title": "Kardashian wedding goes viral"},
        ]
        result = subprocess.run(
            ["uv", "run", "python", str(ROOT / "bin/train.py"),
             "--score", "--show", "twit", "--model-dir", str(model_dir)],
            input=json.dumps(candidates), capture_output=True, text=True, cwd=ROOT,
        )
        assert result.returncode == 0, result.stderr
        scores = json.loads(result.stdout)
        assert len(scores) == 2
        for s in scores:
            assert 0.0 <= s["score"] <= 1.0
        # The Anthropic story should outscore the gossip
        anthropic = next(s for s in scores if "anthropic" in s["url"])
        gossip = next(s for s in scores if "celeb" in s["url"])
        assert anthropic["score"] > gossip["score"], (
            f"expected Anthropic > celebrity, got {anthropic['score']} vs {gossip['score']}"
        )


def test_train_writes_model_artifact():
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "labels.db"
        model_dir = Path(tmp) / "models"
        make_test_db(db)
        result = subprocess.run(
            ["uv", "run", "python", str(ROOT / "bin/train.py"),
             "--train", "--show", "twit",
             "--labels-db", str(db),
             "--model-dir", str(model_dir),
             "--no-eval"],
            capture_output=True, text=True, cwd=ROOT,
        )
        assert result.returncode == 0, result.stderr
        assert (model_dir / "twit.pkl").exists()
        # Output is one JSON summary on stdout
        summary = json.loads(result.stdout.strip().splitlines()[-1])
        assert summary["show"] == "twit"
        assert summary["positives"] >= 8
