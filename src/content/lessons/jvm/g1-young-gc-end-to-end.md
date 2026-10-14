---
title: One G1 young GC cycle, end to end
summary: Follow a JDK 25 G1 young pause from Eden allocation and roots through evacuation, promotion, region reclamation, and GC log evidence.
course: jvm
lessonSlug: g1-young-gc-end-to-end
module: HotSpot Internals
order: 440
sourceByte: byte-044
draft: true
prerequisites:
  - virtual-method-call-end-to-end
jdk: JDK 25 · G1
---

[Lesson 42](/courses/jvm/object-allocation-end-to-end) followed `new Order()` into memory. [Lesson 43](/courses/jvm/virtual-method-call-end-to-end) followed a call on that object. In a running service, many threads keep creating orders. What happens when the space used for new objects fills?

This lesson follows one **G1 young collection** in JDK 25. The shortest useful model is: pause Java execution, find references into selected young regions, copy the live objects elsewhere, then reuse the evacuated regions. The details explain both correctness and pause cost.

## Allocation pressure starts the cycle

A Java thread executing and changing the heap is a **mutator**. HotSpot's `JavaThread`s commonly allocate small ordinary objects in thread-local allocation buffers (**TLABs**) carved from G1 **Eden** regions. An allocation within a TLAB usually advances a pointer; it does not run GC for each `new`. G1's heap consists of regions whose roles include Eden, Survivor, Old, and free; like roles need not be physically adjacent. Humongous objects use a special path covered in Lesson 46.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable G1 allocation and young collection diagram"><a href="/images/courses/jvm/g1-young-allocation-cycle.svg" aria-label="Open G1 allocation cycle diagram"><img src="/images/courses/jvm/g1-young-allocation-cycle.svg" alt="Three Java threads allocate through separate TLABs into Eden regions; pressure leads to a young collection and reusable regions." width="1080" height="430" /></a><figcaption>TLAB allocation feeds Eden; the collector responds to overall pressure and policy.</figcaption></figure>

G1 adaptively sizes the young generation using recent allocation and collection behavior. `-XX:MaxGCPauseMillis=200` is JDK 25 G1's default **goal**, not a guaranteed pause limit. A selected young collection set normally contains Eden regions and the relevant Survivor regions. G1 can adjust its size, but a wrong prediction or expensive roots and copying can still exceed the goal. <mark>Allocation creates pressure; G1 policy decides when to collect.</mark>

## Safepoint coordination and the collection set

A normal young evacuation is a stop-the-world (**STW**) pause. HotSpot requests a global **safepoint**; Java threads reach states where their references can be inspected reliably. The safepoint is the runtime coordination mechanism. G1's tracing and copying are the work performed during the pause. Time to bring threads to the safepoint and time doing GC are distinct quantities.

The **collection set** (CSet) names the regions G1 will evacuate in this pause. Imagine Eden regions E1 and E2 and an existing Survivor region S1 are selected, while Old regions O1 and O2 are outside the set. G1 must preserve every object in E1/E2/S1 reachable from outside, even if its only incoming edge is in O1. It need not scan or copy all of O1.

JDK 25 names four major phases of an evacuation pause. These names appear in detailed GC phase logs:

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable G1 evacuation pause phases"><a href="/images/courses/jvm/g1-young-pause-phases.svg" aria-label="Open evacuation phases diagram"><img src="/images/courses/jvm/g1-young-pause-phases.svg" alt="Pre Evacuate Collection Set prepares TLABs and the CSet; Merge Heap Roots combines incoming heap references; Evacuate Collection Set traces and copies; Post Evacuate Collection Set finishes and prepares resumption." width="1080" height="450" /></a><figcaption>The four JDK 25 phase names locate the work inside a single STW pause.</figcaption></figure>

