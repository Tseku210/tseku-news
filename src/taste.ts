// Personal ranking: what the reader's likes, saves, opens and hides say about
// which stories to put higher. Used only on signed-in pages, so visitors keep
// the default order (rank.ts) and nobody else sees the reader's taste.
//
// Two parts:
//  1. Taste profile (live). For each source, topic and headline word: how much
//     more often than average the reader liked / saved / opened stories with it,
//     and how much more often they hid them. Rates, not counts, so a source that
//     fills the paper every day doesn't win just by volume; every story the
//     reader was shown counts as one exposure. Signals and exposures fade with a
//     30-day half-life, so recent taste counts most. Cached in KV and rebuilt
//     after any new mark.
//  2. Similarity (daily). Each story gets a Workers AI embedding; during the
//     daily run every story in the edition is compared with the stories the
//     reader liked or saved, and with the ones they hid. This catches related
//     stories that share no words ("Claude" vs. "Anthropic"). Stored in KV per
//     edition, so it updates once a day.

import type { Env, Edition } from "./index";
import type { Item } from "./parse";
import { SOURCES } from "./sources";
import { words } from "./trends";

const DAY_MS = 86_400_000;
const HALF_LIFE_DAYS = 30;
const POS = { read: 0.3, like: 1, save: 1.5 }; // a save is the strongest "more of this"
const NEG = 1.5; // a hide
const CAP = 2.5; // largest affinity for one source, topic or word
// Pseudo-signals at the average rate mixed into every estimate, so a handful of
// likes (or a source that was never liked yet) doesn't swing the order much.
const PRIOR = { src: 2, topic: 2, word: 1.5 };
const TASTE_KEY = "taste:v1";
const EMBED_MODEL = "@cf/baai/bge-m3"; // multilingual, so Mongolian headlines work too

const srcName = new Map(SOURCES.map((s) => [s.id, s.name]));
const decay = (ageMs: number) => Math.pow(0.5, Math.max(0, ageMs) / (HALF_LIFE_DAYS * DAY_MS));

export interface Taste {
  builtAt: number;
  signals: number; // decayed likes + saves + hides, plus opens at their weight
  src: Record<string, number>; // affinity: + likes it, − hides it (about −2.5…2.5)
  topic: Record<string, number>;
  words: Record<string, number>;
}

type Acc = { n: number; pos: number; neg: number };
const bump = (m: Map<string, Acc>, k: string, e: number, p: number, q: number) => {
  const a = m.get(k) ?? { n: 0, pos: 0, neg: 0 };
  a.n += e;
  a.pos += p;
  a.neg += q;
  m.set(k, a);
};

// Smoothed lift: log2 of this feature's like rate over the overall rate, minus
// the same for hides. Zero when there's no evidence either way. Being liked less
// often than average only costs a little (you can't read everything); being
// hidden more often than average costs a lot. Never being hidden earns nothing.
function affinity(a: Acc, prior: number, P: number, N: number): number {
  const up = P > 0 ? Math.max(-0.5, Math.log2((a.pos + prior) / (a.n + prior / P) / P)) : 0;
  const down = N > 0 ? Math.max(0, Math.log2((a.neg + prior) / (a.n + prior / N) / N)) : 0;
  return Math.max(-CAP, Math.min(CAP, up - down));
}

const round = (x: number) => Math.round(x * 100) / 100;

