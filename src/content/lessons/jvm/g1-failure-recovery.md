---
title: When G1 cannot keep up — evacuation failure, humongous objects and Full GC
summary: Diagnose failed evacuation, pinned objects, humongous allocation pressure and Full GC by separating reclamation lag from a large retained live set.
course: jvm
lessonSlug: g1-failure-recovery
module: HotSpot Internals
order: 460
sourceByte: byte-046
draft: true
prerequisites:
  - g1-concurrent-marking
jdk: JDK 25 · G1
---

[Lesson 44](/courses/jvm/g1-young-gc-end-to-end) followed a successful young evacuation. [Lesson 45](/courses/jvm/g1-concurrent-marking) followed concurrent marking and later mixed collections. Both paths need room to work. A service can have plenty of garbage and still struggle to allocate if G1 cannot move survivors or reclaim Old regions quickly enough. This lesson follows that failure through the heap and then through the GC log.

## Reclaiming a region first requires somewhere to put its survivors

G1 divides the heap into regions. During a normal young or mixed collection, it copies reachable objects out of selected **source regions** into **destination regions**. Only a successfully emptied source region can be reused as a whole. The dead objects require no copy, but their live neighbors do.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable G1 evacuation space dependency diagram"><a href="/images/courses/jvm/g1-evacuation-space-dependency.svg" aria-label="Open evacuation space dependency diagram"><img src="/images/courses/jvm/g1-evacuation-space-dependency.svg" alt="A source region with live and dead objects becomes free only after its live objects fit in a destination region; insufficient destination space leaves the source occupied." width="1080" height="450" /></a><figcaption>Copying collection needs free destination space before it can release a source region. The sizes are illustrative.</figcaption></figure>

Imagine selected regions contain 90 MB of reachable objects but G1 can obtain only 60 MB of suitable destination space. It can copy some objects, then fail to allocate space for another. <mark>Garbage inside a source region does not make the region reusable while reachable objects remain there.</mark>

## A failed evacuation can still leave a consistent heap

An **evacuation failure** means that G1 could not move some selected objects. It does not mean the process immediately exits or always enters Full GC. Objects copied before the failure stay at their new locations; objects that were not copied remain at their original locations. G1 uses forwarding and failure handling to make references consistent before application threads resume. Affected regions cannot be reclaimed wholesale, and G1 can select them for prompt evacuation in later collections.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable partial evacuation and recovery diagram"><a href="/images/courses/jvm/g1-evacuation-failure-recovery.svg" aria-label="Open partial evacuation diagram"><img src="/images/courses/jvm/g1-evacuation-failure-recovery.svg" alt="Objects A and B are copied and references follow them; C remains in the failed source region, which is preserved. Java resumes after references are consistent." width="1080" height="500" /></a><figcaption>Partial evacuation preserves both moved and unmoved objects. It does not make the failed source region empty.</figcaption></figure>

A single failure may be recoverable. Repeated failures reduce the useful headroom for the next cycle and may lead to a much more expensive recovery path. Read events in sequence, including how much space the next collections actually recover.

## Ask why an object could not move

JDK 25 G1 can report `Evacuation Failure: Allocation`, `Evacuation Failure: Pinned`, or both in one event. **Allocation** means destination space was unavailable. Investigate the free-region budget, surviving bytes, promotion rate and how promptly marking and mixed collections reclaim Old space.

**Pinned** means an object could not move at that time. One cause is native code using a JNI critical-array operation such as `GetPrimitiveArrayCritical`. Under circumstances where HotSpot provides access to the array's storage, movement must be coordinated with that access. G1 region pinning lets other collection work proceed while respecting the pinned region; pinning itself is a valid cooperation mechanism. Repeated pinned failures call for reviewing native critical-section duration and release paths, as explained in the [JNI lesson](/courses/jvm/jni-native-boundary), rather than changing heap flags reflexively.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable allocation and pinned evacuation failure comparison"><a href="/images/courses/jvm/g1-allocation-vs-pinned-failure.svg" aria-label="Open evacuation failure causes diagram"><img src="/images/courses/jvm/g1-allocation-vs-pinned-failure.svg" alt="Allocation failure points to insufficient destination space and heap headroom; pinned failure points to an object held in place during native critical access. Both can leave regions unevacuated." width="1080" height="470" /></a><figcaption>The log's failure reason changes the investigation. Both reasons can appear together.</figcaption></figure>

## Humongous objects consume Old regions differently

For G1, an object whose **total allocation size** is at least half a region is **humongous**. With 2 MB regions, an object of approximately 1 MB meets that threshold. Total size includes its header and alignment, so a payload size alone does not determine the classification. G1 allocates a humongous object directly in an Old-generation sequence of contiguous regions, bypassing ordinary Eden allocation.

Consider a 2.1 MB object with 2 MB regions. It occupies two regions, or 4 MB of region capacity. The last 1.9 MB cannot hold unrelated allocations while the object occupies that sequence. That is **internal fragmentation**. Now consider the free-region pattern `free, occupied, free, occupied, free`: three free regions exist, but no adjacent pair. An object needing two regions cannot fit there. That is a **contiguity problem** in the free-region layout, even though aggregate free capacity is adequate.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable humongous object fragmentation diagram"><a href="/images/courses/jvm/g1-humongous-tail-and-contiguity.svg" aria-label="Open humongous fragmentation diagram"><img src="/images/courses/jvm/g1-humongous-tail-and-contiguity.svg" alt="A 2.1 MB object takes two 2 MB regions and strands a 1.9 MB tail; a separate region map has enough free regions in total but no adjacent pair." width="1080" height="510" /></a><figcaption>Tail waste and the need for adjacent free regions are independent costs of humongous allocation.</figcaption></figure>

