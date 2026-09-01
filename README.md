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

- Netlify אתר: `oki-family-maduel` — מפריסים מ־`oki-family/dist` (`npm run deploy:netlify`)
- בעלים נעל: תיקייה מקומית בינתיים (בלי GitHub); אותו Supabase כמו TrailLink — ראו `docs/OWNER_DECISIONS_he.md`
- Supabase: מיגרציות ב־`supabase/migrations/` (אם חסר בפרויקט הקיים)
- LiveKit: secrets ב־Edge Function `family-livekit-token`

## סוכנים

ראו [`AGENTS.md`](AGENTS.md) ו־[`docs/AGENT_BOOTSTRAP_he.md`](docs/AGENT_BOOTSTRAP_he.md).

## ריפו GitHub

הקוד מוכן לריפו עצמאי `maduel-cmd/oki-family`.
יצירת הריפו: [`docs/SETUP_GITHUB_he.md`](docs/SETUP_GITHUB_he.md).

עד אז: ענף ביניים https://github.com/maduel-cmd/TrailLink/tree/oki-family
