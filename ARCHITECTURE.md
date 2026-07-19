# Architecture

## Routing and pages

Astro’s file-based routing maps files in `src/pages/` to static routes. This keeps the route structure visible without additional routing code.

## Shared UI

`BaseLayout` owns the document shell, global stylesheet, header, footer, and page metadata defaults. Header and footer are focused components so later pages can reuse the same accessible navigation without duplicating markup.

## Styling

Tailwind CSS is connected through its official Vite plugin. Styles live in one global entry point and are expressed next to the markup they affect, avoiding a custom design-system layer until the site needs one. The visual language uses neutral surfaces, slate text, and one blue accent; responsive utility variants keep the same layout readable from small screens through desktop. Space Grotesk is bundled locally for headings, while body copy uses the system font stack for reading comfort and no third-party font request. A reusable `.prose` layer in `global.css` styles rendered Markdown (headings, code blocks, blockquotes, lists, images) for blog posts. A `.bg-dot-grid` utility provides a masked, radial-gradient dot pattern used behind the homepage hero only, fading toward the edges so it reads as texture rather than a decorative background.

## Content

Blog posts live in `src/content/blog/` as Markdown, migrated from the author's Medium export. Astro Content Collections validate each post's frontmatter (`title`, `description`, `publishDate`, `tags`, `draft`) at build time and expose typed data to the index and post routes. Public routes and the blog index exclude entries marked as drafts, allowing unfinished posts to stay versioned without publishing them. Each post's tags render as links to `/blog/tags/[tag]/`, a statically generated page (`src/pages/blog/tags/[tag].astro`) listing every published post under that tag. Reading time is estimated from word count at render time rather than stored.

## SEO and discoverability

`BaseLayout` centralizes canonical URLs, standard metadata, Open Graph and Twitter metadata, favicon markup, and WebSite JSON-LD. The Astro site URL comes from `SITE_URL`; `https://example.com` is only a pre-deployment fallback and must be replaced with the production domain. Astro’s sitemap integration, RSS endpoint, and robots endpoint derive their URLs from the same setting.

## Deployment

The site deploys as static files to Cloudflare Pages. No runtime adapter or Cloudflare configuration file is needed: Pages runs `npm run build` and publishes `dist`. `SITE_URL` is a Pages build variable so generated absolute URLs always point to the final public domain.
