# החלטות בעלים — פיצול אוקי (2026-08-29)

| # | שאלה | בחירה | משמעות |
| --- | --- | --- | --- |
| 1 | ריפו GitHub | **ג** — תיקייה מקומית בלבד בינתיים | אין דחיפה ל־GitHub; git מקומי ב־`oki-family/` |
| 2 | Netlify | **א** — אתר `oki-family-maduel` מהבנייה של `oki-family` | פריסה מ־`oki-family/dist` (CLI); לא מ־`apps/family` |
| 3 | Supabase | **א** — אותו פרויקט כמו TrailLink | `VITE_SUPABASE_*` הקיימים; טבלאות `families*` |

## פריסת Netlify (מצב נוכחי — בלי ריפו GitHub)

```bash
cd oki-family
npm run build
npx netlify-cli deploy --prod --dir dist --site 29a19584-165d-4743-9139-7234676f5680 --no-build
```

או: `npm run deploy:netlify` (אם מוגדר ב־`package.json`).

כשיהיה ריפו GitHub נפרד — לחבר את האתר לאותו ריפו עם Base directory = שורש.

## סוכן

עבודה מקומית על `oki-family/`. סוכן Cloud נפרד — רק אחרי יצירת ריפו GitHub (עדיין לא נעול).
