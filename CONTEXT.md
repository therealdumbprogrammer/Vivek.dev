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

## Lesson 2 memory terminology simplified — 2026-09-09

- Simplified the reserved/committed/resident explanation below the process-memory diagram with an illustrative 1 GB reserved → 300 MB committed → 180 MB resident walkthrough and compact hierarchy. Added a brief RSS definition and a 4 GB reserved heap / 1.8 GB process RSS comparison.
- Preserved the rest of Lesson 2 and its accepted visibility on `feature/learning-ui-experiment`. Next: review the revised explanation locally at http://127.0.0.1:4321/courses/jvm/memory.


## Daily JVM Byte #3 converted — 2026-09-09

- Converted byte-003 and the reviewed originating draft into Lesson 3, “Object layout inside the heap”, Foundations order 30, prerequisite memory. Local draft at `/courses/jvm/object-layout`, on `feature/learning-ui-experiment`.
- Illustration-first teaching: eight editable SVGs show heap zoom, conventional header, Klass pointer, separate referenced objects, 24-byte User alignment, compact headers, scale effects, and object graphs. Reused the accepted course shell, voice, full-size image links and disclosure styles.
- Explicitly distinguish implementation settings from Java guarantees, internal vs trailing padding, class pointers vs object references, shallow vs retained size, and conventional vs JDK 25 compact headers (product feature, disabled by default). Kept the 24-byte example and source-order caveat.
- Navigation/sidebar now connect Lesson 2 → Lesson 3 → references/reachability/GC-roots preview. Assign placeholder order before filtering authored replacements. Draft lesson stays excluded from production navigation and routes; Lesson 2 names it in prose without a production dead link.
- Original byte, reviewed draft, editorial notes and small JDK probe retained under `sources/daily-jvm/byte-003*`. OpenJDK 25.0.2 confirms User and the additional-boolean variant are 24 bytes in both tested header modes; offsets remain illustrative.
- Verification: Astro check has zero errors/warnings/hints, build succeeds (58 pages); draft route/links excluded from production. Desktop and 390px mobile checked for SVG loading, anchors, navigation, overflow and keyboard disclosure. Local server remains at http://127.0.0.1:4321/courses/jvm/object-layout.
- Next: review Lesson 3 locally. Changes remain uncommitted; existing Lesson 2 revisions preserved.

### Lesson 3 class-metadata clarification — 2026-09-09

- Expanded the `java.lang.Class` sentence into a concrete `User.class` / `user.getClass()` explanation. The lesson now distinguishes the heap-resident Java-facing class mirror from HotSpot's internal native `Klass` metadata and shows how both represent the same loaded class.


## Daily JVM Byte #4 converted — 2026-09-09

- Converted byte-004 and its reviewed draft into Lesson 4, “GC roots, reachability, and why GC is graph traversal”, Foundations order 40, prerequisite object-layout. Local draft: `/courses/jvm/gc-roots-reachability`.
- Graph-first visual teaching reuses the Lesson 3 object graph and adds nine editable SVGs for roots, root sources, the concrete thread-root example, transitive reachability, cycles, marking, reachable leaks, root paths, and dominator intuition.
- Preserved root-set starting-reference semantics; stack/register/static/JNI/VM sources; precise interpreter/JIT frame metadata and OopMap intuition; strong-reference and collection-timing limits; unwanted retention; and retained-size alternate-path caveat with reasoning checks.
- Shared navigation connects Lesson 3 → Lesson 4 → collection-strategies preview. Source and reviewed draft preserved under `sources/daily-jvm/byte-004*`. Lesson 4 stays excluded from production routes/navigation. Existing Lesson 3 and memory changes preserved; branch remains `feature/learning-ui-experiment`, changes uncommitted.
- Next: local editorial review of Lesson 4, then the mark-sweep/mark-compact/copying byte.
- Original verification: Astro check reported zero errors/warnings/hints; production build passed (59 pages). Lesson 4 and its links were absent from production HTML/XML. The original nine lesson SVGs parsed and loaded; desktop navigation, headings, old-preview redirect, and narrow layout with keyboard reasoning disclosure were checked. Cache declaration wrapped for narrow reading. HotSpot frame.cpp confirms interpreter map and compiled OopMap scanning; no JVM experiment was run for these conceptual examples. Dev server: http://127.0.0.1:4322/courses/jvm/gc-roots-reachability. A transient Astro content-sync duplicate-ID warning occurred during concurrent dev/check; only one source file exists for each lesson.
- Reader-review refinement on 2026-09-10: added a concrete `main` → `t1` → `processOrder` example and a thread-root SVG, bringing the lesson to ten SVGs including the reused object graph. Clarified that `main` starts and joins `t1`, while the root path to Order comes from the live `order` reference in `t1`'s execution state; GC scans a root set across relevant threads rather than treating main as a single master root. Exact stack/register placement remains implementation- and optimization-dependent. Astro check again reported zero errors/warnings/hints and the production build passed (62 pages); the draft remained absent from production output. Desktop and 390px mobile views verified with all images loaded and no page or code overflow; the textual root path is stacked vertically for narrow screens.


## Daily JVM Byte #5 converted — 2026-09-09

- Converted byte-005 into Lesson 5, “Mark-Sweep vs Mark-Compact vs Copying GC”, Foundations order 50 at `/courses/jvm/gc-reclamation-strategies`. Illustration-first GC algorithm comparison with seven editable SVGs.
- Preserved building-block framing, fragmentation/free-list bookkeeping, compaction/bump allocation, reference relocation correctness, copying survivor cost versus total work, survival comparison, table, reasoning checks, and generational bridge.
- Navigation connects Lesson 4 → Lesson 5 → generational-gc preview. Former collection-strategies URL redirects according to draft visibility. Source byte and reviewed draft archived. Lesson stays a local draft; existing edits preserved on feature/learning-ui-experiment. No commit, push, or deployment.
- Next: local editorial review of Lesson 5, then the generational-GC byte.
- Lesson 5 visual revision: the opening three-strategy comparison now shows copying as an explicit from-space → to-space transition, so it no longer resembles the compacted result.
- Lesson 5 prose revision: expanded the semispace capacity trade-off with a 1 GB → two 500 MB spaces example, role swapping after collection, the equal-size worst-case guarantee, and the distinction from region-based evacuation.
- Verification: final Astro check reports zero errors/warnings/hints; production build passes (60 pages). All seven SVGs parse, load, and were visually inspected. Desktop and 390px mobile checked; table scroll is contained and code has no overflow. Reasoning disclosure opens with Enter; overview, sidebar, heading anchors, Lesson 4 ↔ Lesson 5 ↔ generational preview and legacy redirect verified. Draft URL/links absent from production HTML/XML. One transient content-sync duplicate-ID warning occurred with dev/check; exactly one byte-005 source entry exists. Examples are illustrative, not executed JVM measurements. Server remains at http://127.0.0.1:4323/courses/jvm/gc-reclamation-strategies.


