---
title: Reading GC logs — reconstructing what the collector is doing
summary: Read JDK 25 GC logs as a timeline of allocation, survival, marking, evacuation, and reclamation rather than isolated pause numbers.
course: jvm
lessonSlug: reading-gc-logs-jdk-25
module: Garbage Collection
order: 300
sourceByte: byte-030
draft: true
prerequisites: [gc-ergonomics-heap-sizing]
jdk: JDK 25 · HotSpot Unified Logging, G1 examples
---

A service suddenly spends more time in GC. A dashboard gives you pause duration and heap usage, but neither explains whether allocations accelerated, more objects survived, or a concurrent cycle failed to recover headroom. [Lesson 29](/courses/jvm/gc-ergonomics-heap-sizing) supplied the capacity and headroom model. Here we turn a GC log into evidence about that model.

The examples use **G1**, the JDK 25 default on server-class machines. Serial, Parallel, and ZGC use different event names and mechanics, but the reading method still applies: identify the collector, group related lines, follow time and occupancy, then inspect work and failures. [JDK 25 GC guide](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html)

## Start with a useful log

JDK 25 uses **Unified Logging**. Begin locally with `-Xlog:gc*` to include GC-tagged detail. A common file form for sustained observation is:

```text
-Xlog:gc*:file=gc.log:time,uptime,level,tags
```

`-Xlog:gc` supplies high-level events; `gc*` selects tag sets containing `gc`, including heap and phase information at the configured level. Logging volume and rotation deserve attention in production. When the operational question is **total JVM stop time**, add safepoint events, for example `-Xlog:gc*,safepoint`. A safepoint is a JVM coordination point at which Java threads may be stopped for GC or other VM work, so GC pause time alone does not account for every stop. [JDK 25 `java` command](https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html)

## Reconstruct one event before interpreting it

Detailed output can give you several lines with `GC(36)`: the event start, worker count, phase times, region changes, a summary, and CPU totals. **The shared ID is the correlation key for that collection.** Gather its lines together before interpreting a single number. Other concurrent events can appear between them in a long log.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable GC event bundle diagram"><a href="/images/courses/jvm/gc-log-event-bundle.svg" aria-label="Open GC event bundle diagram"><img src="/images/courses/jvm/gc-log-event-bundle.svg" alt="Five lines sharing GC(36) lead into one collection record with type, phases, regions, summary, and CPU totals." width="900" height="450" /></a><figcaption>One collection is a bundle of observations linked by its GC ID.</figcaption></figure>

<mark>Group lines by `GC(n)` before diagnosing the collection they describe.</mark>

The compact summary below is illustrative of a G1 young pause:

```text
[10.191s][info][gc] GC(36) Pause Young (...) 391M->114M(508M) 13.075ms
```

`GC(36)` identifies the event. `Pause Young` says G1 stopped application threads to collect young regions. `391M` is **overall heap used before** this event; `114M` is **overall heap used after**; `(508M)` is the **current heap capacity** represented in the log; `13.075ms` is elapsed pause duration. The number in parentheses need not equal configured `-Xmx`.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable GC summary line diagram"><a href="/images/courses/jvm/gc-summary-line.svg" aria-label="Open GC summary line diagram"><img src="/images/courses/jvm/gc-summary-line.svg" alt="A G1 summary line is divided into event ID, event type, heap used before, heap used after, current heap capacity, and pause duration." width="900" height="450" /></a><figcaption>The arrow describes whole-heap occupancy around this event, even when the collection itself is young.</figcaption></figure>

<aside class="lesson-callout" data-kind="misconception" aria-label="Common misconception"><p class="callout-label">Common misconception</p><p><code>391M-&gt;114M(508M)</code> does not mean young-before → young-after (<code>-Xmx</code>). It reports overall heap occupancy before and after the event, followed by current heap capacity.</p></aside>

## Read type and cause first

A `Pause Young` evacuates young regions. A `Pause Young (Concurrent Start)` also launches an old-generation marking cycle. `Pause Remark` finishes concurrent marking at a stop-the-world point. A `Pause Young (Mixed)` includes selected old regions alongside young regions. `Pause Full` is a major fallback or explicit collection boundary. These labels locate the event in G1's state machine; a 50 ms young pause and a 50 ms Full GC require different questions. [G1 process](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html)

