# AGENTS.md — אוקי משפחה (ריפו עצמאי)

> **מרכז הסוכנים** למוצר «אוקי משפחה».  
> זה **לא** חלק מ־TrailLink. אל תייבאו `@traillink/*` ואל תפתחו את מונוריפו TrailLink לצורך פיצ'רים כאן.

תקשורת עם המשתמש: **עברית** (ראו `.cursor/rules/hebrew-first.mdc`).

---

## נעילות מוצר (לא לפתוח מחדש בלי בעלים)

| # | נעילה |
| --- | --- |
| 1 | מיתוג **«אוקי משפחה»** — אפליקציה עצמאית |
| 2 | PTT = **LiveKit** (נפילה להדגמה בלי credentials) |
| 3 | מיקום למנהל = **רק בבקשה + אישור** (לא שיתוף רציף) |
| 4 | לקוח = **PWA** (Vite, פורט 5174) |
| 5 | מתחמים = **צורה סגורה** (≥3 נקודות); נראות/התראות **להורים בלבד** |

מפרט: [`docs/FAMILY_WALKIE_he.md`](docs/FAMILY_WALKIE_he.md)

---

## מבנה

| נתיב | תפקיד |
| --- | --- |
| `src/` | UI, state, מיתוג |
| `src/lib/domain` | אזורים / שקט / מתחמים |
| `src/lib/api` | Supabase client + families + LiveKit token |
| `src/lib/live` | LiveKit session + טון הדגמה |
| `src/lib/maps` | MapLibre style + RTL plugin |
| `src/lib/i18n` | he/ar/en (מפתחות family + auth) |
| `supabase/migrations` | profiles מינימלי + family + compounds |
| `supabase/functions/family-livekit-token` | Edge ל־PTT |

Aliases: `@oki/domain`, `@oki/api`, `@oki/i18n`, `@oki/live`, `@oki/maps`.

---

## פקודות

```bash
npm install
npm run dev          # http://127.0.0.1:5174
npm run build
npm run typecheck
npm run test
```

Env: העתיקו `.env.example` → `.env.local` עם `VITE_SUPABASE_*`.

---

## מה לא לעשות

- לא לערבב קוד TrailLink / ניווט שטח / trips / SOS.
- לא להחזיר סימון קו עיפרון במקום מתחם סגור.
- לא לשתף מיקום רציף בלי בקשה+אישור.