## Daily JVM Byte #6 converted — 2026-09-09

- Converted byte-006 and the reviewed originating draft into Lesson 6, “Generational GC — Eden, Survivor, and promotion”, Foundations order 60 at `/courses/jvm/generational-gc`. Nine editable SVGs support an illustration-first generational-GC teaching approach.
- Preserved classic Eden/S0/S1 conceptual framing, G1 regions and special allocation caveat, dynamic tenuring, mutator/write-barrier/remembered-metadata intuition, and distinct allocation/survival/promotion/occupancy measurements.
- Navigation connects Lesson 5 → Lesson 6 → write-barriers/card-tables/remembered-sets preview. Lesson 6 remains a local draft on feature/learning-ui-experiment; existing edits preserved. Source and review notes saved under sources/daily-jvm/byte-006*.
- Next: local editorial review, then supply Byte #7. Examples and rates are illustrative, not executed JVM measurements.

- Verification: Astro check returned zero errors/warnings/hints; production build passed (60 pages), with Lesson 6 route and HTML links excluded. Nine SVGs parse, load, and were visually inspected. Desktop and 390px mobile checked without page/code overflow; heading anchors, keyboard reasoning disclosure, overview/sidebar, and Lesson 5 → 6 → next preview verified. One transient duplicate-ID content-sync warning for existing Lesson 5 occurred before clean build sync; no duplicate Byte #6 source exists. Local server remains at http://127.0.0.1:4324/courses/jvm/generational-gc.


## Daily JVM Byte #7 converted — 2026-09-09

- Converted byte-007 into Lesson 7, “Write barriers, card tables, and remembered sets”, Foundations order 70, prerequisite generational-gc. Local draft at `/courses/jvm/write-barriers-card-tables`.
- Seven editable SVGs support an illustration-first explanation of barriers/cards/remembered sets. Preserved coarse dirty-card semantics, incoming-source metadata, G1 grouping, hot-path and concurrent cost trade-offs, and production reasoning checks.
- Navigation connects Lesson 6 → Lesson 7 → TLAB/bump-pointer allocation preview; former Lesson 7 preview redirects with draft visibility respected. Source and editorial notes archived. Existing edits preserved on feature/learning-ui-experiment; changes remain uncommitted.
- Next: local editorial review, then the allocation-internals byte. Examples are illustrative, not measured JVM output.

- Verification: Astro check reports zero errors/warnings/hints; build passes (61 pages). Draft Lesson 7 route and production links are absent. All seven SVGs parse, load, and were visually inspected; card-table label spacing corrected after review. Desktop and 390px mobile verified with no page overflow, working keyboard disclosure and valid heading targets. Existing transient content-sync duplicate-ID warning occurred for Lesson 6; clean build sync succeeded. Preview server: http://127.0.0.1:4325/courses/jvm/write-barriers-card-tables.
- Simplified the selected-card explanation after review: card metadata reduces how much of Old must be searched, while young GC still scans roots, follows live objects, copies survivors, and updates references. Kept the coarse-card caveat in plain language.
- Rewrote the remembered-set section around the concrete old `Customer` → young `Order` example. It now distinguishes “where did a write happen?” (card table) from “where outside the collection target should GC look?” (remembered set), with a four-step flow and an explicit collector-specific caveat. Astro check and production build pass; the rendered section and comparison table were visually inspected at http://127.0.0.1:4328/courses/jvm/write-barriers-card-tables#a-remembered-set-tells-gc-where-to-look.
- Refined the explanation again after reader review: a remembered set is target-oriented information, not generally a hash table of every dirty card. Added the G1-style dirty-card refinement step, explained why a remembered entry can remain after a card is cleaned, and replaced the ambiguous “REMEMBER INCOMING SOURCES” graphic with a five-stage card-table → refinement → remembered-set → young-GC flow. The SVG parses, Astro check and production build pass, and the revised flow was visually inspected at http://127.0.0.1:4329/courses/jvm/write-barriers-card-tables#a-remembered-set-tells-gc-which-outside-cards-to-scan.
- Removed the vague term “remembered information” throughout Lesson 7 and now names only the card table and remembered set. The section and flow diagram explicitly show the post-refinement states: Card 17 may be clean in the card table while the remembered set for Young still lists Card 17, because “write processed” and “reference may still exist” are different facts. The revised page and diagram were visually checked at http://127.0.0.1:4330/courses/jvm/write-barriers-card-tables#a-remembered-set-tells-gc-which-outside-cards-to-scan; Astro check and production build pass.
- Clarified how G1 refinement discovers dirty cards: the write barrier identifies the source card and hands its number to pending refinement work, typically through a small buffer. Background refinement processes that work while the application runs; a GC pause can finish a backlog. The lesson and SVG now state explicitly that G1 does not scan all of Old to rediscover which cards changed. The SVG parses, Astro check and production build pass, and the revised prose and diagram were visually inspected at the local Lesson 7 URL.


## Daily JVM Byte #8 converted — 2026-09-09

- Converted byte-008 and the available reviewed originating draft into Lesson 8, “TLABs and why object allocation is usually very cheap”, Foundations order 80, prerequisite write-barriers-card-tables, at `/courses/jvm/tlabs-allocation`.
- Eight original editable SVGs support an illustration-first allocation-internals teaching approach. Preserved dynamic allocation slices, shared-pointer contention intuition, bounds check/bump/initialization, separate constructor work, amortized refill, tail waste, and collector-specific outside-TLAB behavior.
- Clarified ordinary shared heap object semantics versus ThreadLocal, carrier/platform allocation state for virtual threads, and allocation rate versus cost and retention. JFR distinguishes cumulative thread counters, refill-triggering allocations, outside-TLAB allocations, and weighted samples; platform counters are not a per-virtual-thread census.
- Shared metadata connects Lesson 7 → Lesson 8 → escape-analysis/scalar-replacement preview. Old TLAB preview URL redirects with draft visibility respected. Source and available reviewed draft archived; retrieval truncation documented in review notes.
- Local draft on feature/learning-ui-experiment; all prior edits preserved and changes uncommitted. Next: local editorial review of Lesson 8. Examples are illustrative, not benchmark measurements.

