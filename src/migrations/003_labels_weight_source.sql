ALTER TABLE picks ADD COLUMN weight REAL NOT NULL DEFAULT 1.0;
ALTER TABLE picks ADD COLUMN source TEXT NOT NULL DEFAULT 'archive';
CREATE INDEX idx_picks_show_source ON picks(show, source);
