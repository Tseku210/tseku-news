import { SOURCES, SLOTS, type Source } from "./sources";
import { parseFeed, parseHn, parseLinks, parseTldrIssue, type Item } from "./parse";
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

async function readJson<T>(env: Env, key: string, fallback: T): Promise<T> {
  const v = await env.NEWS.get(key, "json");
  return (v as T) ?? fallback;
}

// One slot = one cron firing: fetch the sources assigned to it and stage the results.
export async function runSlot(env: Env, slot: number, date: string, now: number): Promise<void> {
  const seen = new Set(await readJson<string[]>(env, "seen", []));
  const mine = SOURCES.filter((_, i) => i % SLOTS === slot);
  await Promise.all(
    mine.map(async (src) => {
      let payload: { items: Item[]; error?: string };
      try {
        payload = { items: await collectSource(src, seen, now) };
      } catch (e) {
        payload = { items: [], error: String((e as Error)?.message ?? e).slice(0, 120) };
      }
      await env.NEWS.put(`staging:${date}:${src.id}`, JSON.stringify(payload), { expirationTtl: 3 * DAY });
    }),
  );
  if (slot === SLOTS - 1) await assemble(env, date, now);
}

// Merge staged results into the day's edition, dedupe, and remember what was shown.
export async function assemble(env: Env, date: string, now: number): Promise<Edition> {
  const existing = await readJson<Edition | null>(env, `edition:${date}`, null);
  const seenList = await readJson<string[]>(env, "seen", []);
  const seen = new Set(seenList);
  const items: Item[] = existing?.items ? [...existing.items] : [];
  const inEdition = new Set(items.map((i) => i.url));
  const report: Record<string, string> = { ...(existing?.report ?? {}) };
  const newlySeen: string[] = [];

  for (const src of SOURCES) {
    const staged = await readJson<{ items: Item[]; error?: string } | null>(env, `staging:${date}:${src.id}`, null);
    if (!staged) {
      report[src.id] ??= "not run";
      continue;
    }
    let added = 0;
    for (const it of staged.items) {
      if (it.title === "__issue__") {
        newlySeen.push(it.url);
        continue;
      }
      if (inEdition.has(it.url) || seen.has(it.url)) continue;
      inEdition.add(it.url);
      newlySeen.push(it.url);
      items.push(it);
      added++;
    }
    report[src.id] = staged.error ? `error: ${staged.error}` : `${added} new`;
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
  // Cron "*/10 23 * * *": six firings 23:00–23:50 UTC = 07:00–07:50 in Ulaanbaatar.
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const slot = Math.floor(new Date(event.scheduledTime).getUTCMinutes() / 10) % SLOTS;
    // The edition is dated by the Ulaanbaatar morning it is published on.
    const date = ubDate(event.scheduledTime - new Date(event.scheduledTime).getUTCMinutes() * 60_000);
    ctx.waitUntil(runSlot(env, slot, date, event.scheduledTime));
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/robots.txt") return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });

    const latest = await env.NEWS.get("latest");

    if (!latest) {
      // First visit after deploy: build the first edition one slot per page load.
      // The page reloads itself, so opening it once is enough.
      const now = Date.now();
      const date = ubDate(now);
      const step = Number((await env.NEWS.get("bootstrap")) ?? "0");
      if (step < SLOTS) {
        ctx.waitUntil(
          (async () => {
            await env.NEWS.put("bootstrap", String(step + 1), { expirationTtl: DAY });
            await runSlot(env, step, date, now);
          })(),
        );
      }
      return html(renderBuilding(Math.min(step + 1, SLOTS), SLOTS), 0);
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
