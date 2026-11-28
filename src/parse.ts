// Small, dependency-free parsers. They work on strings with bounded regexes so a
// daily run stays cheap in CPU time.

export interface Item {
  title: string;
  url: string;
  summary?: string; // excerpt from the feed or page
  brief?: string; // 1–2 sentence AI summary (see summarize.ts); shown instead of the excerpt
  date?: string; // ISO
  source: string; // Source.id
  meta?: string; // e.g. "6 min read" or "412 points"
  discuss?: string; // e.g. HN comments link
  image?: string; // https thumbnail from the feed or the page's og:image
  also?: string[]; // other Source.ids that carried the same link (a ranking signal)
  by?: string; // author of a social post (display name)
  avatar?: string; // author's profile picture (social posts)
  quote?: { by: string; handle: string; text: string; url: string; avatar?: string; date?: string }; // post quoted by a social post
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…",
  mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", laquo: "«", raquo: "»",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function stripTags(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

export function clean(s: string | undefined, max = 0): string {
  if (!s) return "";
  // Feeds often double-encode HTML inside descriptions, so decode, strip, decode.
  let out = decodeEntities(stripTags(decodeEntities(stripTags(unCdata(s)))));
  out = out.replace(/\s+/g, " ").trim();
  if (max && out.length > max) out = out.slice(0, max).replace(/\s+\S*$/, "") + "…";
  return out;
}

export function normalizeUrl(raw: string, base?: string): string | null {
  try {
    const u = new URL(decodeEntities(raw.trim()), base);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^utm_|^(ref|fbclid|gclid|mc_cid|mc_eid)$/i.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.toLowerCase();
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return null;
  }
}

function tag(block: string, name: string): string | undefined {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i");
  return re.exec(block)?.[1];
}

function toIso(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = Date.parse(clean(s));
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

function attr(tagText: string, name: string): string | undefined {
  const m = new RegExp(`[\\s"']${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tagText);
  return m ? (m[1] ?? m[2]) : undefined;
}

// Only https images, so the page never has mixed content, and no tracking pixels.
export function imageUrl(raw: string | undefined, base?: string): string | undefined {
  if (!raw) return undefined;
  const u = normalizeUrl(raw, base);
  if (!u || !u.startsWith("https://")) return undefined;
  if (/pixel|1x1|spacer|blank\.gif|feeds\.feedburner|gravatar\.com\/avatar|\.svg(\?|$)/i.test(u)) return undefined;
  return u.length > 600 ? undefined : u;
}

// The picture a feed entry carries: media:thumbnail, media:content, an image
// enclosure, or the first <img> in its HTML body.
export function feedImage(block: string): string | undefined {
  const b = block.slice(0, 20_000);
  for (const m of b.matchAll(/<(media:thumbnail|media:content|enclosure|itunes:image)\b[^>]*>/gi)) {
    const t = m[0];
    const type = attr(t, "type") ?? "";
    const medium = attr(t, "medium") ?? "";
    if (/video|audio/i.test(type + medium)) continue;
    if (m[1].toLowerCase() === "enclosure" && !/^image\//i.test(type)) continue;
    const img = imageUrl(attr(t, "url") ?? attr(t, "href"));
    if (img) return img;
  }
  const body = decodeEntities(unCdata(b));
  for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
    if (/\b(width|height)=["']?1["'\s>]/i.test(m[0])) continue;
    const img = imageUrl(attr(m[0], "src"));
    if (img) return img;
  }
  return undefined;
}

// og:image / twitter:image from the <head> of an article page.
export function metaImage(html: string, base: string): string | undefined {
  const found: Record<string, string> = {};
  for (const m of html.slice(0, 200_000).matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(m[0], "property") ?? attr(m[0], "name") ?? "").toLowerCase();
    if (/^(og:image(:secure_url|:url)?|twitter:image(:src)?)$/.test(key) && !found[key]) {
      const c = attr(m[0], "content");
      if (c) found[key] = c;
    }
  }
  for (const k of ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"]) {
    const img = imageUrl(found[k], base);
    if (img) return img;
  }
  return undefined;
}

// Text to summarise from an article page: its meta description plus the first
// paragraphs of the body, about `max` characters in all.
export function pageText(html: string, max = 2500): string {
  let desc = "";
  for (const m of html.slice(0, 200_000).matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(m[0], "property") ?? attr(m[0], "name") ?? "").toLowerCase();
    if (key === "og:description" || key === "description" || key === "twitter:description") {
      desc = clean(attr(m[0], "content"), 400);
      if (desc) break;
    }
  }
  const body = html.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, " ");
  const paras: string[] = [];
  let len = desc.length;
  for (const m of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const t = clean(m[1]);
    // Skip captions, bylines, cookie notes and other short bits.
    if (t.length < 60 || t === desc) continue;
    paras.push(t);
    len += t.length;
    if (len > max) break;
  }
  return [desc, ...paras].filter(Boolean).join("\n").slice(0, max);
}

// RSS 2.0 and Atom. Only the first `limit` entries are looked at.
export function parseFeed(xml: string, sourceId: string, limit = 20): Item[] {
  const items: Item[] = [];
  const re = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && items.length < limit) {
    const b = m[2];
    const title = clean(tag(b, "title"), 200);
    let link = "";
    const atomAlt =
      /<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i.exec(b) ||
      /<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["']/i.exec(b);
    const atomAny = /<link\b[^>]*href=["']([^"']+)["']/i.exec(b);
    const rssLink = tag(b, "link");
    if (rssLink && clean(rssLink)) link = clean(rssLink);
    else if (atomAlt) link = atomAlt[1];
    else if (atomAny) link = atomAny[1];
    const url = link && normalizeUrl(link);
    if (!title || !url) continue;
    // Look at a bounded slice of the description to keep CPU low.
    const rawSummary = (tag(b, "description") ?? tag(b, "summary") ?? tag(b, "content") ?? "").slice(0, 3000);
    items.push({
      title,
      url,
      summary: clean(rawSummary, 220) || undefined,
      date: toIso(tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date")),
      source: sourceId,
      image: feedImage(b),
    });
  }
  return items;
}

// A TLDR issue page: every story headline is a link whose text ends in a
// parenthesised label like "(6 minute read)" or "(GitHub Repo)". The summary is
// the text between that link and the next story link.
export function parseTldrIssue(html: string, sourceId: string, issueDate?: string): Item[] {
  const out: Item[] = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const hits: { url: string; text: string; end: number; start: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const text = clean(m[2]);
    if (/\((\d+\s+minute read|GitHub Repo|Website|Sponsor)\)\s*$/i.test(text)) {
      hits.push({ url: m[1], text, start: m.index, end: re.lastIndex });
    }
  }
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    if (/\(Sponsor\)\s*$/i.test(h.text) || /utm_medium=paid|advertise\.tldr|tldr\.tech\/.*sponsor/i.test(h.url)) continue;
    const url = normalizeUrl(h.url, "https://tldr.tech/");
    if (!url || /^https:\/\/(www\.)?tldr\.tech\b/.test(url)) continue;
    const label = /\(([^()]*)\)\s*$/.exec(h.text)?.[1] ?? "";
    const title = h.text.replace(/\s*\([^()]*\)\s*$/, "").trim();
    const nextStart = i + 1 < hits.length ? hits[i + 1].start : Math.min(html.length, h.end + 4000);
    const between = html.slice(h.end, Math.min(nextStart, h.end + 4000));
    // Stop at the next heading so section titles don't leak into the summary.
    const body = between.split(/<h[1-6]\b/i)[0];
    out.push({
      title: clean(title, 200),
      url,
      summary: clean(body, 220) || undefined,
      date: issueDate,
      source: sourceId,
      meta: label.replace(/minute read/i, "min read"),
    });
  }
  return out;
}

// Algolia HN search API response.
export function parseHn(json: string, sourceId: string, minPoints = 100): Item[] {
  const data = JSON.parse(json) as {
    hits: { title?: string; url?: string; points?: number; objectID: string; created_at?: string; num_comments?: number }[];
  };
  return data.hits
    .filter((h) => h.title && (h.points ?? 0) >= minPoints)
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
    .map((h) => {
      const discuss = `https://news.ycombinator.com/item?id=${encodeURIComponent(h.objectID)}`;
      return {
        title: clean(h.title, 200),
        url: (h.url && normalizeUrl(h.url)) || discuss,
        date: h.created_at,
        source: sourceId,
        meta: `${h.points} points · ${h.num_comments ?? 0} comments`,
        discuss,
      };
    });
}

// Links on a page that match a path pattern, grouped by URL. Used for sites
// without a feed (launchpad.mn product pages, ikon.mn articles).
export function parseLinks(
  html: string,
  base: string,
  sourceId: string,
  pathRe: RegExp,
  pick: "first" | "longest" = "first",
  minTitle = 2,
): Item[] {
  const byUrl = new Map<string, string[]>();
  const images = new Map<string, string>();
  const order: string[] = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const url = normalizeUrl(m[1], base);
    if (!url || !pathRe.test(new URL(url).pathname)) continue;
    // Keep text pieces separated by tags as separate lines.
    const parts = decodeEntities(m[2].replace(/<[^>]*>/g, "\n"))
      .split("\n")
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter((s) => s && !/^[\d\s.,:#↑▲]+$/.test(s));
    if (!byUrl.has(url)) {
      byUrl.set(url, []);
      order.push(url);
    }
    byUrl.get(url)!.push(...parts);
    if (!images.has(url)) {
      const tagText = /<img\b[^>]*>/i.exec(m[2])?.[0];
      const img = tagText && imageUrl(attr(tagText, "data-src") ?? attr(tagText, "src"), base);
      if (img) images.set(url, img);
    }
  }
  const out: Item[] = [];
  for (const url of order) {
    const parts = [...new Set(byUrl.get(url)!)];
    if (!parts.length) continue;
    // The longest piece is usually the headline; for product cards the first
    // piece is the name and the rest is its tagline.
    const title = pick === "first" ? parts[0] : [...parts].sort((a, b) => b.length - a.length)[0];
    if (title.length < minTitle) continue;
    const rest = parts.filter((p) => p !== title).join(" · ");
    out.push({ title: clean(title, 200), url, summary: clean(rest, 200) || undefined, source: sourceId, image: images.get(url) });
  }
  return out;
}

// unread.today home page (Mongolian long-form media; it has no feed). Every story
// card is an element with class "unread-content": the hero, the editors' picks
// carousel and the latest list. A card carries the /c/<slug> link, a "title"
// element, a CSS background-image cover, and on dated cards "11 сарын 17, 2026"
// and "5 мин". Editors' picks carry no date and can be months old, so only dated
// cards are kept.
export function parseUnread(html: string, sourceId: string, max: number): Item[] {
  const out: Item[] = [];
  const seenUrls = new Set<string>();
  const cards = html.split(/(?=<[a-z0-9]+\b[^>]*class="[^"]*\bunread-content\b)/i).slice(1);
  for (const raw of cards) {
    if (out.length >= max) break;
    const b = raw.slice(0, 6000);
    const href = /href="((?:https:\/\/(?:www\.)?unread\.today)?\/c\/[^"#?]+)"/i.exec(b)?.[1];
    const url = href && normalizeUrl(href, "https://unread.today/");
    const d = /(\d{1,2}) сарын (\d{1,2}), (\d{4})/.exec(b);
    if (!url || !d || seenUrls.has(url)) continue;
    const title = clean(decodeEntities(stripTags(/class="title\b[^"]*"[^>]*>([\s\S]*?)<\/(?:h\d|div)>/i.exec(b)?.[1] ?? "")), 200);
    if (title.length < 5) continue;
    seenUrls.add(url);
    const pad = (n: string) => n.padStart(2, "0");
    const mins = /(\d+) мин/.exec(b)?.[1];
    out.push({
      title,
      url,
      date: new Date(`${d[3]}-${pad(d[1])}-${pad(d[2])}T00:00:00+08:00`).toISOString(),
      source: sourceId,
      meta: mins ? `${mins} min read` : undefined,
      // The hero's background is a blurred "_progressive" image; data-large is the real one.
      image: imageUrl(/data-large="([^"]+)"/i.exec(b)?.[1] ?? /background-image:\s*url\(['"]?([^'")]+)/i.exec(b)?.[1], "https://unread.today/"),
    });
  }
  return out;
}

// github.com/trending (no API or feed). Each repo is an <article class="Box-row"> with
// the repo link in its <h2>, the description in the first <p>, the language, and
// "1,234 stars today". No date: a repo shows once and the seen list keeps it from
// coming back while it stays on the list.
export function parseGithubTrending(html: string, sourceId: string, max: number): Item[] {
  const out: Item[] = [];
  for (const block of html.split(/<article\b[^>]*class="[^"]*Box-row/i).slice(1)) {
    const h2 = /<h2\b[\s\S]*?<\/h2>/i.exec(block)?.[0] ?? "";
    const href = /href="(\/[\w.-]+\/[\w.-]+)"/.exec(h2)?.[1];
    if (!href) continue;
    const url = normalizeUrl(href, "https://github.com");
    if (!url) continue;
    const name = href.slice(1);
    const desc = clean(/<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(block)?.[1], 300);
    const lang = clean(/itemprop="programmingLanguage"[^>]*>([^<]*)</i.exec(block)?.[1]);
    const stars = /([\d,]+)\s+stars?\s+(today|this week|this month)/i.exec(stripTags(block));
    out.push({
      title: name.replace("/", " / "),
      url,
      summary: desc || undefined,
      source: sourceId,
      meta: [stars ? `★ ${stars[1]} ${stars[2].toLowerCase()}` : "", lang].filter(Boolean).join(" · ") || undefined,
    });
    if (out.length >= max) break;
  }
  return out;
}
