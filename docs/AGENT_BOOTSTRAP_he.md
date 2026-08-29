# פרומפט לסוכן חדש — אוקי משפחה (עצמאי)

העתיקו את הבלוק למטה לשיחה חדשה עם Cloud Agent / Composer על **הריפו `oki-family` בלבד** (לא TrailLink).

---

## פרומפט מוכן להדבקה

```
אתה סוכן על הריפו העצמאי «אוקי משפחה» (oki-family) — PWA משפחתי.
זה לא TrailLink ולא מונוריפו של ניווט שטח. אל תייבא @traillink/* ואל תפתח את TrailLink.

חובה לקרוא לפני קוד:
1. AGENTS.md (שורש)
2. .cursor/rules/hebrew-first.mdc + oki-family.mdc
3. docs/FAMILY_WALKIE_he.md (נעילות מוצר)

תקשורת איתי: עברית בלבד.

נעילות (לא לפתוח מחדש):
- מיתוג «אוקי משפחה»
- PTT = LiveKit (+ demo בלי credentials)
- מיקום למנהל = בקשה + אישור בלבד
- מתחמים = פוליגון סגור ≥3 נקודות; נראות/התראות להורים בלבד
- פורט dev: 5174 (`npm run dev`)

מבנה: src/ (UI) + src/lib/{domain,api,live,maps,i18n} + supabase/
Aliases: @oki/domain @oki/api @oki/i18n @oki/live @oki/maps

לפני שינוי קוד: גיבוי ל־backups/. אחרי שינוי: typecheck + test + commit.

המשימה שלי עכשיו: [תארו כאן]
```

---

## מה נדרש כדי להפעיל סוכן חדש מחוץ ל־TrailLink

### א׳. ריפו GitHub נפרד

**סטטוס בעלים (2026-08-29):** בינתיים **תיקייה מקומית בלבד** — בלי דחיפה ל־GitHub.  
כשתרצו סוכן Cloud עצמאי, צרו ריפו ואז:

1. צרו ריפו חדש ב־GitHub (למשל `maduel-cmd/oki-family`), **ריק**.
2. מהתיקייה הזו:

```bash
cd oki-family
git init
git add .
git commit -m "chore: bootstrap אוקי משפחה כריפו עצמאי"
git branch -M main
git remote add origin git@github.com:USER/oki-family.git
git push -u origin main
```

3. ב־Cursor: **New Cloud Agent** → בחרו את הריפו `oki-family` (לא TrailLink).
4. הדביקו את הפרומפט למעלה.

### ב׳. סביבת Cloud (Environment)

ב־Cursor Environments לריפו החדש מומלץ:

| שדה | ערך |
| --- | --- |
| Node | 22 |
| Install | `npm install` |
| Start (אופציונלי) | `npm run dev` |

Secrets / env לבילד:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_AUTH_REDIRECT_URL` (כתובת Netlify של אוקי)
- `NETLIFY_AUTH_TOKEN` (אם מפריסים מתוך הסוכן)

LiveKit — רק ב־Supabase Edge secrets, לא ב־Vite.

### ג׳. Netlify

1. אתר חדש (או העברת `oki-family-maduel`) עם **Base directory = שורש הריפו החדש**.
2. Build: `npm run build`, publish: `dist`.
3. העתיקו את משתני ה־env מאתר אוקי הקיים אם כבר קיים.

### ד׳. Supabase

- אפשר **אותו** פרויקט Supabase כמו TrailLink (טבלאות `families*` כבר שם), או פרויקט חדש + הרצת כל המיגרציות ב־`supabase/migrations/`.
- Edge Function: `family-livekit-token`.

### ה׳. TrailLink אחרי הפיצול

במונוריפו TrailLink השאירו רק קישור החוצה (`VITE_FAMILY_APP_URL`) לכתובת אוקי. אל תמשיכו לפתח `apps/family` שם.

---

## שאלות נפוצות לבעלים

**האם חובה ריפו GitHub נפרד?**  
כן, כדי שסוכן Cloud יהיה «לא חלק מ־TrailLink» באמת (הקשר, CI, PR נפרדים).

**אפשר להשאיר את התיקייה ליד TrailLink בלי ריפו?**  
לפיתוח מקומי כן; לסוכן עצמאי בענן — לא מספיק.