**Pre Evacuate Collection Set** includes preparation such as disconnecting mutator TLABs and finalizing the CSet. The next two phases establish incoming references and evacuate reachable objects. **Post Evacuate Collection Set** performs finishing work, which can include reference processing, region bookkeeping, and preparation for resumed allocation. These phase labels describe major groups; log subphases provide the finer breakdown.

## Find every incoming reference

G1 begins from references originating **outside** the CSet. VM roots include Java thread stacks, JNI handles, class and static-related state, HotSpot internal structures, and code roots. For compiled frames at a safe point, an **OopMap** records where managed object references are in registers and stack slots. GC can inspect the precise locations; it does not guess from words that resemble addresses.

There is a second source: **heap roots**. This term in G1 pause logging means references from *other heap regions* into the CSet, rather than Java thread roots. Consider `Customer` in Old O1 with `latestOrder` pointing to `Order` in Eden E1. Even if a thread stack does not point directly to `Order`, G1 must find that edge. The general rule covers any outside-CSet region, with old-to-young the familiar case. <mark>A young collection needs both VM/code roots and incoming heap references.</mark>

When Java writes `customer.latestOrder = order`, G1's **post-write barrier** and card machinery record information that can locate relevant cross-region references. A card represents an approximate source area, so it must be scanned to find actual fields. Refinement may run concurrently. JDK 25 G1 manages remembered information for groups of regions; it is inaccurate to picture one exact remembered set for each region. During **Merge Heap Roots**, G1 builds a unified view for the selected CSet, removes duplicates, and organizes parallel scan work. The result avoids scanning the entire old generation at every young pause.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable external roots and remembered information diagram"><a href="/images/courses/jvm/g1-young-external-roots.svg" aria-label="Open external roots diagram"><img src="/images/courses/jvm/g1-young-external-roots.svg" alt="A thread stack and a code root point into young collection-set regions; an Old Customer points to a young Order through a card found by merged remembered information." width="1080" height="490" /></a><figcaption>Different outside sources converge on live objects inside the CSet; heap-root merging concerns the source regions, not OopMaps.</figcaption></figure>

## Evacuation follows a graph

Suppose E1 contains `Order A`, `Order B`, `Customer C`, and `Order D`. A thread root reaches A; A points to C; an old object points to D; B is unreachable. GC workers start from the incoming references, copy A, C, and D into destination regions, and process their fields until no reachable CSet objects remain. B is never copied. **Forwarding information** coordinates discovery when multiple paths or workers encounter the same old location. Relevant roots and object fields are adjusted to the copied locations before mutators resume.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable G1 graph evacuation diagram"><a href="/images/courses/jvm/g1-young-evacuation-graph.svg" aria-label="Open evacuation graph diagram"><img src="/images/courses/jvm/g1-young-evacuation-graph.svg" alt="Thread root reaches Order A, which reaches Customer C; an Old object reaches Order D. A, C, and D are copied to Survivor or Old while unreachable B stays behind; references are redirected." width="1080" height="520" /></a><figcaption>Reachability decides which objects move; successful evacuation makes the whole source region reusable.</figcaption></figure>

The new copy has a different address, but Java still observes the same **logical object identity**. Physical address is a HotSpot implementation detail. Some copies go to Survivor, others to Old. G1 considers age, its adaptive tenuring threshold, and available Survivor capacity; there is no universal “promote after exactly N collections” rule. Promotion connects repeated young survival to rising old occupancy in [Lesson 45](/courses/jvm/g1-concurrent-marking).

If every required live object leaves a source region, G1 reclaims that region wholesale. It need not free each dead object separately. This condition matters: destination pressure or pinning can prevent complete evacuation. G1 then has failure handling and cannot simply declare every affected source region empty. Lesson 46 will examine that recovery path.

## What makes a pause expensive?

Compare two services that each allocate 1 GB/s. In A, 98% of Eden objects die before collection. In B, a large fraction remains reachable. B usually copies more bytes, may promote more, and may create more old pressure. Yet copied bytes alone are not the whole pause: root scanning, cards and remembered information, reference processing, and GC worker efficiency matter too. Total heap capacity and allocation rate alone cannot predict a young pause. <mark>G1 mostly pays to discover and move survivors, plus the roots and cards needed to find them.</mark>

