// Short AI summaries for the cards, made with Workers AI during the daily run.
// Each summary is cached in D1 (table `summaries`) by URL, so a story is summarised
// once even when it shows up again or the run is repeated. If the model fails or
// the AI binding is missing, the card keeps the feed's excerpt.

import type { Env } from "./index";
import type { Item } from "./parse";
import { SOURCES } from "./sources";

// Non-reasoning, multilingual, cheap: ~150 stories a day is roughly 4k neurons,
// inside the Workers Paid daily allowance.
export const MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
const MAX_PER_RUN = 200;
const CONCURRENCY = 4;
const MAX_CHARS = 260;

const srcName = new Map(SOURCES.map((s) => [s.id, s.name]));
const noBrief = new Set(SOURCES.filter((s) => s.kind === "social" || s.kind === "github").map((s) => s.id));

const SYSTEM =
  "You write the summary line under a headline on a personal news page. " +
  "Summarise the story in one or two short sentences (at most 35 words): what happened and why it matters. " +
  "Use only facts from the text given. Write in the same language as the article. " +
  "No preamble, no quotes around it, no hashtags, and don't repeat the headline word for word. " +
  "If the text is too thin to say more than the headline, reply with just: SKIP";

// Cached summaries for these URLs.
export async function cachedBriefs(env: Env, urls: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const list = [...new Set(urls)];
  for (let i = 0; i < list.length; i += 50) {
    const part = list.slice(i, i + 50);
    const { results } = await env.DB.prepare(
      `SELECT url, text FROM summaries WHERE url IN (${part.map((_, j) => `?${j + 1}`).join(",")})`,
    )
      .bind(...part)
      .all<{ url: string; text: string }>();
    for (const r of results) out.set(r.url, r.text);
  }
  return out;
}

// Give every item without a brief one, from the cache or the model. `pageText`
// holds article text read during the run (by URL). Returns how many items changed.
export async function addBriefs(env: Env, items: Item[], pageText: Map<string, string>, now: number): Promise<number> {
  // Posts and trending repos are shown as written; they need no summary.
  const todo = items.filter((i) => !i.brief && !noBrief.has(i.source));
  if (!todo.length) return 0;
  let changed = 0;
  let cache: Map<string, string>;
  try {
    cache = await cachedBriefs(env, todo.map((i) => i.url));
  } catch (e) {
    console.error("summary cache read failed", e);
    return 0;
  }
  const missing: Item[] = [];
  for (const it of todo) {
    const hit = cache.get(it.url);
    if (hit) {
      it.brief = hit;
      changed++;
    } else if (!missing.some((m) => m.url === it.url)) missing.push(it);
  }
  if (!env.AI) return changed;

  const queue = missing.slice(0, MAX_PER_RUN);
  const made = new Map<string, string>();
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < queue.length) {
        const it = queue[next++];
        try {
          const text = await summarize(env, it, pageText.get(it.url));
          if (text) made.set(it.url, text);
        } catch (e) {
          console.warn("summary failed", it.url, String((e as Error)?.message ?? e).slice(0, 120));
        }
      }
    }),
  );
  if (!made.size) return changed;

  for (const it of todo) {
    const b = made.get(it.url);
    if (b && !it.brief) {
      it.brief = b;
      changed++;
    }
  }
  try {
    const stmt = env.DB.prepare("INSERT OR REPLACE INTO summaries (url, text, model, created_at) VALUES (?1, ?2, ?3, ?4)");
    const rows = [...made].map(([url, text]) => stmt.bind(url, text, MODEL, now));
    for (let i = 0; i < rows.length; i += 50) await env.DB.batch(rows.slice(i, i + 50));
  } catch (e) {
    console.error("summary cache write failed", e);
  }
  return changed;
}

async function summarize(env: Env, it: Item, page?: string): Promise<string | undefined> {
  const parts = [`Headline: ${it.title}`, `Source: ${srcName.get(it.source) ?? it.source}`];
  if (it.summary) parts.push(`Feed excerpt: ${it.summary}`);
  if (page) parts.push(`Article text (start):\n${page}`);
  // Without any text beyond the headline the model would only invent things.
  if (!it.summary && !page) return undefined;

  const res = (await env.AI!.run(MODEL as keyof AiModels, {
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: parts.join("\n\n") },
    ],
    max_tokens: 120,
    temperature: 0.2,
  } as never)) as unknown;
  return tidy(outputText(res), it.title);
}

function outputText(res: unknown): string {
  if (typeof res === "string") return res;
  const r = res as { response?: unknown; choices?: { message?: { content?: unknown } }[] } | null;
  if (typeof r?.response === "string") return r.response;
  const c = r?.choices?.[0]?.message?.content;
  return typeof c === "string" ? c : "";
}

// Clean the model's reply, or drop it when it isn't a usable summary.
export function tidy(raw: string, title: string): string | undefined {
  let s = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^\s*(summary|tl;?dr)\s*[:\-–—]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["“'«]+|["”'»]+$/g, "")
    .trim();
  if (!s || /^SKIP\b/i.test(s) || s.length < 25) return undefined;
  if (s.toLowerCase() === title.toLowerCase()) return undefined;
  if (s.length > MAX_CHARS) {
    // Cut at the last sentence end that fits, else at a word.
    const cut = s.slice(0, MAX_CHARS);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    s = end > 80 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…";
  }
  return s;
}
