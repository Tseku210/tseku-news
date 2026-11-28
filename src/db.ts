// D1: every story ever shown (for search, trends and the saved list) and what the
// reader did with each one (read, like, save, hide). Editions themselves stay in KV.

import type { Env, Edition } from "./index";
import { SOURCES, type Topic } from "./sources";

const topicOf = new Map(SOURCES.map((s) => [s.id, s.topic]));

export type MarkKind = "read" | "like" | "save" | "hide";
const COLUMN: Record<MarkKind, string> = { read: "read_at", like: "liked_at", save: "saved_at", hide: "hidden_at" };

export interface Mark {
  read: boolean;
  liked: boolean;
  saved: boolean;
  hidden: boolean;
}

export interface StoryRow {
  url: string;
  title: string;
  summary: string | null;
  source: string;
  topic: Topic;
  edition: string;
  image: string | null;
}

// Copy an edition's stories into D1. Safe to run again: existing rows are kept.
export async function indexEdition(env: Env, ed: Edition): Promise<void> {
  const stmt = env.DB.prepare(
    "INSERT OR IGNORE INTO stories (url, title, summary, source, topic, edition, image) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
  );
  const rows = ed.items.map((it) =>
    stmt.bind(it.url, it.title, it.summary ?? null, it.source, topicOf.get(it.source) ?? "tech", ed.date, it.image ?? null),
  );
  for (let i = 0; i < rows.length; i += 50) await env.DB.batch(rows.slice(i, i + 50));
}

// Index an edition once. A KV flag (the item count) remembers it so page views
// don't redo the work; an edition that grew is indexed again.
export async function ensureIndexed(env: Env, ed: Edition): Promise<void> {
  const key = `idx:${ed.date}`;
  if ((await env.NEWS.get(key)) === String(ed.items.length)) return;
  await indexEdition(env, ed);
  await env.NEWS.put(key, String(ed.items.length), { expirationTtl: 200 * 86_400 });
}

// Index every archived edition that isn't in D1 yet (editions from before D1).
export async function backfill(env: Env): Promise<number> {
  const dates = ((await env.NEWS.get<string[]>("dates", "json")) ?? []).slice(0, 180);
  let n = 0;
  for (const d of dates) {
    if (await env.NEWS.get(`idx:${d}`)) continue;
    const ed = await env.NEWS.get<Edition>(`edition:${d}`, "json");
    if (!ed) continue;
    await ensureIndexed(env, ed);
    n++;
  }
  return n;
}

export async function marksFor(env: Env, date: string): Promise<Map<string, Mark>> {
  const { results } = await env.DB.prepare(
    `SELECT m.url, m.read_at, m.liked_at, m.saved_at, m.hidden_at FROM marks m JOIN stories s ON s.url = m.url WHERE s.edition = ?1`,
  )
    .bind(date)
    .all<{ url: string; read_at: number | null; liked_at: number | null; saved_at: number | null; hidden_at: number | null }>();
  return new Map(
    results.map((r) => [r.url, { read: r.read_at != null, liked: r.liked_at != null, saved: r.saved_at != null, hidden: r.hidden_at != null }]),
  );
}

// Turn one mark on or off. "read" only ever records the first time.
export async function setMark(env: Env, url: string, kind: MarkKind, on: boolean, now: number): Promise<boolean> {
  const col = COLUMN[kind];
  const value = on ? now : null;
  const set = kind === "read" ? `${col} = COALESCE(marks.${col}, excluded.${col})` : `${col} = excluded.${col}`;
  const res = await env.DB.prepare(
    `INSERT INTO marks (url, ${col}, updated_at) SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM stories WHERE url = ?1)
     ON CONFLICT(url) DO UPDATE SET ${set}, updated_at = excluded.updated_at`,
  )
    .bind(url, value, now)
    .run();
  return res.meta.changes > 0;
}

export async function listMarked(env: Env, kind: "like" | "save", limit = 200): Promise<StoryRow[]> {
  const col = COLUMN[kind];
  const { results } = await env.DB.prepare(
    `SELECT s.* FROM marks m JOIN stories s ON s.url = m.url WHERE m.${col} IS NOT NULL ORDER BY m.${col} DESC LIMIT ?1`,
  )
    .bind(limit)
    .all<StoryRow>();
  return results;
}

// Full-text search over every edition. Each word matches as a prefix.
export async function search(env: Env, q: string, limit = 60): Promise<StoryRow[]> {
  const words = (q.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);
  if (!words.length) return [];
  const match = words.map((w) => `"${w}"*`).join(" ");
  const { results } = await env.DB.prepare(
    `SELECT s.* FROM stories_fts f JOIN stories s ON s.rowid = f.rowid WHERE stories_fts MATCH ?1 ORDER BY f.rank LIMIT ?2`,
  )
    .bind(match, limit)
    .all<StoryRow>();
  return results;
}

