---
title: Mark-Sweep vs Mark-Compact vs Copying GC
summary: Compare three foundational reclamation strategies, and see how fragmentation, object movement, and survival rate shape GC design.
course: jvm
lessonSlug: gc-reclamation-strategies
module: Foundations
order: 50
sourceByte: byte-005
draft: false
prerequisites: [gc-roots-reachability]
jdk: HotSpot · GC foundations
---

Your application needs room for another object. The collector has found plenty of unreachable data, but that does not yet give the allocator somewhere convenient to put the new object. The collector still has to turn that garbage into reusable space.

In [Lesson 4](/courses/jvm/gc-roots-reachability), we followed references from GC roots to discover the live graph. This lesson begins with that result and asks: **how should the memory be reclaimed and organized?** Mark-sweep, mark-compact, and copying are foundational strategies, or building blocks. Modern collectors combine them across regions, generations, and phases; they are not three mutually exclusive collector types.

Look at the same starting heap in each case. A, B, and C survive. What changes is where they end up and how the free space is arranged.

<figure>
<a href="/images/courses/jvm/gc-three-strategies.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/gc-three-strategies.svg" alt="The same live objects A, B, and C remain in place after sweeping, pack together after compaction, or move from the original from-space into a separate to-space during copying." width="480" height="680" /></a>
<figcaption>Reachability chooses the survivors. Sweeping leaves them in place, compaction moves them within the collected area, and copying moves them from one space into another. Blocks are schematic, not actual object sizes. <a href="/images/courses/jvm/gc-three-strategies.svg">Open full-size diagram</a>.</figcaption>
</figure>

## Mark-sweep: reclaim the holes

A mark-sweep strategy first marks reachable objects, then sweeps the collected area, reclaiming storage belonging to unmarked objects. In our picture, A, B, and C keep their locations. Only the dead blocks become free.

Keeping survivors in place avoids relocation work. But it leaves separated holes between objects. After repeated allocations and collections, a heap can have considerable free space without having a large enough individual hole for the next allocation. This is **external fragmentation**.

<figure>
<a href="/images/courses/jvm/gc-fragmentation.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/gc-fragmentation.svg" alt="Three separated holes of 2 MB, 3 MB, and 4 MB provide 9 MB total free space, but cannot satisfy a contiguous 6 MB request." width="480" height="460" /></a>
<figcaption>The request needs one continuous range. Adding up separated holes does not make such a range available. <a href="/images/courses/jvm/gc-fragmentation.svg">Open full-size diagram</a>.</figcaption>
</figure>

Here the free blocks total 9 MB, but the largest is only 4 MB. A request needing a contiguous 6 MB range cannot fit into any of them. This is a simplified allocator example, not a claim that every collector handles large objects in the same way.

Scattered space also needs bookkeeping. The allocator may use free lists, size classes, or search structures to locate a suitable block, split it, and track what remains. Adjacent free blocks can be combined, but a live object between holes prevents that combination. Sweeping therefore avoids moving survivors at the cost of managing a potentially fragmented free-space layout.

## Mark-compact: move the survivors together

Compaction changes the arrangement. After discovering the live objects, the collector determines their destinations, moves survivors together, and preserves the references that identify them. The remaining space becomes contiguous within the compacted area.

<figure>
<a href="/images/courses/jvm/gc-compaction.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/gc-compaction.svg" alt="A, B, and C move together, leaving contiguous free space. The allocation pointer marks the boundary; allocating N advances that boundary." width="480" height="550" /></a>
<figcaption>Compaction pays movement costs now to make subsequent allocation easier. <a href="/images/courses/jvm/gc-compaction.svg">Open full-size diagram</a>.</figcaption>
</figure>

Read the final two rows from left to right. Once used and free memory meet at a single boundary, an allocator can reserve space by advancing that boundary. This is **bump-pointer allocation**. Its central idea is approximately:

```text
address = top
top = top + alignedObjectSize
```

That is the reservation step, not the whole implementation of Java `new`. Real allocation also needs a capacity check, correct alignment and initialization, and safe coordination between threads, often through thread-local allocation buffers. The useful point is that finding storage no longer requires searching scattered holes.

Compaction does not promise that every free byte in a region-based collector becomes one heap-wide range. Our diagram shows the basic operation on one area. Collectors choose where and when to apply it.

## Moving an object means its references must still work

Suppose A has a field referencing B, and the collector moves B from location X to location Y. The Java relationship must remain A → B. Leaving an ordinary address-based reference pointing at the abandoned storage would break the program.

