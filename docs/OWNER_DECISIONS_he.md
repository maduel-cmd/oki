# החלטות בעלים — פיצול אוקי (2026-08-29)

| # | שאלה | בחירה | משמעות |
| --- | --- | --- | --- |
| 1 | ריפו GitHub | **ג** → **פתרון ביניים** | אין ריפו נפרד (טוקן הסוכן לא יכול ליצור). יש **ענף `oki-family`** ב־`maduel-cmd/TrailLink` עם תוכן הפרויקט העצמאי בלבד |
| 2 | Netlify | **א** | אתר `oki-family-maduel` ← בנייה מ־`oki-family` (`npm run deploy:netlify`) |
| 3 | Supabase | **א** | אותו פרויקט כמו TrailLink |

## GitHub — איך זה נראה בפועל

- **סטטוס סוכן:** ענף **`oki-family` פעיל** — סוכני Cloud עובדים ישירות על הענף הזה (שורש = אוקי משפחה בלבד).
- ענף: https://github.com/maduel-cmd/TrailLink/tree/oki-family  
- בשורש הענף: `package.json`, `src/`, `AGENTS.md` (לא מונוריפו TrailLink)
- דחיפה מקומית:

```bash
cd oki-family
git push traillink main:oki-family
```

### סוכן Cloud על הענף

1. New Agent → ריפו **TrailLink**
2. Branch / ref: **`oki-family`** (לא `master`)
3. הדביקו פרומפט מ־`docs/AGENT_BOOTSTRAP_he.md`

כשיהיה PAT אישי עם הרשאת `repo` — אפשר ליצור `maduel-cmd/oki-family` ולהעביר את ההיסטוריה (`git push` לריפו חדש).

## פריסת Netlify

```bash
cd oki-family && npm run deploy:netlify
```

(האתר כרגע ב־manual deploy; אין קישור Git ב־Netlify UI.)

## Netlify — Git vs CLI

- פריסה פעילה ואמינה: `npm run deploy:netlify` (CLI) — **חובה על סוכן אחרי push**
- חיבור Git ל־branch `oki-family` הוגדר + נוצר deploy key ב־Netlify
- הוספת המפתח ל־GitHub דורשת `administration=write` — טוקן הסוכן **נדחה (403)**; Continuous Deploy מ־Git לא פעיל (`stop_builds=true`)
- מפתח ציבורי שמור ב־`docs/NETLIFY_DEPLOY_KEY.pub` לשימוש עתידי אם תהיה הרשאה