export async function storiesSince(env: Env, since: string): Promise<Pick<StoryRow, "title" | "topic" | "edition" | "url">[]> {
  const { results } = await env.DB.prepare(`SELECT title, topic, edition, url FROM stories WHERE edition >= ?1`)
    .bind(since)
    .all<Pick<StoryRow, "title" | "topic" | "edition" | "url">>();
  return results;
}

export async function readsByTopic(env: Env, sinceMs: number): Promise<{ topic: Topic; n: number }[]> {
  const { results } = await env.DB.prepare(
    `SELECT s.topic AS topic, COUNT(*) AS n FROM marks m JOIN stories s ON s.url = m.url
     WHERE m.read_at >= ?1 OR m.liked_at >= ?1 OR m.saved_at >= ?1 GROUP BY s.topic ORDER BY n DESC`,
  )
    .bind(sinceMs)
    .all<{ topic: Topic; n: number }>();
  return results;
}

export interface SignalStats {
  first: number | null; // ms of the earliest recorded mark
  reads: number;
  likes: number;
  saves: number;
  hides: number;
}

export async function signalStats(env: Env): Promise<SignalStats> {
  const r = await env.DB.prepare(
    `SELECT MIN(MIN(COALESCE(read_at, 9e15), COALESCE(liked_at, 9e15), COALESCE(saved_at, 9e15), COALESCE(hidden_at, 9e15))) AS first,
            COUNT(read_at) AS reads, COUNT(liked_at) AS likes, COUNT(saved_at) AS saves, COUNT(hidden_at) AS hides FROM marks`,
  ).first<{ first: number | null; reads: number; likes: number; saves: number; hides: number }>();
  const first = r?.first != null && r.first < 9e15 ? r.first : null;
  return { first, reads: r?.reads ?? 0, likes: r?.likes ?? 0, saves: r?.saves ?? 0, hides: r?.hides ?? 0 };
}

export async function marksForUrls(env: Env, urls: string[]): Promise<Map<string, Mark>> {
  const out = new Map<string, Mark>();
  for (let i = 0; i < urls.length; i += 90) {
    const part = urls.slice(i, i + 90);
    const { results } = await env.DB.prepare(
      `SELECT url, read_at, liked_at, saved_at, hidden_at FROM marks WHERE url IN (${part.map((_, j) => `?${j + 1}`).join(",")})`,
    )
      .bind(...part)
      .all<{ url: string; read_at: number | null; liked_at: number | null; saved_at: number | null; hidden_at: number | null }>();
    for (const r of results)
      out.set(r.url, { read: r.read_at != null, liked: r.liked_at != null, saved: r.saved_at != null, hidden: r.hidden_at != null });
  }
  return out;
}

// Housekeeping for the daily run: forget stories from editions older than
// `keepDays`, with their search rows, summaries and marks, and the old editions
// in KV. Liked and saved stories stay in D1 for good, so the Liked and Saved
// pages keep them (their edition page goes, though).
export async function pruneOld(env: Env, today: string, keepDays = 90): Promise<{ stories: number; editions: number }> {
  const cutoff = new Date(Date.parse(today) - keepDays * 86_400_000).toISOString().slice(0, 10);
  const cutoffMs = Date.parse(cutoff);
  const old = `SELECT rowid FROM stories WHERE edition < ?1
    AND url NOT IN (SELECT url FROM marks WHERE liked_at IS NOT NULL OR saved_at IS NOT NULL)`;
  const [, gone] = await env.DB.batch([
    // stories_fts is an external-content index, so its rows are removed with the
    // special 'delete' insert, using the values that were indexed.
    env.DB.prepare(
      `INSERT INTO stories_fts(stories_fts, rowid, title, summary) SELECT 'delete', rowid, title, summary FROM stories WHERE rowid IN (${old})`,
    ).bind(cutoff),
    env.DB.prepare(`DELETE FROM stories WHERE rowid IN (${old})`).bind(cutoff),
    env.DB.prepare(`DELETE FROM marks WHERE url NOT IN (SELECT url FROM stories)`),
    env.DB.prepare(`DELETE FROM summaries WHERE created_at < ?1 AND url NOT IN (SELECT url FROM stories)`).bind(cutoffMs),
  ]);

  // Old editions would otherwise stay browsable for 180 days and be indexed again on a visit.
  const dates = (await env.NEWS.get<string[]>("dates", "json")) ?? [];
  const drop = dates.filter((d) => d < cutoff);
  if (drop.length) {
    await env.NEWS.put("dates", JSON.stringify(dates.filter((d) => d >= cutoff)));
    for (const d of drop) await Promise.all([env.NEWS.delete(`edition:${d}`), env.NEWS.delete(`idx:${d}`)]);
  }
  return { stories: gone.meta.changes ?? 0, editions: drop.length };
}
