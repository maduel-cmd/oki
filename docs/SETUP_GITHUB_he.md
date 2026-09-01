# יצירת ריפו GitHub — אוקי משפחה

הטוקן של סוכן הענן **לא יכול** ליצור repository (`gh repo create` → 403).  
צריך ליצור פעם אחת מהחשבון של הבעלים.

## אפשרות א (מומלץ) — דחיפת הענף הקיים עם היסטוריה

מהריפו TrailLink (יש כבר ענף `oki-family` עם כל ההיסטוריה):

```bash
# יצירת ריפו ריק ב-GitHub (באתר או ב-CLI)
gh repo create maduel-cmd/oki-family --public --description "אוקי משפחה — PWA משפחתי"

# דחיפת הענף כ-main בריפו החדש
cd TrailLink
git push git@github.com:maduel-cmd/oki-family.git oki-family:main
```

אחר כך ב-Netlify: חברו את האתר `oki-family-maduel` לריפו `oki-family` (branch `main`).

## אפשרות ב — מהארכיון / התיקייה המקומית

```bash
unzip oki-family-standalone.zip && cd oki-family
gh repo create oki-family --public --source=. --remote=origin --push
```

## אחרי שהריפו קיים

1. עדכנו ב-TrailLink את `docs/ops/OKI_FAMILY_EXTRACT_he.md` עם ה-URL הסופי.
2. סוכני Cloud: New Agent → ריפו **oki-family** (לא TrailLink).
3. הפסיקו לעבוד על ענף `TrailLink/oki-family` (או השאירו כארכיון בלבד).
