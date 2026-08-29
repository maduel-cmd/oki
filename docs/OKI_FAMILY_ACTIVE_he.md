# אוקי משפחה — מוד פעיל / LiveKit

מרכז סוכנים: [`apps/family/AGENTS.md`](../../apps/family/AGENTS.md)

## מה נדרש ל־PTT חי

| רכיב | איפה |
| --- | --- |
| Migrations `…007` + `…008` | Supabase SQL / `npm run live:up` מקומי |
| Edge `family-livekit-token` | `supabase functions deploy family-livekit-token` |
| Secrets | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (Edge) |
| Client | `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` ב־`apps/family/.env` |

בלי אלה האפליקציה עובדת במצב **מקומי / הדגמה** (BroadcastChannel + טון).

## מקומי (Docker)

```bash
npm run live:up              # Postgres + Auth + REST + .env ל־web ול־family
LIVEKIT=1 npm run live:up    # גם LiveKit + shim טוקן על :8788
npm run verify:family-schema # בדיקה סטטית ש־migrations/Edge קיימים
npm run test:family-e2e      # יצירה/הצטרפות + opt-in מיקום + חיבור LiveKit (שני משתתפים)
npm run dev:family           # http://127.0.0.1:5174
```

Auth redirect מקומי כולל `5174` (אוקי משפחה) ו־`5173` (TrailLink).
עם `LIVEKIT=1`, nginx מפנה `/functions/v1/family-livekit-token` ל־`scripts/family-livekit-local-server.mjs`.

## ענן (בעלים)

1. SQL Editor — הריצו לפי הסדר את שני קבצי ה־migration של המשפחה.  
2. Deploy Edge Function `family-livekit-token` + secrets של LiveKit.  
3. הגדירו `VITE_SUPABASE_*` (ו־`VITE_FAMILY_APP_URL`) בפריסת Netlify של `apps/family`.  
4. בדקו: שני משתמשים → יצירה/הצטרפות → PTT חי → שקט מחוץ לאזור `force_audio`.

## מדיניות מיקום (נעילה)

GPS מקומי לאכיפת אזורים/קווים בלבד.  
שיתוף למנהל **רק** אחרי `family_location_requests` + אישור (`last_lat` / `last_lng`).
