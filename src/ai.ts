// Claude Haiku, once a day after the edition is assembled:
//  1. "Today in short": a neutral two-sentence brief per topic.
//  2. Personalized ranking, once there is enough signal: learn an interest profile
//     from the reader's reads, likes, saves and hides, then score every story 0-10
//     against it. rank.ts mixes the score into the usual ranking.
// Needs the ANTHROPIC_API_KEY secret. Without it, or on any error, the edition is
// published as before.

import Anthropic from "@anthropic-ai/sdk";
import type { Env, Edition } from "./index";
import { SOURCES, TOPICS, type Topic } from "./sources";
import { rank } from "./rank";
import { recentSignals, signalStats, type SignalStats } from "./db";

const MODEL = "claude-haiku-5-5";
const DAY_MS = 86_400_000;

// Switch to personalized ranking after this much history.
export const LEARN_DAYS = 7;
export const LEARN_MIN_SIGNALS = 25; // reads + likes + saves

const srcName = new Map(SOURCES.map((s) => [s.id, s.name]));

export interface Profile {
  updated: string; // YYYY-MM-DD
  summary: string;
  likes: string[];
  dislikes: string[];
  signals: number;
}

export function readiness(s: SignalStats, now: number): { ready: boolean; days: number; positives: number } {
  const days = s.first ? Math.floor((now - s.first) / DAY_MS) : 0;
  const positives = s.reads + s.likes + s.saves;
  return { ready: days >= LEARN_DAYS && positives >= LEARN_MIN_SIGNALS, days, positives };
}

async function askJson<T>(client: Anthropic, system: string, user: string, schema: Record<string, unknown>, maxTokens = 8000): Promise<T> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: user }],
  });
  if (res.stop_reason === "refusal") throw new Error("model declined");
  if (res.stop_reason === "max_tokens") throw new Error("output cut off");
  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("no text in response");
  return JSON.parse(text.text) as T;
}

const clip = (s: string | undefined, n: number) => (s && s.length > n ? s.slice(0, n) + "…" : s ?? "");

async function writeBriefs(client: Anthropic, ed: Edition, now: number): Promise<Partial<Record<Topic, string>>> {
  const ranked = rank(ed.items, now);
  const blocks = TOPICS.map((t) => {
    const list = ranked.filter((i) => i.topic === t.id).slice(0, 12);
    if (!list.length) return "";
    return `## ${t.id} (${t.label})\n` + list.map((i) => `- ${i.title}${i.summary ? ` — ${clip(i.summary, 200)}` : ""}`).join("\n");
  }).filter(Boolean);
  if (!blocks.length) return {};
  const out = await askJson<{ briefs: { topic: Topic; text: string }[] }>(
    client,
    "You write the 'today in short' line for each section of a daily tech news page. For every topic given, write at most two plain sentences (under 45 words) on the most important things in that topic's stories. Be neutral and specific: name the companies, products and numbers. No hype, no opinions, no lead-ins like 'Today' or 'In AI news'. Write in English even when the stories are in Mongolian.",
    blocks.join("\n\n"),
    {
      type: "object",
      properties: {
        briefs: {
          type: "array",
          items: {
            type: "object",
            properties: { topic: { type: "string", enum: TOPICS.map((t) => t.id) }, text: { type: "string" } },
            required: ["topic", "text"],
            additionalProperties: false,
          },
        },
      },
      required: ["briefs"],
      additionalProperties: false,
    },
  );
  const briefs: Partial<Record<Topic, string>> = {};
  for (const b of out.briefs ?? []) if (b.text?.trim()) briefs[b.topic] = b.text.trim();
  return briefs;
}

