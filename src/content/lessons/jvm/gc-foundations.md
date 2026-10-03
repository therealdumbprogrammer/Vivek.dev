---
title: GC foundations — tracing, reclamation, and compaction
summary: Follow reachable objects from GC roots, then see how sweeping, compaction, and evacuation turn liveness information into reusable heap space.
course: jvm
lessonSlug: gc-foundations
module: Garbage Collection
order: 220
sourceByte: byte-022
draft: true
prerequisites: [reentrant-lock-aqs, gc-roots-reachability, gc-reclamation-strategies]
jdk: JDK 25 · HotSpot garbage collection foundations
---

Your service allocates request objects steadily. Most requests finish quickly, yet the heap sometimes fills and the JVM pauses to recover space. Which bytes can the collector reuse, and what shape will the remaining free space have?

Earlier lessons introduced [GC roots](/courses/jvm/gc-roots-reachability), [collector strategies](/courses/jvm/gc-reclamation-strategies), [generations](/courses/jvm/generational-gc), [write barriers](/courses/jvm/write-barriers-card-tables), and [safepoints](/courses/jvm/safepoints) separately. Here we connect them into one collection path. First discover which objects must survive. Then make the rest of the heap useful for future allocations.

<figure>
<a href="/images/courses/jvm/gc-two-problems.svg" aria-label="Open the two GC problems diagram"><img src="/images/courses/jvm/gc-two-problems.svg" alt="A heap with live and unreachable objects feeds two distinct jobs: discover reachable objects, then recover usable space by sweeping, compacting, or evacuating." width="900" height="420" /></a>
<figcaption>Reachability identifies survivors; the reclamation strategy determines the resulting free space. The blocks are a conceptual heap, not a G1 region layout.</figcaption>
</figure>

<mark>Tracing answers which objects are live; sweeping, compaction, and evacuation answer what to do with heap space afterward.</mark> This distinction lets us compare collectors without assuming that every tracing pass moves objects.

## Start from roots, then follow references

Imagine a stack reference to object A. A refers to B and C. A static field refers to D, which refers to E. Two more objects, F and G, refer to each other but have no path from either root.

<figure>
<a href="/images/courses/jvm/gc-root-tracing.svg" aria-label="Open GC root tracing graph"><img src="/images/courses/jvm/gc-root-tracing.svg" alt="Stack and static roots reach A, B, C, D, and E. F and G form a reference cycle disconnected from all roots." width="900" height="470" /></a>
<figcaption>The reachable graph A–E is the live set for this trace. F and G can be reclaimed despite their cycle.</figcaption>
</figure>

A **GC root** is a starting reference the collector must account for, including references associated with thread execution and JVM runtime state. The collector follows references transitively. The objects it discovers form the **live set**: the reachable object graph for that collection's scope and snapshot. In this example A–E are live; F and G are unreachable.

<mark>A cycle is garbage when no path from a GC root reaches it.</mark> Merely having an incoming reference does not keep an object alive. This is why reference counting alone cannot describe Java's tracing collectors.

The roots must be accurate even when Java methods run as optimized machine code. HotSpot's compiled-frame metadata, including **OopMaps**, identifies locations that contain object references at suitable execution points. Safepoint coordination and related mechanisms give the collector a state it can inspect consistently. The [safepoints lesson](/courses/jvm/safepoints) explains that execution-engine side; here its result becomes the starting edge of the object graph. Actual root processing and concurrent collection are more involved than the stationary graph in the figure.

<figure>
<a href="/images/courses/jvm/gc-liveness-vs-reclamation.svg" aria-label="Open liveness and reclamation diagram"><img src="/images/courses/jvm/gc-liveness-vs-reclamation.svg" alt="Roots and reference metadata lead to a live set. Separate branches use that information to leave free holes, slide survivors together, or evacuate them to destination space." width="900" height="450" /></a>
<figcaption>The same liveness question can feed different space-recovery choices. A real collector can combine them.</figcaption>
</figure>

## Sweep: recover holes without moving survivors

In a textbook **mark-sweep** pass, the collector marks objects reached during tracing. It then scans the relevant heap space and makes unmarked objects available for reuse. A, B, and C stay at their old addresses in this simplified row; the former garbage positions become holes.

<figure>
<a href="/images/courses/jvm/mark-sweep.svg" aria-label="Open mark-sweep stages"><img src="/images/courses/jvm/mark-sweep.svg" alt="Before: live A and B, unreachable X, live C, unreachable Y. Mark preserves A B C. Sweep turns X and Y into separated free holes without moving survivors." width="900" height="430" /></a>
<figcaption>Marking discovers survivors; sweeping recovers unmarked space in place. Real collectors use metadata and more elaborate phase coordination.</figcaption>
</figure>

