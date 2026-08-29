# אוקי משפחה — מצב פעיל (ops)

מרכז סוכנים: [`AGENTS.md`](../AGENTS.md)

## מה חייב לרוץ בענן

| רכיב | איפה |
| --- | --- |
| Client | `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` ב־`.env.local` / Netlify |
| Auth redirect | `VITE_AUTH_REDIRECT_URL` = כתובת האתר של אוקי |
| PTT | Edge `family-livekit-token` + secrets: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| DB | מיגרציות ב־`supabase/migrations/` (profiles → family → compounds) |

## פיתוח מקומי

```bash
cp .env.example .env.local
npm install
npm run dev   # http://127.0.0.1:5174
```

בלי Supabase — יצירת משפחה מקומית (demo). עם מפתחות — ענן.

## פריסת Netlify

`netlify.toml` בשורש הריפו: `npm run build` → `dist`.
