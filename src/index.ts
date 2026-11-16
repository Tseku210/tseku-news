import { SOURCES, type Source } from "./sources";
import { metaImage, parseFeed, parseHn, parseLinks, parseTldrIssue, type Item } from "./parse";
import { renderArchive, renderBuilding, renderEdition, renderFeed, renderNotFound } from "./render";

export interface Env {
  NEWS: KVNamespace;
}

export interface Edition {
  date: string; // YYYY-MM-DD, Ulaanbaatar time
  generatedAt: string; // ISO
  items: Item[];
  report: Record<string, string>; // source id -> "12 new" | "error: …"
}

const UA = "news.tseku.dev/1.0 (personal news digest; +https://news.tseku.dev)";
const MAX_AGE_DAYS = 4;
const DAY = 86_400;

// Ulaanbaatar is UTC+8 with no daylight saving.
export function ubDate(ms: number): string {
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
}

async function get(url: string, accept: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept },
    signal: AbortSignal.timeout(15_000),
    cf: { cacheTtl: 600 },
  } as RequestInit);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return text.length > 1_500_000 ? text.slice(0, 1_500_000) : text;
}

async function collectSource(src: Source, seen: Set<string>, now: number): Promise<Item[]> {
  let items: Item[] = [];
  switch (src.kind) {
    case "rss":
      items = parseFeed(await get(src.url, "application/rss+xml, application/atom+xml, application/xml, text/xml"), src.id, 25);
      break;
    case "hn":
      items = parseHn(await get(src.url, "application/json"), src.id, 100);
      break;
    case "tldr": {
      // The feed lists one entry per daily issue. Open the newest issue we haven't used.
      const issues = parseFeed(await get(src.url, "application/rss+xml, application/xml"), src.id, 5);
      const issue = issues[0];
      if (!issue || seen.has(issue.url)) return [];
      if (issue.date && now - Date.parse(issue.date) > MAX_AGE_DAYS * DAY * 1000) return [];
      const stories = parseTldrIssue(await get(issue.url, "text/html"), src.id, issue.date);
      // Mark the issue itself as used, and fall back to linking the issue when the page
      // layout changed and no stories could be read.
      items = stories.length ? stories : [{ ...issue, summary: undefined, meta: "full issue" }];
      items.push({ ...issue, title: "__issue__" });
      break;
    }
    case "launchpad":
      items = parseLinks(await get(src.url, "text/html"), src.url, src.id, /^\/products\/[a-z0-9-]+$/i, "first");
      items.forEach((i) => (i.meta = "launch"));
      break;
    case "ikon":
      items = parseLinks(await get(src.url, "text/html"), src.url, src.id, /^\/n\/[a-z0-9]+$/i, "longest", 20);
      break;
  }
  const cutoff = now - MAX_AGE_DAYS * DAY * 1000;
  const fresh = items.filter((i) => !seen.has(i.url) && (!i.date || Date.parse(i.date) >= cutoff));
  const marker = fresh.filter((i) => i.title === "__issue__");
  return fresh.filter((i) => i.title !== "__issue__").slice(0, src.max).concat(marker);
}

// Read just the <head> of an article and take its og:image. Stops after ~150 KB.
async function pageImage(url: string): Promise<string | undefined> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html" },
    signal: AbortSignal.timeout(8_000),
    cf: { cacheTtl: 3600 },
  } as RequestInit);
  if (!res.ok || !res.body || !/html/i.test(res.headers.get("content-type") ?? "")) {
    await res.body?.cancel();
    return undefined;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let html = "";
  try {
    while (html.length < 150_000) {
      const { value, done } = await reader.read();
      if (done) break;
      html += value;
      if (/<\/head>|<body\b/i.test(html.slice(-value.length - 8))) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return metaImage(html, res.url || url);
}

// Give stories without a feed image their page's og:image, a few at a time.
async function addImages(items: Item[], limit = 150, concurrency = 10): Promise<void> {
  const todo = items.filter((i) => !i.image && !/news\.ycombinator\.com/.test(i.url)).slice(0, limit);
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < todo.length) {
        const it = todo[next++];
        try {
          it.image = await pageImage(it.url);
        } catch {
          // No picture is fine; the card shows a coloured tile instead.
        }
      }
    }),
  );
}

async function readJson<T>(env: Env, key: string, fallback: T): Promise<T> {
  const v = await env.NEWS.get(key, "json");
  return (v as T) ?? fallback;
}

type Collected = { items: Item[]; error?: string };