The **cause** adds another dimension. An explicit `System.gc()` request, a humongous allocation trigger, normal allocation pressure, and `Evacuation Failure: Allocation` are distinct stories. A Full GC after failed evacuation and rising Old occupancy suggests exhausted working space; an explicit Full GC calls for investigation of the caller and configuration. Read type, cause, surrounding events, and occupancy together.

<aside class="lesson-callout" data-kind="key-idea" aria-label="Key idea"><p class="callout-label">Key idea</p><p>Start diagnosis with the event type and cause. The same before/after numbers or pause length can arise from different collector work.</p></aside>

## Follow a sequence, not one collection

One `900M->300M` event tells you that this collection reduced occupancy. A series supplies **cadence** and trend. Consider these invented snapshots, each one second apart:

```text
1.0s  Young  900M->300M
2.0s  Young  900M->320M
3.0s  Young  900M->340M
4.0s  Young  900M->360M
```

Between the first two events, occupancy grows from about 300 MB to about 900 MB in one second. That suggests roughly 600 MB/s of **heap consumption pressure** between observations. It is not an exact allocation rate: heap resizing, concurrent reclamation, humongous objects, and collector accounting can alter the delta. Allocation profiling is needed for a measured rate. Still, the estimate tells you whether the available runway is disappearing quickly.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable allocation pressure timeline"><a href="/images/courses/jvm/gc-log-allocation-pressure.svg" aria-label="Open allocation pressure timeline"><img src="/images/courses/jvm/gc-log-allocation-pressure.svg" alt="Successive pauses show heap usage rising between the previous post-GC value and the next pre-GC value; the slope suggests consumption pressure." width="900" height="450" /></a><figcaption>The interval between events matters as much as the bytes reclaimed at each event.</figcaption></figure>

Now look at the **post-GC floor**: 300, 320, 340, 360 MB. A normal heap graph often rises with allocation and drops during reclamation, giving a sawtooth shape. A stable floor suggests broadly stable surviving occupancy. A rising floor means more remains after each collection. It can reflect promotion, cache growth, a larger workload, or a leak; the graph alone does not choose among them.

<mark>The post-GC floor is the useful trend; interpreting it requires knowing what that collection actually examined.</mark>

<aside class="lesson-callout" data-kind="important" aria-label="Important"><p class="callout-label">Important</p><p>After a young G1 collection, occupancy is a survival and retention signal, not an exact whole-heap live-set measurement. Unreachable objects can remain in old regions outside the collection set. A broader collection or completed liveness cycle gives stronger evidence about whole-heap retention.</p></aside>

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable sawtooth floor comparison"><a href="/images/courses/jvm/gc-sawtooth-floor.svg" aria-label="Open sawtooth floor comparison"><img src="/images/courses/jvm/gc-sawtooth-floor.svg" alt="Two sawtooth heap timelines contrast a stable post-GC floor with a rising post-GC floor." width="900" height="450" /></a><figcaption>Compare several troughs under similar workload before treating a rising floor as a persistent condition.</figcaption></figure>

Frequency is separate from pause length. Five milliseconds every ten seconds uses roughly 0.05% of elapsed time in those pauses; five milliseconds every half second uses roughly 1%, before other GC work or stops. Even unchanged short pauses can signal a throughput problem when they become frequent. Compare pause time over a representative window with wall-clock time, and include concurrent CPU cost when estimating application throughput.

## Find where surviving objects went

With G1 heap detail, a young event might report:

```text
Eden regions:       286->0
Survivor regions:    15->26
Old regions:         88->92
Humongous regions:    3->3
```

Eden's drop records regions processed by the young collection. More Survivor regions are consistent with young objects remaining alive. Old growth can reflect promotion; repeated `88->92`, `92->98`, `98->105` is more informative than one transition, though counts alone are not exact promoted bytes. Humongous regions hold sufficiently large objects using G1's special region path. Repeated Humongous growth points toward large arrays, buffers, or payloads and a different pressure mode than ordinary promotion, as [Lesson 26](/courses/jvm/g1-failure-modes) explained. [G1 logging examples](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html)

