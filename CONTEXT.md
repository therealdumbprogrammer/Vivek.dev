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

## Learning UI experiment — 2026-09-06

- Goal: validate a Learning section inside the personal blog, with a card-based hub and a persistent course contents sidebar inspired by fanout.sh, backend-from-first-principle.vercel.app, and the local Thinking in English handbook.
- Branch: `feature/learning-ui-experiment`. Local UI review only; no deployment.
- Scope: `/courses`, three sample track overviews (Course / Path / Collection), and seven short sample lessons. Shared sidebar, breadcrumbs, desktop on-page TOC, and previous/next navigation.
- Decisions: reuse Astro static routes, Tailwind utilities, existing typography/colors and BaseLayout. Small typed local data file; no CMS, accounts, completion tracking, or backend. Sidebar is sticky on desktop and collapsible on mobile; active lesson is marked on every page. Keep existing uppercase CONTEXT.md rather than create a duplicate context.md.
- Next: review desktop/mobile reading flow locally, settle naming and density, then replace samples with reviewed Markdown/content collections. Decide publishing/indexing behavior before shipping dummy routes.
- Local review: `npm run dev -- --host 127.0.0.1`; start at `/courses` and `/courses/jvm/runtime`.
- Verification: Astro check returned 0 errors/warnings/hints; production build passed (64 pages). All 11 learning routes return HTTP 200; internal learning links and TOC targets resolve. Browser checked hub → overview → lesson → next, TOC anchor, desktop layout and mobile contents collapse with no horizontal overflow. Dev server left running at http://127.0.0.1:4321.

- Visual iteration: learning hub now uses blue (JVM), green (Kubernetes), and warm amber (agents) cards with original stacked-card SVG illustrations and topic icons. Retains the existing fonts; no icon package or external image dependency.

- Visual direction revised after review: replace reference-like stacked cards with white editorial cards and original runtime pipeline, cluster topology, and agent decision-loop diagrams. Shared muted blue/teal/clay track accents carry into overview headers, active sidebar entries, lesson labels and callouts; body text and reading backgrounds stay neutral.

- Homepage discovery: added a Learning section between the introduction and featured playlists, with an Explore learning button and compact links to all three sample tracks using shared track data/colors.

- Homepage prominence pass: Learning now shares the hero with the personal introduction on desktop, using a navy panel and saturated blue/teal/apricot track links. Explore learning is the primary hero action (also visible before the panel on mobile). Reader page palettes stay restrained.
