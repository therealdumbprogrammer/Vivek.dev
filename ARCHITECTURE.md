# Architecture

## Routing and pages

Astro’s file-based routing maps files in `src/pages/` to static routes. This keeps the route structure visible without additional routing code.

## Shared UI

`BaseLayout` owns the document shell, global stylesheet, header, footer, and page metadata defaults. Header and footer are focused components so later pages can reuse the same accessible navigation without duplicating markup.

## Styling

Tailwind CSS is connected through its official Vite plugin. Styles live in one global entry point and are expressed next to the markup they affect, avoiding a custom design-system layer until the site needs one. The visual language uses neutral surfaces, slate text, and one blue accent; responsive utility variants keep the same layout readable from small screens through desktop. Space Grotesk is bundled locally for headings, while body copy uses the system font stack for reading comfort and no third-party font request.

## Content

Blog posts live in `src/content/blog/` as Markdown. Astro Content Collections validate each post’s frontmatter at build time and expose typed data to the index and post routes. Public routes and the blog index exclude entries marked as drafts, allowing unfinished posts to stay versioned without publishing them.

## SEO and discoverability

`BaseLayout` centralizes canonical URLs, standard metadata, Open Graph and Twitter metadata, favicon markup, and WebSite JSON-LD. The Astro site URL comes from `SITE_URL`; `https://example.com` is only a pre-deployment fallback and must be replaced with the production domain. Astro’s sitemap integration, RSS endpoint, and robots endpoint derive their URLs from the same setting.

## Deployment

The site deploys as static files to Cloudflare Pages. No runtime adapter or Cloudflare configuration file is needed: Pages runs `npm run build` and publishes `dist`. `SITE_URL` is a Pages build variable so generated absolute URLs always point to the final public domain.
