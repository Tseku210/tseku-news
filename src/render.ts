import { SOURCES, TOPICS } from "./sources";
import type { Item } from "./parse";
import type { Edition } from "./index";
import { rank, topPicks, type Ranked } from "./rank";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const srcById = new Map(SOURCES.map((s) => [s.id, s]));
const topicLabel = new Map(TOPICS.map((t) => [t.id as string, t.label]));
const shortLabel = (id: string) => (id === "dev" ? "Dev" : topicLabel.get(id) ?? "");

function host(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function longDate(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  });
}

function ubTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ulaanbaatar" });
}

// Light and dark palettes. Each topic has its own hue, used for the kicker dot
// and for the coloured tile shown when a story has no picture.
const LIGHT = `--bg:#f4f3ef;--card:#ffffff;--fg:#17191c;--muted:#666b73;--dim:#a2a6ad;--line:#e4e2dc;--chip:#ebe9e3;--shadow:0 1px 2px rgba(20,20,20,.05),0 4px 16px rgba(20,20,20,.04);
--ai:#7c4dff;--dev:#1f6feb;--startups:#e8590c;--tech:#0c8f7a;--mongolia:#d6336c`;
const DARK = `--bg:#0e0f11;--card:#17191c;--fg:#eceef1;--muted:#9aa0a8;--dim:#5c626b;--line:#25282d;--chip:#1f2226;--shadow:none;
--ai:#a28bff;--dev:#58a6ff;--startups:#ff8a3d;--tech:#2ec4a6;--mongolia:#ff6b9a`;