Keeping survivors in place avoids moving them and repairing their references for this step. The resulting free space may be **fragmented**: several holes can add up to more bytes than an allocation needs while none is large enough as one contiguous area. Allocators can maintain free lists and choose fitting holes, but fragmented space complicates allocation and can eventually require other recovery work. The exact outcome depends on the collector and allocator; “mark-sweep” is a teaching model, not a description of every HotSpot phase.

## Compact: move survivors into a dense area

**Mark-compact** starts with liveness information, computes new positions for survivors, moves them into a denser arrangement, and leaves a larger contiguous free range. If A, B, and C occupy the front of our illustrative space after compaction, an allocator can advance a **bump pointer** through the free tail for suitable allocations. A bump pointer records the next free address and advances after reserving space; it does not mean every Java allocation in every collector uses one global pointer.

<figure>
<a href="/images/courses/jvm/mark-compact.svg" aria-label="Open mark-compact stages"><img src="/images/courses/jvm/mark-compact.svg" alt="Scattered live A, B, C objects move together at one end; their old gaps become one contiguous free tail with a bump pointer." width="900" height="430" /></a>
<figcaption>Compaction changes survivor addresses to recover a contiguous range. The drawing omits collector metadata and concurrent barriers.</figcaption>
</figure>

Moving an object is more than copying its bytes. A stack slot, static field, or field in another object that pointed to the old address must eventually resolve to the new address. Collector algorithms coordinate those **reference updates** with the move; some use forwarding information or barriers during a transition. The exact mechanism varies, but leaving an ordinary reference pointing at abandoned storage would break the program.

<figure>
<a href="/images/courses/jvm/gc-reference-update.svg" aria-label="Open reference repair diagram"><img src="/images/courses/jvm/gc-reference-update.svg" alt="A root and an object field originally point to B at its old address. B moves; both references must resolve to B at its new address before the old location is reused." width="900" height="450" /></a>
<figcaption>Every relevant path to a moved survivor must be made valid under the collector's reference protocol.</figcaption>
</figure>

## Evacuate: preserve survivors elsewhere

A **copying** or **evacuating** collection selects a source space, finds the objects that must survive, and copies or moves them into destination space. Once all required survivors and references are handled, the source space can be reused as a unit. That action combines reclamation and compaction: garbage is left behind while survivors arrive packed in the destination.

<figure>
<a href="/images/courses/jvm/copying-collector.svg" aria-label="Open copying collector diagram"><img src="/images/courses/jvm/copying-collector.svg" alt="Source space contains live A and B interleaved with garbage. A and B move into destination space; the complete source space becomes reusable after references are handled." width="900" height="450" /></a>
<figcaption>Only selected survivors move to destination space in this model. A real collector must also process roots, incoming references, and allocation constraints.</figcaption>
</figure>

This gives a useful intuition: `cost ≈ live data copied`. If little survives, there is relatively little survivor data to move. It is **not** a complete pause-time or CPU equation. Root processing, remembered sets, reference updates, marking, bookkeeping, coordination, concurrent work, and failed or constrained evacuation also contribute. Destination capacity and spare heap **headroom** matter because survivors need somewhere to go.

The generational hypothesis says many newly allocated objects die young. When that pattern holds, evacuating a young collection set is attractive: discard the many dead objects with the source space and copy the smaller survivor set. It is a workload tendency, not a promise about every application or object.

<figure>
<a href="/images/courses/jvm/young-survival-copying.svg" aria-label="Open young survivor evacuation diagram"><img src="/images/courses/jvm/young-survival-copying.svg" alt="Many new objects occupy a young source area; only two survivors are copied into destination space, leaving the source area reusable." width="900" height="430" /></a>
<figcaption>Low young-object survival can make evacuation efficient. The next lesson will give Eden, survivor, and promotion paths their precise roles.</figcaption>
</figure>

## G1 puts the pieces into regions

On server-class machines, **G1 is the default collector in JDK 25**. HotSpot's G1 divides the heap into regions, tracks generations and remembered information, and selects a collection set of regions. It evacuates surviving objects from selected regions into destination regions; old-region selection uses liveness and expected collection efficiency. G1 also performs marking and other concurrent or pause-time work. Its region and evacuation model is a concrete bridge from the textbook techniques, not a claim that G1 runs one simple whole-heap mark-sweep or copying pass.

