---
title: G1 failure modes — humongous objects, evacuation failure, and Full GC
summary: Learn why G1 needs evacuation headroom, how pinned and humongous objects complicate reclamation, and how to distinguish recovery paths in GC logs.
course: jvm
lessonSlug: g1-failure-modes
module: Garbage Collection
order: 260
sourceByte: byte-026
draft: true
prerequisites: [g1-satb]
jdk: JDK 25 · HotSpot G1
---

In [Lesson 25](/courses/jvm/g1-satb), G1 marked a changing heap with SATB. Marking tells G1 which old regions contain reclaimable space; it does not itself make room for every new object. In a normal young or mixed collection, G1 **evacuates** live objects from selected source regions into destination regions, then reuses the emptied sources. What happens when the destinations are scarce?

## Copying needs room before it frees room

Picture a collection set with two source regions. G1 must keep their live objects intact while copying survivors elsewhere. Only after the copy and reference updates can it reclaim the whole source regions. For a short time, both old and new copies occupy heap space. The free destination regions are working space for GC as well as capacity for future application allocations.

<figure><a href="/images/courses/jvm/g1-evacuation-headroom.svg" aria-label="Open evacuation headroom diagram"><img src="/images/courses/jvm/g1-evacuation-headroom.svg" alt="Live objects remain in two source regions while G1 copies survivors into free destination regions; only after copying can the old source regions be reclaimed." width="900" height="450" /></a><figcaption>Evacuation spends destination space before source space becomes reusable.</figcaption></figure>

<mark>A heap below <code>-Xmx</code> can still be too full for G1 to evacuate its live objects efficiently.</mark> `-Xmx` caps the heap; it is not the safe live-set capacity of an evacuating collector. G1 reserves some regions to reduce evacuation-failure risk, but a rapidly growing live set or promotion surge can use up practical headroom.

<aside class="lesson-callout" data-kind="key-idea" aria-label="Key idea"><p class="callout-label">Key idea</p><p>Free regions do two jobs: they receive new application allocations and provide destinations for survivors during a G1 evacuation pause. Plan capacity for both jobs.</p></aside>

## When evacuation cannot finish

An **evacuation failure** means G1 could not move some objects during a collection. In JDK 25, the GC log reports `Evacuation Failure: Allocation` when it cannot obtain enough destination space, `Evacuation Failure: Pinned` when an object cannot move because native critical access has pinned it, or both reasons together. A JNI `GetPrimitiveArrayCritical()` call is one example of the pinning path. The log reason matters: a pinned object is a movement constraint even if free bytes appear available. [JDK 25 G1 collector guide](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html)

<figure><a href="/images/courses/jvm/g1-evacuation-failure-allocation.svg" aria-label="Open evacuation failure causes diagram"><img src="/images/courses/jvm/g1-evacuation-failure-allocation.svg" alt="An Allocation failure has no destination space for an object copy; a Pinned failure keeps an object in its region during native critical access. Either prevents complete evacuation of that source region." width="900" height="450" /></a><figcaption>Both reasons prevent complete evacuation, but they suggest different investigations.</figcaption></figure>

G1 must preserve every live object it could not move. A region that did not evacuate completely is temporarily unavailable for allocation and becomes a candidate for evacuation in later collections. <mark>An evacuation failure is a warning about an incomplete copy, not an automatic immediate Full GC.</mark> If collection ceases to free space under severe pressure, G1 can eventually schedule Full GC. [JDK 25 G1 collector guide](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html)

That incomplete reclamation can feed itself. Fewer free regions make the next evacuation harder; failures leave less space reclaimed than planned; the next pause begins with still less headroom.

<figure><a href="/images/courses/jvm/g1-headroom-spiral.svg" aria-label="Open G1 headroom feedback loop"><img src="/images/courses/jvm/g1-headroom-spiral.svg" alt="Less free space leads to harder evacuation, which leaves source regions unreclaimed and further reduces destination headroom." width="900" height="450" /></a><figcaption>The feedback loop explains why apparently moderate occupancy can deteriorate quickly when survival rises.</figcaption></figure>

## Humongous objects need a different shape of free space

In G1, an object whose size is **at least half a region** is *humongous*. The threshold changes with region size: for an illustrative 4 MiB region, a 2 MiB object reaches it. G1 allocates such an object directly in old-generation regions, beginning in a humongous-start region and continuing through as many adjacent humongous-continuation regions as needed. It does not follow the ordinary Eden → Survivor → Old path. [JDK 25 G1 collector guide](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html)

<figure><a href="/images/courses/jvm/g1-humongous-object.svg" aria-label="Open humongous object region layout"><img src="/images/courses/jvm/g1-humongous-object.svg" alt="A large object begins in a humongous-start old region and extends through contiguous continuation regions; unused space at the end of the last region cannot serve another allocation until the object is reclaimed." width="900" height="450" /></a><figcaption>A humongous object occupies a whole region run, including unusable tail space in its final region.</figcaption></figure>

