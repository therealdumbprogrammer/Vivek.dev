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

## Current JVM sequence — 2026-09-29

Daily JVM Byte #20 is Lesson 20, `synchronization-internals`, order 200. Daily JVM Byte #21 is Lesson 21, `reentrant-lock-aqs`, order 210, and closes Threads and Synchronization. The next planned lesson starts Garbage Collection foundations. Lesson 20 remains a local draft; Lesson 21 is currently accepted in the live content. Shared visibility filtering excludes drafts from production output and navigation.

Keep carrier reuse separate from Java thread identity, dynamic stack chunks separate from one permanent chunk per thread, and carrier-level TLABs separate from Java ThreadLocal values. JEP 491 was delivered in JDK 24; JDK 25 ordinary synchronized monitor ownership does not inherently pin. Carrier release does not imply monitor release, and native-frame interaction can still prevent unmounting. Synchronization lessons must distinguish Java monitor semantics from HotSpot representations; JDK 25 Mark Word lock state from LockStack ownership; monitor entry contention from wait-set behavior; and ordinary synchronized ownership from carrier pinning. Future locking diagrams must use the JDK 25 baseline and define configuration-specific header assumptions.

For multi-column comparisons that need more width than a phone provides, use a semantic `table.lesson-comparison` inside a keyboard-focusable `div.lesson-table-scroll` with a descriptive region label. The table scrolls internally, uses shared light/dark tokens, and keeps the page within the viewport. Long inline API names wrap through the shared course stylesheet.


For synchronization lessons, distinguish the Java monitor contract from HotSpot's representation. Keep JDK 25 lightweight-lock Mark Word state separate from LockStack ownership bookkeeping; explain inflation as a possible transition to richer ObjectMonitor state and include deflation where relevant. Distinguish monitor-entry contention from Object.wait() release/wait-set/reacquire semantics. Preserve JEP 491's virtual-thread identity correction. Diagnose measured contention and critical-section behavior rather than attributing cost to `synchronized` by itself.

Daily JVM Byte #22 is Lesson 22, `gc-foundations`, order 220, and begins the Garbage Collection module as a local draft. The next preview is `generational-gc-mechanics`, order 230. Preserve the split between tracing/liveness and space reclamation in collector-specific lessons; moving survivors entails reference repair, and live-set/survival/headroom evidence should accompany allocation-rate claims.

Daily JVM Byte #23 is Lesson 23, `generational-gc-mechanics`, order 230, a local draft. It makes incoming references the central correctness requirement of a young collection. Keep post-write remembered-reference work separate from SATB concurrent-marking work; cards identify coarse source ranges and G1 remembered entries approximate outside locations that may point into a collection set. The next preview is `g1-internals`, order 240.


Daily JVM Byte #24 is Lesson 24, `g1-internals`, order 240, a local draft. Teach G1 through region roles and the CSet, then young evacuation, old liveness, the current JDK 25 marking cycle, and mixed collections. Concurrent Start is a young pause that initiates marking; normal evacuation remains stop-the-world. Old-region selection considers reclaimable space, predicted evacuation and remembered-root costs, connectivity, and pause budget. The next preview is Lesson 25, `g1-concurrent-marking-satb`; defer pre-write barrier mechanics until then.

Daily JVM Byte #25 is Lesson 25, `g1-satb`, order 250, a local draft. SATB records old overwritten references before stores; thread-local buffers supply later marking work rather than fully marking at enqueue. TAMS separates the mark-start population from later allocations. Floating garbage is conservative retention. Remark completes outstanding SATB/graph work to a fixed point, plus reference processing and class unloading; distinguish this from evacuation costs. Lesson 25 leads to `g1-failure-modes`, order 260.

Daily JVM Byte #26 is Lesson 26, `g1-failure-modes`, order 260, a local draft that closes the G1 sub-block. Separate `Evacuation Failure: Allocation` (destination space) from `Evacuation Failure: Pinned` (native critical access). Do not equate either event with immediate Full GC. Humongous allocation needs contiguous old-region runs; Adaptive IHOP predicts marking start from observed timing and old allocation. Diagnose logs and live-set headroom before tuning. Next preview: ZGC in JDK 25, beginning with concurrent relocation.