## Break a pause into its work

A 120 ms pause tells you the application was stopped for 120 ms. It does not tell you which GC activity consumed that time. Current G1 evacuation has **Pre Evacuate Collection Set**, **Merge Heap Roots**, **Evacuate Collection Set**, and **Post Evacuate Collection Set** phases. Preparation and cleanup surround root merging and survivor evacuation. `-Xlog:gc+phases=debug` exposes deeper work such as `Ext Root Scanning`, `Code Root Scan`, `Scan Heap Roots`, and `Object Copy`. [JDK 25 G1 phases](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html)

In an illustrative 120 ms pause, suppose evacuation takes 103 ms and `Object Copy` dominates its worker time. That suggests substantial survivor copying. If `Scan Heap Roots` dominates instead, inspect cross-region references and remembered-root work. Worker subphase times may overlap across parallel workers, so do not add them blindly to reconstruct wall-clock pause time.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable G1 pause phase breakdown"><a href="/images/courses/jvm/gc-pause-phase-breakdown.svg" aria-label="Open G1 pause phase breakdown"><img src="/images/courses/jvm/gc-pause-phase-breakdown.svg" alt="A 120 millisecond G1 pause is decomposed into preparation, root merging, evacuation, and cleanup, then evacuation is examined for copying versus root-scanning cost." width="900" height="450" /></a><figcaption>Phase detail turns a long pause into a specific question about GC work.</figcaption></figure>

<aside class="lesson-callout" data-kind="production" aria-label="Production note"><p class="callout-label">Production note</p><p>Inspect the dominant phase before tuning. The same total pause can come from survivor copying, root scanning, or other collector work, and each points to different evidence.</p></aside>

## Separate concurrent work from stop time

A `Concurrent Mark` lasting 400 ms is 400 ms of wall-clock collector activity that overlaps application execution. It is not a 400 ms application pause. `Pause Remark` and G1 evacuation pauses explicitly stop application threads. On a timeline, concurrent marking spans running application time; Remark is a shorter interruption within the cycle. [JDK 25 G1 process](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html)

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable concurrent versus pause timeline"><a href="/images/courses/jvm/gc-concurrent-vs-pause.svg" aria-label="Open concurrent versus pause timeline"><img src="/images/courses/jvm/gc-concurrent-vs-pause.svg" alt="Application work overlaps a long Concurrent Mark interval, while a short Remark interval interrupts application threads." width="900" height="450" /></a><figcaption>Collector wall time and application stop time are different measurements.</figcaption></figure>

Detailed output can also show `User`, `Sys`, and `Real`. `Real` is elapsed wall time. `User` is aggregate user-mode CPU time, and `Sys` is system-mode CPU time. Parallel GC workers can consume CPU simultaneously, so `User > Real` is normal: twenty workers active for roughly 10 ms can accumulate far more than 10 ms of CPU while the pause remains about 10 ms. Read CPU totals with worker count and wall time rather than interpreting `User` as the pause.

## Reconstruct the whole G1 cycle

Across event IDs, a healthy story can look like this illustrative sequence:

```text
GC(40) Young                  900M->320M   Old 88->92
GC(41) Young                  930M->340M   Old 92->97
GC(42) Young (Concurrent Start) 950M->360M
       Concurrent Mark runs while the application runs
GC(43) Pause Remark           marking completes
GC(44) Pause Cleanup          selects reclaimable old regions
GC(45) Young (Mixed)          980M->510M   Old 105->91
GC(46) Young (Mixed)          920M->390M   Old 91->78
```

Young collections leave more survivors and Old grows. Concurrent Start begins global marking; Remark finishes it; Cleanup prepares reclamation. Mixed collections then include selected old regions and reduce Old occupancy. The post-GC floor and working headroom recover. Exact log spelling and intermediate events vary by JDK and configuration, but this causal path is the point. [G1 collection cycle](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html)

