// Posts from people on X, without the paid X API.
//
// Each account is read from two free places, and the two are merged:
//   Bluesky  the public AppView API (app.bsky.feed.getAuthorFeed), JSON, no key. Used only
//            for handles that are the person's own domain, so a handle can't be someone else.
//   X        the profile timeline behind X's embed widget (syndication.twitter.com). Signed
//            out it serves posts about a year old, so it is read with Tseku's own x.com
//            session cookie (secret X_COOKIE: "auth_token=…; ct0=…"). It is undocumented and
//            rate limited, so requests go one at a time with a pause between them. Old posts
//            are dropped by the edition's age filter, and a failed fetch just leaves that
//            account out for the day. When the cookie expires (logging out of x.com ends it),
//            set a new one with `wrangler secret put X_COOKIE`.
// Replies and reposts are skipped; a person's own posts are kept.

import { decodeEntities, imageUrl, type Item } from "./parse";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const MAX_TEXT = 400;

function tidy(s: string): string {
  // Keep the post's line breaks (at most one blank line); tidy everything else.
  const t = decodeEntities(s).replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT).replace(/\s+\S*$/, "") + "…" : t;
}

function iso(s: unknown): string | undefined {
  const t = typeof s === "string" ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

// ---- Bluesky ----

export const bskyFeedUrl = (handle: string) =>
  `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&filter=posts_no_replies&limit=30`;

type BskyImages = { images?: { thumb?: string }[] };
interface BskyEmbed extends BskyImages {
  media?: BskyImages;
  external?: { thumb?: string };
}

export function parseBsky(json: string, source: string): Item[] {
  const data = JSON.parse(json) as {
    feed?: {
      post?: {
        uri?: string;
        author?: { handle?: string; displayName?: string; avatar?: string };
        record?: { text?: string; createdAt?: string; reply?: unknown };
        embed?: BskyEmbed;
      };
      reason?: unknown;
      reply?: unknown;
    }[];
  };
  const out: Item[] = [];
  for (const f of data.feed ?? []) {
    const p = f.post;
    if (!p || f.reason || f.reply || p.record?.reply) continue; // reposts and replies
    const rkey = p.uri?.split("/").pop();
    const handle = p.author?.handle;
    const text = tidy(p.record?.text ?? "");
    if (!rkey || !handle || !text) continue;
    const e = p.embed;
    out.push({
      title: text,
      url: `https://bsky.app/profile/${handle}/post/${rkey}`,
      date: iso(p.record?.createdAt),
      source,
      by: p.author?.displayName || handle,
      meta: `@${handle}`,
      avatar: imageUrl(p.author?.avatar),
      image: imageUrl(e?.images?.[0]?.thumb ?? e?.media?.images?.[0]?.thumb ?? e?.external?.thumb),
    });
  }
  return out;
}

// ---- X ----

const xTimelineUrl = (handle: string) =>
  `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(handle)}?showReplies=false`;

const X_GAP_MS = 2_000; // pause between X requests
const X_RETRY_MS = 15_000; // wait once after "too many requests"
let xQueue: Promise<unknown> = Promise.resolve();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function xFetch(handle: string, cookie?: string): Promise<string> {
  const headers: Record<string, string> = { "user-agent": BROWSER_UA, accept: "text/html", referer: "https://platform.twitter.com/" };
  if (cookie) headers.cookie = cookie;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(xTimelineUrl(handle), { headers, signal: AbortSignal.timeout(15_000) });
    if (res.status === 429 && attempt === 0) {
      await res.body?.cancel();
      await sleep(X_RETRY_MS);
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`X HTTP ${res.status}`);
    }
    return res.text();
  }
}

// One X account's timeline. Calls wait their turn, so all accounts together are read
// one after another rather than all at once.
export function fetchXTimeline(handle: string, cookie?: string): Promise<string> {
  const run = xQueue.then(() => xFetch(handle, cookie));
  xQueue = run.catch(() => {}).then(() => sleep(X_GAP_MS));
  return run;
}

interface Tweet {
  id_str?: string;
  created_at?: string;
  full_text?: string;
  text?: string;
  user?: { screen_name?: string; name?: string; profile_image_url_https?: string };
  retweeted_status?: unknown;
  in_reply_to_status_id_str?: string | null;
  entities?: { urls?: { url?: string; expanded_url?: string; display_url?: string }[]; media?: { url?: string; media_url_https?: string }[] };
  extended_entities?: { media?: { url?: string; media_url_https?: string }[] };
  mediaDetails?: { media_url_https?: string }[];
}

const isTweet = (o: Record<string, unknown>) =>
  typeof o.id_str === "string" && typeof o.created_at === "string" && (typeof o.full_text === "string" || typeof o.text === "string");

// Every tweet object in the page data, wherever the timeline keeps them. A tweet's own
// insides (quoted or retweeted posts) are not searched.
function findTweets(node: unknown, out: Tweet[], depth = 0): void {
  if (!node || typeof node !== "object" || depth > 12) return;
  if (Array.isArray(node)) {
    for (const n of node) findTweets(n, out, depth + 1);
    return;
  }
  const o = node as Record<string, unknown>;
  if (isTweet(o)) {
    out.push(o as Tweet);
    return;
  }
  for (const v of Object.values(o)) findTweets(v, out, depth + 1);
}

export function parseXTimeline(html: string, handle: string, source: string): Item[] {
  const start = html.indexOf('id="__NEXT_DATA__"');
  if (start < 0) throw new Error("no timeline data");
  const open = html.indexOf(">", start) + 1;
  const close = html.indexOf("</script>", open);
  const tweets: Tweet[] = [];
  findTweets(JSON.parse(html.slice(open, close)), tweets);
  const me = handle.toLowerCase();
  const out: Item[] = [];
  for (const t of tweets) {
    const name = t.user?.screen_name ?? handle;
    if (name.toLowerCase() !== me || t.retweeted_status || t.in_reply_to_status_id_str) continue;
    let text = t.full_text ?? t.text ?? "";
    if (/^RT @/.test(text)) continue;
    // Show links as their real address, and drop the link to attached media.
    for (const u of t.entities?.urls ?? []) if (u.url) text = text.split(u.url).join(u.display_url ?? u.expanded_url ?? "");
    const media = t.extended_entities?.media ?? t.entities?.media ?? [];
    for (const m of media) if (m.url) text = text.split(m.url).join("");
    text = tidy(text);
    if (!text) continue;
    out.push({
      title: text,
      url: `https://x.com/${name}/status/${t.id_str}`,
      date: iso(t.created_at),
      source,
      by: t.user?.name || name,
      meta: `@${name}`,
      avatar: imageUrl(t.user?.profile_image_url_https),
      image: imageUrl(media[0]?.media_url_https ?? t.mediaDetails?.[0]?.media_url_https),
    });
  }
  return out;
}

// ---- Merge ----

// The same post is often on both networks. Keep one copy: the first one seen.
export function mergePosts(lists: Item[][]): Item[] {
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const it of lists.flat()) {
    const key = it.title.toLowerCase().replace(/https?:\/\/\S+|[^\p{L}\p{N}]+/gu, "").slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}