- Verification: Astro check reports zero errors/warnings/hints; production build passes (62 pages). Draft Lesson 8 route and links excluded from production. All eight SVGs parse, load, and were visually inspected. Desktop and a 390px iframe verified; no page or code overflow after shortening pseudocode. Keyboard disclosures, heading anchor, sidebar/overview, Lesson 7 ↔ Lesson 8 ↔ escape-analysis preview and legacy redirect checked. Viewport override was ineffective, so narrow QA used an iframe. Transient content-sync warnings occurred for Lessons 7/8 during dev/check; one source file per lesson exists and clean build sync succeeded. Build/content sync left the reused server overview stale; started a fresh server and verified correct Lesson 8 overview, assets and navigation at http://127.0.0.1:4326/courses/jvm/tlabs-allocation.


## Daily JVM Byte #9 converted — 2026-09-09

- Converted byte-009 and the reviewed originating draft into Lesson 9, “Escape analysis and scalar replacement”, Foundations order 90, prerequisite tlabs-allocation, at `/courses/jvm/escape-analysis-scalar-replacement`.
- Eight editable SVGs support the illustration-first explanation. Escape analysis is separated from scalar replacement; NoEscape is an opportunity rather than a guarantee; scalar decomposition is distinguished from general stack allocation.
- Preserved NoEscape/ArgEscape/GlobalEscape intuition, inlining scope, lock elimination, source `new` versus heap allocations, warmed-up profiling and JMH caution, practical guidance, reasoning checks, and deoptimization materialization as a bridge to later JIT lessons.
- Navigation connects Lesson 8 → Lesson 9 → class-loading-lifecycle preview. The final decision tree places TLAB and outside-TLAB machinery under real allocation before heap/GC lifecycle.
- Lesson 9 remains a local draft on feature/learning-ui-experiment; prior edits are preserved and all changes remain uncommitted. Examples are illustrative, not benchmark measurements.
- Verification: Astro check reports zero errors/warnings/hints; production build passes (62 pages), with the Lesson 9 draft route and links absent. All eight SVGs parse and load at their intrinsic dimensions. Desktop 1280px and mobile 390px layouts have no page, code, or image overflow; sidebar, TOC, heading anchors, keyboard reasoning disclosure, draft badge, and Lesson 8 ↔ Lesson 9 ↔ class-loading preview navigation were checked in the browser. Local server: http://127.0.0.1:4327/courses/jvm/escape-analysis-scalar-replacement.
- Reader-review revision: expanded the escape-state section with small source and conceptual compiler-view examples for NoEscape, ArgEscape, and GlobalEscape. Simplified the stack-allocation correction to show that scalar replacement removes the `Point` container and retains values, which may independently occupy registers or stack slots.

## Lessons 3 and 4 accepted — 2026-09-10

- User reviewed and accepted “Object layout inside the heap” and “GC roots, reachability, and why GC is graph traversal”. Set both lessons to `draft: false` without changing their content.
- Lessons 3 and 4 now participate in production routes, course counts, sidebar navigation, previous/next navigation, and the sitemap. Later lessons remain at their existing visibility.
- Changes remain uncommitted on `feature/learning-ui-experiment`; no deployment was performed.

## Lesson 5 accepted — 2026-09-10

- User reviewed and accepted “Mark-Sweep vs Mark-Compact vs Copying GC”. Set the lesson to `draft: false`; its content and illustrations are unchanged from the reviewed revision.
- Lesson 5 now participates in production routes, course counts, sidebar navigation, previous/next navigation, and the sitemap. The generational-GC lesson remains a draft, so Lesson 5 names it as the next planned lesson without linking to its local-only route.
- Changes remain uncommitted on `feature/learning-ui-experiment`; no deployment was performed.
- Verification: Astro check reports zero errors/warnings/hints; production build passes (65 pages). Lesson 5 is present in the production route, course overview, Lesson 4 navigation, and sitemap without a draft badge. Lesson 6 remains excluded.

## Lessons 6 and 7 accepted — 2026-09-11

- User reviewed and accepted “Generational GC — Eden, Survivor, and promotion” and “Write barriers, card tables, and remembered sets”. Set both lessons to `draft: false`. Updated publication-aware transitions: Lesson 5 now links to published Lesson 6, while Lesson 7 describes the unpublished TLAB lesson without linking to its draft-only route.
- Lessons 6 and 7 now participate in production routes, course counts, sidebar navigation, previous/next navigation, and the sitemap. Lesson 8 remains a draft preview.
- Changes remain uncommitted on `feature/learning-ui-experiment`; no deployment was performed.
- Verification: Astro check reports zero errors/warnings/hints; production build passes with 67 pages. Both routes appear in the production build and sitemap without draft badges, Lesson 5 → Lesson 6 → Lesson 7 navigation is live, and Lesson 7 has no production link to the unpublished TLAB route. Both finalized lesson headers and sidebar entries were visually checked at http://127.0.0.1:4331/.


## JVM Lessons 8 and 9 promoted — 2026-09-11

- User reviewed and accepted “TLABs and why object allocation is usually very cheap” and “Escape analysis and scalar replacement”. Set both lessons to `draft: false` so they participate in production routes, course counts, sidebar navigation, previous/next navigation, and the sitemap.
- Updated publication-aware transitions: Lesson 7 now links to Lesson 8, and Lesson 8 describes Lesson 9 as the next published lesson. Lesson 9 continues to point to the class-loading lifecycle preview.
- Verification: Astro check completed with 0 errors, warnings, or hints; the production build generated 69 pages, including both lesson routes with final sidebar and previous/next navigation and no draft labels. The sitemap includes both routes, and every JVM course SVG passes XML validation.


## Daily JVM Byte #10 converted — 2026-09-13

