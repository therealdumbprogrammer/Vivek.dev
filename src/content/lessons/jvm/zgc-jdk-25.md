---
title: ZGC in JDK 25 — concurrent relocation and load barriers
summary: Follow one moving object through ZGC's colored references and load barrier, then connect low pauses to generational bookkeeping, throughput, and heap headroom.
course: jvm
lessonSlug: zgc-jdk-25
module: Garbage Collection
order: 270
sourceByte: byte-027
draft: true
prerequisites: [g1-failure-modes]
jdk: JDK 25 · HotSpot generational ZGC
---

In [Lesson 26](/courses/jvm/g1-failure-modes), G1 needed free destinations before it could copy survivors and reclaim their source regions. G1 does much work concurrently, including marking, but **ordinary object relocation happens during stop-the-world evacuation pauses**. What if the application could keep running while those objects move?

ZGC is HotSpot's low-latency answer. <mark>ZGC moves much of the expensive relocation work out of global pauses while application threads continue running.</mark> That changes where the cost is paid; it does not make moving an object free. [JDK 25 collector guide](https://docs.oracle.com/en/java/javase/25/gctuning/available-collectors.html)

<figure><a href="/images/courses/jvm/g1-vs-zgc-relocation.svg" aria-label="Open G1 and ZGC relocation comparison"><img src="/images/courses/jvm/g1-vs-zgc-relocation.svg" alt="G1 copies selected live objects during an evacuation pause, while ZGC relocation overlaps application execution and uses barriers when references are loaded." width="900" height="450" /></a><figcaption>The central difference is when application threads can run during ordinary relocation.</figcaption></figure>

## The stale-reference problem

Suppose `A.child` points to object `B` at an illustrative address, `0x1000`. A collector copies `B` to `0x9000`. With G1's ordinary evacuation, application threads are stopped while that collection's copies and reference handling take place. With ZGC, a mutator (an application thread changing the heap) may have loaded an old-looking reference before or during the move. Following `0x1000` as though it were always the current object would be unsafe.

