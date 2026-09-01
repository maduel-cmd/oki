# החלטות בעלים — פיצול אוקי

| # | שאלה | בחירה | משמעות |
| --- | --- | --- | --- |
| 1 | ריפו GitHub | **מוכן לדחיפה** | עץ עצמאי + ארכיון; יצירת `maduel-cmd/oki-family` דורשת פעולת בעלים — ראו `docs/SETUP_GITHUB_he.md` |
| 2 | Netlify | **א** | אתר `oki-family-maduel` ← `npm run deploy:netlify` / חיבור לריפו החדש |
| 3 | Supabase | **א** | אותו פרויקט כמו TrailLink (migrations ב־`supabase/`) |

## מצב נוכחי (הכנת ריפו נפרד)

- תיקייה מקומית: `/home/ubuntu/oki-family`
- ארכיון: `/opt/cursor/artifacts/oki-family-standalone.zip`
- ענף ביניים ב-TrailLink: `oki-family`
- הוראות: [`SETUP_GITHUB_he.md`](./SETUP_GITHUB_he.md)

## פקודת דחיפה אחרי `gh repo create`

```bash
git push git@github.com:maduel-cmd/oki-family.git main
# או מ-TrailLink:
# git push git@github.com:maduel-cmd/oki-family.git oki-family:main
```
