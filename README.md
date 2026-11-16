# news.tseku.dev

A personal daily news brief: technology, AI, software development, startups and
Mongolian startups. It is one Cloudflare Worker that fetches public feeds every
morning, dedupes them, stores the day's edition in Workers KV and serves it as a
plain, fast page. No chat session or server of yours is involved after deploy.

## Deploy

```sh
npm install
npx wrangler login      # once, opens Cloudflare in your browser
npx wrangler deploy
```

Then open https://news.tseku.dev once. The first edition builds itself while the
page reloads (about a minute). After that it refreshes on its own every day.

`wrangler deploy` attaches `news.tseku.dev` as a Custom Domain and creates its
DNS record, because the `tseku.dev` zone is in the same Cloudflare account. The
KV namespace `tseku-news` already exists and its id is in `wrangler.toml`.

## Schedule

Cron `*/10 23 * * *` = six firings, 07:00 to 07:50 Ulaanbaatar time. Each firing
fetches two or three sources and the 07:50 firing publishes the edition. This is
split up so each firing stays inside the Workers Free plan's 10 ms CPU limit, and
it counts as one of the account's Cron Triggers (Free allows 5).

TLDR sends its issues in the US morning, so the 07:00 run picks up the issue from
the evening before.

## Sources

| Topic | Source | How |
| --- | --- | --- |
| AI | TLDR AI | `https://tldr.tech/api/rss/ai`, then the newest issue page, split into stories |
| AI | OpenAI News | `https://openai.com/news/rss.xml` |
| AI | Hugging Face Blog | `https://huggingface.co/blog/feed.xml` |
| AI | Simon Willison | `https://simonwillison.net/atom/entries/` |
| AI | TechCrunch AI | `https://techcrunch.com/category/artificial-intelligence/feed/` |
| Dev | TLDR Dev | `https://tldr.tech/api/rss/webdev` |
| Dev | GitHub Blog | `https://github.blog/feed/` |
| Dev | The Pragmatic Engineer | `https://blog.pragmaticengineer.com/rss/` |
| Startups | TLDR Founders | `https://tldr.tech/api/rss/founders` |
| Startups | TechCrunch Startups | `https://techcrunch.com/category/startups/feed/` |
| Tech | TLDR Tech | `https://tldr.tech/api/rss/tech` |
| Tech | Hacker News | Algolia API, front page stories with 100+ points |
| Mongolia | Launchpad.mn | home page product launches (the site has no feed) |
| Mongolia | iKon.mn Технологи | `https://ikon.mn/l/7` technology section |

Add or remove sources in `src/sources.ts`. Keep the total under about 40 fetches
per run on the Free plan (50 subrequest limit; each TLDR source uses two).

Only headlines, links and a short trimmed summary are stored. Sponsored TLDR
items and tracking parameters are dropped.

## Pages

- `/` today's edition, grouped by topic
- `/d/YYYY-MM-DD` a past edition (kept 180 days)
- `/archive` list of editions
- `/feed.xml` RSS of today's edition
- `/api/latest.json` today's edition as JSON

## Useful commands

```sh
npx wrangler tail                  # watch the cron runs live
npx wrangler kv key get --binding NEWS --remote latest
npx tsc                            # type-check
```

## Later: AI summaries

Not included yet. A one-paragraph "today in short" per topic could be added with
Workers AI (a free daily allowance, no key needed) or the Claude API (an API key
added with `npx wrangler secret put ANTHROPIC_API_KEY`).