- Converted byte-010 into Lesson 10, “Class loading lifecycle — from .class bytes to a live JVM class”, Foundations order 100, following Lesson 9. Local draft on feature/learning-ui-experiment.
- Twelve editable SVGs clarify loading versus linking versus initialization, lazy resolution, preparation defaults and ConstantValue before clinit, defining-loader type identity, Class mirrors versus HotSpot Metaspace metadata, and reachability-dependent unloading.
- Shared navigation connects Lesson 9 → Lesson 10 → class-file/runtime-constant-pool preview. Lesson 9 prose avoids a production link to the local draft. Source byte and available reviewed draft archived with review notes.
- Next: local editorial review, then the class-file/runtime-constant-pool byte. Changes remain uncommitted.

- Verification: Astro diagnostics report 0 errors/warnings/hints; production build succeeds (69 pages). Draft route, production HTML links, and sitemap entry are excluded. All twelve SVGs parse, load, and were visually inspected. Desktop and 390px iframe views checked; final example has no horizontal code or page overflow. Sidebar selection, heading anchor, keyboard disclosure, overview, Lesson 9 ↔ 10 ↔ next preview and end-of-preview navigation verified. Fixed overview numbering from 010/011 to 10/11.
- Executed the initialization example on Homebrew OpenJDK HotSpot 25.0.2: loaded, 42, initializing, 42, 42. javap confirms ConstantValue for LIMIT and putstatic in the static initializer for count. A transient content-sync duplicate-ID warning occurred during dev/check; clean production sync succeeded and only one source entry exists per lesson.
- Local preview remains at http://127.0.0.1:4332/courses/jvm/class-loading-lifecycle. No commit, push, or deployment.


## Daily JVM Byte #11 converted — 2026-09-13

- Converted byte-011 into Lesson 11, “The constant pool and why JVM bytecode uses symbolic references”, Foundations order 110, prerequisite class-loading-lifecycle. Local draft on feature/learning-ui-experiment.
- Eleven editable SVGs explain symbolic references, portability, class-file versus runtime pools, loader-sensitive resolution, lazy timing, resolution versus dynamic dispatch, field layout, interpreter operands, and member linkage failures.
- Verified javap exercise on Homebrew OpenJDK HotSpot 25.0.2; source, available reviewed draft, disassembly, and technical review notes archived. ClassNotFoundException / NoClassDefFoundError remain distinct from missing members; initialization failure caveat preserved.
- Shared navigation connects Lesson 10 → Lesson 11 → stack-frames/operand-stack preview. Legacy constant-pool preview URL redirects with draft visibility respected. Prior edits preserved; changes uncommitted. Next: local editorial review and the stack-frames byte.
- Beginner-first revision on 2026-09-15: the lesson now starts with `Example.java` and its verified `javap -v` output, teaches bytecode offsets and constant-pool index chaining before symbolic/runtime terminology, and carries `Example.name` plus `String.toUpperCase` through the rest of the explanation. Updated the opening, five supporting SVGs, the course preview summary, and the reasoning sequence.
- Reviewed and published on 2026-09-15 by changing Lesson 11 from draft to visible course content.


## Daily JVM Byte #12 converted — 2026-09-14

- Converted byte-012 and the available reviewed draft into Lesson 12, “Stack frames, local variables, and the operand stack”, Foundations order 120, prerequisite constant-pool-symbolic-references. Local draft on feature/learning-ui-experiment.
- Twelve editable SVGs explain frame containment, local slots, instruction-by-instruction operand changes, call/return handoff, stack bytecode versus registers, Code capacities, call stacks, shared heap references, GC roots, logical versus compiled frames, stack overflow, and the interpreter bridge.
- Clarified indexed slots versus source variables, instance/static receiver convention, continuing two-slot long/double rule, per-frame operand stacks versus thread call stacks, live references/OopMaps, and logical versus JIT physical frames including inlining.
- Shared course metadata connects Lesson 11 → Lesson 12 → HotSpot interpreter preview. Source byte and available reviewed draft archived with retrieval boundary noted. Changes remain uncommitted; prior edits preserved. Next: local editorial review, then the HotSpot interpreter byte.
- Verification: Astro check reports 0 errors/warnings/hints; production build succeeds (70 pages), with Lesson 12 route, HTML links and sitemap entry excluded. All twelve SVGs parse, load and were visually reviewed. Desktop 1280px and mobile 390px have no page/code overflow after formatting the Java example. Heading anchors, keyboard reasoning disclosure, overview/sidebar, Lesson 11 ↔ 12 ↔ interpreter preview and end-of-preview navigation verified.
- Executed FrameDemo on Homebrew OpenJDK HotSpot 25.0.2: prints 30; javap confirms stack=2, locals=4, args_size=3 and the six instructions. Source and disassembly archived. Content sync emitted transient duplicate-ID warnings for Lessons 11/12 during checks; each has one source entry, diagnostics passed, and final production sync succeeded.
- Local review server: http://127.0.0.1:4333/courses/jvm/stack-frames-operand-stack; interpreter preview: http://127.0.0.1:4333/courses/jvm/hotspot-interpreter. No commit, push or deployment.


## Daily JVM Byte #13 converted — 2026-09-14

- Converted byte-013 and the available reviewed draft into Lesson 13, “The HotSpot interpreter — executing bytecode before JIT compilation”, Execution and JIT order 130. Local draft on feature/learning-ui-experiment; prior edits preserved.
- Ten editable SVGs explain native interpreter machinery, frame/operand operations, interpret-first investment, receiver profiles, policy-driven hotness, back edges/OSR, compiled execution, warm-up, and adaptive execution.
- Clarified profiling in lower compiled tiers, counters as intuition rather than magic thresholds, guarded receiver assumptions, compiler/native-memory/Code Cache costs, and workload-dependent production warm-up. Theme: execution changes while the application runs.
- Navigation connects Lesson 12 → Lesson 13 → tiered-compilation preview (C1/C2/levels). Source and available draft archived with retrieval boundary. Next: local editorial review, then tiered compilation. Changes remain uncommitted.
- Verification: Astro diagnostics passed with 0 errors/warnings/hints; production build generated 70 pages. Lesson 13 is absent from production routes, HTML links and sitemap. All ten SVGs parse and load and were visually inspected. Desktop and 390px mobile checks found no page or code overflow; reasoning disclosure works by keyboard, navigation reaches the tiered preview with a return link and End of preview. A transient existing Lesson 12 duplicate-ID content-sync message appeared before clean build sync.
- Local review remains at http://127.0.0.1:4333/courses/jvm/hotspot-interpreter; next preview at http://127.0.0.1:4333/courses/jvm/tiered-compilation. Examples are explicitly illustrative; no large loop or benchmark was run. No commit, push, or deployment.


