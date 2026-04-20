CREATE TABLE picks (
  id INTEGER PRIMARY KEY,
  show TEXT NOT NULL,
  episode_date TEXT NOT NULL,
  section_name TEXT,
  section_order INTEGER,
  rank_in_section INTEGER,
  story_url TEXT NOT NULL,
  story_title TEXT,
  scraped_at TEXT NOT NULL,
  source_file TEXT
);
CREATE INDEX idx_picks_show_date ON picks(show, episode_date);
CREATE UNIQUE INDEX idx_picks_unique ON picks(show, episode_date, story_url);
