# khybertraders / animalhealth.pk

## Before editing anything: verify the local checkout is current

This sandbox's container is ephemeral and gets reclaimed after periods of inactivity. When a
new container spins up, it has repeatedly been observed to restore the repo from a stale
filesystem snapshot instead of the true current state — the local branch pointer can sit many
commits behind `origin` even though `origin` itself is correct and current.

`git fetch` alone will NOT fix this: fetch only updates the `origin/<branch>` remote-tracking
ref, never your local branch ref. You must explicitly compare and pull.

**Run this before touching any tracked file, every session/turn:**

```bash
git fetch origin claude/website-improvements-tlKIS
git log --oneline -1                                        # local
git log --oneline -1 origin/claude/website-improvements-tlKIS  # remote truth
```

If local is behind, confirm it's a clean ancestor (safe fast-forward, nothing local to lose)
before pulling:

```bash
git log origin/claude/website-improvements-tlKIS..HEAD --oneline   # must be EMPTY
git pull --ff-only origin claude/website-improvements-tlKIS
```

If that log is *not* empty, stop and investigate — there's uncommitted/unpushed local work
that a fast-forward would strand. This has not happened so far (local has always been a strict
ancestor of origin), but don't assume it always will be.

## Branch / deploy model

- **`main`** — production-stable, intact. Never push here directly. The user merges
  `claude/website-improvements-tlKIS` into `main` manually, at their own discretion, or asks
  Claude to do it explicitly. Treat a request to merge as one-time, not standing permission.
- **`claude/website-improvements-tlKIS`** — where all Claude work happens. Deploy-from-any-branch
  is enabled on `deploy.yml` (`on: push:` with no branch filter, plus `workflow_dispatch:`), so
  every push to this branch goes live on `animalhealth.pk` immediately. This is deliberate
  (confirmed with the user) — there is no staging/review gate.
- **`sync_products.yml`** (hourly cron + `workflow_dispatch`) regenerates `/s/*.html`,
  `/c/*.html`, `sitemap.xml`, `sitemap.html`, `products.json` from Firestore, commits with the
  built-in `GITHUB_TOKEN`, and then explicitly triggers `deploy.yml` itself via `gh workflow run`
  (bot commits do not auto-fire other `push`-triggered workflows — GitHub's anti-recursion
  behavior — so this explicit trigger step is required and must not be removed).

## Verify before you deploy

For any change to `index.html`, `assets/cart.js`, or the `sync_products.yml` page generator:
render the actual change in a real headless Chromium browser (Playwright is installed at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`) before pushing, not just a syntax check.
`animalhealth.pk`, Cloudinary, and most CDNs (Tailwind, Google Fonts, Font Awesome, GA4) are
blocked by this sandbox's network proxy — `firestore.googleapis.com` REST calls and
`registry.npmjs.org` are not. Patterns already established and working:

- Fetch real product data via direct REST calls to `firestore.googleapis.com` rather than the
  `firebase-admin` SDK (which needs gRPC, not just REST, and won't traverse the proxy).
- Stub `gstatic.com` (Firebase SDK) and CDN hosts via Playwright's `page.route()`.
- For anything that depends on real Tailwind utility classes (not just structural HTML), build
  actual CSS locally with `npx tailwindcss` (the `tailwindcss` npm package installs fine via the
  allowed `registry.npmjs.org`) and inject it in place of the CDN stub — a no-op Tailwind stub
  under-renders `hidden`/`fixed`/etc. and gives a misleading screenshot.
- Confirm zero *real* console errors (`ERR_TUNNEL_CONNECTION_FAILED` / `ERR_CONNECTION_RESET` on
  blocked-host images/CDNs are expected sandbox noise, not bugs).
- After pushing, do a final `git show origin/<branch>:<path>` spot-check against the actual
  deployed commit — don't just trust that what you tested locally is what got committed.
