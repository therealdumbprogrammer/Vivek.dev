---
title: GC ergonomics — heap sizing, headroom, and why bigger is not always better
summary: Separate heap capacity from committed memory, occupancy, and live data; then size for collector headroom and the whole JVM process.
course: jvm
lessonSlug: gc-ergonomics-heap-sizing
module: Garbage Collection
order: 290
sourceByte: byte-029
draft: true
prerequisites: [serial-parallel-gc]
jdk: JDK 25 · HotSpot GC ergonomics
---

A service runs without `OutOfMemoryError`, yet its garbage collector runs every few hundred milliseconds. Another deployment gets a larger heap and finishes more work per second, but costs more memory per replica. Which size is right? After the [collector comparison in Lesson 28](/courses/jvm/serial-parallel-gc), we can answer by following the memory the collector has to preserve, the space it needs to work, and the process budget around it.

## Four quantities behind “heap size”

**Maximum heap capacity** is the upper bound selected by `-Xmx`. **Committed heap** is the capacity currently made available to HotSpot. **Current occupancy** is the space holding objects at this instant, including objects a later collection may reclaim. **Live set** is the data that remains reachable and must be preserved when an appropriate collection examines it. A young collection's post-GC occupancy is not necessarily a measurement of the entire live set: unreachable objects may remain in old regions it did not collect.

<figure><a href="/images/courses/jvm/heap-four-quantities.svg" aria-label="Open four heap quantities diagram"><img src="/images/courses/jvm/heap-four-quantities.svg" alt="Nested bars distinguish maximum heap capacity, committed heap, current occupancy, and live reachable data." width="900" height="450" /></a><figcaption>Capacity, commitment, occupancy, and live data answer different questions at the same moment.</figcaption></figure>

<mark>Two JVMs with the same `-Xmx` can have very different GC difficulty if their live sets differ.</mark> In an illustrative 6 GB heap budget, an application with a stable 3 GB live set leaves far more room to allocate and collect than one retaining 5.5 GB. Even when both avoid a heap OOM at a quiet moment, a burst, promotion, or collection's working space can expose the second application's narrow margin. The numbers are an example, not a universal safe percentage.

## `-Xms`, `-Xmx`, and physical memory

`-Xms` sets the initial Java heap size; `-Xmx` sets its maximum. With `java -Xms1g -Xmx8g MyApp`, HotSpot can begin with about 1 GB of heap capacity and grow toward 8 GB as demand and collector policy require. The maximum commonly reserves a range of **virtual address space**. Committed memory is made available for use; **resident memory** is the physical memory currently held in RAM as the operating system accounts for it. These are the distinct views introduced in [Lesson 2](/courses/jvm/memory). The relationship varies by platform, collector, page policy, and actual page use; committed bytes are not a direct RSS reading.

<figure><a href="/images/courses/jvm/heap-reserved-committed-resident.svg" aria-label="Open reserved committed resident diagram"><img src="/images/courses/jvm/heap-reserved-committed-resident.svg" alt="An 8 GB maximum is shown as virtual address reservation; a smaller portion is committed, while resident pages are an operating-system observation rather than the whole reservation." width="900" height="450" /></a><figcaption>`-Xmx8g` establishes a heap ceiling; it does not immediately place 8 GB of pages in physical RAM.</figcaption></figure>

<aside class="lesson-callout" data-kind="misconception" aria-label="Common misconception"><p class="callout-label">Common misconception</p><p><code>-Xmx</code> is a maximum for the Java heap, not a maximum for JVM process memory. Metaspace, Code Cache, platform-thread stacks, direct buffers, GC structures, native libraries, and other native allocations also consume process memory.</p></aside>

<figure><a href="/images/courses/jvm/process-memory-vs-xmx.svg" aria-label="Open process memory versus Xmx diagram"><img src="/images/courses/jvm/process-memory-vs-xmx.svg" alt="A JVM process contains Java heap alongside Metaspace, Code Cache, thread stacks, native buffers, GC structures, and libraries; Xmx bounds only the heap." width="900" height="450" /></a><figcaption>The heap ceiling is one boundary inside the larger process-memory boundary.</figcaption></figure>

## Why more heap can improve throughput