const CSS = `
:root{${LIGHT}}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${DARK}}}
:root[data-theme="dark"]{${DARK}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-padding-top:64px}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
.wrap{max-width:1180px;margin:0 auto;padding:0 16px 64px}
.bar{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.bar .wrap{display:flex;align-items:center;gap:16px;padding-top:12px;padding-bottom:12px}
.brand{font-weight:800;letter-spacing:-.02em;white-space:nowrap}
.brand span{color:var(--muted);font-weight:500}
.chips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin-left:auto}
.chips::-webkit-scrollbar{display:none}
.chips a{white-space:nowrap;font-size:13px;padding:5px 11px;border-radius:999px;background:var(--chip);color:var(--muted)}
.chips a:hover{color:var(--fg)}
.chips i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;vertical-align:1px;background:var(--c)}
.intro{padding:28px 0 18px}
.intro h1{margin:0;font-size:34px;line-height:1.1;letter-spacing:-.03em;font-weight:800}
.intro p{margin:6px 0 0;color:var(--muted)}
h2{display:flex;align-items:center;gap:8px;font-size:19px;letter-spacing:-.01em;margin:40px 0 14px}
h2 i{width:10px;height:10px;border-radius:50%;background:var(--c)}
h2 small{color:var(--dim);font-weight:500;font-size:14px}
.t-ai{--c:var(--ai)}.t-dev{--c:var(--dev)}.t-startups{--c:var(--startups)}.t-tech{--c:var(--tech)}.t-mongolia{--c:var(--mongolia)}

.bento{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.card{position:relative;display:flex;flex-direction:column;background:var(--card);border-radius:18px;overflow:hidden;box-shadow:var(--shadow);border:1px solid var(--line);transition:transform .15s ease}
.card:hover{transform:translateY(-2px)}
.card h3{margin:0;font-size:16px;line-height:1.3;letter-spacing:-.01em;font-weight:700;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;overflow-wrap:anywhere}
.card h3 a::after{content:"";position:absolute;inset:0;z-index:1}
.card h3 a:hover{text-decoration:underline;text-decoration-thickness:1.5px;text-underline-offset:3px}
.card .body{display:flex;flex-direction:column;gap:6px;padding:14px 16px 16px;flex:1}
.card p{margin:0;color:var(--muted);font-size:14px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere}
.kick{font-size:12px;font-weight:600;color:var(--c);text-transform:uppercase;letter-spacing:.04em}
.meta{margin-top:auto;padding-top:4px;font-size:12.5px;color:var(--dim);overflow-wrap:anywhere}
.meta a{position:relative;z-index:2;color:var(--muted);text-decoration:underline;text-underline-offset:2px}
.pic{position:relative;aspect-ratio:16/9;background:linear-gradient(135deg,color-mix(in srgb,var(--c) 85%,#000),color-mix(in srgb,var(--c) 45%,var(--card)));overflow:hidden;flex:none}
.pic img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:var(--card)}
.ph{position:absolute;left:14px;bottom:10px;right:14px;color:#fff;font-weight:800;font-size:20px;letter-spacing:-.02em;opacity:.9;line-height:1.1}

.hero{grid-column:span 2;grid-row:span 2;min-height:440px;border:0}
.hero .pic{position:absolute;inset:0;aspect-ratio:auto}
.hero .pic::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.88) 0%,rgba(0,0,0,.55) 38%,rgba(0,0,0,0) 70%)}
.hero .ph{top:22px;bottom:auto;font-size:30px;opacity:.35}
.hero .body{position:relative;justify-content:flex-end;padding:24px;color:#fff}
.hero h3{font-size:28px;line-height:1.15;letter-spacing:-.025em;-webkit-line-clamp:4}
.hero p{color:rgba(255,255,255,.82);font-size:15px;-webkit-line-clamp:3}
.hero .kick{color:#fff;opacity:.85}
.hero .meta,.hero .meta a{color:rgba(255,255,255,.7)}
.hero .meta{margin-top:4px}
.wide{grid-column:span 2;flex-direction:row}
.wide .pic{width:42%;aspect-ratio:auto}

.topic{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.topic .lead{grid-column:span 2}
.topic .lead h3{font-size:20px}
.topic .lead .pic{aspect-ratio:2.2/1}
.list{grid-column:span 2;display:flex;flex-direction:column;background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow);padding:4px 0}
.row{position:relative;display:flex;gap:12px;align-items:center;padding:10px 14px;border-radius:12px}
.row+.row{border-top:1px solid var(--line);border-radius:0}
.row:hover h4{text-decoration:underline;text-underline-offset:2px}
.row .pic{width:64px;height:64px;aspect-ratio:auto;border-radius:12px}
.row .ph{left:8px;bottom:6px;font-size:13px}
.row h4{margin:0 0 2px;font-size:14.5px;line-height:1.3;font-weight:600;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere}
.row h4 a::after{content:"";position:absolute;inset:0;z-index:1}
.row .meta{padding:0}
.row>div:last-child{min-width:0}
details.more{grid-column:1/-1}
details.more summary{cursor:pointer;list-style:none;display:inline-block;font-size:13.5px;font-weight:600;color:var(--muted);padding:7px 14px;border-radius:999px;background:var(--chip)}
details.more summary::-webkit-details-marker{display:none}
details.more[open] summary{margin-bottom:12px}
details.more .list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
details.more .row+.row{border-top:0}
details.more .row{border-top:1px solid var(--line)!important;border-radius:0}
details.more .row:nth-child(-n+2){border-top:0!important}
.empty{color:var(--muted)}

footer{margin-top:56px;border-top:1px solid var(--line);padding-top:18px;color:var(--muted);font-size:13px}
footer a{text-decoration:underline;text-underline-offset:2px}
footer details summary{cursor:pointer}
.pager{display:flex;justify-content:space-between;gap:12px;margin-top:36px;font-weight:600}
.pager a:hover{text-decoration:underline}
.src{columns:3 200px;margin:10px 0 0;padding:0;list-style:none}
.src li{padding:1px 0}
.ok{color:var(--tech)} .err{color:#e5484d}
.simple ol{list-style:none;margin:0;padding:0}
.simple li{padding:8px 0;border-bottom:1px solid var(--line)}
.simple li a{font-weight:600}

@media (max-width:900px){
  .bento,.topic{grid-template-columns:repeat(2,minmax(0,1fr))}
  .hero{min-height:380px}
}
@media (max-width:600px){
  .bento,.topic{grid-template-columns:minmax(0,1fr);gap:10px}
  .hero,.wide,.topic .lead,.list{grid-column:auto}
  .hero{grid-row:auto;min-height:360px}
  .hero h3{font-size:23px}
  .intro h1{font-size:28px}
  .bento>.card:not(.hero),.wide{flex-direction:row;align-items:stretch}
  .bento>.card:not(.hero) .pic{width:96px;aspect-ratio:auto}
  .bento>.card:not(.hero) .ph{font-size:13px;left:8px;bottom:6px}
  .bento>.card:not(.hero) p{display:none}
  .bento>.card:not(.hero) h3{font-size:15px}
  .bento>.card:not(.hero) .body{padding:12px 14px}
  details.more .list{grid-template-columns:minmax(0,1fr)}
  details.more .row:nth-child(2){border-top:1px solid var(--line)!important}
  .brand span{display:none}
}
@media (prefers-reduced-motion:reduce){.card{transition:none}.card:hover{transform:none}}
`;

