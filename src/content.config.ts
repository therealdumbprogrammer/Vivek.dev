import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishDate: z.date(),
    tags: z.array(z.string()),
    draft: z.boolean(),
  }),
});

const lessons = defineCollection({
  loader: glob({ base: './src/content/lessons', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(), summary: z.string(), course: z.string(),
    lessonSlug: z.string(), module: z.string(), order: z.number(),
    sourceByte: z.string(), draft: z.boolean().default(true),
    prerequisites: z.array(z.string()).default([]), jdk: z.string(),
  }),
});
export const collections = { blog, lessons };