## Daily JVM Byte #14 converted — 2026-09-14

- Converted byte-014 and available reviewed draft into Lesson 14, “Tiered compilation — C1, C2, and why HotSpot compiles a method more than once”, Execution and JIT order 140, prerequisite hotspot-interpreter. Local draft on feature/learning-ui-experiment; previous edits preserved.
- Twelve editable SVGs cover C1/C2 trade-offs, tier states, compiled profiling, profile-guided optimization, inlining scope, method versions, investment, concurrent queues, Code Cache placement, warm-up, and the complete model.
- Clarified tier levels as policy choices, limited/full C1 profiling, compiler queue pressure and CPU competition, guarded specialization, inlining/escape-analysis opportunities, version replacement versus invalidation/reclamation, native Code Cache placement and configuration-dependent segmentation (including non-profiled C1).
- Shared navigation connects Lesson 13 → Lesson 14 → speculative-optimization/deoptimization preview. Source byte and available reviewed draft retained with retrieval boundary and review notes. Examples are illustrative, not measured benchmarks. Next: local editorial review, then speculative optimization and deoptimization. Changes remain uncommitted.
- Verification: Astro check reports 0 errors/warnings/hints; production build succeeds (70 pages). A transient content-sync duplicate-ID warning for the edited Lesson 13 preceded a clean build sync. Lesson 14 is absent from production routes, HTML links, and sitemap. All twelve SVGs parse and load; diagram gallery and rendered lesson inspected. Desktop (1280px) and 390px mobile frame have no page/code overflow. Heading anchor, keyboard reasoning disclosure, active sidebar item, overview, Lesson 13 ↔ 14 ↔ next preview, and end-of-preview navigation verified.
- Local review remains at http://127.0.0.1:4333/courses/jvm/tiered-compilation; next preview: http://127.0.0.1:4333/courses/jvm/speculative-optimization-deoptimization. No commit, push, or deployment.


## Daily JVM Byte #15 converted — 2026-09-14

- Converted byte-015 and available reviewed draft into Lesson 15, “Speculative optimization and deoptimization”, Execution and JIT order 150, prerequisite tiered-compilation. Local draft on feature/learning-ui-experiment; prior edits preserved.
- Eleven editable SVGs cover speculation, guarded devirtualization, guards versus dependencies, uncommon traps, logical-state and inlined-frame reconstruction, machine-value metadata, rematerialization, adaptive recompilation, class-loading invalidation, and the complete loop.
- Clarified guard versus VM-dependency invalidation, logical rather than historical physical state, live scalar-replaced object rematerialization and required lock semantics, and adaptive recompilation without a fixed public trap threshold. Included production reasoning and four reasoning checks.
- Shared navigation connects Lesson 14 → Lesson 15 → Code Cache preview. Source retained with retrieval boundary and technical review notes. Examples are illustrative, not executed benchmarks. Next: local editorial review, then Code Cache. Changes remain uncommitted.
- Verification: Astro check reports 0 errors/warnings/hints; production build succeeds (70 pages). A transient edited-Lesson-14 duplicate-ID content-sync warning preceded clean build sync. Lesson 15 is absent from production routes, HTML navigation and sitemap. Eleven SVGs parse/load and were visually reviewed, including separate guarded-call branches. Desktop and 390px mobile checks show no page/code overflow; keyboard reasoning disclosure and Lesson 14 ↔ 15 ↔ Code Cache preview navigation verified.
- Review server remains at http://127.0.0.1:4337/courses/jvm/speculative-optimization-deoptimization; next preview http://127.0.0.1:4337/courses/jvm/code-cache. No commit, push or deployment.

## Lesson 10 reader-feedback revision — 2026-09-14

- Clarified that “mirror” is HotSpot's name for the familiar heap `java.lang.Class` object returned by `Customer.class` and `getClass()`, and simplified the defining-loader explanation around parent delegation.
- Reframed the ConstantValue section around its observable purpose: some primitive/String compile-time constants can be embedded in callers and read without initializing their declaring class.
- Rebuilt resolution around a verified `Checkout` → `Customer.fee()` example, including its `invokestatic #7` instruction and corresponding constant-pool entries.
- Replaced three diagrams. The loading diagram now distinguishes the Java-facing `Class<Customer>` object from VM metadata; the resolution diagram connects bytecode index, symbolic entry, lookup, and runtime method; the memory diagram follows initialized `Customer` metadata, class-wide static state, and an ordinary instance across Metaspace and heap.
- Changes remain an uncommitted local draft on `feature/learning-ui-experiment`.
- Verification: the `Checkout` example compiled on Homebrew OpenJDK HotSpot 25.0.2 and `javap -c -verbose` produced `invokestatic #7` with `Methodref Customer.fee:()I`. Astro diagnostics and production build pass. The three revised SVGs parse and load; desktop and 390px views were inspected with no page or code overflow.

## JVM Lesson 10 promoted — 2026-09-15

- User reviewed and accepted “Class loading lifecycle — from .class bytes to a live JVM class”. Set Lesson 10 to `draft: false` so it participates in production routes, course counts, sidebar navigation, previous/next navigation, and the sitemap.
- Restored Lesson 9's direct link to Lesson 10. Lesson 10 describes unpublished Lesson 11 as the next planned lesson without linking to its draft-only route.
- Content and illustrations remain unchanged from the reviewed revision. Changes remain uncommitted on `feature/learning-ui-experiment`; no deployment was performed.
- Verification: Astro diagnostics report 0 errors, warnings, or hints; the production build succeeds with 71 pages. Lesson 10 appears as a normal 15-minute lesson in the generated route, course overview, sidebar, and sitemap without a draft marker. Production navigation links Lesson 9 to Lesson 10 and omits the draft-only Lesson 11 route. The local lesson preview was inspected at desktop size and shows Lesson 10 without a draft label.

## JVM Lesson 12 promoted — 2026-09-15

