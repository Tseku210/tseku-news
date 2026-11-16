-- Every story that appeared in an edition, for search, trends and the saved list.
CREATE TABLE stories (
  url TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  source TEXT NOT NULL,
  topic TEXT NOT NULL,
  edition TEXT NOT NULL, -- YYYY-MM-DD of the first edition it appeared in
  image TEXT
);
CREATE INDEX stories_edition ON stories(edition);

CREATE VIRTUAL TABLE stories_fts USING fts5(
  title, summary, content='stories', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER stories_ai AFTER INSERT ON stories BEGIN
  INSERT INTO stories_fts(rowid, title, summary) VALUES (new.rowid, new.title, new.summary);
END;

-- What the reader did with a story. A NULL column means "not done" (or undone).
CREATE TABLE marks (
  url TEXT PRIMARY KEY,
  read_at INTEGER,
  liked_at INTEGER,
  saved_at INTEGER,
  hidden_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX marks_updated ON marks(updated_at);
