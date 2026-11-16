# news.tseku.dev

Personal daily news brief. One Cloudflare Worker fetches the sources in
`src/sources.ts` at 07:00 Ulaanbaatar (cron `0 23 * * *`), dedupes, and stores
the edition in KV.

```sh
npm install
npx wrangler deploy   # deploy
npx wrangler tail     # watch the daily run
npx tsc               # type-check
npx wrangler d1 migrations apply tseku-news --remote   # after schema changes
npx wrangler secret put ADMIN_TOKEN        # sign-in passphrase
npx wrangler secret put ANTHROPIC_API_KEY  # Haiku briefs and personalized ranking
```

Pages: `/`, `/d/YYYY-MM-DD`, `/archive`, `/search`, `/trends`, `/saved`, `/login`, `/feed.xml`, `/api/latest.json`.