- User reviewed and accepted “Stack frames, local variables, and the operand stack”. Set Lesson 12 to `draft: false` so it participates in production routes, course counts, sidebar navigation, previous/next navigation, and the sitemap.
- Lesson 12 now describes the unpublished HotSpot interpreter lesson as the next planned lesson without linking to its draft-only route. Content and illustrations remain unchanged from the reviewed revision.
- Changes remain uncommitted on `feature/learning-ui-experiment`; no deployment was performed.
- Verification: Astro diagnostics report 0 errors, warnings, or hints; the production build succeeds with 73 pages. Lesson 12 appears in the generated route, course overview, sidebar, and sitemap without a draft marker, and Lesson 11 links forward to it. The HotSpot interpreter route remains excluded from production.

## JVM Lesson 13 beginner-model revision — 2026-09-16

- Reworked the draft HotSpot interpreter lesson around a first-time JVM reader. The explanation now builds in dependency order: stack machine and operand flow, a complete teaching interpreter loop with `pc`, fetch/dispatch/execute/continue, HotSpot template generation versus runtime native-handler reuse, profiling and hotness, back edges, then OSR state transfer.
- Added `stack-machine-add.svg`, `interpreter-loop.svg`, and `osr-state-handoff.svg`; rebuilt the template-interpreter and complete adaptive-execution diagrams. Lesson 12 now defines the stack-machine model before introducing indexed locals and operand-stack instructions, with `stack-machine-model.svg`.
- Preserved the implementation boundaries: the pseudocode is explanatory rather than literal HotSpot source, the JVMS owns instruction semantics, HotSpot supplies native interpreter machinery, profiling also occurs in lower compiled tiers, and OSR continues the same invocation without resetting live state.
- Changes remain uncommitted on `feature/learning-ui-experiment`; Lesson 13 remains a local draft.
- Verification: Astro diagnostics report 0 errors, warnings, or hints; production build succeeds with 73 pages. Lesson 13 remains absent from production routes, HTML links, and sitemap, while published Lesson 12 includes the new stack-machine section and diagram. All revised SVGs parse and load. Desktop and 390px views show no page or code overflow; heading anchors and both keyboard reasoning disclosures work. The local Lesson 12 → Lesson 13 → Lesson 14 navigation remains intact. A transient content-sync duplicate-ID warning for the edited Lesson 13 preceded a clean production sync.
- Local review server: http://127.0.0.1:4338/courses/jvm/hotspot-interpreter. No commit, push, or deployment.

## JVM Lesson 13 promoted — 2026-09-17

- User reviewed and accepted “The HotSpot interpreter — executing bytecode before JIT compilation”. Set Lesson 13 to `draft: false` so it participates in production routes, course counts, sidebar navigation, previous/next navigation, and the sitemap.
- Lesson 12 now links directly to the published interpreter lesson. Lesson 13 describes tiered compilation as the next planned lesson without linking to its unpublished draft route.
- Content and illustrations remain unchanged from the reviewed beginner-model revision. Changes remain uncommitted on `feature/learning-ui-experiment`; no deployment was performed.
- Production course navigation now stops at Lesson 13 while Lessons 14 and 15 remain drafts, instead of skipping ahead to the later Code Cache placeholder. Development previews retain the complete draft sequence.
- Verification: Astro diagnostics report 0 errors, warnings, or hints; the production build succeeds with 73 pages. Lesson 13 appears as Lesson 13 of 13 in its generated route, course overview, sidebar, and sitemap without a draft marker. Lesson 12 links forward to Lesson 13, and Lesson 13 ends the published preview without exposing draft or out-of-sequence placeholder routes.

## JVM Lesson 14 beginner-model revision — 2026-09-17

- Reworked the draft tiered-compilation lesson for first-time course readers while preserving its technical scope. One `process(Order)` example now carries the explanation from interpreted bytecode through C1 profiling, C2 optimization, installed versions, compiler queues, and Code Cache placement.
- Defined JIT compilation, native code, profiling instrumentation, devirtualization, inlining, nmethods, compiler threads, and Code Cache terminology before relying on them. Replaced compressed phrases such as amortization and eligibility/availability with explicit cause-and-effect explanations.
- Preserved the deeper boundaries: levels are policy-controlled states rather than a mandatory staircase; level 2 and level 3 collect different evidence; profile-guided specialization must preserve Java behavior; inlining only exposes escape-analysis opportunities; installation, invalidation, recompilation, and reclamation are distinct; segmented Code Cache categories include non-profiled C1 code.
- Revised four diagrams and captions (`c1-vs-c2`, `c1-profiled-code`, `profile-to-c2`, and `compilation-investment`) to use the lesson's beginner-facing terms and consistent `DefaultPricingService` example. Lesson 14 remains an uncommitted local draft on `feature/learning-ui-experiment`.
- Verification: Astro diagnostics report 0 errors, warnings, or hints; production build succeeds with 73 pages. Lesson 14 remains absent from production routes and links. All twelve lesson images load; the four revised SVGs parse. Desktop and 390px mobile views have no page, table, or code overflow, and the keyboard reasoning disclosure works. Local review: http://127.0.0.1:4338/courses/jvm/tiered-compilation.

## JVM Lesson 14 promoted — 2026-09-17

- User reviewed and accepted “Tiered compilation — C1, C2, and why HotSpot compiles a method more than once”. Set Lesson 14 to `draft: false` so it participates in production routes, course counts, sidebar navigation, previous/next navigation, and the sitemap.
- Lesson 13 now links directly to the published tiered-compilation lesson. Lesson 14 describes speculative optimization and deoptimization as the next planned lesson without linking to the unpublished Lesson 15 route.
- Content and illustrations remain unchanged from the reviewed beginner-model revision. Changes remain uncommitted on `feature/learning-ui-experiment`; no deployment was performed.
- Verification: Astro diagnostics report 0 errors, warnings, or hints; the production build succeeds with 74 pages. Lesson 14 appears in its generated route, course overview, sidebar, and sitemap without a draft marker. Production navigation links Lesson 13 to Lesson 14 and ends the published preview at Lesson 14, while Lesson 15 remains excluded. The local lesson was visually inspected at http://127.0.0.1:4338/courses/jvm/tiered-compilation.

## JVM Lesson 15 beginner-model revision — 2026-09-17

