-- AI summaries for the cards, one per story URL, so nothing is summarised twice.
CREATE TABLE summaries (
  url TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