A failing path can begin similarly, then diverge: mixed collections reclaim little, Old stays high, `Evacuation Failure: Allocation` appears when destination space is insufficient, and a `Pause Full` follows. Evacuation failure need not cause immediate Full GC every time; inspect the actual sequence. If a Full GC at `7900M` leaves `7300M` in an 8192 MB heap, only about 600 MB was reclaimed and headroom remains narrow. If it leaves `1800M`, about 6100 MB was reclaimable; investigate why normal collection did not recover it earlier. The Full GC **cause** still matters: allocation pressure, evacuation failure, `System.gc()`, and humongous allocation lead to different investigations. [G1 failure guidance](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html)

<aside class="lesson-callout" data-kind="important" aria-label="Important"><p class="callout-label">Important</p><p>After a Full GC, the occupancy that remains often says more about retention and remaining headroom than the pre-GC peak. Interpret it alongside the trigger and workload.</p></aside>

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable complete G1 log reconstruction"><a href="/images/courses/jvm/gc-log-complete.svg" aria-label="Open complete G1 log reconstruction"><img src="/images/courses/jvm/gc-log-complete.svg" alt="A healthy G1 path shows Young, marking, Remark, Cleanup, Mixed, and headroom recovery; a failing branch shows little Mixed reclamation, evacuation failure, and Full GC." width="900" height="450" /></a><figcaption>The same early Old growth can resolve through Mixed collection or progress into a fallback path.</figcaption></figure>

## A repeatable reading order

Read **collector and configuration → event cadence → heap before/after → post-GC floor → Eden/Survivor/Old/Humongous movement → concurrent cycle → pause phases → fallback or failure cause**. This order prevents a single large pause from hiding a sustained capacity problem. It also works for other collectors if you translate their event vocabulary and collection scope.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable GC log reading method"><a href="/images/courses/jvm/gc-log-method-generalizes.svg" aria-label="Open GC log reading method"><img src="/images/courses/jvm/gc-log-method-generalizes.svg" alt="A central reading sequence from configuration through failure is applied to G1, Serial, Parallel, and ZGC with different event vocabulary." width="900" height="450" /></a><figcaption>The diagnostic questions transfer across collectors; the log terms and pause mechanisms change.</figcaption></figure>

## Check your reasoning

<details class="lesson-check"><summary>After four young collections, the post-GC floor rises from 300 to 360 MB. Does that measure a 360 MB whole-heap live set?</summary><p>No. It shows occupancy remaining after the latest young collection. Old regions outside that collection set can still contain unreachable objects. Check Old and Humongous movement and broader-cycle evidence.</p></details>

<details class="lesson-check"><summary>Two 120 ms G1 pauses have different dominant subphases: Object Copy and Scan Heap Roots. Should they receive the same tuning response?</summary><p>No. First investigate survival and collection-set work for copying, and incoming references or remembered-root processing for root scanning. Confirm with representative logs and workload measurements.</p></details>

<details class="lesson-check"><summary>A 400 ms Concurrent Mark is followed by a 6 ms Remark. How long did this pair stop Java threads according to those events?</summary><p>The 400 ms marking duration overlaps application execution. The reported Remark pause contributes about 6 ms of stop time; inspect other pauses and safepoint logs for total JVM stop time.</p></details>

<details class="lesson-check"><summary>What differs between Full GC results of 7900M->7300M and 7900M->1800M?</summary><p>The first leaves little headroom after strong reclamation; investigate retained data and capacity. The second reclaims much more; investigate why normal collection could not recover it earlier. In both cases inspect the Full GC trigger.</p></details>

## From GC evidence to process memory

GC logs explain the Java heap and the collector's work within it. They do not account for all process memory. With the GC block complete, Lesson 31 begins **native memory architecture outside `-Xmx`**: Metaspace, Code Cache, thread stacks, direct buffers, GC structures, and the gap between heap health and container memory pressure.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on Daily JVM Byte #30 and its reviewed draft. All numeric log excerpts and SVGs here are illustrative reconstructions, not measured output; no JDK 25 workload was executed for this lesson. Event vocabulary and phase names describe JDK 25 HotSpot G1, not a Java language guarantee or every collector. Check actual runtime output when applying the method.</p><ul><li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html">JDK 25 java command: Unified Logging and safepoint options</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html">JDK 25 G1: collection cycle, phases, regions, and failures</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/ergonomics.html">JDK 25 GC ergonomics and default selection</a></li></ul></details>
