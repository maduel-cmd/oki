# אוקי משפחה

PWA משפחתי עצמאי: אוקי־אוקי (LiveKit PTT), אזורי האזנה, מתחמים סגורים להורים, בקשת מיקום חד־פעמית.

**לא חלק מ־TrailLink.**

## התחלה מהירה

```bash
cp .env.example .env.local   # מלאו VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev                  # http://127.0.0.1:5174
```

בלי מפתחות Supabase — אפשר ליצור משפחה מקומית (demo). עם מפתחות — ענן + Auth.

## פריסה

- Netlify: אתר `oki-family-maduel` — `npm run deploy:netlify`
- Supabase: מיגרציות ב־`supabase/migrations/` (אותו פרויקט כמו TrailLink — ראו `docs/OWNER_DECISIONS_he.md`)
- LiveKit: secrets ב־Edge Function `family-livekit-token`
- סדר פריסה אחרי שינוי סכימה: DB ← Edge ← Netlify

## אבטחה ופרטיות

הקשחת 2026-11-13 והכרעות פתוחות: [`docs/DECISIONS_2026-11-13_he.md`](docs/DECISIONS_2026-11-13_he.md).
תרחישי בדיקה ל־RLS: `supabase/tests/security_hardening_scenarios.sql`.

## סוכנים

ראו [`AGENTS.md`](AGENTS.md) ו־[`docs/AGENT_BOOTSTRAP_he.md`](docs/AGENT_BOOTSTRAP_he.md).

## ריפו GitHub

`maduel-cmd/oki` (ריפו עצמאי).