ZGC organizes heap storage into **ZPages**. It chooses pages for a **Relocation Set**, whose live objects are candidates for movement. These are ZGC implementation concepts. **A G1 region and a ZGC page are not interchangeable abstractions**: each collector uses its own space layout, selection policy, and reference protocol. [OpenJDK ZGC overview](https://wiki.openjdk.org/display/zgc/Main)

<figure><a href="/images/courses/jvm/zgc-concurrent-relocation.svg" aria-label="Open concurrent relocation timeline"><img src="/images/courses/jvm/zgc-concurrent-relocation.svg" alt="A mutator continues executing while ZGC selects a ZPage for relocation and copies B; the mutator can encounter an older reference to B during this overlap." width="900" height="450" /></a><figcaption>One old-looking reference can remain in a running mutator's path while the object moves.</figcaption></figure>

## The reference load becomes a checkpoint

A **load barrier** is a small piece of collector-aware work associated with loading an object reference. Conceptually, a field read follows this path:

```text
ref = A.child
ref = ZGC_load_barrier(ref)  // conceptual, not Java source
use(ref)
```

The barrier checks whether that reference is immediately usable. Its common **fast path** is deliberately very cheap. Only a reference needing GC attention takes the slower path to resolve marking or relocation state. This is a model of generated-code behavior, not a claim that every Java field read calls a function or performs a forwarding-table lookup. [JEP 333](https://openjdk.org/jeps/333), [JEP 439](https://openjdk.org/jeps/439)

<figure><a href="/images/courses/jvm/zgc-load-barrier.svg" aria-label="Open ZGC load barrier paths"><img src="/images/courses/jvm/zgc-load-barrier.svg" alt="A loaded reference reaches the barrier. The common immediately usable case continues; a reference needing GC attention follows a slow path to resolve the current object before use." width="900" height="450" /></a><figcaption>The slow path is conditional; ordinary reference loads should avoid its full cost.</figcaption></figure>

The fast decision is possible because ZGC uses **colored pointers**: object references carry metadata that helps the collector interpret their current GC state. Think of the color as a compact signal to the barrier, alongside the object address, about whether work may be needed. The exact bit layout and valid states are HotSpot implementation details that have evolved; the causal point is that the barrier can usually classify a reference without searching for the object first. [JEP 333](https://openjdk.org/jeps/333), [JEP 439](https://openjdk.org/jeps/439)

<figure><a href="/images/courses/jvm/zgc-colored-pointer.svg" aria-label="Open colored pointer concept"><img src="/images/courses/jvm/zgc-colored-pointer.svg" alt="A conceptual reference consists of object-location information plus GC metadata. The load barrier inspects the metadata and either continues quickly or resolves the reference." width="900" height="450" /></a><figcaption>Metadata makes reference validity cheap to assess; this is deliberately not a bit-layout diagram.</figcaption></figure>

## Follow B through one move

Return to `A.child → B`. ZGC can select the ZPage containing `B`, make a relocated copy, and record **forwarding or relocation metadata** connecting B's old location to its current one. If a mutator loads an old-looking reference, the barrier's slow path can consult that bridge and produce a usable reference to the current object. When needed, mutator work through this slow path may help resolve or participate in relocation. ZGC coordinates these races so the mutator observes one logical object, even while its physical location changes. [OpenJDK ZGC overview](https://wiki.openjdk.org/display/zgc/Main), [JEP 333](https://openjdk.org/jeps/333)

<figure><a href="/images/courses/jvm/zgc-forwarding.svg" aria-label="Open ZGC forwarding sequence"><img src="/images/courses/jvm/zgc-forwarding.svg" alt="An old-looking reference to B reaches the load barrier; forwarding metadata connects B's former location to its relocated copy, and the barrier returns a current usable reference." width="900" height="450" /></a><figcaption>Forwarding metadata bridges old and new locations while references are brought up to date.</figcaption></figure>

The barrier can also **repair or self-heal** a reference location it encounters, so later loads may take the cheap path. This repair is incremental: one load does not magically rewrite every reference to `B` throughout the heap. Other references are handled as collection and mutator work reaches them. <mark>Local checks and repairs let ZGC spread reference work across running threads and concurrent phases instead of collecting it into one large global pause.</mark>

<aside class="lesson-callout" data-kind="key-idea" aria-label="Key idea"><p class="callout-label">Key idea</p><p>A barrier spends a small amount of work at a reference access to keep concurrent GC safe. Its common path must remain cheap, while the less common path pays for resolving a reference that needs attention.</p></aside>

## Load barriers are one part of generational ZGC

In **JDK 25, ZGC is generational only**. The non-generational implementation was removed in JDK 24, and `-XX:+UseZGC` is sufficient to select ZGC. Older instructions to add `-XX:+ZGenerational` are obsolete for this course baseline. [JEP 490](https://openjdk.org/jeps/490), [JDK 25 ZGC tuning guide](https://docs.oracle.com/en/java/javase/25/gctuning/hotspot-virtual-machine-garbage-collection-tuning-guide.pdf)

Generational ZGC groups objects logically into **Young** and **Old** so it can collect short-lived objects more frequently while retaining longer-lived ones. Generation sizes and **tenuring** (when surviving objects move into Old) adapt to the workload. The picture is logical: it does not assert that a ZGC generation has G1's region layout or a fixed young-to-old age threshold. [JEP 439](https://openjdk.org/jeps/439), [JDK 25 ZGC tuning guide](https://docs.oracle.com/en/java/javase/25/gctuning/hotspot-virtual-machine-garbage-collection-tuning-guide.pdf)

<figure><a href="/images/courses/jvm/zgc-generational.svg" aria-label="Open generational ZGC model"><img src="/images/courses/jvm/zgc-generational.svg" alt="New allocations enter logical Young; short-lived objects die there, while surviving objects may remain Young or be tenured to Old. Generation sizing and tenuring adapt." width="900" height="450" /></a><figcaption>Young and Old describe object-lifetime work, not a reuse of G1's region model.</figcaption></figure>

A young collection must still account for references from Old into Young. Generational ZGC therefore also uses **store barriers** and remembered generational information. The load barrier remains central to concurrent reference resolution, but teaching ZGC as “load barriers only” would omit its generational correctness work. [JEP 439](https://openjdk.org/jeps/439)

The barrier story now has four distinct jobs:

<figure><a href="/images/courses/jvm/gc-barrier-evolution.svg" aria-label="Open course barrier progression"><img src="/images/courses/jvm/gc-barrier-evolution.svg" alt="G1 SATB pre-write barriers preserve overwritten marking edges; G1 post-write and card barriers record new cross-region relationships; ZGC load barriers resolve loaded references; generational ZGC store barriers track reference writes for generation bookkeeping." width="900" height="450" /></a><figcaption>Each barrier observes an access point that matters to a different collector invariant.</figcaption></figure>

## Low pauses still have a cost

<aside class="lesson-callout" data-kind="misconception" aria-label="Common misconception"><p class="callout-label">Common misconception</p><p>Concurrent does not mean pauseless. ZGC still uses short stop-the-world coordination phases. Its design moves expensive work, including much of marking, relocation, and reference processing, into phases that overlap application execution.</p></aside>

This is why pause duration can be **largely decoupled from heap size**: ZGC does not try to perform all live-object work during one global stop. The work still consumes CPU cycles, memory bandwidth, and mutator barrier time. Oracle describes a sub-millisecond maximum-pause target for ZGC in JDK 25, while explicitly noting some throughput cost. Treat that as a collector design target, not a service-level guarantee for every application and machine. [JDK 25 collector guide](https://docs.oracle.com/en/java/javase/25/gctuning/available-collectors.html)

G1 and ZGC therefore occupy different points in a latency and throughput trade-off. G1's stop-the-world regional evacuation can be efficient and offers a pause goal with high throughput. ZGC biases harder toward very short pauses, paying through concurrent CPU, bandwidth, barriers, and sometimes lower application throughput. A workload and its latency objective decide which trade-off matters; neither collector is universally better.

## Headroom and evidence in production

Concurrent relocation still needs room. While GC is active, the heap must hold the **live set**, new allocations, and collector working space for moving objects. If allocations outpace reclamation, application threads may have to wait for GC progress. `-Xmx` is the primary hard capacity control. `-XX:SoftMaxHeapSize` is a preferred operating ceiling: ZGC tries to stay under it but may grow toward `-Xmx` to prevent allocation stalls. It is not a second hard maximum. [JDK 25 ZGC tuning guide](https://docs.oracle.com/en/java/javase/25/gctuning/hotspot-virtual-machine-garbage-collection-tuning-guide.pdf)

<figure><a href="/images/courses/jvm/zgc-headroom.svg" aria-label="Open ZGC headroom model"><img src="/images/courses/jvm/zgc-headroom.svg" alt="A heap below hard Xmx holds the live set plus allocations arriving during concurrent collection and relocation working space; SoftMaxHeapSize is a preferred ceiling that may be exceeded." width="900" height="450" /></a><figcaption>Concurrency changes timing, not the need for enough free capacity while reclamation runs.</figcaption></figure>

<aside class="lesson-callout" data-kind="production" aria-label="Production note"><p class="callout-label">Production note</p><p>Start with <code>-Xmx</code>, live-set size, and allocation rate. A low pause graph can coexist with significant concurrent GC CPU, memory-bandwidth use, and lost application throughput. Use <code>-Xlog:gc*</code> to begin tracing cycles and timing, then correlate with service latency and throughput before changing collector settings.</p></aside>

## Check your reasoning

<details class="lesson-check"><summary>B moved while A still held an old-looking reference. Why can A continue?</summary><p>A load barrier checks the reference before use. If it needs relocation handling, the slow path resolves B's current location through forwarding metadata and supplies a usable reference. Encountered reference locations may be repaired incrementally.</p></details>

<details class="lesson-check"><summary>If the common barrier path is cheap, why might ZGC still reduce throughput?</summary><p>The fast check occurs across many reference loads, and concurrent marking and relocation compete for CPU and memory bandwidth. Rare slow paths add more work. Short pauses measure only one part of total GC cost.</p></details>

<details class="lesson-check"><summary>Why does generational ZGC need store barriers as well as load barriers?</summary><p>The load barrier helps make a loaded reference usable during concurrent work. Store barriers help maintain information about reference writes, including Old-to-Young relationships needed for a correct young collection.</p></details>

<details class="lesson-check"><summary>Can SoftMaxHeapSize replace Xmx as the capacity plan?</summary><p>No. SoftMaxHeapSize is a preferred operating ceiling. ZGC can exceed it up to the hard Xmx limit when needed; Xmx and enough headroom for the live set, incoming allocations, and concurrent collector work remain central.</p></details>

## Two relocation models, one next question

<mark>G1 ordinarily moves selected live objects while mutators are stopped; ZGC lets relocation overlap mutator execution and uses barriers to keep references usable.</mark>

<div class="lesson-table-scroll" role="region" aria-label="G1 and ZGC relocation comparison" tabindex="0">
<table class="lesson-comparison"><caption>The ordinary relocation path in each collector.</caption><thead><tr><th scope="col">Question</th><th scope="col">G1</th><th scope="col">ZGC</th></tr></thead><tbody>
<tr><th scope="row">When do objects move?</th><td>During a stop-the-world evacuation pause.</td><td>Largely concurrently with mutators.</td></tr>
<tr><th scope="row">How are references made usable?</th><td>The paused collection handles references to copied survivors.</td><td>Colored references and load barriers resolve encountered references; forwarding bridges a move.</td></tr>
<tr><th scope="row">Where is the cost visible?</th><td>Evacuation pause time and working-space demand.</td><td>Concurrent CPU and bandwidth, barrier work, and working-space demand, alongside short coordination pauses.</td></tr>
</tbody></table></div>

Both collectors spend resources to trace, move, and reclaim objects. [Lesson 28](/courses/jvm/serial-parallel-gc) examines the other end of the choice: collectors that accept stop-the-world work to emphasize throughput or simplicity.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on Daily JVM Byte #27 and its reviewed lesson requirements. Addresses, sequences, and SVGs are conceptual illustrations, not measured traces or exact pointer layouts. No JDK 25 workload was executed for this lesson. The barrier, page, forwarding, and generation descriptions concern HotSpot ZGC in JDK 25, not Java language guarantees or all collectors.</p><ul><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/available-collectors.html">JDK 25 available collectors: G1 and ZGC pause and throughput goals</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/hotspot-virtual-machine-garbage-collection-tuning-guide.pdf">JDK 25 ZGC tuning guide: generations, headroom, and soft maximum heap</a></li><li><a href="https://openjdk.org/jeps/490">JEP 490: remove the non-generational ZGC mode</a></li><li><a href="https://openjdk.org/jeps/439">JEP 439: generational ZGC and barrier work</a></li><li><a href="https://openjdk.org/jeps/333">JEP 333: ZGC colored pointers, load barriers, and concurrent relocation</a></li><li><a href="https://wiki.openjdk.org/display/zgc/Main">OpenJDK ZGC implementation overview</a></li></ul></details>
