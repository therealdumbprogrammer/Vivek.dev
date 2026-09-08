# Byte #2 editorial review

Source: originating Save Backend Resource conversation; full byte retrieved. No separately written reviewed draft appeared in its latest turns. The implementation follows the explicit accuracy requirements in the handoff.

- Foundations lesson 2, order 20; draft remains development-only. Object-layout is an explicit planned preview at order 30.
- Distinguish reserved, committed and resident memory. Thread count times nominal stack size estimates reservation, not RSS; applies to platform threads.
- Metaspace follows class loading and loader lifecycle; eligibility does not promise immediate unloading or RSS reduction.
- Code Cache and direct backing storage are native; wrappers are heap objects. GC can participate in native cleanup but does not govern total process memory.
- Container limits use cgroup accounting, not merely one JVM RSS. Budget figures are illustrative resident contributions, not measurements or a sum of limits.
- NMT reports HotSpot categories, reserved and committed; it is not a complete native allocation profiler or RSS report.
- Lesson 1's prose continuation is plain text so production does not link to the excluded draft; shared navigation links Lesson 1 to Lesson 2 locally.
- Original editable SVG follows Lesson 1 figure, caption, full-size link and accessibility conventions.

## Validation

- OpenJDK 25.0.2: compiled and ran MemoryProbe with -Xms16m -Xmx64m and summary NMT. Direct buffer allocation, jcmd summary, baseline and summary.diff succeeded. Actual output retained in nmt-validation.txt; process exited normally. No container OOM experiment was run; budgets remain illustrative.
- Astro check: zero errors/warnings/hints. Build: 57 pages. An initial transient runtime duplicate-ID sync warning cleared on the final check; only one runtime source exists.
- Draft route absent from dist; no production HTML/XML contains its URL.
- Local browser checked 1280px desktop and 390px mobile: title, draft marker, selected sidebar, diagram load, heading anchors, keyboard-operated reasoning disclosure, previous/next sequence and object-layout end-of-preview all work. No page overflow; long Java code remains inside a horizontally scrollable code block. Overview shows 3 lessons, 1 draft.
- Existing dev server remains at http://127.0.0.1:4321.