// Learn what the reader likes from the last 45 days of actions.
async function learnProfile(client: Anthropic, env: Env, now: number, date: string): Promise<Profile | null> {
  const sig = await recentSignals(env, now - 45 * DAY_MS);
  const line = (s: (typeof sig)[number]) => `- [${s.topic} · ${srcName.get(s.source) ?? s.source}] ${s.title}`;
  const group = (label: string, list: typeof sig) => (list.length ? `## ${label}\n${list.slice(0, 120).map(line).join("\n")}` : "");
  const liked = sig.filter((s) => s.liked || s.saved);
  const read = sig.filter((s) => s.read && !s.liked && !s.saved && !s.hidden);
  const hidden = sig.filter((s) => s.hidden);
  if (liked.length + read.length < LEARN_MIN_SIGNALS) return null;
  const out = await askJson<{ summary: string; likes: string[]; dislikes: string[] }>(
    client,
    "You study one person's news reading and describe what they care about, so their daily news page can be ranked for them. Liked or saved stories are the strongest signal, opened stories a weaker one, hidden stories mean 'not interested'. Look for specific subjects, companies, technologies, kinds of story (launches, research, opinion, business news) and sources, not just broad topics. summary: under 90 words, second person. likes and dislikes: short specific phrases, at most 12 each.",
    [group("Liked or saved", liked), group("Opened", read), group("Hidden", hidden)].filter(Boolean).join("\n\n"),
    {
      type: "object",
      properties: {
        summary: { type: "string" },
        likes: { type: "array", items: { type: "string" } },
        dislikes: { type: "array", items: { type: "string" } },
      },
      required: ["summary", "likes", "dislikes"],
      additionalProperties: false,
    },
  );
  return {
    updated: date,
    summary: out.summary,
    likes: (out.likes ?? []).slice(0, 12),
    dislikes: (out.dislikes ?? []).slice(0, 12),
    signals: sig.length,
  };
}

async function scoreStories(client: Anthropic, ed: Edition, profile: Profile): Promise<Map<number, number>> {
  const list = ed.items
    .map((it, i) => `${i}. [${srcName.get(it.source) ?? it.source}] ${it.title}${it.summary ? ` — ${clip(it.summary, 160)}` : ""}`)
    .join("\n");
  const out = await askJson<{ scores: { i: number; s: number }[] }>(
    client,
    `You rank a daily news page for one reader. What they like:\n${profile.summary}\nInterested in: ${profile.likes.join("; ")}\nNot interested in: ${profile.dislikes.join("; ") || "nothing noted"}\n\nScore every story from 0 (they would skip it) to 10 (they would open it first). Use the whole range. Return one entry per story number.`,
    list,
    {
      type: "object",
      properties: {
        scores: {
          type: "array",
          items: {
            type: "object",
            properties: { i: { type: "integer" }, s: { type: "integer" } },
            required: ["i", "s"],
            additionalProperties: false,
          },
        },
      },
      required: ["scores"],
      additionalProperties: false,
    },
    16000,
  );
  const scores = new Map<number, number>();
  for (const { i, s } of out.scores ?? []) if (Number.isInteger(i) && i >= 0 && i < ed.items.length) scores.set(i, Math.max(0, Math.min(10, s)));
  return scores;
}

// Add briefs and (when ready) interest scores to an edition, in place.
// Returns a short status line for the page footer.
export async function enrich(env: Env, ed: Edition, now: number): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) return "off (no ANTHROPIC_API_KEY)";
  if (!ed.items.length) return "nothing to rank";
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 3 });
  const status: string[] = [];

  let profile: Profile | null = null;
  const { ready } = readiness(await signalStats(env), now);
  if (ready) {
    try {
      profile = await learnProfile(client, env, now, ed.date);
      if (profile) await env.NEWS.put("profile", JSON.stringify(profile));
    } catch (e) {
      status.push(`profile failed: ${(e as Error).message}`);
      profile = (await env.NEWS.get<Profile>("profile", "json")) ?? null;
    }
  }

  if (profile) {
    try {
      const scores = await scoreStories(client, ed, profile);
      ed.items.forEach((it, i) => {
        const s = scores.get(i);
        if (s != null) it.interest = s;
      });
      ed.personalized = scores.size > 0;
      status.push(`personalized ${scores.size}/${ed.items.length}`);
    } catch (e) {
      status.push(`scoring failed: ${(e as Error).message}`);
    }
  } else {
    status.push("default ranking (still learning)");
  }

  try {
    ed.brief = await writeBriefs(client, ed, now);
    status.push(`${Object.keys(ed.brief).length} briefs`);
  } catch (e) {
    status.push(`briefs failed: ${(e as Error).message}`);
  }
  return status.join(", ");
}
