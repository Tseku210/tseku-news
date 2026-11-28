import { SOURCES, type Topic } from "./sources";
import type { Item } from "./parse";
import { words } from "./trends";

// Deterministic story ranking, computed at render time so old editions get it too.
// Signals: source weight, position in its source (feeds and TLDR issues list the
// lead story first, HN is sorted by points), HN points, how many sources carried
// the same link, freshness, and whether there is a picture to show.

const srcById = new Map(SOURCES.map((s) => [s.id, s]));

export interface Ranked extends Item {
  score: number;
  topic: Topic;
  why?: string; // signed in: why the reader's taste moved it (see taste.ts)
  related?: string[]; // other sources that covered the same story under another link
}

// Signed in only: the reader's own adjustment for a story (taste.ts).
export type Personalize = (it: Item, topic: Topic) => { boost: number; why?: string };

function points(it: Item): number {
  const m = /(\d+)\s+points/.exec(it.meta ?? "");
  return m ? Number(m[1]) : 0;
}

// Same story, different links: other sources (ids) whose headline is about the
// same thing. From embeddings in the daily run (taste.ts, `cover`), and from
// headline words as a fallback, so older editions get it too. The stories stay
// separate on the page; this only says that more than one source found it worth covering.
export function coverage(items: Item[], fromVectors: Record<string, string[]> = {}): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  const add = (url: string, src: string) => {
    const set = out.get(url) ?? new Set<string>();
    set.add(src);
    out.set(url, set);
  };
  for (const [url, srcs] of Object.entries(fromVectors)) for (const s of srcs) add(url, s);
  const news = items.filter((it) => !NOT_NEWS.has(srcById.get(it.source)?.topic ?? "tech"));
  const bags = news.map((it) => words(it.title));
  for (let i = 0; i < news.length; i++)
    for (let j = i + 1; j < news.length; j++) {
      const a = news[i], b = news[j];
      if (a.source === b.source || a.url === b.url) continue;
      let shared = 0;
      for (const w of bags[i]) if (bags[j].has(w)) shared++;
      // At least three shared words, and half of the shorter headline's words.
      if (shared >= 3 && shared >= 0.5 * Math.min(bags[i].size, bags[j].size)) {
        add(a.url, b.source);
        add(b.url, a.source);
      }
    }
  const res = new Map<string, string[]>();
  for (const [url, set] of out) {
    const it = items.find((x) => x.url === url);
    const own = new Set([it?.source, ...(it?.also ?? [])]);
    const list = [...set].filter((s) => !own.has(s));
    if (list.length) res.set(url, list);
  }
  return res;
}

// Posts from people and trending repos are their own sections, not news.
const NOT_NEWS = new Set<string>(["posts", "repos"]);

export function rank(items: Item[], now: number, personal?: Personalize, covered = new Map<string, string[]>()): Ranked[] {
  const pos = new Map<string, number>();
  return items
    .map((it) => {
      const src = srcById.get(it.source);
      const p = pos.get(it.source) ?? 0;
      pos.set(it.source, p + 1);
      let score = src?.weight ?? 1;
      score += Math.max(0, 1.2 - p * 0.15); // lead stories of each source
      const pts = points(it);
      if (pts) score += Math.log2(1 + pts / 100); // 100 pts +1, 300 pts +2, 700 pts +3
      // Carried by several sources (same link, or the same story under another link): important.
      const related = covered.get(it.url) ?? [];
      score += Math.min(3.6, ((it.also?.length ?? 0) + related.length) * 1.2);
      if (it.date) {
        const ageH = (now - Date.parse(it.date)) / 3600_000;
        if (ageH > 36) score -= Math.min(1.5, (ageH - 36) / 48);
      }
      if (it.image) score += 0.4;
      const topic = src?.topic ?? "tech";
      const mine = personal?.(it, topic);
      if (mine) score += mine.boost;
      return { ...it, score, topic, why: mine?.why, related: related.length ? related : undefined };
    })
    .sort((a, b) => b.score - a.score);
}

// Stories under this score are filler and left off the page (the reader's hides
// push stories they don't care about under it). Kept anyway: anything several
// sources carried, and the best few of each section so none goes empty (unless
// they score under FLOOR).
export const MIN_SCORE = 1.6;
const KEEP_PER_TOPIC = 3;
const FLOOR = 0.8; // even to fill a section, nothing below this (mostly stories like ones the reader hides)

export function important(ranked: Ranked[]): { kept: Ranked[]; dropped: number } {
  const perTopic = new Map<string, number>();
  const kept: Ranked[] = [];
  for (const it of ranked) {
    const n = perTopic.get(it.topic) ?? 0;
    const many = (it.also?.length ?? 0) + (it.related?.length ?? 0) > 0;
    if (NOT_NEWS.has(it.topic) || it.score >= MIN_SCORE || many || (n < KEEP_PER_TOPIC && it.score >= FLOOR)) {
      kept.push(it);
      perTopic.set(it.topic, n + 1);
    }
  }
  return { kept, dropped: ranked.length - kept.length };
}

// Pick the day's top stories with some variety: at most two per source and
// three per topic. The lead story gets the big tile, so prefer one with a picture.
export function topPicks(ranked: Ranked[], n = 7): Ranked[] {
  const out: Ranked[] = [];
  const perSrc = new Map<string, number>();
  const perTopic = new Map<string, number>();
  for (const it of ranked) {
    if (out.length >= n) break;
    if ((perSrc.get(it.source) ?? 0) >= 2 || (perTopic.get(it.topic) ?? 0) >= 3) continue;
    out.push(it);
    perSrc.set(it.source, (perSrc.get(it.source) ?? 0) + 1);
    perTopic.set(it.topic, (perTopic.get(it.topic) ?? 0) + 1);
  }
  const lead = out.slice(0, 3).findIndex((it) => it.image);
  if (lead > 0) out.unshift(...out.splice(lead, 1));
  return out;
}