export async function buildTaste(env: Env, now: number): Promise<Taste> {
  const { results } = await env.DB.prepare(
    `SELECT s.title, s.source, s.topic, s.edition, m.read_at, m.liked_at, m.saved_at, m.hidden_at
     FROM stories s LEFT JOIN marks m ON m.url = s.url`,
  ).all<{
    title: string; source: string; topic: string; edition: string;
    read_at: number | null; liked_at: number | null; saved_at: number | null; hidden_at: number | null;
  }>();

  const src = new Map<string, Acc>();
  const topic = new Map<string, Acc>();
  const word = new Map<string, Acc>();
  let n = 0, pos = 0, neg = 0, signals = 0;
  for (const r of results) {
    const e = decay(now - Date.parse(`${r.edition}T00:00:00Z`));
    let p = 0;
    if (r.read_at != null) p += POS.read * decay(now - r.read_at);
    if (r.liked_at != null) p += POS.like * decay(now - r.liked_at);
    if (r.saved_at != null) p += POS.save * decay(now - r.saved_at);
    const q = r.hidden_at != null ? NEG * decay(now - r.hidden_at) : 0;
    n += e;
    pos += p;
    neg += q;
    signals += p + q;
    bump(src, r.source, e, p, q);
    bump(topic, r.topic, e, p, q);
    for (const w of words(r.title)) bump(word, w, e, p, q);
  }
  const P = n ? pos / n : 0;
  const N = n ? neg / n : 0;
  const out = (m: Map<string, Acc>, prior: number, minEvidence: number) => {
    const list: [string, number][] = [];
    for (const [k, a] of m) {
      if (a.pos + a.neg < minEvidence) continue;
      const v = affinity(a, prior, P, N);
      if (Math.abs(v) >= 0.15) list.push([k, round(v)]);
    }
    list.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    return Object.fromEntries(list.slice(0, 3000));
  };
  return { builtAt: now, signals: round(signals), src: out(src, PRIOR.src, 0), topic: out(topic, PRIOR.topic, 0), words: out(word, PRIOR.word, 1.5) };
}

// The profile, from KV when fresh. A new mark deletes it (forgetTaste), and it
// is rebuilt at least every 6 hours so exposures from a new edition count.
export async function getTaste(env: Env, now: number): Promise<Taste | null> {
  try {
    const cached = await env.NEWS.get<Taste>(TASTE_KEY, "json");
    if (cached && now - cached.builtAt < 6 * 3600_000) return cached;
    const t = await buildTaste(env, now);
    await env.NEWS.put(TASTE_KEY, JSON.stringify(t), { expirationTtl: 86_400 });
    return t;
  } catch (e) {
    console.error("taste failed", e);
    return null;
  }
}

export async function forgetTaste(env: Env): Promise<void> {
  await env.NEWS.delete(TASTE_KEY);
}

export interface Personal {
  boost: number; // added to the story's score in rank.ts
  why?: string; // short reason, shown on hover
}

// How much to move one story, and why. `fit` is its similarity score from the
// daily run (z-score across the edition), if there is one.
export function personalize(it: Item, topic: string, t: Taste, fit?: number): Personal {
  // Below ~20 signals the profile is mostly noise, so it only nudges.
  const conf = Math.min(1, t.signals / 20);
  const srcIds = [it.source, ...(it.also ?? [])];
  let s = 0;
  let sId = it.source;
  for (const id of srcIds) {
    const v = t.src[id] ?? 0;
    if (Math.abs(v) > Math.abs(s)) [s, sId] = [v, id];
  }
  const tp = t.topic[topic] ?? 0;
  const hits = [...words(it.title)]
    .map((w) => [w, t.words[w] ?? 0] as const)
    .filter(([, v]) => v)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 3);
  const w = hits.length ? hits.reduce((x, [, v]) => x + v, 0) / hits.length : 0;
  const f = fit ?? 0;

  const parts = { src: 0.8 * s * conf, topic: 0.4 * tp * conf, words: 0.7 * w * conf, fit: 0.6 * f };
  const boost = Math.max(-3, Math.min(3, parts.src + parts.topic + parts.words + parts.fit));

  // The reason is the biggest part pushing the same way as the total.
  const [k, v] = Object.entries(parts).sort((a, b) => b[1] * Math.sign(boost) - a[1] * Math.sign(boost))[0];
  let why: string | undefined;
  if (Math.abs(boost) >= 0.4 && Math.sign(v) === Math.sign(boost)) {
    const up = boost > 0;
    const name = srcName.get(sId) ?? sId;
    const kw = hits.filter(([, x]) => Math.sign(x) === Math.sign(boost)).map(([x]) => x).slice(0, 2).join(", ");
    why =
      k === "src" ? (up ? `Moved up: you often like ${name}` : `Moved down: ${name} rarely interests you`)
      : k === "topic" ? (up ? "Moved up: a topic you read a lot" : "Moved down: a topic that rarely interests you")
      : k === "words" ? (up ? `Moved up: about ${kw}` : `Moved down: about ${kw}, which rarely interests you`)
      : up ? "Moved up: like stories you liked" : "Moved down: like stories you hid";
  }
  return { boost: round(boost), why };
}