The ordinary cycle is therefore: TLAB allocation → adaptive trigger → safepoint → CSet and incoming roots → graph evacuation → successful source-region reclamation → mutators resume. The same pattern repeats while the application runs.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable complete G1 young collection cycle"><a href="/images/courses/jvm/g1-young-cycle-complete.svg" aria-label="Open complete young collection cycle"><img src="/images/courses/jvm/g1-young-cycle-complete.svg" alt="Allocation through TLABs fills Eden; G1 selects young regions and reaches a safepoint; roots and cards reveal live objects; evacuation sends survivors to Survivor or Old; successful source regions are reused and mutators resume." width="1080" height="500" /></a><figcaption>Each pause is one turn of the allocation and reclamation cycle; promotion carries some survivors into the next lesson's Old-generation story.</figcaption></figure>

Notice the two boundaries in that sequence. **Before** the pause, mutators allocate and write references while barrier and refinement work maintain information G1 will need. **During** the pause, GC workers use roots and that information to make selected regions safe to reuse. **After** the pause, application threads continue with references to the copied objects. A single Java object may survive multiple turns, but its physical address can change when it is evacuated.

## Read a controlled GC log

With a disposable, bounded JDK 25 workload, enable G1 and write detailed phase logging:

```bash
java -Xms256m -Xmx256m -XX:+UseG1GC \
  '-Xlog:gc*,gc+phases=debug:file=g1-young.log:uptime,level,tags' \
  YourBoundedDemo
```

`YourBoundedDemo` stands for a locally controlled program; the command is a template, not a claimed run. Search the log for `Pause Young (Normal) (G1 Evacuation Pause)` and its GC ID, then inspect the matching `Pre Evacuate Collection Set`, `Merge Heap Roots`, `Evacuate Collection Set`, and `Post Evacuate Collection Set` timings. Compare before/after heap occupancy and `Eden regions`, `Survivor regions`, and `Old regions` lines. Log wording and subphases can vary by JDK build. A concurrent-start young pause can additionally initiate old marking; keep its marking purpose separate from the young evacuation inside that pause.

<details class="lesson-check"><summary>Two services allocate at the same rate. Why might their young pause times differ?</summary><p>Their live evacuation volumes and incoming-reference scanning workloads may differ. Allocation rate describes pressure; it does not tell us how much survives or how much root/card work the pause needs.</p></details>

<details class="lesson-check"><summary>If an Old object points into selected Eden, can G1 scan only thread stacks?</summary><p>No. The Old object's field is an incoming heap reference. Post-write/card and remembered information let G1 find candidate source areas without scanning all Old regions.</p></details>

<details class="lesson-check"><summary>Why is a successfully evacuated Eden region cheap to reclaim?</summary><p>All required live objects have moved and relevant references point to their copies, so G1 can reuse the entire source region. Failed evacuation or pinning breaks that simple condition.</p></details>

The next lesson follows what happens as promotion grows Old occupancy: [G1 concurrent marking](/courses/jvm/g1-concurrent-marking) discovers liveness for later mixed collections.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on Daily JVM Byte #44 and its approved review. The service examples and diagrams are illustrative; the GC logging command is provided for a controlled JDK 25 run and was not executed for this lesson. The phase names, adaptive policy, grouped remembered information and evacuation behavior describe JDK 25 G1, not a Java language guarantee or every collector. Exact subphases and timings depend on the build and workload.</p><ul><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html">Oracle JDK 25 G1 collector guide</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-garbage-collector-tuning.html">Oracle JDK 25 G1 tuning and diagnostics</a></li><li><a href="https://github.com/openjdk/jdk/tree/jdk-25%2B36/src/hotspot/share/gc/g1">OpenJDK 25 G1 implementation</a></li></ul></details>