Daily JVM Byte #27 is Lesson 27, `zgc-jdk-25`, order 270, a local draft. Contrast G1's ordinary stop-the-world relocation with ZGC's concurrent relocation. Define ZPages and the Relocation Set separately from G1 regions/CSet. Teach colored references, cheap load-barrier fast paths, forwarding and incremental repair before discussing mutator slow-path work. Generational ZGC in JDK 25 also needs store barriers; `-XX:+UseZGC` is sufficient and older `-XX:+ZGenerational` advice is obsolete. Preserve short coordination pauses, headroom, and throughput costs. Next preview: Parallel GC and Serial GC, order 280.

Daily JVM Byte #28 is Lesson 28, `serial-parallel-gc`, order 280, a local draft. Serial and Parallel remain generational and primarily stop-the-world; separate worker parallelism from overlap with mutators. Teach small-job coordination cost, application-time throughput, tail latency, Parallel GC worker and adaptive sizing goals, and deployment CPU limits before comparing all four JDK 25 collectors by workload. This completes collector architecture. Next preview: GC ergonomics and heap sizing, order 290, covering `-Xms`, `-Xmx`, young sizing, allocation rate, live set, and headroom.

Daily JVM Byte #29 is Lesson 29, `gc-ergonomics-heap-sizing`, order 290, a local draft. Keep maximum capacity, committed heap, occupancy, and live set distinct. Explain G1 evacuation destination space and ZGC concurrent allocation runway; do not infer pauses from Xmx alone. Budget the whole process under container limits. Next preview: Reading GC logs in JDK 25, order 300, as the evidence source for sizing decisions.

Daily JVM Byte #30 is Lesson 30, `reading-gc-logs-jdk-25`, order 300, a local draft. Group lines by GC ID, read event type and cause, and interpret post-young-GC occupancy as a retention trend rather than an exact whole-heap live set. Distinguish concurrent duration from stop time and phase worker CPU from wall time. The GC block is complete. Next preview: native memory architecture outside `-Xmx`, order 310.

Daily JVM Bytes #31 and #32 are separate local draft Lessons 31 `native-memory-architecture` (310) and 32 `metaspace-internals` (320) in Native Memory. Keep NMT's HotSpot tracking scope separate from OS RSS and class-loader reachability separate from an allocator's ability to uncommit free chunks. The current next lesson is Code Cache internals (330), covering nmethods, segmented code heaps, reclamation, and pressure.

Daily JVM Bytes #33 and #34 are separate local draft Lessons 33 `code-cache-internals` (330) and 34 `thread-stacks-stack-walking` (340), both in Native Memory. Keep the Code Cache segmentation caveat tied to JDK 25 configuration and distinguish nmethod invalidation from reclamation. In stack explanations, keep physical compiled frames distinct from logical Java frames and connect OopMaps to precise GC at walkable states. The current next lesson is Direct and mapped memory (`direct-mapped-memory`, order 350).

Daily JVM Byte #35 is local draft Lesson 35 `direct-mapped-memory` (350), followed by local draft Lesson 36 `jni-native-boundary` (360), both in Native Memory. Distinguish NIO direct-buffer native allocations from OS-backed file mappings; keep wrapper reachability, derived-view ownership, eventual cleanup, capacity limits, and mapped virtual size versus RSS separate. `MaxDirectMemorySize` is not a process-native cap. In JNI, keep opaque references distinct from raw addresses, strong globals distinct from locals, and external malloc memory distinct from HotSpot NMT categories. Critical array access is a short coordination protocol, not a pinning guarantee. The current next lesson is Native Memory Tracking in depth (`native-memory-tracking-in-depth`, Lesson 37), covering reserved versus committed, summary/detail, baseline/diff analysis, category ownership, NMT scope, and a heap-looks-fine/process-is-huge workflow.