function page(title: string, body: string, extraHead = "", chips = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="A daily brief of technology, AI, software development, startups and Mongolian startup news.">
<meta name="color-scheme" content="light dark">
<link rel="alternate" type="application/rss+xml" title="news.tseku.dev" href="/feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='7' height='16' rx='2' fill='%237c4dff'/%3E%3Crect x='9' width='7' height='7' rx='2' fill='%23e8590c'/%3E%3Crect x='9' y='9' width='7' height='7' rx='2' fill='%230c8f7a'/%3E%3C/svg%3E">
${extraHead}<style>${CSS}</style></head><body>
<div class="bar"><div class="wrap"><a class="brand" href="/">news.tseku.dev <span>daily brief</span></a>${chips ? `<nav class="chips">${chips}</nav>` : ""}</div></div>
<div class="wrap">
${body}
<footer>Gathered automatically from public feeds every morning at 07:00 Ulaanbaatar time. Stories and images belong to their publishers.<br>
<a href="/archive">archive</a> · <a href="/feed.xml">rss</a> · <a href="/api/latest.json">json</a> · <a href="https://tseku.dev">tseku.dev</a></footer>
</div></body></html>`;
}

function srcName(it: Item): string {
  return srcById.get(it.source)?.name ?? it.source;
}

function pic(it: Ranked, eager = false): string {
  const img = it.image
    ? `<img src="${esc(it.image)}" alt="" ${eager ? `fetchpriority="high"` : `loading="lazy"`} decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">`
    : "";
  return `<div class="pic"><span class="ph">${esc(srcName(it))}</span>${img}</div>`;
}

function meta(it: Ranked): string {
  const bits = [esc(host(it.url))];
  if (it.meta) bits.push(esc(it.meta));
  if (it.also?.length) bits.push(`also in ${it.also.map((s) => esc(srcById.get(s)?.name ?? s)).join(", ")}`);
  if (it.discuss && it.discuss !== it.url) bits.push(`<a href="${esc(it.discuss)}" target="_blank" rel="noopener">discuss</a>`);
  return `<div class="meta">${bits.join(" · ")}</div>`;
}

// A bento tile. kind: hero (big, picture behind the text), wide (picture left),
// tile (picture on top) or lead (first story of a topic section).
function card(it: Ranked, kind: "hero" | "wide" | "tile" | "lead", showTopic: boolean): string {
  const kick = showTopic ? `${esc(shortLabel(it.topic))} · ${esc(srcName(it))}` : esc(srcName(it));
  const summary = kind !== "tile" && it.summary ? `<p>${esc(it.summary)}</p>` : "";
  return `<article class="card ${kind} t-${it.topic}">${pic(it, kind === "hero")}<div class="body">
<div class="kick">${kick}</div><h3><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></h3>${summary}${meta(it)}</div></article>`;
}

function row(it: Ranked): string {
  return `<div class="row t-${it.topic}">${pic(it)}<div><h4><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></h4>
<div class="meta">${esc(srcName(it))} · ${esc(host(it.url))}${it.meta ? ` · ${esc(it.meta)}` : ""}</div></div></div>`;
}

const LIST_ROWS = 4; // rows shown next to a topic's lead story; the rest fold away

