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

## Daily JVM Byte pipeline — first lesson, 2026-09-06

- Byte #1 now replaces the runtime sample at `/courses/jvm/runtime`, under Foundations. The original is preserved verbatim in `sources/daily-jvm/byte-001.md`; the authored draft lives in `src/content/lessons/jvm/runtime.md`.
- Added a typed `lessons` Markdown collection. Shared `getTracks()` merges authored entries with remaining samples; one visibility rule controls routes, counts, sidebar and previous/next links. Drafts are visible in development and excluded from production, including the old sample route they replace.
- Lesson tone follows the dedicated ai-toolkit course writing profile. Two original SVG diagrams explain runtime responsibilities and the route to compiled execution; full-size links support phone reading. Primary sources distinguish JVM specification guarantees from HotSpot behavior.
- The example was compiled, disassembled and run on OpenJDK 25.0.2 with a bounded heap. Source, actual compilation output and editorial review notes are retained under `sources/daily-jvm/byte-001/`.
- Verification: Astro check has zero errors/warnings/hints; build succeeds (63 production pages). All 11 local learning routes and lesson anchors resolve; draft route and links are absent from production HTML/sitemap. Desktop/mobile inspected, with no mobile page overflow.
- Next: review the lesson prose, depth and diagrams locally. Keep `draft: true` until publication is explicitly approved. Remaining JVM lessons are samples. Continue one source byte at a time using the same skill and source ID conventions; commit/push only after review.

## Introductory lesson revision — 2026-09-07

- User feedback: first draft was too technical and lacked an introductory purpose; teach conversationally and begin with the JVM at a high level.
- Rewrote byte-001 at the same URL around what a JVM does and its four main responsibilities. Kept the original short method to connect the parts; deferred diagnostic detail. Replaced both SVGs with larger, colored illustrations and added a revealable understanding check.
- Keep this editorial direction provisional until review. Source byte and prior execution evidence are preserved. Draft remains local-only on the existing feature branch. Next: review this version for voice, depth and visual usefulness before committing.

Revision verification: Astro check and production build pass; 11 local course routes and anchors checked; draft absent from production navigation/output; original byte unchanged. Desktop and 390px mobile inspected, both SVGs load without page overflow, and the answer disclosure responds to Space with a visible keyboard focus indicator.

## Editorial visual experiment — 2026-09-07

- Replaced the understated system/Space Grotesk direction with Fraunces display headings, DM Sans body copy, and JetBrains Mono code. This is a deliberate local review experiment; it gives the blog and course material a warmer editorial voice while retaining legible technical code.
- Added a warm paper background, subtle blue and peach atmosphere, a coral primary action, and stronger navy-to-blue Learning feature panel. The blog index now has an editorial label, warm topic panel, coral dates, and hover markers for posts.
- Verified the homepage, blog index, and JVM lesson locally. `npm run check` and `npm run build` pass. Keep the server running for review; decide whether this visual direction should be retained before cleaning the previous unused font dependencies.

## Learning scope locked — 2026-09-07

- Only the JVM course is visible during this phase. Kubernetes and agentic-system samples remain in local data as hidden future experiments and do not generate cards or routes.
- The JVM course contains the authored introduction and a single “Heap and native memory” placeholder. Removed the Native Memory Tracking sample and its Diagnostics section until real source material is processed.
- Placeholder pages contain only a clear planned-lesson state; they do not present generated sample teaching content as course material.

## First lesson accepted — 2026-09-07

- “What the JVM actually is” is no longer a draft. It is included in production routes, course counts, navigation, and the sitemap.
- The accepted course currently contains this published introduction and one explicit memory placeholder. This records content visibility only; no site deployment was performed.

## JVM Byte #1 technical refinement — 2026-09-08

- Refined byte-001 in Foundations at `/courses/jvm/runtime` after review: retain the conversational introduction while restoring a concrete profiling/JIT journey and an explicit Execution / Memory / Runtime Services model.
- Added one Customer example connecting compiled code, code cache, GC reference maps and safe runtime coordination. Qualified conceptual heap allocation to leave room for escape analysis/scalar replacement.
- Closing flow now runs from putting the pieces together through the three-system model, the existing -Xmx reasoning check, and “Memory? Execution? Runtime coordination?” diagnosis prompts to the memory placeholder.
- Kept accepted visibility, existing SVGs, source byte and course conventions. Changes remain uncommitted on `feature/learning-ui-experiment`; next step is local editorial review.
- Verification: Astro check returned zero errors/warnings/hints; production build passed (57 pages). Local desktop and 390px mobile checks confirmed loaded images, valid anchors, no page/code-block horizontal overflow, and a working reasoning disclosure. An initial content-sync duplicate-ID warning did not recur on the final check; only one lesson source exists. Preview: http://127.0.0.1:4321/courses/jvm/runtime. No new executable example was added.


## Daily JVM Byte #2 converted — 2026-09-08

- Converted byte-002 into JVM Lesson 2, “JVM process memory — heap is only one part”, at `/courses/jvm/memory`, Foundations order 20. Source preserved in `sources/daily-jvm/byte-002.md`; review notes in `sources/daily-jvm/byte-002/review.md`.
- Kept Lesson 1's course prose, figure/full-size link, source disclosure and reasoning-check conventions. Added an original editable process-memory SVG.
- Accuracy decisions: heap is not process memory; -Xss/platform-thread reservation is not RSS; distinguish reserved/committed/resident; Metaspace follows loader lifecycle; Code Cache, direct buffers and HotSpot internals need native memory. GC manages heap lifetime, with related cleanup participation, not all native allocation. -Xmx does not cap RSS; container/cgroup accounting needs measured headroom. NMT is HotSpot-focused and incomplete for native allocations.
- Shared metadata orders runtime → memory → object-layout preview locally. Memory remains draft and excluded from production paths/navigation. Removed the published runtime prose link to the now-draft route to avoid a broken production link. Object-layout preview uses its own summary, not memory-specific boilerplate.
- Preserved pre-existing uncommitted Lesson 1 refinements. Branch remains `feature/learning-ui-experiment`; no commit, push or deployment. Next: editorial review of Lesson 2, then supply the object-layout byte.

- Verification: final Astro check has zero errors/warnings/hints; production build passes (57 pages); memory draft URL absent from all production HTML/XML. Desktop/390px mobile inspected; diagram, anchors, keyboard check, overview/sidebar and runtime → memory → object-layout navigation work without page overflow. NMT summary/baseline/summary.diff and direct-buffer allocation validated on a bounded OpenJDK 25.0.2 process; source and actual output saved with byte-002 review notes. Container budget is illustrative, not a reproduced OOM. Preview remains at http://127.0.0.1:4321/courses/jvm/memory.

## Lesson 2 accepted — 2026-09-08

- User reviewed and accepted JVM Lesson 2. Set memory.md to `draft: false`; it now participates in production routes, counts, sidebar, previous/next navigation and sitemap. Restored Lesson 1’s direct prose link to Lesson 2.
- This supersedes the local-draft status above. Object-layout remains an explicit planned preview.