// The daily run: fetch every source in parallel, then merge into the day's edition.
export async function runDaily(env: Env, date: string, now: number): Promise<Edition> {
  const seen = new Set(await readJson<string[]>(env, "seen", []));
  const results = await Promise.all(
    SOURCES.map(async (src): Promise<[string, Collected]> => {
      try {
        return [src.id, { items: await collectSource(src, seen, now) }];
      } catch (e) {
        return [src.id, { items: [], error: String((e as Error)?.message ?? e).slice(0, 120) }];
      }
    }),
  );
  const fresh = new Map<string, Item>();
  for (const [, got] of results) for (const it of got.items) if (it.title !== "__issue__" && !fresh.has(it.url)) fresh.set(it.url, it);
  await addImages([...fresh.values()]);
  // The same link can come from several sources; copy the picture to every copy.
  for (const [, got] of results) for (const it of got.items) it.image ??= fresh.get(it.url)?.image;
  return assemble(env, date, now, new Map(results));
}

// Merge collected results into the day's edition, dedupe, and remember what was shown.
// Running it again on the same day adds only stories not already in the edition.
export async function assemble(env: Env, date: string, now: number, collected: Map<string, Collected>): Promise<Edition> {
  const existing = await readJson<Edition | null>(env, `edition:${date}`, null);
  const seenList = await readJson<string[]>(env, "seen", []);
  const seen = new Set(seenList);
  const items: Item[] = existing?.items ? [...existing.items] : [];
  const inEdition = new Map(items.map((i) => [i.url, i]));
  const report: Record<string, string> = { ...(existing?.report ?? {}) };
  const newlySeen: string[] = [];

  for (const src of SOURCES) {
    const got = collected.get(src.id);
    if (!got) {
      report[src.id] ??= "not run";
      continue;
    }
    let added = 0;
    for (const it of got.items) {
      if (it.title === "__issue__") {
        newlySeen.push(it.url);
        continue;
      }
      const dup = inEdition.get(it.url);
      if (dup) {
        // Carried by more than one source: remember it, it helps ranking.
        if (dup.source !== it.source && !dup.also?.includes(it.source)) (dup.also ??= []).push(it.source);
        continue;
      }
      if (seen.has(it.url)) continue;
      inEdition.set(it.url, it);
      newlySeen.push(it.url);
      items.push(it);
      added++;
    }
    report[src.id] = got.error ? `error: ${got.error}` : `${added} new`;
  }

  const edition: Edition = { date, generatedAt: new Date(now).toISOString(), items, report };
  await env.NEWS.put(`edition:${date}`, JSON.stringify(edition), { expirationTtl: 180 * DAY });
  await env.NEWS.put("seen", JSON.stringify([...newlySeen, ...seenList].slice(0, 8000)));
  // Publish when there is something to show, or when this is the very first
  // edition (so the site renders and shows which sources failed).
  if (items.length || !(await env.NEWS.get("latest"))) {
    const dates = await readJson<string[]>(env, "dates", []);
    if (!dates.includes(date)) {
      dates.unshift(date);
      dates.sort().reverse();
      await env.NEWS.put("dates", JSON.stringify(dates.slice(0, 180)));
    }
    await env.NEWS.put("latest", date);
  }
  return edition;
}

const html = (body: string, maxAge = 300) =>
  new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}`,
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });

export default {
  // Cron "0 23 * * *": 23:00 UTC = 07:00 the next morning in Ulaanbaatar.
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    // The edition is dated by the Ulaanbaatar morning it is published on.
    ctx.waitUntil(runDaily(env, ubDate(event.scheduledTime), event.scheduledTime));
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/robots.txt") return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });

    const latest = await env.NEWS.get("latest");

    if (!latest) {
      // First visit after deploy: build the first edition in the background.
      // The page reloads itself until it is ready, so opening it once is enough.
      const started = await env.NEWS.get("bootstrap");
      if (!started) {
        await env.NEWS.put("bootstrap", "1", { expirationTtl: 300 });
        const now = Date.now();
        ctx.waitUntil(runDaily(env, ubDate(now), now));
      }
      return html(renderBuilding(), 0);
    }

    if (path === "/") {
      const ed = await readJson<Edition | null>(env, `edition:${latest}`, null);
      if (!ed) return html(renderNotFound(), 60);
      const dates = await readJson<string[]>(env, "dates", []);
      return html(renderEdition(ed, dates, true));
    }

    const day = /^\/d\/(\d{4}-\d{2}-\d{2})$/.exec(path);
    if (day) {
      const ed = await readJson<Edition | null>(env, `edition:${day[1]}`, null);
      if (!ed) return new Response(renderNotFound(), { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
      const dates = await readJson<string[]>(env, "dates", []);
      return html(renderEdition(ed, dates, day[1] === latest), 3600);
    }

    if (path === "/archive") return html(renderArchive(await readJson<string[]>(env, "dates", [])));

    if (path === "/feed.xml") {
      const ed = await readJson<Edition | null>(env, `edition:${latest}`, null);
      return new Response(renderFeed(ed, `https://${url.host}`), {
        headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=900" },
      });
    }

    if (path === "/api/latest.json") {
      const ed = await env.NEWS.get(`edition:${latest}`);
      return new Response(ed ?? "null", {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=900", "access-control-allow-origin": "*" },
      });
    }

    return new Response(renderNotFound(), { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  },
} satisfies ExportedHandler<Env>;
