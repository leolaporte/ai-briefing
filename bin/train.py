#!/usr/bin/env python3
"""Per-show classifier trainer/scorer for ai-briefing.

Modes:
  --train  Read picks from labels.db, embed titles, train logistic regression,
           write model to <model-dir>/<show>.pkl.
  --score  Read JSON candidates from stdin, emit JSON scores on stdout.
           (Implemented in Task 8.)
"""
import argparse
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.linear_model import LogisticRegression

EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"

def load_picks(db_path: Path, show: str) -> list[dict]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT story_url, story_title, source, weight, episode_date "
        "FROM picks WHERE show = ? AND story_title IS NOT NULL",
        (show,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def make_xy(picks: list[dict], embedder: SentenceTransformer):
    titles = [p["story_title"] for p in picks]
    if not titles:
        return None, None, None
    X = embedder.encode(titles, show_progress_bar=False, normalize_embeddings=True)
    y = np.array([1 if p["source"] in ("show_notes", "raindrop") else 0 for p in picks])
    w = np.array([p["weight"] for p in picks])
    return X, y, w

def train(args):
    embedder = SentenceTransformer(EMBEDDING_MODEL)
    picks = load_picks(args.labels_db, args.show)

    holdout_cutoff = None
    if not args.no_eval and len(picks) >= 30:
        dates = sorted({p["episode_date"] for p in picks})
        if len(dates) >= 2:
            holdout_cutoff = dates[-1]

    train_picks = [p for p in picks if p["episode_date"] != holdout_cutoff] if holdout_cutoff else picks
    holdout_picks = [p for p in picks if p["episode_date"] == holdout_cutoff] if holdout_cutoff else []

    X, y, w = make_xy(train_picks, embedder)
    if X is None or len(set(y)) < 2:
        summary = {"show": args.show, "trained": False, "reason": "insufficient label diversity"}
        print(json.dumps(summary))
        sys.exit(0)

    clf = LogisticRegression(class_weight="balanced", max_iter=1000)
    clf.fit(X, y, sample_weight=w)

    args.model_dir.mkdir(parents=True, exist_ok=True)
    artifact = {"clf": clf, "embedding_model": EMBEDDING_MODEL, "trained_at": datetime.utcnow().isoformat()}
    tmp = args.model_dir / f"{args.show}.pkl.tmp"
    final = args.model_dir / f"{args.show}.pkl"
    joblib.dump(artifact, tmp)
    tmp.replace(final)

    summary = {
        "show": args.show, "trained": True,
        "positives": int((y == 1).sum()), "negatives": int((y == 0).sum()),
        "train_size": len(train_picks),
        "holdout_episode_date": holdout_cutoff,
        "holdout_size": len(holdout_picks),
    }

    if holdout_picks and not args.no_eval:
        Xh, yh, _ = make_xy(holdout_picks, embedder)
        scores = clf.predict_proba(Xh)[:, 1]
        if len(scores) > 0:
            order = np.argsort(-scores)
            top_k = min(40, len(scores))
            picked = order[:top_k]
            recall_at_k = float(yh[picked].sum() / max(1, yh.sum())) if yh.sum() > 0 else 0.0
            summary["recall_at_40"] = round(recall_at_k, 3)

    print(json.dumps(summary))

def score(args):
    artifact_path = args.model_dir / f"{args.show}.pkl"
    if not artifact_path.exists():
        # No model yet — emit zero scores so the caller falls back gracefully
        candidates = json.load(sys.stdin)
        out = [{"url": c["url"], "score": 0.0} for c in candidates]
        print(json.dumps(out))
        return
    artifact = joblib.load(artifact_path)
    clf = artifact["clf"]
    embedder = SentenceTransformer(artifact["embedding_model"])
    candidates = json.load(sys.stdin)
    if not candidates:
        print(json.dumps([]))
        return
    titles = [c.get("title") or c.get("url") for c in candidates]
    X = embedder.encode(titles, show_progress_bar=False, normalize_embeddings=True)
    probs = clf.predict_proba(X)[:, 1]
    out = [{"url": c["url"], "score": float(p)} for c, p in zip(candidates, probs)]
    print(json.dumps(out))

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--train", action="store_true")
    p.add_argument("--score", action="store_true")
    p.add_argument("--show", required=True, choices=["twit", "mbw", "im"])
    p.add_argument("--labels-db", type=Path, default=Path.home() / ".local/share/ai-briefing/labels.db")
    p.add_argument("--model-dir", type=Path, default=Path.home() / ".local/share/ai-briefing/models")
    p.add_argument("--no-eval", action="store_true")
    args = p.parse_args()
    if args.train:
        train(args)
    elif args.score:
        score(args)
    else:
        p.error("must pass --train or --score")

if __name__ == "__main__":
    main()
