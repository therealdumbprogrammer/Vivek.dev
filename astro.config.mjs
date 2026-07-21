import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'static',
  site: process.env.SITE_URL ?? 'https://vivekmaurya.in',
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
});
