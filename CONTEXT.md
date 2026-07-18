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

Phase 6 is in progress. Cloudflare Pages configuration and GitHub connection instructions are documented in `DEPLOYMENT.md`; the production URL remains pending until a Pages project or custom domain is created. Site identity and personal content have been added.

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

- Create/push the GitHub repository, connect it to Cloudflare Pages, choose the production domain, and set `SITE_URL` in the Pages dashboard.

## How to Run Locally

Run `npm install`, then `npm run dev`. Use `npm run check` for Astro and TypeScript diagnostics, and `npm run build` for a production build.

## Deployment Notes

- Build command: `npm run build`
- Output directory: `dist`
- Production URL: pending user deployment
- Full setup instructions: `DEPLOYMENT.md`