- Reworked the draft speculative-optimization lesson for a first-time JVM reader while preserving its full technical scope. The opening now separates required Java behavior, C2's optimized representation, and recovery information before introducing implementation machinery.
- Expanded one `Payment` example to define call site, receiver, guard, inlining, fallback, uncommon trap, and deoptimization in dependency order. Added an end-to-end eight-step trace before the frame-reconstruction internals.
- Added a guard-versus-VM-dependency comparison and defined invalidation, logical JVM state, compiler metadata as a translation map, rematerialization, identity and aliases, and monitor state at first use.
- Preserved the deeper boundaries around dependency invalidation, bytecode-position recovery, inlined-frame reconstruction, machine-value locations, conditional object rematerialization, eliminated locks, adaptive recompilation, trap history without a public fixed threshold, dynamic class loading, Code Cache cost, and latency-sensitive production behavior.
- Lesson 15 remains an uncommitted local draft on `feature/learning-ui-experiment`; Lesson 14 remains the end of the published course until review acceptance.
- Verification: Astro diagnostics report 0 errors, warnings, or hints; the production build succeeds with 74 pages. Lesson 15 remains absent from production routes, HTML links, and sitemap. All eleven images load, heading anchors and adjacent navigation are correct, and the first reasoning disclosure works by keyboard. Desktop and 390px mobile views have no page or code overflow after replacing the four-column comparison table with compact parallel blocks and wrapping the teaching examples. Local review: http://127.0.0.1:4340/courses/jvm/speculative-optimization-deoptimization.

## JVM Lesson 15 promoted — 2026-09-17

- User reviewed and accepted “Speculative optimization and deoptimization”. Set Lesson 15 to `draft: false` so it participates in production routes, course counts, sidebar navigation, previous/next navigation, and the sitemap.
- Lesson 14 now links directly to the published Lesson 15. Lesson 15 continues to the existing Code Cache preview.
- Content and illustrations remain unchanged from the reviewed beginner-model revision. The accumulated course changes are being committed and pushed on `feature/learning-ui-experiment` at the user's request; no deployment was requested.
- Verification: Astro diagnostics report 0 errors, warnings, or hints; the production build succeeds with 76 pages. Lesson 15 renders without a draft marker, appears in the course overview and sitemap, receives the forward link from Lesson 14, and links onward to the Code Cache preview.

## Course orientation and emphasis — 2026-09-17

- Overview uses native collapsed section disclosures with lesson counts, numbered links, and planned/draft labels. Sidebar separators stay non-clickable; active lesson remains accented.
- Shared `getLessonSections()` derives both views from existing module metadata and preserves global sequence numbers and draft visibility. No parallel section registry.
- Use semantic `<mark>` for roughly 1–3 short must-remember ideas per lesson where useful; never add emphasis mechanically or hard-code colors. Larger standalone concepts may use restrained `lesson-callout` asides with Key idea, Important, Production note, or Common misconception labels. Existing lesson wording and qualifications are preserved.
- See `JVM_AUTHORING_GUIDE.md` for exact markup, metadata conventions, and review steps. Course colors follow the OS dark-mode preference; diagrams retain their authored colors.
- Verification: Astro diagnostics report 0 errors/warnings/hints; production build generates 76 pages. Chromium checks at 1440px and 390px in light/dark mode cover all 16 lesson routes, overview counts and keyboard disclosure, mobile contents toggle, active state, previous/next links, and horizontal overflow. Visually reviewed overview and emphasis. Content sync emitted transient duplicate-ID warnings during concurrent development/check; build completed cleanly and only one source file exists per lesson.
- Local preview: http://127.0.0.1:4330/courses/jvm. Changes remain uncommitted on feature/learning-ui-experiment.

## Daily JVM Byte #16 converted — 2026-09-22

- Converted byte-016 and the reviewed originating draft into Lesson 16, “The Code Cache — where JIT-compiled machine code lives”, Execution and JIT order 160, prerequisite speculative-optimization-deoptimization. It remains an uncommitted local draft on `feature/learning-ui-experiment`.
- Eight editable SVGs explain bytecode → C1/C2 → nmethod → Code Cache → CPU, native-memory placement outside `-Xmx`, the three segmented Code Heaps, nmethod anatomy, delayed reclamation, fragmentation/lifecycle grouping, compilation pressure, and the complete adaptive-execution model.
- Preserved the key boundaries: segmentation is a HotSpot choice; non-profiled is not a strict C2-only category; an nmethod is executable code plus relocation, reference, stack/scope, safepoint, deoptimization, exception and dependency metadata; invalidation or supersession does not immediately free storage.
- Diagnostics distinguish aggregate occupancy from per-heap usable capacity, reclamation, compiler enabled/stopped/restarted state, compilation results and compiler queues. JFR CodeCacheFull, JITRestart, Compilation, Deoptimization and CompilerQueueUtilization are presented as correlated evidence, with one restrained production tuning note.
- Three semantic inline highlights and one Production note use the shared emphasis system. Navigation connects Lesson 15 → Lesson 16 → Safepoints preview in development; production keeps the draft route and links excluded.
- Verified `-XX:+PrintCodeCache` and relevant Code Heap flags on Homebrew OpenJDK HotSpot 25.0.2; the exact startup output is archived under `sources/daily-jvm/byte-016/` and is labeled as a short-lived observation rather than a workload measurement.
- Astro diagnostics report 0 errors/warnings/hints; production build succeeds with 75 pages and excludes the draft route, sitemap entry and navigation links. All eight SVGs parse and load at their intrinsic sizes. Desktop and 390px mobile checks cover highlights, callout, diagrams, headings, reasoning disclosures, overview section grouping, active sidebar, mobile contents toggle, previous/next links, and page/image overflow. Mobile code samples retain intentional internal horizontal scrolling where needed. Light and forced dark-theme review show legible emphasis, callouts and fixed-color SVGs.
- Local review: http://127.0.0.1:4341/courses/jvm/code-cache; course overview: http://127.0.0.1:4341/courses/jvm. Next: Safepoints. No commit, push or deployment.

## JVM Lesson 16 promoted — 2026-09-22

- User reviewed and accepted “The Code Cache — where JIT-compiled machine code lives”. Set Lesson 16 to `draft: false` so it participates in production routes, course counts, sidebar navigation, previous/next navigation, and the sitemap.
- Lesson 15 now links directly to Lesson 16. Lesson 16 continues to the Safepoints preview. Lesson content and illustrations are unchanged from the reviewed draft.
- Verification: Astro diagnostics report 0 errors, warnings, or hints; the production build includes Lesson 16 as normal course content without a draft label and retains Safepoints as the next planned preview.