The allocation requires a **contiguous run** of free regions. Three free regions separated by used regions do not satisfy a request for three adjacent regions, even though their total free bytes look sufficient. This fragmentation can provoke collection pressure or even an allocation failure below `-Xmx`.

<figure><a href="/images/courses/jvm/g1-humongous-fragmentation.svg" aria-label="Open contiguous region requirement"><img src="/images/courses/jvm/g1-humongous-fragmentation.svg" alt="Free regions alternate with used regions, giving enough total free region count for a large object but no contiguous three-region run." width="900" height="450" /></a><figcaption>Total free bytes do not tell you whether a sufficiently long adjacent run exists.</figcaption></figure>

G1 normally leaves a live humongous object in place rather than copying it during ordinary evacuation. It can reclaim a dead humongous object's regions after marking, and may eagerly reclaim eligible dead primitive arrays at pauses; moving a live humongous object is a special, costly last resort. Humongous allocations also make G1 check whether occupancy calls for a Concurrent Start pause. A few long-lived large arrays may be perfectly reasonable. Diagnose object-size distribution, allocation frequency, lifetime, and region occupancy before treating the category itself as a defect. [JDK 25 G1 collector guide](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html)

## Marking has to win a race

Application threads, called **mutators** in GC discussions, keep allocating and promoting survivors into old regions while G1 marks concurrently. Marking must finish, and subsequent mixed collections must reclaim old space, before demand consumes the remaining headroom. SATB can conservatively retain objects that became dead during the cycle, as Lesson 25 explained, so a successful mark is not instantaneous recovery of every dead byte.

<figure><a href="/images/courses/jvm/g1-marking-race.svg" aria-label="Open old occupancy and marking race"><img src="/images/courses/jvm/g1-marking-race.svg" alt="Old occupancy rises from allocation and promotion while Concurrent Mark runs; a successful cycle reaches mixed collections before headroom disappears, whereas a sudden rate increase can exhaust headroom first." width="900" height="450" /></a><figcaption>Reclamation must arrive before allocation and promotion consume the remaining working space.</figcaption></figure>

G1's **Adaptive Initiating Heap Occupancy Percent (IHOP)** estimates when to start marking from observed marking duration and old-generation allocation during prior cycles, allowing safety headroom for reclamation. It does not forever wait for one fixed percentage. If the workload suddenly promotes much more data or marking takes longer, yesterday's prediction can start the cycle too late. Inspect the timing and occupancy trend before changing IHOP or reserve settings. [JDK 25 G1 collector guide](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html)

## The recovery ladder and Full GC

Healthy G1 uses young evacuation, concurrent marking, and mixed collections to reclaim incrementally. Under pressure, destination space shrinks, evacuation may fail for `Allocation` or `Pinned` reasons, and reclamation may lag. In the severe case where ordinary collections cannot free enough space, G1 can use a **Full GC**: a stop-the-world, full-heap, in-place compaction path with very different latency from its ordinary regional evacuation pauses. The stages are possible escalation, not a claim that every failure proceeds directly to the next one. [JDK 25 G1 collector guide](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html)

<figure><a href="/images/courses/jvm/g1-normal-vs-full-gc.svg" aria-label="Open normal G1 and Full GC comparison"><img src="/images/courses/jvm/g1-normal-vs-full-gc.svg" alt="Normal G1 has stop-the-world regional evacuation pauses interleaved with concurrent marking and incremental mixed reclamation. Under severe pressure G1 may perform a stop-the-world full-heap in-place compaction." width="900" height="450" /></a><figcaption>Full GC changes the amount of heap processed while the application is stopped.</figcaption></figure>

<aside class="lesson-callout" data-kind="important" aria-label="Important"><p class="callout-label">Important</p><p>Repeated G1 Full GCs are an operational warning. Check the logged cause before attributing them to allocation pressure: <code>System.gc()</code> or an external tool can explicitly request a full collection, while old-space pressure and failed reclamation lead to a different investigation.</p></aside>

## Read the logs before changing flags

Start a JDK 25 process with `-Xlog:gc*` to see GC events, their causes, timing, and region trends. For a running service, use its existing logs first. The following are **patterns to classify**, not diagnoses from one line:

<div class="lesson-table-scroll" role="region" aria-label="G1 log patterns and investigation questions" tabindex="0">
<table class="lesson-comparison"><caption>Read a pattern across multiple collections before changing a setting.</caption><thead><tr><th scope="col">Observation</th><th scope="col">Question to investigate</th></tr></thead><tbody>
<tr><th scope="row">Old occupancy rises across cycles</th><td>Is the live set growing, or is reclamation arriving too late?</td></tr>
<tr><th scope="row">High young survival and promotion</th><td>How much destination space does each pause need, and how quickly is old space filling?</td></tr>
<tr><th scope="row">Concurrent Mark completes after headroom vanishes</th><td>Did a changed allocation rate or marking time defeat Adaptive IHOP’s estimate?</td></tr>
<tr><th scope="row">Humongous regions: X-&gt;Y rises</th><td>What object sizes, frequency, and lifetimes occupy those regions? Is a contiguous run scarce?</td></tr>
<tr><th scope="row">Evacuation Failure: Allocation</th><td>Was destination space unavailable during copying?</td></tr>
<tr><th scope="row">Evacuation Failure: Pinned</th><td>Which JNI critical-access path kept objects in place, and for how long?</td></tr>
<tr><th scope="row">Repeated Pause Full (G1 Compaction Pause)</th><td>What is the logged cause: allocation/reclamation pressure, System.gc(), or an external request?</td></tr>
</tbody></table></div>

The JDK 25 tuning guide recommends GC logging for diagnosis and explains the humongous-region line, Full GC causes, and the possibility that Adaptive IHOP predictions miss a changed workload. [JDK 25 G1 tuning guide](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-garbage-collector-tuning.html)

<aside class="lesson-callout" data-kind="production" aria-label="Production note"><p class="callout-label">Production note</p><p>Capacity planning needs a live-set estimate plus room for allocation bursts, survivor copying, promotion, humongous region runs, and concurrent marking time. For example, an 8 GiB maximum heap with a 7.2 GiB sustained live set leaves far less useful G1 working space than one with a 3 GiB live set. These figures illustrate headroom, not a universal safe-occupancy threshold.</p></aside>

Observe and classify the pressure before tuning collector flags. A larger heap, shorter object lifetime, lower promotion rate, changed region size, or earlier marking addresses different evidence; none follows automatically from a single “GC is slow” report.

## Check your reasoning

<details class="lesson-check"><summary>The heap has unused bytes below -Xmx. Why might a young evacuation still fail with Allocation?</summary><p>Survivors need free destination regions while their old copies still exist. Unused bytes or nominal capacity alone do not guarantee enough destination space for the copy.</p></details>

<details class="lesson-check"><summary>A log reports Evacuation Failure: Pinned. Does that prove destination headroom was exhausted?</summary><p>No. Pinned means G1 could not move an object held in place for native critical access. The log may report both reasons; inspect the exact cause and JNI behavior.</p></details>

<details class="lesson-check"><summary>Three free regions exist, but a humongous object needs three regions and allocation fails. How is that possible?</summary><p>The free regions can be separated by occupied regions. A humongous object needs one contiguous run, and the unused tail of another humongous object's final region is unavailable.</p></details>

<details class="lesson-check"><summary>Why can a sudden promotion surge defeat a previously successful marking schedule?</summary><p>Adaptive IHOP predicts from observed marking time and old allocation. A new surge can consume headroom before marking and mixed reclamation finish, so the earlier prediction starts too late.</p></details>

## The complete G1 picture, and what ZGC changes

<mark>G1 succeeds when marking and regional reclamation keep enough free space ahead of application demand and survivor copying.</mark> The figure connects allocation, survivor movement, old occupancy, marking, and failure recovery into one loop.

<figure><a href="/images/courses/jvm/g1-failure-modes-complete.svg" aria-label="Open complete G1 pressure model"><img src="/images/courses/jvm/g1-failure-modes-complete.svg" alt="Application allocation and promotion raise old occupancy; Concurrent Mark and mixed evacuation reclaim regions; free headroom supports both new allocations and survivor copying. Loss of headroom can lead to evacuation failure and eventually Full GC." width="900" height="450" /></a><figcaption>The same free-region supply supports allocation and G1's copying work.</figcaption></figure>

This closes the G1 block. The next planned lesson begins **ZGC in JDK 25**: it is designed around concurrent relocation, while G1 ordinarily relocates objects during stop-the-world evacuation pauses. That difference changes how each collector manages latency and working space; the ZGC lesson will build the new mechanism from the same live-set questions.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on Daily JVM Byte #26 and the reviewed draft in the originating conversation. Region layouts, numeric heap examples, timelines, and log-pattern questions are illustrative; no GC workload was run. Evacuation reasons, humongous handling, Adaptive IHOP, and Full GC behavior describe HotSpot G1 in JDK 25, not Java language guarantees or all collectors. The ZGC sentence is an architectural bridge, not a claim that its full implementation is covered here.</p><ul><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html">JDK 25 G1 collector guide: evacuation failure, humongous regions, IHOP, and Full GC</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-garbage-collector-tuning.html">JDK 25 G1 tuning guide: logging and failure diagnosis</a></li><li><a href="https://openjdk.org/jeps/423">JEP 423: region pinning for G1</a></li><li><a href="https://openjdk.org/jeps/439">JEP 439: generational ZGC and concurrent relocation</a></li></ul></details>