<figure>
<a href="/images/courses/jvm/g1-region-evacuation.svg" aria-label="Open G1 region evacuation diagram"><img src="/images/courses/jvm/g1-region-evacuation.svg" alt="A G1 heap is divided into regions. Selected source regions contribute survivors to destination regions; reclaimed source regions become available, while unselected regions remain outside this evacuation." width="900" height="470" /></a>
<figcaption>G1 evacuates a selected collection set rather than treating this picture as one contiguous two-space heap.</figcaption>
</figure>

This is also why a collector name does not imply one textbook algorithm. Real collectors combine tracing, marking, region selection, copying or compaction, remembered metadata, barriers, and concurrent work to balance throughput, pause latency, CPU use, memory footprint, allocation speed, spare headroom, and predictability. Improving one measure can consume resources that another measure needs. G1's pause goals are targets, not guarantees.

## Read allocation and survival separately

For a running service, distinguish three signals. **Allocation rate** is how quickly new objects consume space. **Survival rate** is the fraction that remains reachable when a collection examines a cohort. **Live-set size** is the reachable data a collector must preserve, possibly across several areas of the heap. They answer different questions: how quickly collection pressure arrives, how much evacuation work a young collection may do, and how much space and processing a persistent reachable graph requires.

<aside class="lesson-callout" data-kind="production" aria-label="Production note">
<p class="callout-label">Production note</p>
<p>A high allocation rate alone is not automatically a GC problem. Check allocation alongside survival, live-set growth, collection frequency and pause time, and the heap headroom available for evacuation. A short-lived allocation burst can collect cheaply; a modest rate with long-lived retention can leave little room to recover.</p>
</aside>

Use GC logs and workload latency together to ask whether pauses coincide with user-facing slowdowns. Allocation profiles help identify producers; heap paths to roots help investigate retained objects. One heap occupancy number cannot by itself identify a leak, and one pause cannot establish a stable trend. Before changing collector or heap settings, identify whether the pressure comes from creation, survival, retained live data, or too little spare space for the current collection pattern.

## Check your reasoning

<details class="lesson-check">
<summary>If tracing marks A, B, and C as live, must the collector move them?</summary>
<p>No. Tracing establishes liveness. A sweeping strategy can reclaim unmarked positions while A, B, and C stay at their addresses; compaction or evacuation may move survivors for a different free-space result.</p>
</details>

<details class="lesson-check">
<summary>F and G refer to each other but no root reaches either. Can both be garbage?</summary>
<p>Yes. The reference cycle has no path from a GC root, so tracing from roots does not include either object in the live set.</p>
</details>

<details class="lesson-check">
<summary>Two services allocate at the same rate. Must their GC work be similar?</summary>
<p>No. Different survival, live-set size, reference connectivity, and destination headroom can make collection costs and outcomes very different.</p>
</details>

## The complete collection path

Roots and reference metadata allow tracing to discover a live set. The collector then chooses how to reclaim and reshape space: leave holes, move survivors together, or evacuate survivors from selected source areas. Moving requires a valid reference protocol; low survival can make evacuation particularly useful. That chain explains why collector behavior depends on the live graph and available space as much as on bytes allocated per second.

<figure>
<a href="/images/courses/jvm/gc-foundations-complete.svg" aria-label="Open complete GC foundations diagram"><img src="/images/courses/jvm/gc-foundations-complete.svg" alt="GC roots and reference metadata lead to tracing and a live set; separate reclamation choices produce free holes, contiguous free space, or reusable source regions; runtime signals include allocation, survival, live set, and headroom." width="900" height="480" /></a>
<figcaption>The collection path joins execution metadata, graph reachability, space recovery, and workload evidence.</figcaption>
</figure>

Next, **Generational GC mechanics** will follow a young allocation through Eden and survivor regions, then through promotion when it remains live. It will make the remembered-set and write-barrier work behind cross-generation references concrete. Those are the details needed to understand why a young collection can trace a subset of the heap safely.

<details class="lesson-sources">
<summary>Sources and implementation boundaries</summary>
<p>Based on Daily JVM Byte #22 and the reviewed lesson requirements. Object graphs, heap rows, and costs are explanatory models; no GC workload or command was executed for this lesson. Root metadata and G1 details describe HotSpot on JDK 25 rather than a universal JVM implementation. Collector phase timing, reference processing, and allocation policy vary by collector and configuration.</p>
<ul>
<li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-collector-implementation.html">JDK 25 GC Tuning Guide: collector implementation and generations</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html">JDK 25 GC Tuning Guide: G1 regions, marking, and evacuation</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/ergonomics.html">JDK 25 GC Tuning Guide: collector defaults on server-class machines</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/introduction-garbage-collection-tuning.html">JDK 25 GC Tuning Guide: throughput, pauses, and compaction</a></li>
</ul>
</details>
