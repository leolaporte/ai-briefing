CREATE TABLE stories (
  id INTEGER PRIMARY KEY,
  url_canonical TEXT UNIQUE NOT NULL,
  url_original TEXT,
  title TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_domain TEXT NOT NULL,
  published_at TEXT NOT NULL,
  first_para TEXT,
  ingested_at TEXT NOT NULL
);
CREATE INDEX idx_stories_published ON stories(published_at);
CREATE INDEX idx_stories_source ON stories(source_domain);
