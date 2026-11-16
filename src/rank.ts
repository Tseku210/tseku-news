import { SOURCES, type Topic } from "./sources";
import type { Item } from "./parse";

// Deterministic story ranking, computed at render time so old editions get it too.
// Signals: source weight, position in its source (feeds and TLDR issues list the
// lead story first, HN is sorted by points), HN points, how many sources carried
// the same link, freshness, and whether there is a picture to show. Once the
// reader profile is learned (ai.ts), each story's 0-10 interest score moves it
// by up to ±3, enough to outweigh source weight and lead position.

const srcById = new Map(SOURCES.map((s) => [s.id, s]));

export interface Ranked extends Item {
  score: number;
  topic: Topic;
}

function points(it: Item): number {
  const m = /(\d+)\s+points/.exec(it.meta ?? "");
  return m ? Number(m[1]) : 0;
}

export function rank(items: Item[], now: number): Ranked[] {
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
      score += (it.also?.length ?? 0) * 1.2;
      if (it.date) {
        const ageH = (now - Date.parse(it.date)) / 3600_000;
        if (ageH > 36) score -= Math.min(1.5, (ageH - 36) / 48);
      }
      if (it.image) score += 0.4;
      if (it.interest != null) score += (it.interest - 5) * 0.6;
      return { ...it, score, topic: src?.topic ?? "tech" };
    })
    .sort((a, b) => b.score - a.score);
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
