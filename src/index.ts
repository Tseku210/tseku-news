import { SOURCES, type Source } from "./sources";
import { metaImage, pageText, parseFeed, parseHn, parseLinks, parseGithubTrending, parseTldrIssue, parseUnread, type Item } from "./parse";
import {
  renderArchive, renderBuilding, renderEdition, renderFeed, renderLogin, renderNotFound, renderSaved, renderSearch, renderTrends, type View,
} from "./render";
import { backfill, ensureIndexed, listMarked, marksFor, marksForUrls, pruneOld, readsByTopic, search, setMark, signalStats, type MarkKind } from "./db";
import { isSignedIn, sameOrigin, signIn, signOutCookie } from "./auth";
import { computeTrends } from "./trends";
import { addVectors, computeFit, forgetTaste, getCover, getFit, getTaste, personalize, tasteSummary } from "./taste";
import { addBriefs, cachedBriefs } from "./summarize";
import { bskyFeedUrl, fetchXTimeline, mergePosts, parseBsky, parseXTimeline } from "./social";

export interface Env {
  NEWS: KVNamespace;
  DB: D1Database;
  AI?: Ai; // Workers AI, for the card summaries (optional: cards fall back to excerpts)
  ADMIN_TOKEN?: string; // secret: sign-in passphrase
  X_COOKIE?: string; // secret: "auth_token=…; ct0=…" from a signed-in x.com session (see social.ts)
}

export interface Edition {
  date: string; // YYYY-MM-DD, Ulaanbaatar time
  generatedAt: string; // ISO
  items: Item[];
  report: Record<string, string>; // source id -> "12 new" | "error: …"
}

const UA = "news.tseku.dev/1.0 (personal news digest; +https://news.tseku.dev)";
const MAX_AGE_DAYS = 4;
const SOCIAL_AGE_DAYS = 2;
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

async function collectSource(src: Source, seen: Set<string>, now: number, env: Env): Promise<Item[]> {
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
    case "unread":
      items = parseUnread(await get(src.url, "text/html"), src.id, 40);
      break;
    case "github":
      items = parseGithubTrending(await get(src.url, "text/html"), src.id, 25);
      break;
    case "social": {
      // X and Bluesky side by side; the account only fails when every place it is read from fails.
      const tries: Promise<Item[]>[] = [];
      if (src.x) tries.push(fetchXTimeline(src.x, env.X_COOKIE).then((h) => parseXTimeline(h, src.x!, src.id)));
      if (src.bsky) tries.push(get(bskyFeedUrl(src.bsky), "application/json").then((j) => parseBsky(j, src.id)));
      const got = await Promise.allSettled(tries);
      const ok = got.flatMap((g) => (g.status === "fulfilled" ? [g.value] : []));
      if (!ok.length) throw (got[0] as PromiseRejectedResult).reason;
      items = mergePosts(ok);
      break;
    }
  }
  // Posts are a day's news only while they are fresh; articles get a few days.
  const cutoff = now - (src.kind === "social" ? SOCIAL_AGE_DAYS : MAX_AGE_DAYS) * DAY * 1000;
  const fresh = items.filter((i) => !seen.has(i.url) && (!i.date || Date.parse(i.date) >= cutoff));
  const marker = fresh.filter((i) => i.title === "__issue__");
  return fresh.filter((i) => i.title !== "__issue__").slice(0, src.max).concat(marker);
}