Daily JVM Bytes #37 and #38 are separate local draft lessons in Native Memory: `native-memory-tracking` (370) and `jvm-crash-anatomy` (380). NMT includes Java Heap reservation and commitment but does not profile arbitrary JNI/native allocations; compare NMT, RSS, and container metrics by trend and accounting scope. Fatal crash location is initial evidence, not proof of root cause; classify managed exit, HotSpot/native fault, and external kill before choosing tools. Lesson 39 `jvm-diagnostics-system` is now the authored successor in Production Diagnostics.

Daily JVM Bytes #39 and #40 are separate local draft lessons. Lesson 39 `jvm-diagnostics-system` (390) begins Production Diagnostics; Lesson 40 `hotspot-internal-object-model` (400) begins HotSpot Internals. Match each diagnostic question to the narrowest useful observation layer and verify hypotheses across views. For JDK 25, histogram and heap dump are high-impact operations; thread snapshots and JFR samples have different time scopes. In HotSpot diagrams, show conceptual relationships without claiming fixed object-header layouts or universal C++ pointer ownership. Keep `Method` metadata separate from compiled `nmethod` lifetime, reflection mirrors separate from `Klass`, and virtual-thread identity separate from a permanent carrier `JavaThread`. Next planned Lesson 41 is the OpenJDK source-code map; do not link to it until authored.

Daily JVM Bytes #41–43 are separate local draft lessons in HotSpot Internals at orders 410–430. Preserve the fixed JDK 25 source boundary; distinguish `new` from constructor invocation, TLAB from non-TLAB allocation, and `invokeinterface` from `invokevirtual`. Explain compiled inline caches separately from speculative inlining and guard misses separately from dependency invalidation. Lesson 44, One GC cycle end to end, is planned without a route.

Daily JVM Bytes #44 and #45 are separate local draft Lessons 44 `g1-young-gc-end-to-end` (440) and 45 `g1-concurrent-marking` (450) in HotSpot Internals. Lesson 44 uses JDK 25's four named evacuation phases and distinguishes VM/code roots from merged incoming heap roots; reclaim a source region wholesale only after successful evacuation. Lesson 45 separates SATB pre-write marking from post-write card tracking and concurrent liveness discovery from later mixed evacuation. Lesson 46, When G1 Cannot Keep Up, is next and has no route yet.

Daily JVM Bytes #46 and #47 are separate local draft Lessons 46 `g1-failure-recovery` (460) and 47 `zgc-vs-g1-concurrent-relocation` (470), both in HotSpot Internals. For G1, distinguish allocation failure from pinning, humongous tail waste from contiguous-region shortage, and reclamation lag from a large reachable live set. For JDK 25 ZGC, teach colored references, load and store barrier responsibilities, concurrent relocation, allocation stalls and headroom together. Lesson 48, ZGC’s concurrent relocation protocol, is next and has no route yet.

Daily JVM Byte #53 is local draft Lesson 53 `jvm-rss-growth-stable-heap` (530) in HotSpot Internals after Lesson 52. Teach used heap, committed heap and RSS in that order before native attribution. Distinguish live native allocations, allocator-held freed chunks and page touching. glibc arenas, dedicated mmap paths, `malloc_trim(0)` and `MALLOC_ARENA_MAX` require platform and workload qualifications. Correlate HotSpot NMT with Linux mappings and cgroup charges without subtracting their totals as a leak estimate. Lesson 54, Native Memory Tracking Internals, remains a plain-text preview without a route.

Daily JVM Bytes #55–57 are separate authored lessons in HotSpot Internals at orders 550–570. Lesson 55 separates safepoint arrival from VM-operation time; Lesson 56 traces guarded C2 assumptions, deoptimization and logical frame recovery; Lesson 57 traces profile → policy → broker → C1/C2 queues → compiler CPU → nmethod → Code Cache. Preserve its distinction between runnable CPU contention and cgroup quota throttling, transient startup queues and sustained capacity pressure, and compiler backlog and Code Cache exhaustion. Lesson 58, JVM Warm-up Versus Steady State, remains a plain-text preview without a route.
