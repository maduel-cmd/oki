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

- Netlify: `netlify.toml` בשורש (`npm run build` → `dist`)
- Supabase: הריצו את המיגרציות ב־`supabase/migrations/` (profiles → family → compounds)
- LiveKit: secrets ב־Edge Function `family-livekit-token`

## סוכנים

ראו [`AGENTS.md`](AGENTS.md) ו־[`docs/AGENT_BOOTSTRAP_he.md`](docs/AGENT_BOOTSTRAP_he.md).
