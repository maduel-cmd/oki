# אוקי משפחה — מפרט מוצר (ריפו עצמאי)

מרכז סוכנים: [`AGENTS.md`](../AGENTS.md) · פרומפט לסוכן חדש: [`AGENT_BOOTSTRAP_he.md`](AGENT_BOOTSTRAP_he.md)

## נעילות שהוחלטו עם הבעלים

| # | נעילה |
| --- | --- |
| 1 | **אפליקציה עצמאית** עם מיתוג «אוקי משפחה» (לא מודול בתוך TrailLink) |
| 2 | **PTT = LiveKit** (נפילה להדגמה מקומית בלי credentials) |
| 3 | **מיקום למנהל = רק בבקשה + אישור** (לא שיתוף רציף אוטומטי) |
| 4 | לקוח ראשון = **PWA** |
| 5 | **מתחמים סגורים** (≥3 נקודות); נראות/התראות **להורים בלבד** |

## יכולות ליבה

- אוקי־אוקי משפחתי (החזק כדי לדבר)
- אזורי האזנה (force audio)
- מתחמי גדר סגורים + התראות כניסה/יציאה להורים
- בקשת מיקום חד־פעמית מילד/חבר

## ארכיטקטורה בקצרה

- PWA: `src/` (פורט 5174)
- Domain: `src/lib/domain/familyWalkie.ts`
- API: `src/lib/api/families.ts`
- Edge: `supabase/functions/family-livekit-token`
- Migrations: `supabase/migrations/`

TrailLink יכול להפנות לכאן דרך `VITE_FAMILY_APP_URL` (קישור בלבד).
