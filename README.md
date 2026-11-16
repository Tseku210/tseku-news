# news.tseku.dev

Personal daily news brief. One Cloudflare Worker fetches the sources in
`src/sources.ts` at 07:00 Ulaanbaatar (cron `0 23 * * *`), dedupes, and stores
the edition in KV.

```sh
npm install
npx wrangler deploy   # deploy
npx wrangler tail     # watch the daily run
npx tsc               # type-check
```

Pages: `/`, `/d/YYYY-MM-DD`, `/archive`, `/feed.xml`, `/api/latest.json`.