// Read an article page: its og:image, and (when `wantText`) the opening text to
// summarise. Only the <head> is read unless text is wanted; either way it stops
// after a few hundred KB.
async function pageInfo(url: string, wantText: boolean): Promise<{ image?: string; text?: string }> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html" },
    signal: AbortSignal.timeout(8_000),
    cf: { cacheTtl: 3600 },
  } as RequestInit);
  if (!res.ok || !res.body || !/html/i.test(res.headers.get("content-type") ?? "")) {
    await res.body?.cancel();
    return {};
  }
  const limit = wantText ? 400_000 : 150_000;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let html = "";
  try {
    while (html.length < limit) {
      const { value, done } = await reader.read();
      if (done) break;
      html += value;
      if (!wantText && /<\/head>|<body\b/i.test(html.slice(-value.length - 8))) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return { image: metaImage(html, res.url || url), text: wantText ? pageText(html) || undefined : undefined };
}

// Visit story pages a few at a time: give stories without a feed image their
// og:image, and collect article text for stories that still need a summary.
async function readPages(
  items: Item[],
  needsText: (it: Item) => boolean,
  limit = 180,
  concurrency = 10,
): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  const todo = items
    .filter((i) => !/news\.ycombinator\.com/.test(i.url) && !isPost(i))
    .map((it) => ({ it, wantText: needsText(it) }))
    .filter((t) => t.wantText || !t.it.image)
    .slice(0, limit);
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < todo.length) {
        const { it, wantText } = todo[next++];
        try {
          const got = await pageInfo(it.url, wantText);
          it.image ??= got.image;
          if (got.text) texts.set(it.url, got.text);
        } catch {
          // No picture is fine (the card shows a coloured tile), and no text means the excerpt stays.
        }
      }
    }),
  );
  return texts;
}

// Posts and trending repos are shown as they come: no page visit for a picture or text to summarise.
const isPost = (it: Item) => {
  const kind = SOURCES.find((s) => s.id === it.source)?.kind;
  return kind === "social" || kind === "github";
};

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
        return [src.id, { items: await collectSource(src, seen, now, env) }];
      } catch (e) {
        return [src.id, { items: [], error: String((e as Error)?.message ?? e).slice(0, 120) }];
      }
    }),
  );
  const fresh = new Map<string, Item>();
  for (const [, got] of results) for (const it of got.items) if (it.title !== "__issue__" && !fresh.has(it.url)) fresh.set(it.url, it);
  // Stories summarised on an earlier run need no article text.
  let known = new Map<string, string>();
  try {
    known = await cachedBriefs(env, [...fresh.keys()]);
  } catch (e) {
    console.error("summary cache read failed", e);
  }
  const texts = await readPages([...fresh.values()], (it) => !!env.AI && !known.has(it.url));
  // The same link can come from several sources; copy the picture to every copy.
  for (const [, got] of results) for (const it of got.items) it.image ??= fresh.get(it.url)?.image;
  const edition = await assemble(env, date, now, new Map(results));
  // Summaries for the cards. The edition is published first with excerpts, then
  // saved again with the summaries, so a model outage never holds up the news.
  try {
    if (await addBriefs(env, edition.items, texts, now))
      await env.NEWS.put(`edition:${date}`, JSON.stringify(edition), { expirationTtl: 180 * DAY });
  } catch (e) {
    console.error("summaries failed", e);
  }
  // Copy the stories to D1 for search, trends and marks. A failure here leaves the edition as is.
  try {
    await ensureIndexed(env, edition);
    await backfill(env);
  } catch (e) {
    console.error("indexing failed", e);
  }
  // Personal ranking: embed the stories and score them against what was liked and hidden.
  try {
    await addVectors(env, edition, now);
    await computeFit(env, edition, now);
  } catch (e) {
    console.error("similarity failed", e);
  }
  // Keep 90 days of stories (liked and saved ones are kept for good).
  try {
    const pruned = await pruneOld(env, date);
    if (pruned.stories || pruned.editions) console.log("pruned", pruned);
  } catch (e) {
    console.error("pruning failed", e);
  }
  return edition;
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

// Signed-in pages show the reader's own marks, so they must not be cached.
const html = (body: string, maxAge = 300, view?: View, status = 200) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": view?.signedIn ? "private, no-store" : `public, max-age=${maxAge}`,
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });

export default {
  // Cron "0 23 * * *": 23:00 UTC = 07:00 the next morning in Ulaanbaatar.
  async scheduled(event: ScheduledController, env: Env) {
    // The edition is dated by the Ulaanbaatar morning it is published on.
    // Awaited, not waitUntil: work left to waitUntil is cut off 30 s after the
    // handler returns, which is too short once the AI summaries run. A cron
    // handler itself may run for up to 15 minutes.
    await runDaily(env, ubDate(event.scheduledTime), event.scheduledTime);
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const signedIn = await isSignedIn(req, env);

    if (req.method === "POST") return post(req, env, path, signedIn);
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });

    if (path === "/login") return html(renderLogin(url.searchParams.has("error"), !!env.ADMIN_TOKEN), 0);
    if (path === "/logout") return new Response(null, { status: 303, headers: { location: "/", "set-cookie": signOutCookie } });

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

    const day = path === "/" ? [path, latest] : /^\/d\/(\d{4}-\d{2}-\d{2})$/.exec(path);
    if (day) {
      const ed = await readJson<Edition | null>(env, `edition:${day[1]}`, null);
      if (!ed) return html(renderNotFound(), 60, undefined, path === "/" ? 200 : 404);
      const dates = await readJson<string[]>(env, "dates", []);
      const view: View = { signedIn, cover: await getCover(env, ed.date), all: url.searchParams.has("all") };
      if (signedIn) {
        // Stories must be in D1 before they can be marked (covers editions from before D1).
        await ensureIndexed(env, ed);
        const [marks, taste, fit] = await Promise.all([marksFor(env, ed.date), getTaste(env, Date.now()), getFit(env, ed.date)]);
        view.marks = marks;
        // Only signed-in pages are personalised (and they are never cached), so visitors keep the default order.
        if (taste) view.personal = (it, topic) => personalize(it, topic, taste, fit[it.url]);
      }
      return html(renderEdition(ed, dates, day[1] === latest, view), path === "/" ? 300 : 3600, view);
    }

    if (path === "/archive") return html(renderArchive(await readJson<string[]>(env, "dates", []), { signedIn }), 300, { signedIn });

    if (path === "/search") {
      const q = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
      const rows = q ? await search(env, q) : [];
      const view: View = { signedIn, marks: signedIn && rows.length ? await marksForUrls(env, rows.map((r) => r.url)) : undefined };
      return html(renderSearch(q, rows, view), 300, view);
    }

    if (path === "/trends") {
      const tr = await computeTrends(env, latest);
      const reads = signedIn ? await readsByTopic(env, Date.now() - 30 * DAY * 1000) : null;
      return html(renderTrends(tr, reads, { signedIn }), 1800, { signedIn });
    }

    if (path === "/saved") {
      if (!signedIn) return new Response(null, { status: 303, headers: { location: "/login" } });
      const tab = url.searchParams.get("tab") === "liked" ? "liked" : "saved";
      const rows = await listMarked(env, tab === "liked" ? "like" : "save");
      const [stats, taste] = await Promise.all([signalStats(env), getTaste(env, Date.now())]);
      const view: View = { signedIn, marks: rows.length ? await marksForUrls(env, rows.map((x) => x.url)) : undefined };
      return html(
        renderSaved(tab, rows, stats, view, taste ? tasteSummary(taste) : null),
        0,
        view,
      );
    }

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

    return html(renderNotFound(), 60, undefined, 404);
  },
} satisfies ExportedHandler<Env>;

const KINDS = new Set<MarkKind>(["read", "like", "save", "hide"]);

async function post(req: Request, env: Env, path: string, signedIn: boolean): Promise<Response> {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });

  if (path === "/login") {
    const form = await req.formData();
    const cookie = await signIn(String(form.get("token") ?? ""), env);
    if (!cookie) return new Response(null, { status: 303, headers: { location: "/login?error" } });
    return new Response(null, { status: 303, headers: { location: "/", "set-cookie": cookie } });
  }

  if (!signedIn) return new Response("Sign in first", { status: 401 });

  if (path === "/api/mark") {
    let body: { url?: unknown; kind?: unknown; on?: unknown };
    try {
      body = await req.json();
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }
    const { url, kind, on } = body;
    if (typeof url !== "string" || url.length > 2048 || !KINDS.has(kind as MarkKind) || typeof on !== "boolean")
      return new Response("Bad request", { status: 400 });
    const ok = await setMark(env, url, kind as MarkKind, on, Date.now());
    if (ok) await forgetTaste(env); // rebuilt on the next page view
    return new Response(null, { status: ok ? 204 : 404 });
  }

  return new Response("Not found", { status: 404 });
}