// ── Similarity (daily run) ──────────────────────────────────────────────────

const textOf = (title: string, about?: string | null) => `${title}. ${about ?? ""}`.slice(0, 600);

async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const res = (await env.AI!.run(EMBED_MODEL as keyof AiModels, { text: texts } as never)) as { data?: number[][] };
  if (!Array.isArray(res?.data) || res.data.length !== texts.length) throw new Error("bad embedding reply");
  return res.data;
}

async function haveVectors(env: Env, urls: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < urls.length; i += 90) {
    const part = urls.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT url FROM vectors WHERE url IN (${part.map((_, j) => `?${j + 1}`).join(",")})`)
      .bind(...part)
      .all<{ url: string }>();
    for (const r of results) out.add(r.url);
  }
  return out;
}

async function storeVectors(env: Env, list: { url: string; text: string }[], now: number): Promise<void> {
  const stmt = env.DB.prepare("INSERT OR REPLACE INTO vectors (url, vec, model, created_at) VALUES (?1, ?2, ?3, ?4)");
  for (let i = 0; i < list.length; i += 20) {
    const part = list.slice(i, i + 20);
    const vecs = await embed(env, part.map((x) => x.text));
    await env.DB.batch(part.map((x, j) => stmt.bind(x.url, new Float32Array(vecs[j]).buffer, EMBED_MODEL, now)));
  }
}

// Embed the edition's stories, and any marked story from before this existed.
export async function addVectors(env: Env, ed: Edition, now: number): Promise<void> {
  if (!env.AI) return;
  const have = await haveVectors(env, ed.items.map((i) => i.url));
  const todo = ed.items.filter((i) => !have.has(i.url)).map((i) => ({ url: i.url, text: textOf(i.title, i.brief ?? i.summary) }));
  const { results: old } = await env.DB.prepare(
    `SELECT s.url, s.title, s.summary FROM marks m JOIN stories s ON s.url = m.url
     WHERE (m.liked_at IS NOT NULL OR m.saved_at IS NOT NULL OR m.hidden_at IS NOT NULL)
       AND s.url NOT IN (SELECT url FROM vectors) LIMIT 300`,
  ).all<{ url: string; title: string; summary: string | null }>();
  const seen = new Set(todo.map((x) => x.url));
  for (const r of old) if (!seen.has(r.url)) todo.push({ url: r.url, text: textOf(r.title, r.summary) });
  if (todo.length) await storeVectors(env, todo, now);
  // Vectors of stories that were pruned from D1.
  await env.DB.prepare("DELETE FROM vectors WHERE url NOT IN (SELECT url FROM stories)").run();
}

const toVec = (b: ArrayBuffer) => new Float32Array(b);
function cos(a: Float32Array, b: Float32Array): number {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    x += a[i] * a[i];
    y += b[i] * b[i];
  }
  return d / (Math.sqrt(x * y) || 1);
}

// Mean of the k largest values.
function topMean(xs: number[], k = 3): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => b - a).slice(0, k);
  return s.reduce((a, b) => a + b, 0) / s.length;
}

const fitKey = (date: string) => `fit:${date}`;

const coverKey = (date: string) => `cover:${date}`;
// Cosine similarity above which two headlines are taken to be the same story.
const SAME_STORY = 0.8;
const NOT_NEWS = new Set(SOURCES.filter((s) => s.topic === "posts" || s.topic === "repos").map((s) => s.id));

// Two scores for every story in the edition, from its embedding:
//  - cover: other sources that ran the same story under a different link (for
//    everyone: several sources covering something means it matters);
//  - fit: how close it is to the stories the reader liked or saved (its nearest
//    few) minus how close it is to the ones they hid. Saved as z-scores per URL,
//    so the scale doesn't depend on the model.
export async function computeFit(env: Env, ed: Edition, now: number): Promise<number> {
  const urls = [...new Set(ed.items.map((i) => i.url))];
  const vecs = new Map<string, Float32Array>();
  for (let i = 0; i < urls.length; i += 90) {
    const part = urls.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT url, vec FROM vectors WHERE url IN (${part.map((_, j) => `?${j + 1}`).join(",")})`)
      .bind(...part)
      .all<{ url: string; vec: ArrayBuffer }>();
    for (const r of results) vecs.set(r.url, toVec(r.vec));
  }

  const news = ed.items.filter((i) => !NOT_NEWS.has(i.source) && vecs.has(i.url));
  const cover: Record<string, string[]> = {};
  for (let i = 0; i < news.length; i++)
    for (let j = i + 1; j < news.length; j++) {
      const a = news[i], b = news[j];
      if (a.source === b.source || a.url === b.url) continue;
      if (cos(vecs.get(a.url)!, vecs.get(b.url)!) < SAME_STORY) continue;
      (cover[a.url] ??= []).includes(b.source) || cover[a.url].push(b.source);
      (cover[b.url] ??= []).includes(a.source) || cover[b.url].push(a.source);
    }
  await env.NEWS.put(coverKey(ed.date), JSON.stringify(cover), { expirationTtl: 100 * 86_400 });

  const { results: marked } = await env.DB.prepare(
    `SELECT v.url, v.vec, m.liked_at, m.saved_at, m.hidden_at FROM marks m JOIN vectors v ON v.url = m.url
     WHERE m.liked_at IS NOT NULL OR m.saved_at IS NOT NULL OR m.hidden_at IS NOT NULL`,
  ).all<{ url: string; vec: ArrayBuffer; liked_at: number | null; saved_at: number | null; hidden_at: number | null }>();
  const likes: { url: string; v: Float32Array; w: number }[] = [];
  const hides: { url: string; v: Float32Array; w: number }[] = [];
  for (const r of marked) {
    const p = Math.max(r.liked_at != null ? decay(now - r.liked_at) : 0, r.saved_at != null ? decay(now - r.saved_at) : 0);
    if (p > 0) likes.push({ url: r.url, v: toVec(r.vec), w: 0.5 + 0.5 * p });
    if (r.hidden_at != null) hides.push({ url: r.url, v: toVec(r.vec), w: 0.5 + 0.5 * decay(now - r.hidden_at) });
  }
  if (likes.length < 3) return 0;

  const raw = new Map<string, number>();
  for (const [url, v] of vecs) {
    // A story is never compared with itself.
    const up = topMean(likes.filter((x) => x.url !== url).map((x) => cos(v, x.v) * x.w));
    const down = topMean(hides.filter((x) => x.url !== url).map((x) => cos(v, x.v) * x.w));
    raw.set(url, up - 0.8 * down);
  }
  if (raw.size < 5) return 0;
  const vals = [...raw.values()];
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
  const fit: Record<string, number> = {};
  for (const [u, x] of raw) fit[u] = round(Math.max(-2, Math.min(2, (x - mean) / sd)));
  await env.NEWS.put(fitKey(ed.date), JSON.stringify(fit), { expirationTtl: 100 * 86_400 });
  return raw.size;
}

export async function getCover(env: Env, date: string): Promise<Record<string, string[]>> {
  try {
    return (await env.NEWS.get<Record<string, string[]>>(coverKey(date), "json")) ?? {};
  } catch {
    return {};
  }
}

export async function getFit(env: Env, date: string): Promise<Record<string, number>> {
  try {
    return (await env.NEWS.get<Record<string, number>>(fitKey(date), "json")) ?? {};
  } catch {
    return {};
  }
}

// For the Saved page: what the profile has learned, strongest first.
export function tasteSummary(t: Taste): { likes: string[]; hides: string[]; words: string[]; signals: number } {
  const top = (r: Record<string, number>, sign: 1 | -1, k: number) =>
    Object.entries(r).filter(([, v]) => v * sign >= 0.4).sort((a, b) => (b[1] - a[1]) * sign).slice(0, k).map(([x]) => x);
  return {
    likes: top(t.src, 1, 6).map((id) => srcName.get(id) ?? id),
    hides: top(t.src, -1, 4).map((id) => srcName.get(id) ?? id),
    words: top(t.words, 1, 12),
    signals: t.signals,
  };
}
