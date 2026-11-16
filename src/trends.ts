// Topic trends from the D1 story archive: stories per topic per day, and the
// words that show up in more headlines this week than in the three weeks before.

import type { Env } from "./index";
import { TOPICS, type Topic } from "./sources";
import { storiesSince } from "./db";

const STOP = new Set(
  `the and for with that this from your you are was were has have had not but its it's into over about after before more than what when where which who why how new now out all can will just get got one two our their them they his her him she he use using used via per off amid says said say make makes made why yes also may might could would should here there then very much many most some any each only own same such too own week day year years today first last next back still even like vs inc ltd co www com http https
the a an to of in on at by is be as or if do does did so up no we us my me i
show ask tell launch launches launched hn pdf video guide how-to ships ship shipped raises raised adds added release released releases
introducing introduces announces announced unveils lets gets big small best better top way ways things need want why`.split(/\s+/),
);

function words(title: string): Set<string> {
  const out = new Set<string>();
  for (const m of title.toLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}.+#-]*[\p{L}\p{N}+#]|[\p{L}]{3,}/gu)) {
    const w = m[0];
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
    out.add(w);
  }
  return out;
}

export interface Trends {
  days: string[]; // oldest first
  perTopic: { topic: Topic; label: string; counts: number[]; total: number }[];
  terms: { term: string; week: number; before: number }[];
  rising: boolean; // false while there isn't three weeks of history yet
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export async function computeTrends(env: Env, today: string): Promise<Trends> {
  const end = Date.parse(`${today}T00:00:00Z`);
  const since = iso(end - 27 * 86_400_000);
  const weekStart = iso(end - 6 * 86_400_000);
  const rows = await storiesSince(env, since);

  const days = Array.from({ length: 14 }, (_, i) => iso(end - (13 - i) * 86_400_000));
  const dayIdx = new Map(days.map((d, i) => [d, i]));
  const perTopic = TOPICS.map((t) => ({ topic: t.id, label: t.label, counts: days.map(() => 0), total: 0 }));
  const byTopic = new Map(perTopic.map((p) => [p.topic, p]));

  const week = new Map<string, number>();
  const before = new Map<string, number>();
  const olderDays = new Set<string>();
  for (const r of rows) {
    const p = byTopic.get(r.topic);
    const i = dayIdx.get(r.edition);
    if (p && i != null) {
      p.counts[i]++;
      p.total++;
    }
    const bucket = r.edition >= weekStart ? week : before;
    if (bucket === before) olderDays.add(r.edition);
    for (const w of words(r.title)) bucket.set(w, (bucket.get(w) ?? 0) + 1);
  }

  const rising = olderDays.size >= 7;
  const terms = [...week]
    .filter(([, n]) => n >= 2)
    .map(([term, n]) => {
      const b = before.get(term) ?? 0;
      // Mentions this week against the average week before; plain counts until there is history.
      const lift = rising ? (n - b / 3) / Math.sqrt(b / 3 + 1) : n;
      return { term, week: n, before: b, lift };
    })
    .filter((t) => !rising || t.lift > 0.5)
    .sort((a, b) => b.lift - a.lift || b.week - a.week)
    .slice(0, 18)
    .map(({ term, week, before }) => ({ term, week, before }));

  return { days, perTopic, terms, rising };
}