<figure>
<a href="/images/courses/jvm/gc-reference-fixup.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/gc-reference-fixup.svg" alt="Before relocation A points to B at X. After relocation A points to the same logical B at Y; X is no longer B's location." width="480" height="545" /></a>
<figcaption>The object relationship stays the same even when the physical location changes. X and Y are conceptual addresses. <a href="/images/courses/jvm/gc-reference-fixup.svg">Open full-size diagram</a>.</figcaption>
</figure>

Every relevant reference must continue to resolve correctly, including references from roots and other heap objects. Depending on the collector, that can involve updating reference slots, forwarding information, indirection, or barriers that resolve references during access. The diagram shows the required logical result, not a mandatory order of implementation steps.

Movement consumes CPU and memory bandwidth; maintaining reference correctness adds work too. Some collectors do much of this while application threads are paused, while others perform substantial work concurrently. Movement cost and pause duration are therefore related but not interchangeable.

## Copying: preserve survivors, then reuse the old space

Copying collection uses a separate destination. Starting from roots, it discovers and copies live objects out of **from-space** into **to-space**, preserving their reference relationships. Discovering and copying can be interleaved; a separate complete marking pass is not required by every copying algorithm.

<figure>
<a href="/images/courses/jvm/gc-copying.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/gc-copying.svg" alt="From-space contains A, dead data, B, and dead data. Only A and B are copied to packed to-space; the source becomes reusable after relocation is complete." width="480" height="560" /></a>
<figcaption>Garbage is left behind. The old space can be reused once live objects and their references are safely handled. <a href="/images/courses/jvm/gc-copying.svg">Open full-size diagram</a>.</figcaption>
</figure>

The collector need not free each dead object individually. After evacuation completes safely, it can reset the source area for reuse. “Discarding” from-space means discarding its old contents as object storage; it does not necessarily mean returning physical memory to the operating system.

The destination must have enough room for every object that survives the collection. A classic **semispace** design makes that requirement easy to satisfy by dividing its managed area into two equal parts.

Imagine a 1 GB area split like this:

```text
1 GB managed area
├── From-space: 500 MB
│   application allocates here
└── To-space: 500 MB
    kept available for the next copy
```

When from-space fills, the collector copies its live objects into to-space. If only 80 MB survives, it copies roughly 80 MB and the old from-space can be cleared as a whole. The two spaces then exchange roles: the former to-space becomes the new allocation space, while the cleared former from-space becomes the destination for a later collection.

Why make the spaces equal? Ignoring collector metadata, anything that fitted in the 500 MB source can also fit in the 500 MB destination, even in the worst case where nearly everything survives. The trade-off is capacity. Although the design owns 1 GB, only one 500 MB half is used for ordinary allocation at a time; the other half must remain available so relocation can complete. That is the source of the familiar “copying uses half the heap” description.

It describes this classic layout, not every collector that copies objects. Modern collectors can divide the heap into many regions, select only some source regions for evacuation, and copy their survivors into a smaller pool of available destination regions. They still need sufficient evacuation space, and a high survival rate can put that space under pressure. But the reserved destination capacity does not have to be one fixed half of the entire heap.

## Survival rate changes the movement cost

Suppose 100 MB of objects was allocated and only 5 MB remains live. A copying collector needs to copy roughly those 5 MB of surviving object data. It does not spend the same copying effort on the 95 MB of garbage left behind.

That statement is about **copying work**, not total collection time. Root scanning, traversing references, discovering survivors, reference processing, and other bookkeeping still require work. Object count, reference density, memory bandwidth, and collector design also matter.

Now compare two equally sized regions. We use decimal units here: 1 GB = 1,000 MB.

<figure>
<a href="/images/courses/jvm/gc-survival-cost.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/gc-survival-cost.svg" alt="Region A has 50 MB live and 950 MB dead; Region B has 950 MB live and 50 MB dead. Evacuating all survivors copies 19 times more bytes from B." width="480" height="550" /></a>
<figcaption>Equal occupied capacity does not imply equal copying work. This is a byte-volume comparison, not a pause-time prediction. <a href="/images/courses/jvm/gc-survival-cost.svg">Open full-size diagram</a>.</figcaption>
</figure>

Region A offers 950 MB of reclamation for about 50 MB of copying. Region B requires about 950 MB of copying to reclaim only 50 MB. Under otherwise comparable conditions, A is much more attractive for evacuation. High survival also puts greater pressure on destination capacity.

This explains why allocation rate alone is an incomplete diagnostic. An application allocating 1 GB per second may produce mostly short-lived objects, leaving few survivors to move. Another application may allocate just as quickly while retaining much of that data. The second workload creates a larger live set and potentially much more movement. Even low-survival allocation is not free: sufficiently high allocation still drives collection frequency and consumes resources.

