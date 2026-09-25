# JVM lesson authoring

Course lessons live in `src/content/lessons/jvm/`. Preserve technical qualifications and distinguish JVMS guarantees from HotSpot implementation details.

## Course structure

Use frontmatter `module` for the section name and `order` for the course sequence. Both the overview and sidebar use `getLessonSections()` in `src/data/learning.ts`; never maintain a second section list. Reuse existing module spellings (currently `Foundations`, `Execution and JIT`, and `Threads and Synchronization`). New modules appear automatically. Numbers are course-wide, not restarted per section. Planned entries retain their existing metadata, and draft visibility follows `getTracks()`.

## Meaningful emphasis

Use approximately 1–3 `<mark>short must-remember ideas</mark>` per lesson where appropriate, not a quota. Choose conceptual distinctions or high-value conclusions; do not highlight incidental terms, every definition, headings, or whole paragraphs. Keep existing wording and technical caveats intact. Colors belong in `src/styles/learning.css`, never in lesson markup.

For a larger standalone concept, use a semantic callout sparingly. Prefer moving an existing paragraph into the callout over repeating it. Most lessons need no callout; one is usually enough. Supported kinds and visible labels:

| data-kind | Label |
| --- | --- |
| key-idea | Key idea |
| important | Important |
| production | Production note |
| misconception | Common misconception |

```html
<aside class="lesson-callout" data-kind="important" aria-label="Important">
<p class="callout-label">Important</p>
<p>The existing standalone explanation, with its qualifications preserved.</p>
</aside>
```

Use HTML inside the callout (`<strong>`, `<code>`, links, paragraphs), since Markdown inside raw HTML blocks is not parsed consistently. Keep the visible label and `aria-label` identical. Do not rely on color alone to communicate meaning. Inline `<mark>` works within ordinary Markdown prose.

## Review

Run `npm run check` and `npm run build`. Review the course overview, collapsed and expanded sections, sidebar active state, previous/next links, and lesson emphasis at desktop and narrow mobile widths. Check both OS color schemes; course dark mode follows `prefers-color-scheme`. Keep diagram artwork in its authored colors. No new branch, commit, or publication is implied by local lesson editing.

Course contents start collapsed below 1024px and open on desktop. Readers can toggle them; section disclosures on the overview always start collapsed. Native details remain usable without JavaScript.

## Current JVM sequence — 2026-09-25

Daily JVM Byte #19 is Lesson 19, `platform-vs-virtual-threads`, order 190, a local draft after accepted Lesson 18. The next planned lesson is `synchronization-internals` (order 200), covering HotSpot lightweight locking and mark-word behavior in JDK 25. Use the shared planned entry until the real lesson replaces it. Production stops before the draft and later preview through the existing visibility filter.

Keep carrier reuse separate from Java thread identity, dynamic stack chunks separate from one permanent chunk per thread, and carrier-level TLABs separate from Java ThreadLocal values. JEP 491 was delivered in JDK 24; JDK 25 ordinary synchronized monitor ownership does not inherently pin. Carrier release does not imply monitor release, and native-frame interaction can still prevent unmounting. Future locking diagrams must use the JDK 25 baseline and define configuration-specific header assumptions.

For multi-column comparisons that need more width than a phone provides, use a semantic `table.lesson-comparison` inside a keyboard-focusable `div.lesson-table-scroll` with a descriptive region label. The table scrolls internally, uses shared light/dark tokens, and keeps the page within the viewport. Long inline API names wrap through the shared course stylesheet.
