# Cloudflare Pages Deployment

This project is a fully static Astro site. It does not need a Cloudflare adapter, Pages Functions, or a `wrangler` configuration file.

## Build configuration

Configure the Cloudflare Pages project with:

| Setting | Value |
| --- | --- |
| Production branch | Your default branch (for example, `main`) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | Leave blank when this repository is the project root |

## Environment variables

Set the following plain-text build variable in **Settings → Variables and Secrets**:

| Environment | Name | Value |
| --- | --- | --- |
| Production | `SITE_URL` | The final public URL, such as `https://your-domain.example` |
| Preview | `SITE_URL` | The same final public URL, so preview pages keep production canonical URLs |

`SITE_URL` must not have a trailing slash. It drives canonical URLs, the sitemap, RSS feed, robots file, and JSON-LD. The local `https://example.com` fallback is only for development before a domain is chosen.

## GitHub connection

1. Create a Git repository for this directory and push it to GitHub.
2. In Cloudflare, open **Workers & Pages** and choose **Create application → Pages → Connect to Git**.
3. Authorize GitHub if prompted, select this repository, and choose the production branch.
4. Enter the build configuration above and add `SITE_URL` before the first production deployment.
5. Save and deploy. Pushes to the production branch publish the site; other branches receive preview deployments.

After the first deployment, record the assigned `*.pages.dev` URL or custom domain in `CONTEXT.md`, update `SITE_URL` if needed, and trigger a new deployment.
