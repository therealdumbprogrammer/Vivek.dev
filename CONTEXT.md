# Project Context

## Goal

Build a long-lived personal portfolio and blog with Astro, Tailwind CSS, Markdown content collections, and Cloudflare Pages.

## Stack

- Astro with static output
- Tailwind CSS
- Astro Content Collections
- Cloudflare Pages

## Phase Plan

1. Project scaffold
2. Blog infrastructure
3. Portfolio pages
4. Styling pass
5. SEO and performance
6. Deployment

## Current Status

Phases 1 through 5 are complete; Phase 6 is ready for the external Cloudflare Pages setup. The site includes personal identity and contact details, responsive portfolio/blog pages, YouTube playlist previews, automatic blog tag counts, local Space Grotesk headings, and SEO essentials.

The two placeholder blog posts have been replaced with 33 real articles migrated from the author's Medium account (3 kept as `draft: true`, pending a final polish pass before publishing). The homepage hero was rewritten with a personal introduction, an avatar, and a subtle dot-grid background; the Projects nav link was removed until real project content exists (the page itself, at `/projects`, is still in the codebase but unlinked).

## Decisions Log

- Use Astro file-based routing and small, plain Astro components.
- Keep shared site structure in `BaseLayout`.
- Store blog posts as Markdown in a typed `blog` content collection; exclude drafts from public routes.
- Keep project data local to the Projects page until real project content warrants a dedicated source.
- Use neutral surfaces, slate text, and a single blue accent with mobile-first responsive layout utilities.
- Centralize SEO metadata in `BaseLayout` and derive sitemap, RSS, and robots URLs from `SITE_URL`.
- Deploy as static files on Cloudflare Pages with `npm run build` and `dist`; no adapter or Wrangler configuration is required.
- Embed YouTube playlists through lazy-loaded `youtube-nocookie.com` iframes to keep homepage video previews dependency-free and privacy-enhanced.
- Calculate tag counts from published blog posts and display them in a responsive Blog-page topic panel; tags link to a per-tag archive page.
- Bundle Space Grotesk locally for headings; retain the system font stack for body copy.
- Migrate blog content from the author's Medium export (HTML) rather than hand-writing it; tags were inferred from title/content keywords since Medium's export doesn't include per-post tags, and should be reviewed for accuracy over time.
- Leave migrated post images hosted on Medium's CDN rather than downloading/self-hosting them, to keep the migration low-risk; revisit if those images ever become unavailable.
- Use a masked CSS radial-gradient (`.bg-dot-grid`) for the homepage hero background instead of an image asset, scoped to the hero section only so it doesn't compete with reading content elsewhere on the site.
- Keep `.claude/` (agent tooling/session config) out of version control; it's local development tooling, not part of the deployed site.

## Known Issues / TODO

- Connect the pushed GitHub repository to Cloudflare Pages.
- Choose a `*.pages.dev` or custom production domain and set `SITE_URL` in the Pages dashboard.
- Deploy, verify the production URL, then record it here and rebuild so canonical URLs, sitemap, RSS, robots, and JSON-LD use it.
- Review the 3 draft posts (`7-habits-of-agood-programmer`, `caching-a-quick-guide`, `mastering-caching-fundamentals`) and publish (flip `draft: false`) when ready.
- Spot-check auto-inferred tags across the 33 migrated posts for accuracy.
- Optional: self-host migrated post images instead of hotlinking Medium's CDN.
- Optional: replace the favicon with a final asset; add real project content to `/projects` and relink it in the header nav.

## How to Run Locally

Run `npm install`, then `npm run dev`. Use `npm run check` for Astro and TypeScript diagnostics, and `npm run build` for a production build.

## Deployment Notes

- Build command: `npm run build`
- Output directory: `dist`
- Production URL: https://vivek-dev.therealdumbprogrammer.workers.dev
- Full setup instructions: `DEPLOYMENT.md`
- GitHub repository: `https://github.com/therealdumbprogrammer/Vivek.dev`
- Initial commit: `129d0aa` (`Initial portfolio and blog site`) on `main`, pushed to `origin/main`
