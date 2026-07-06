# khybertraders
Official Website of Khyber Traders (Wholesale Vet. Pharmacy) Karachi [AnimalHealth.PK]

## Architecture

- `index.html` — public site, reads products live from Firestore
- `admin.html` — password-protected product/category admin panel (Firebase Auth + Firestore)
- `s/*.html`, `c/*.html` — static redirect pages carrying per-product/per-category Open Graph
  preview tags (product photo / branded category card) so WhatsApp link previews render correctly
- `.github/workflows/sync_products.yml` — hourly job (also `workflow_dispatch`) that reads
  Firestore and regenerates `s/`, `c/`, `images/og/`, and `products.json`; runs from `main`
  since GitHub only fires scheduled workflows off the default branch
- `.github/workflows/deploy.yml` — publishes the repo to GitHub Pages (`animalhealth.pk`) on
  every push to `main`
- `assets/fonts/` — Playfair Display, Manrope, Font Awesome Solid, bundled so category-card
  rendering in CI has no external font dependency
