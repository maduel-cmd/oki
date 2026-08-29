# אוקי משפחה — Family Walkie (אפליקציה נפרדת)

מפרט מורחב + **מרכז סוכנים:** [`apps/family/AGENTS.md`](../../apps/family/AGENTS.md) · [`docs/agents/OKI_FAMILY_he.md`](../agents/OKI_FAMILY_he.md)

## נעילות מוצר (2026-08-26)

| # | החלטה |
| --- | --- |
| 1 | **אפליקציה נפרדת** עם מיתוג «אוקי משפחה» — `apps/family` (לא מודול בתוך TrailLink) |
| 2 | **PTT = LiveKit** (כמו טיולים); נפילה להדגמה כשאין credentials |
| 3 | **מיקום למנהל רק בבקשה + אישור** (לא שיתוף רציף) |
| 4 | **PWA** מספיק לשלב ראשון |

## הרצה

```bash
npm run dev:family
# http://127.0.0.1:5174
```

TrailLink (`עוד` → אוקי משפחה) מפנה לאפליקציה הנפרדת (`VITE_FAMILY_APP_URL` או localhost:5174).

## יכולות

1. הרשאות מיקרופון + GPS (+ התראות)
2. יצירת משפחה (מנהל) / הצטרפות בקוד
3. PTT LiveKit או הדגמה (BroadcastChannel)
4. מצב שקט — חסום באזורי `force_audio`
5. אזורי GPS + קווי גבול עם התראות
6. בקשת מיקום opt-in

## Backend

- Migration: `supabase/migrations/20260826000008_family_walkie.sql`
- RPC: `supabase/migrations/20260826000009_family_walkie_rpcs.sql` (`create_oki_family` / `join_oki_family`)
- Edge: `supabase/functions/family-livekit-token`
- Domain: `packages/domain/src/familyWalkie.ts`
- API: `packages/api/src/families.ts` + `fetchFamilyLiveKitToken`
- מרכז סוכנים: [`apps/family/AGENTS.md`](../../apps/family/AGENTS.md)


## מפרט לייעוץ AI (עם צילומי מסך)

[`oki-family-brief/OKI_FAMILY_SYSTEM_BRIEF_he.md`](./oki-family-brief/OKI_FAMILY_SYSTEM_BRIEF_he.md) · ZIP: [`oki-family-brief.tgz`](./oki-family-brief.tgz)