## Daily JVM Byte #17 converted — 2026-09-23

- Converted `byte-017` and the reviewed originating draft into Lesson 17, “Safepoints — when HotSpot needs Java threads in a known state”, Execution and JIT order 170, prerequisite `code-cache`. It remains a local review draft on `feature/learning-ui-experiment`.
- Ten editable SVGs explain global safepoint coordination, arbitrary versus metadata-described machine states, state-dependent thread accounting, compiled-code polling, long-running loop cooperation, the global request/operation/release flow, synchronization time versus time at safepoint, OopMap reference locations, the JIT/GC bridge, and the complete coordination model.
- Preserved the key boundaries: a safepoint is a global HotSpot coordination state rather than one code location or an OS freeze; threads become safe through different state-dependent mechanisms; poll placement is compiler/runtime policy; safepoints are broader than GC; and compiled code includes metadata that connects GC roots, stack walking, and deoptimization.
- The main operational takeaway separates synchronization or time-to-safepoint from time at the safepoint. `-Xlog:safepoint` is the starting point, with three semantic highlights and one restrained Production note.
- Development navigation connects Lesson 16 → Lesson 17 → the Thread-local handshakes preview. Production continues to exclude the draft route and its navigation entry until review acceptance.
- Verification: Astro diagnostics report 0 errors, warnings, or hints; the production build succeeds with 76 pages and excludes Lesson 17 from routes, sitemap, course counts, and navigation. All ten SVGs parse and load. Browser checks cover desktop and 325px narrow mobile layouts, image scaling, page and code overflow, active sidebar state, mobile contents toggle, heading navigation, previous/next links, semantic highlights, callout, and both keyboard reasoning disclosures. A forced dark-theme pass confirmed legible shared colors for text, highlights, callout, and code while all fixed-background SVGs remained readable. Local HotSpot 25.0.2 accepts `-Xlog:safepoint`.
- Local review: http://127.0.0.1:4342/courses/jvm/safepoints; course overview: http://127.0.0.1:4342/courses/jvm.
- Source-section consistency revision: Lesson 16 now includes the standard collapsed “Sources and implementation boundaries” disclosure, and Lesson 17's visible sources heading/list now uses the same component. The JVM lesson skill, editorial reference, and portable authoring guide require this structure for future lessons and include it in verification.
- Next: Thread-local handshakes. No commit, push, or deployment.

## Lesson 17 accepted — 2026-09-23

- User reviewed and accepted “Safepoints — when HotSpot needs Java threads in a known state”. Set Lesson 17 to `draft: false` so it participates in production routes, course counts, sidebar navigation, previous/next navigation, and the sitemap.
- Lesson 17 continues to the Thread-local handshakes preview. Lesson content, source disclosure, and illustrations are unchanged from the reviewed draft.
- Verification: Astro diagnostics report 0 errors, warnings, or hints; the production build succeeds with 78 pages and includes Lesson 17 plus the Thread-local handshakes preview route.
- Next: Thread-local handshakes.

## Daily JVM Byte #18 converted — 2026-09-24

- Converted `byte-018` and the retained reviewed-draft requirements into Lesson 18, “Thread-local handshakes — coordination without stopping the whole JVM”, `Threads and Synchronization` order 180, prerequisite `safepoints`. It remains an uncommitted local review draft on `feature/learning-ui-experiment`.
- Eight editable SVGs explain targeted coordination, global-versus-handshake scope, shared per-thread polling, a simplified target flow, handshake-safe state requirements, the scalability motivation, operation-scope choice, and the combined safepoint/handshake model.
- Preserved the key boundaries: a handshake is selected-thread runtime coordination rather than merely a mini-safepoint; safe-state requirements still apply; suitable operations may be processed on behalf of an already handshake-safe target; narrower scope does not promise zero pause or zero cost; and handshakes complement rather than replace global safepoints.
- Distinguishes global safepoint responsiveness from target-set handshake responsiveness. JFR cooperative sampling appears only as an observability example. Three reasoning checks cover unrelated-thread progress, external processing, and why separate handshakes do not create one global invariant.
- Three semantic inline highlights and one restrained Production note use the shared emphasis system.
- Development navigation connects Lesson 17 → Lesson 18 → the Platform threads vs virtual threads in JDK 25 preview. Production keeps the Lesson 18 draft route and the later preview excluded until review acceptance.
- Verification: Astro diagnostics report 0 errors, warnings, or hints; the production build succeeds with 77 pages and excludes Lesson 18, Lesson 19, their links, and their sitemap entries. All eight SVGs parse and load. Live browser checks cover 1200px desktop and 325px narrow mobile layouts, page/image overflow, intentional code-block scrolling, active sidebar state, collapsed mobile contents, course section grouping, keyboard reasoning/source disclosures, previous/next links, and the Lesson 19 preview. A forced dark-media rendering pass confirmed the shared text, highlight, callout, navigation, and surface colors; the fixed-background SVGs remain self-contained and readable independently of the page theme.
- Local review: http://127.0.0.1:4343/courses/jvm/thread-local-handshakes; course overview: http://127.0.0.1:4343/courses/jvm; next preview: http://127.0.0.1:4343/courses/jvm/platform-vs-virtual-threads.
- Next: Platform threads vs virtual threads in JDK 25. No commit, push, or deployment.

## Lesson 18 accepted — 2026-09-24

- User reviewed and accepted “Thread-local handshakes — coordination without stopping the whole JVM”. Set Lesson 18 to `draft: false` so it participates in production routes, course counts, sidebar navigation, previous/next navigation, and the sitemap.
- Lesson 17 now links directly to Lesson 18. Lesson 18 continues to the Platform threads vs virtual threads in JDK 25 preview. Lesson content, source disclosure, and illustrations are unchanged from the reviewed draft.
- The accumulated Lesson 18 changes are being committed and pushed on `feature/learning-ui-experiment` at the user's request; no deployment was requested.
- Verification: Astro diagnostics report 0 errors, warnings, or hints; the production build succeeds with 79 pages. Lesson 18 renders as normal course content without a draft label, appears in the course overview/sidebar and sitemap, receives Lesson 17's forward link, and links onward to the Lesson 19 preview. All eight SVGs parse successfully.
- Next: Platform threads vs virtual threads in JDK 25.