export function renderEdition(ed: Edition, dates: string[], isLatest: boolean): string {
  const ranked = rank(ed.items, Date.parse(ed.generatedAt));
  const top = topPicks(ranked);
  const topUrls = new Set(top.map((i) => i.url));

  const kinds = ["hero", "tile", "tile", "tile", "tile", "wide", "wide"] as const;
  const topHtml = top.length
    ? `<section class="bento">${top.map((it, i) => card(it, kinds[i] ?? "tile", true)).join("")}</section>`
    : "";

  const topics = TOPICS.map((t) => {
    const list = ranked.filter((i) => i.topic === t.id && !topUrls.has(i.url));
    return { t, list, total: ranked.filter((i) => i.topic === t.id).length };
  });

  const chips = topics
    .filter((x) => x.list.length)
    .map(({ t }) => `<a class="t-${t.id}" href="#${t.id}"><i></i>${esc(shortLabel(t.id))}</a>`)
    .join("");

  const sections = topics
    .filter((x) => x.list.length)
    .map(({ t, list, total }) => {
      const [lead, ...rest] = list;
      const shown = rest.slice(0, LIST_ROWS);
      const hidden = rest.slice(LIST_ROWS);
      const side = shown.length ? `<div class="list">${shown.map(row).join("")}</div>` : "";
      const more = hidden.length
        ? `<details class="more"><summary>${hidden.length} more in ${esc(t.label)}</summary><div class="list">${hidden.map(row).join("")}</div></details>`
        : "";
      return `<section id="${t.id}" class="t-${t.id}"><h2><i></i>${esc(t.label)} <small>${total}</small></h2>
<div class="topic">${card(lead, "lead", false)}${side}${more}</div></section>`;
    })
    .join("");

  const idx = dates.indexOf(ed.date);
  const older = idx >= 0 ? dates[idx + 1] : undefined;
  const newer = idx > 0 ? dates[idx - 1] : undefined;
  const pager = `<div class="pager"><span>${older ? `<a href="/d/${older}">← ${older}</a>` : ""}</span><span>${newer ? `<a href="${idx - 1 === 0 ? "/" : `/d/${newer}`}">${newer} →</a>` : ""}</span></div>`;

  const okSources = SOURCES.filter((s) => ed.report[s.id] && !ed.report[s.id].startsWith("error")).length;
  const srcList = SOURCES.map((s) => {
    const r = ed.report[s.id] ?? "not run";
    const cls = r.startsWith("error") ? "err" : "ok";
    return `<li><span class="${cls}">●</span> ${esc(s.name)} <span style="color:var(--dim)">${esc(r.startsWith("error") ? "unavailable" : r)}</span></li>`;
  }).join("");

  const body = `<div class="intro"><h1>${esc(longDate(ed.date))}${isLatest ? "" : " <small style=\"color:var(--dim);font-weight:500\">archive</small>"}</h1>
<p>${top.length} top stories, ${ed.items.length} in all · updated ${ubTime(ed.generatedAt)} Ulaanbaatar</p></div>
${topHtml}${sections || (top.length ? "" : `<p class="empty">Nothing new today.</p>`)}${pager}
<footer style="border:0;margin-top:24px;padding-top:0"><details><summary>${okSources}/${SOURCES.length} sources worked today</summary><ul class="src">${srcList}</ul></details></footer>`;
  return page(`news.tseku.dev · ${ed.date}`, body, "", chips);
}

export function renderArchive(dates: string[]): string {
  const list = dates.length
    ? `<ol>${dates.map((d) => `<li><a href="/d/${d}">${esc(longDate(d))}</a> <span style="color:var(--dim)">${d}</span></li>`).join("")}</ol>`
    : `<p class="empty">No editions yet.</p>`;
  return page("news.tseku.dev · archive", `<div class="intro"><h1>Archive</h1></div><div class="simple">${list}</div>`);
}

export function renderBuilding(): string {
  return page(
    "news.tseku.dev · building",
    `<div class="intro"><h1>Building the first edition</h1>
<p>This page reloads itself while it gathers today's stories. It usually takes under a minute.</p></div>`,
    `<meta http-equiv="refresh" content="5">`,
  );
}

export function renderNotFound(): string {
  return page("news.tseku.dev · not found", `<div class="intro"><h1>Not found</h1><p>No edition here. <a href="/" style="text-decoration:underline">Go to today's brief.</a></p></div>`);
}
export function renderFeed(ed: Edition | null, origin: string): string {
  const items = (ed?.items ?? [])
    .map((it) => {
      const src = srcById.get(it.source);
      return `<item><title>${esc(it.title)}</title><link>${esc(it.url)}</link><guid isPermaLink="false">${esc(it.url)}</guid>${
        it.date ? `<pubDate>${new Date(it.date).toUTCString()}</pubDate>` : ""
      }<category>${esc(src?.topic ?? "tech")}</category><description>${esc([src?.name, it.summary].filter(Boolean).join(" — "))}</description></item>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>news.tseku.dev</title><link>${esc(origin)}/</link><description>Daily brief: technology, AI, software development, startups and Mongolia.</description>${
    ed ? `<lastBuildDate>${new Date(ed.generatedAt).toUTCString()}</lastBuildDate>` : ""
  }${items}</channel></rss>`;
}
