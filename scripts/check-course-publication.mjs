import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const lessonDir = 'src/content/lessons/jvm';
const outputDir = 'dist/courses/jvm';
const lessons = new Map();
const orders = new Set();

for (const file of readdirSync(lessonDir).filter(name => name.endsWith('.md'))) {
  const source = readFileSync(join(lessonDir, file), 'utf8');
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) throw new Error(`Missing frontmatter: ${file}`);
  const field = name => frontmatter[1].match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]?.trim();
  const slug = field('lessonSlug');
  const order = Number(field('order'));
  const sourceByte = field('sourceByte');
  const draft = field('draft');
  if (!slug || !Number.isInteger(order / 10) || order < 10 || sourceByte !== `byte-${String(order / 10).padStart(3, '0')}` || !['true', 'false'].includes(draft)) {
    throw new Error(`Invalid lesson identity or draft state: ${file}`);
  }
  if (lessons.has(slug) || orders.has(order)) throw new Error(`Duplicate lesson slug or order: ${file}`);
  lessons.set(slug, { number: order / 10, draft: draft === 'true' });
  orders.add(order);
}

const overviewPath = join(outputDir, 'index.html');
if (!existsSync(overviewPath)) throw new Error('Build the site before checking course publication.');
const pages = [overviewPath];
let published = 0;
for (const [slug, lesson] of lessons) {
  const route = join(outputDir, slug, 'index.html');
  if (lesson.draft) {
    if (existsSync(route)) throw new Error(`Draft route was published: ${slug}`);
  } else {
    if (!existsSync(route)) throw new Error(`Published route is missing: ${slug}`);
    const html = readFileSync(route, 'utf8');
    const label = html.match(/<p class="track-label[^\"]*"[^>]*>([^<]*)<\/p>/)?.[1];
    if (!label?.endsWith(`Lesson ${lesson.number}`)) throw new Error(`Wrong displayed number for ${slug}: ${label}`);
    pages.push(route);
    published++;
  }
}
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  for (const [, slug] of html.matchAll(/href="\/courses\/jvm\/([a-z0-9-]+)(?:[\/#?\"])/g)) {
    if (lessons.get(slug)?.draft) throw new Error(`Published page links to draft ${slug}: ${page}`);
    if (!existsSync(join(outputDir, slug, 'index.html'))) throw new Error(`Published page links to missing route ${slug}: ${page}`);
  }
}
console.log(`JVM publication check passed: ${published} numbered pages; drafts excluded; course links resolve.`);