## Java references allow relocation

Java code normally deals with references, not a promise that an object will remain at a fixed physical address. A variable such as `Customer customer` continues to identify the same logical object after relocation. Its identity, fields, and reference relationships must retain their Java meaning.

This abstraction gives the runtime room to compact or copy objects. It does not mean every reference is implemented as a handle: the JVM specification leaves object representation open, and HotSpot can use address-based representations while maintaining correctness during GC. Native interfaces and pinning require additional coordination; ordinary Java code does not repair references itself.

## Compare the building blocks

The table describes the basic strategies applied to the area being collected. Marking and reference discovery contribute work across these designs, even where the distinctive cost is movement.

<div role="region" aria-label="GC strategy comparison" tabindex="0" style="overflow-x: auto;">

| Strategy | Moves live objects? | Free-space arrangement | Distinctive cost or requirement |
|---|---|---|---|
| Mark-sweep | No, in the basic strategy | Separated holes are possible | Sweeping and managing free-space structures |
| Mark-compact | Yes, as needed | Contiguous space in the compacted area | Choosing destinations, moving survivors, preserving references |
| Copying | Yes | Packed survivors and a free destination tail; source reusable | Copying survivors, preserving references, spare destination capacity |

</div>

These are tools for reasoning about collectors, not a ranking. A real design also balances throughput, latency, memory overhead, and the workload's lifetime distribution.

## Check your reasoning

Two young-memory regions each contain 1 GB of allocated objects. Region A has 50 MB live and 950 MB dead. Region B has 900 MB live and 100 MB dead. Which is more attractive for copying?

<details class="lesson-check">
<summary>Pause here, then check your reasoning</summary>
<p>Region A, assuming comparable conditions and enough destination space. Relocating 50 MB requires fewer copied bytes than relocating 900 MB, while reclaiming more space. That does not predict an exact time ratio: both collections still scan roots, traverse references, and perform bookkeeping.</p>
</details>

<details class="lesson-check">
<summary>Can 9 MB of free space always satisfy a 6 MB allocation?</summary>
<p>No. If the allocation needs one contiguous range and the free space consists of separated 2 MB, 3 MB, and 4 MB holes, no hole fits. Compaction can bring the free space together by moving intervening survivors, but must also preserve their references.</p>
</details>

## From short-lived objects to generations

Think about a request that creates a builder, a results list, and a request context. The following is illustrative pseudocode, not a measured allocation experiment:

```java
void handleRequest() {
    StringBuilder builder =
        new StringBuilder();
    List<Result> results =
        new ArrayList<>();
    RequestContext context =
        new RequestContext();
    // Build and process the response.
}
```

Many objects created during such work may soon become unreachable. Returning from the method does not itself guarantee that: objects stored in a cache or another reachable structure can survive. The common empirical observation that **most objects die young** is the weak generational hypothesis, not a Java language rule or a promise about every workload.

<figure>
<a href="/images/courses/jvm/gc-generational-bridge.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/gc-generational-bridge.svg" alt="An allocation area fills with A through F; only C and F survive. Those survivors move to another area and the source becomes reusable." width="480" height="565" /></a>
<figcaption>Few survivors make copying attractive. Promotion to an older generation is a later policy choice, not required on the first collection. <a href="/images/courses/jvm/gc-generational-bridge.svg">Open full-size diagram</a>.</figcaption>
</figure>

This suggests treating recently allocated objects separately. If that area usually contains mostly garbage, collecting it can recover space without repeatedly processing the entire long-lived population. References entering the young area from older objects still need to be accounted for; a smaller collection cannot ignore those paths.

We now have a connected model: objects occupy heap space, references form a graph, roots let GC find survivors, and reclamation strategies reorganize the space around those survivors. The next [lesson introduces generational GC](/courses/jvm/generational-gc): Eden, Survivor spaces, the old generation, age, and promotion. Generations are a performance optimization based on observed lifetime, not a semantic property of Java objects.

<details class="lesson-sources">
<summary>Sources and further reading</summary>
<ul>
<li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-collector-implementation.html">Oracle JDK 25 GC guide: lifetimes, generations, and survivor copying</a></li>
<li><a href="https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-2.html#jvms-2.7">JVM specification §2.7: object representation is implementation-defined</a></li>
<li><a href="https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/cms.html">Historical Oracle CMS guide: sweeping to free lists and allocation constraints</a> (implementation example, not current collector guidance)</li>
</ul>
</details>