Imagine a service allocating rapidly while most new objects die young. A small effective young generation fills often. Every collection pays some fixed setup and coordination cost as well as work proportional to roots, references, and survivors. With more usable allocation space, collections may be farther apart, so repeated fixed overhead consumes a smaller share of elapsed time. That can improve application throughput **even when neither configuration would OOM**. The [Parallel collector's adaptive sizing guidance](https://docs.oracle.com/en/java/javase/25/gctuning/parallel-collector1.html) explicitly weighs frequency, collection time, and footprint.

The other side needs precision. A larger maximum capacity does not itself make every pause longer: unused capacity is not live data to copy. Pause work depends on collector, collection-set size, root/reference processing, and the live data within the collected area. A larger effective young generation can accumulate more survivors and make an individual young collection heavier, while reducing collection frequency. The measured outcome matters more than a slogan about heap size.

<figure><a href="/images/courses/jvm/young-generation-sizing.svg" aria-label="Open young generation sizing diagram"><img src="/images/courses/jvm/young-generation-sizing.svg" alt="A small young generation has frequent collections with potentially less work each; a large one has fewer collections with potentially more work each." width="900" height="450" /></a><figcaption>Young sizing trades collection frequency against possible work per collection; survival behavior determines how costly that work becomes.</figcaption></figure>

## Headroom keeps collection possible

**Operational headroom** is usable heap space beyond data that must remain live and beyond current occupancy that has not yet been reclaimed. It serves several jobs: new allocations, temporary bursts, young survivors, promotion into old regions, destination space for moved objects, and time for concurrent collection to finish. A simple “free bytes” number is only a snapshot; fragmentation and collector-specific availability also matter.

For **G1**, a normal young or mixed collection evacuates survivors out of its collection set. It therefore needs destination regions. Too little usable destination space can cause an evacuation failure, as [Lesson 26](/courses/jvm/g1-failure-modes) showed. G1's reserve concept provides an extra buffer in its adaptive old-occupancy prediction; it is a policy margin, not a separately allocated pile of free bytes. [JDK 25 G1 guide](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html)

For **ZGC**, much collection work runs concurrently with application allocation. Its heap needs room for the live set **and** allocations made while that work progresses. If allocation consumes available space faster than ZGC can reclaim it, the application may stall waiting for memory. [JDK 25 ZGC guide](https://docs.oracle.com/en/java/javase/25/gctuning/z-garbage-collector.html)

<figure><a href="/images/courses/jvm/gc-headroom-comparison.svg" aria-label="Open G1 and ZGC headroom comparison"><img src="/images/courses/jvm/gc-headroom-comparison.svg" alt="G1 uses available destination space to evacuate survivors; ZGC needs capacity for allocation while concurrent collection catches up." width="900" height="450" /></a><figcaption>Headroom has different immediate jobs in G1 and ZGC, but both collectors need working room around the live set.</figcaption></figure>

Suppose a snapshot shows 4 GB nominally free. At 100 MB/s of allocation, that resembles tens of seconds of runway; at 3 GB/s, it resembles about a second. **This is only time-to-exhaustion intuition**, not a GC scheduling formula: collections reclaim memory along the way, allocation is bursty, not all nominal free space is equally usable, and survival changes the result. Still, the comparison explains why capacity must be judged with allocation rate.

<figure><a href="/images/courses/jvm/headroom-allocation-rate.svg" aria-label="Open allocation runway diagram"><img src="/images/courses/jvm/headroom-allocation-rate.svg" alt="The same 4 GB free capacity lasts far longer at 100 MB per second than at 3 GB per second, before accounting for reclamation." width="900" height="450" /></a><figcaption>Equal free capacity can represent radically different runway under different allocation pressure.</figcaption></figure>

<mark>Healthy collector equilibrium means reclamation capacity keeps up with allocation and promotion pressure over time.</mark> A temporary spike is not necessarily a problem. A persistent rising post-collection floor, failed evacuation, allocation stalls, or repeated Full GC suggests the system is losing that balance. The cause can be more live data, faster allocation, less effective collection, an undersized heap, or a changed workload.

## Let ergonomics do its job

**GC ergonomics** means HotSpot makes ongoing policy choices from runtime observations and goals: how much heap or young space to use, when to begin a cycle, how much work to include in a collection set, and how many workers to use. Which choices are adaptive depends on the collector. For G1, young-generation size is part of its pause-time control: it estimates evacuation cost from prior collections and adjusts the next young size. [JDK 25 G1 guide](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html)

<aside class="lesson-callout" data-kind="important" aria-label="Important"><p class="callout-label">Important</p><p>Do not force a fixed G1 young-generation size by default. Setting one of the fixed young-size bounds can disable a key part of G1's pause-time control. First inspect measured pauses, survival, and allocation behavior, then change a specific policy only for a demonstrated reason.</p></aside>

Setting `-Xms` equal to `-Xmx` removes heap-capacity growth and shrinkage as a runtime variable. That can make resource planning and some runtime behavior more predictable, but it also reduces elasticity and may raise a process's committed footprint when many replicas share a host. It does not guarantee that every heap page becomes physically resident at startup.

<aside class="lesson-callout" data-kind="important" aria-label="Important"><p class="callout-label">Important</p><p><code>-Xms == -Xmx</code> is a deployment choice, not a universal performance rule. Compare predictable capacity with elasticity, RSS, memory cost, and replica density under the actual workload.</p></aside>

## Fit the heap inside the process budget

A container limit constrains the **whole process**, as in Lesson 2. Budget for heap plus Metaspace, Code Cache, platform-thread stacks, direct and native buffers, GC/JVM structures, loaded libraries and agents, and operating-system accounting overhead. These components vary with load; a nominal heap ceiling equal to the container limit leaves no room for them.

<aside class="lesson-callout" data-kind="production" aria-label="Production note"><p class="callout-label">Production note</p><p>Do not set <code>-Xmx</code> equal to the container memory limit. The process can be killed by the container while Java heap occupancy still looks healthy. Reserve a measured non-heap/native budget and operational margin.</p></aside>

<figure><a href="/images/courses/jvm/container-heap-budget.svg" aria-label="Open container heap budget diagram"><img src="/images/courses/jvm/container-heap-budget.svg" alt="A container memory limit encloses heap, native JVM and application memory, and a safety margin; Xmx applies only to the heap." width="900" height="450" /></a><figcaption>The deployment boundary encloses more than the Java heap.</figcaption></figure>

Start sizing from a **measured stable post-collection occupancy trend** and, where available, a more complete live-set estimate. Then inspect allocation rate, survival and promotion behavior, collector choice, latency or throughput objective, GC working headroom, non-heap/native use, and the host or container limit. For the 6 GB heap example, a 3 GB stable live set gives considerably more room for bursts and collection than 5.5 GB. Neither number alone certifies safety; the needed margin follows the workload's rates and the collector's work.

A bigger heap may improve throughput but still be a poor deployment choice if RSS, memory cost, replica density, or pause behavior worsens. The decision belongs at the application and fleet level, not only in one JVM's GC-time percentage.

## Check your reasoning

<details class="lesson-check"><summary>Two JVMs use `-Xmx6g`. One retains 3 GB after a sufficiently broad collection; the other retains 5.5 GB. Which has more working room, and what else must you measure?</summary><p>The 3 GB case has much more potential room. Measure allocation rate, bursts, survival and promotion, collector behavior, and non-heap process memory before deciding either deployment is safe.</p></details>

<details class="lesson-check"><summary>Can a larger `-Xmx` improve throughput without changing the live set?</summary><p>Yes. More effective allocation space can reduce collection frequency and repeated setup overhead. It can also increase memory cost or change pause behavior, so measure both outcomes.</p></details>

<details class="lesson-check"><summary>Why can ZGC struggle despite several gigabytes of nominally free heap?</summary><p>A rapid allocation burst can consume that space before concurrent work finishes reclaiming memory. Nominal free bytes also omit timing, survival, and collector-specific availability.</p></details>

<details class="lesson-check"><summary>Why is fixing G1's young size a consequential change?</summary><p>G1 uses young sizing to fit observed evacuation cost to its pause goal. Fixing it removes that control lever, potentially increasing either pause cost or collection frequency.</p></details>

## From a sizing model to evidence

<figure><a href="/images/courses/jvm/gc-heap-sizing-complete.svg" aria-label="Open complete JVM heap sizing diagram"><img src="/images/courses/jvm/gc-heap-sizing-complete.svg" alt="The whole process fits inside a container limit; within it the heap has a maximum, committed capacity, occupancy, live data, and headroom for allocation and collector work; non-heap memory and a margin occupy the rest." width="900" height="450" /></a><figcaption>Size for collector equilibrium and whole-process memory, not merely to avoid a heap OOM.</figcaption></figure>

<mark>Size for collector equilibrium and whole-process memory, not merely to avoid heap OOM.</mark> The next lesson, **Reading GC logs in JDK 25**, will show how to obtain evidence: occupancy before and after collections, post-GC trends, promotion, collection frequency, concurrent cycles, and Full GC causes. Those observations let us test this sizing model against a real workload.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on Daily JVM Byte #29, the reviewed draft, and the user's technical requirements. All numeric examples and SVGs are illustrative, not measured. No JVM workload was executed for this lesson. Collector policies describe JDK 25 HotSpot behavior, not Java language guarantees or every JVM implementation.</p><ul><li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html">JDK 25 java command: heap options and container support</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/ergonomics.html">JDK 25 GC ergonomics</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html">JDK 25 G1 sizing, reserve, and young-generation policy</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/parallel-collector1.html">JDK 25 Parallel collector adaptive sizing</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/z-garbage-collector.html">JDK 25 ZGC heap sizing and headroom</a></li></ul></details>
