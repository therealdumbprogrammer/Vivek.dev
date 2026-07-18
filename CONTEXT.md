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

## Decisions Log

- Use Astro file-based routing and small, plain Astro components.
- Keep shared site structure in `BaseLayout`.
- Store blog posts as Markdown in a typed `blog` content collection; exclude drafts from public routes.
- Keep project data local to the Projects page until real project content warrants a dedicated source.
- Use neutral surfaces, slate text, and a single blue accent with mobile-first responsive layout utilities.
- Centralize SEO metadata in `BaseLayout` and derive sitemap, RSS, and robots URLs from `SITE_URL`.
- Deploy as static files on Cloudflare Pages with `npm run build` and `dist`; no adapter or Wrangler configuration is required.
- Embed YouTube playlists through lazy-loaded `youtube-nocookie.com` iframes to keep homepage video previews dependency-free and privacy-enhanced.
- Calculate tag counts from published blog posts and display them in a responsive Blog-page topic panel.
- Bundle Space Grotesk locally for headings; retain the system font stack for body copy.

## Known Issues / TODO

- Connect the pushed GitHub repository to Cloudflare Pages.
- Choose a `*.pages.dev` or custom production domain and set `SITE_URL` in the Pages dashboard.
- Deploy, verify the production URL, then record it here and rebuild so canonical URLs, sitemap, RSS, robots, and JSON-LD use it.
- Optional: replace sample posts, generic playlist labels, and the favicon with final content/assets.

## How to Run Locally

Run `npm install`, then `npm run dev`. Use `npm run check` for Astro and TypeScript diagnostics, and `npm run build` for a production build.

## Deployment Notes

- Build command: `npm run build`
- Output directory: `dist`
- Production URL: pending user deployment
- Full setup instructions: `DEPLOYMENT.md`
- GitHub repository: `https://github.com/therealdumbprogrammer/Vivek.dev`
- Initial commit: `129d0aa` (`Initial portfolio and blog site`) on `main`, pushed to `origin/main`