A burst of large `byte[]` values can therefore raise Old occupancy directly and consume marking headroom before promotion explains the growth. G1 checks the initiating occupancy threshold on humongous allocations and may begin a concurrent marking cycle. Dead eligible humongous objects can be reclaimed eagerly or after marking and cleanup. G1 ordinarily avoids moving live humongous objects during normal evacuation, though a costly last-resort collection can relocate them. “Humongous” does not mean absolutely immovable.

## Full GC is a recovery mechanism, not a diagnosis

Normal G1 operation uses selected young and mixed evacuation pauses, with much Old marking performed concurrently. If incremental work cannot make sufficient progress, G1 can perform a **stop-the-world Full GC** that analyzes and compacts the whole heap. This may pause the application far longer than a typical selected-region collection. In an extreme allocation failure, reclamation can remain insufficient and the application may reach `OutOfMemoryError`.

A Full GC can also be associated with explicit GC requests or diagnostic operations. Its presence alone proves neither an evacuation failure nor a leak. Read the **cause**, the preceding allocation and marking timeline, and the post-collection occupancy. An isolated evacuation failure that recovers in subsequent collections is different from recurring failures followed by a compaction pause.

## Separate allocation pressure from retained live-set pressure

Take two illustrative 8 GB heaps. In one, about 3 GB is live, 4 GB is temporary garbage, and 1 GB is free. There is substantial reclaimable space, but rapid allocation, promotion, late marking, limited GC CPU or humongous bursts may outpace G1's ability to recover it. In the other, about 7.7 GB remains reachable and only 0.3 GB is garbage. Even an effective Full GC can reclaim little. G1 cannot free objects still reachable from application roots.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable allocation pressure versus live-set pressure diagram"><a href="/images/courses/jvm/g1-allocation-vs-live-set-pressure.svg" aria-label="Open heap pressure comparison"><img src="/images/courses/jvm/g1-allocation-vs-live-set-pressure.svg" alt="Two 8 GB heaps: one holds 3 GB live data and 4 GB garbage, while the other holds 7.7 GB live data. Their post-collection free capacity differs sharply." width="1080" height="470" /></a><figcaption>The same heap capacity can conceal very different recovery potential; numbers are illustrative.</figcaption></figure>

<mark>Allocation pressure means reclamation cannot keep pace; live-set pressure means most capacity is still reachable.</mark> Compare occupancy after comparable collections across several cycles. A persistently rising post-GC baseline supports a retention investigation, but does not by itself prove a leak: a growing cache, traffic change, or legitimate live dataset can produce the same trend. A heap dump and paths to roots can establish *what* is retained.

## Read the JDK 25 evidence as a timeline

For a controlled run of an application that safely fits this heap, record G1 events and region counts:

```bash
java -Xms2g -Xmx2g -XX:+UseG1GC \
  '-Xlog:gc*,gc+heap=info:file=gc.log:time,uptime,level,tags' \
  -jar application.jar
```

| Indicator | Question to ask |
|---|---|
| `Evacuation Failure: Allocation` | Was destination headroom exhausted by survivor or promotion demand? |
| `Evacuation Failure: Pinned` | Which native critical accesses held arrays or regions in place, and for how long? |
| `Humongous regions: X->Y` | Are large objects consuming Old regions faster than they are reclaimed? |
| `Pause Full (G1 Compaction Pause)` | What event led to compaction, and how much space was recovered? |

These are documented JDK 25 indicators, not output from a run here. Follow GC IDs and timestamps from young evacuation through Concurrent Start, marking, mixed pauses and any Full GC. Compare before/after occupancy, humongous-region counts, application allocation rate, and process or container CPU. A high post-GC heap reading alone is not an exact retained-live-set measurement; compare comparable points and use object-retention evidence when necessary. Choose changes after the failing stage is known.

<details class="lesson-check"><summary>A young pause reports Allocation failure, then the next collections reclaim space. Was Full GC inevitable?</summary><p>No. G1 can preserve partially evacuated regions and retry them. The later successful reclamation is evidence that the failure was recoverable.</p></details>

<details class="lesson-check"><summary>Four free 2 MB regions are scattered between occupied regions. Can they hold a 2.1 MB humongous object?</summary><p>Only if at least two free regions are adjacent. Four free regions in aggregate do not satisfy the contiguous two-region requirement.</p></details>

<details class="lesson-check"><summary>An 8 GB heap remains around 7.7 GB occupied after repeated effective whole-heap collections. What should you investigate?</summary><p>Investigate retained objects and paths to roots, while checking whether the live dataset or cache legitimately grew. Tuning evacuation cannot reclaim reachable data.</p></details>

The complete path is allocation into Eden or directly into humongous Old regions, young and mixed evacuation when space permits, and possible Full GC if recovery cannot keep up. [Lesson 47](/courses/jvm/zgc-vs-g1-concurrent-relocation) examines a collector that relocates objects mostly while Java threads continue running, and the new costs that creates.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on Daily JVM Byte #46 and its approved review. Sizes, region layouts and scenarios are illustrative; the logging command was not executed for this lesson. Failure labels, region pinning and humongous handling describe JDK 25 HotSpot G1, not Java language guarantees. Exact events depend on workload and build.</p><ul><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html">Oracle JDK 25 G1 collector guide</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-garbage-collector-tuning.html">Oracle JDK 25 G1 tuning and failure diagnosis</a></li><li><a href="https://openjdk.org/jeps/423">JEP 423: Region Pinning for G1</a></li></ul></details>
