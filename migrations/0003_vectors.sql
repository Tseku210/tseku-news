-- Embeddings of stories (Workers AI, bge-m3), for ranking by similarity to what
-- the reader liked and hid. One Float32Array per story URL.
CREATE TABLE vectors (
  url TEXT PRIMARY KEY,
  vec BLOB NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
