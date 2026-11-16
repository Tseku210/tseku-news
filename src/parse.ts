// Small, dependency-free parsers. They work on strings with bounded regexes so a
// daily run stays cheap in CPU time.

export interface Item {
  title: string;
  url: string;
  summary?: string;
  date?: string; // ISO
  source: string; // Source.id
  meta?: string; // e.g. "6 min read" or "412 points"
  discuss?: string; // e.g. HN comments link
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
    out.push({ title: clean(title, 200), url, summary: clean(rest, 200) || undefined, source: sourceId });
  }
  return out;
}
