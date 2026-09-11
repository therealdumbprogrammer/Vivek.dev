---
title: Generational GC — Eden, Survivor, and promotion
summary: See how object lifetimes shape young collection, survivor copying, promotion, and the references that connect generations.
course: jvm
lessonSlug: generational-gc
module: Foundations
order: 60
sourceByte: byte-006
draft: false
prerequisites: [gc-reclamation-strategies]
jdk: HotSpot · generational GC foundations
---

A request creates a context, a builder, and a results list. A few milliseconds later, most of that data may no longer be needed. A cache entry created during the same request might stay reachable for hours. Should the collector repeatedly process both populations together?

In [Lesson 5](/courses/jvm/gc-reclamation-strategies), copying became attractive when little data survived: preserving 50 MB from a 1 GB area leaves much more reusable space than preserving 900 MB. Generational GC applies that idea to object lifetimes.

The **weak generational hypothesis** is the empirical observation that most objects die young. Objects that have already survived for a while often belong to a longer-lived population. Neither observation is a Java guarantee, and some workloads have very different lifetime distributions. The collector uses this tendency to focus frequent reclamation on recently allocated data.

<figure>
<a href="/images/courses/jvm/generational-overview.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/generational-overview.svg" alt="Ordinary allocations begin young; survivors may eventually move to old memory. This is a conceptual lifecycle." width="480" height="440" /></a>
<figcaption>Ordinary allocations begin young; survivors may eventually move to old memory. This is a conceptual lifecycle. <a href="/images/courses/jvm/generational-overview.svg">Open full-size diagram</a>.</figcaption>
</figure>

## New objects usually begin in Eden

Most ordinary heap allocations start in **Eden**, part of the young generation. Allocation can often advance a pointer through available space, usually within a thread-local allocation buffer. This is the bump-pointer idea from Lesson 5. Reclaiming young memory makes room for another burst of allocations.

In the **classic conceptual model**, young memory consists of Eden and two Survivor spaces, S0 and S1. The old generation holds objects treated as longer-lived. These names describe roles, not a physical layout promised by the JVM specification. **G1 implements Eden, Survivor, and Old using heap regions**, rather than three permanently contiguous young areas. The S0/S1 diagrams below teach classic copying mechanics; they are not a literal G1 heap map.

Returning from a request handler does not itself make every object garbage. A result stored in a reachable cache can outlive the method that created it. Reachability still decides survival.

## Young collection preserves the survivors

When Eden fills, a classic collector needs a young collection. Actual collection triggers depend on the collector and its policy. Suppose A, B, and C remain reachable while the other objects in Eden are dead. A copying-style collection follows the relevant references and copies those survivors into available destination memory. It also updates references so they continue to identify the same logical objects.

<figure>
<a href="/images/courses/jvm/young-gc-copy.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/young-gc-copy.svg" alt="A, B, and C survive; dead objects are not copied. After successful evacuation, Eden is reusable." width="480" height="440" /></a>
<figcaption>A, B, and C survive; dead objects are not copied. After successful evacuation, Eden is reusable. <a href="/images/courses/jvm/young-gc-copy.svg">Open full-size diagram</a>.</figcaption>
</figure>

The collector does not need to move each dead object out of the way. Once the live graph has been preserved elsewhere, it can reuse the source area. Few survivors mean fewer copied bytes, but copying volume is not the whole pause: roots, incoming references, traversal, and bookkeeping still matter.

## Why two Survivor spaces?

Survivors from the previous collection need a destination too. Suppose S0 holds them and S1 is empty. The next young collection copies live objects from Eden and S0 into S1, except those promoted to old memory. Eden and S0 then become reusable. On the following collection, S1 is the source and S0 the destination.

<figure>
<a href="/images/courses/jvm/survivor-role-swap.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/survivor-role-swap.svg" alt="Successive classic young collections swap the source and destination Survivor spaces. Promoted objects go to Old instead." width="480" height="440" /></a>
<figcaption>Successive classic young collections swap the source and destination Survivor spaces. Promoted objects go to Old instead. <a href="/images/courses/jvm/survivor-role-swap.svg">Open full-size diagram</a>.</figcaption>
</figure>

Copying packs survivors into the destination instead of leaving holes where dead objects used to be. The two spaces alternate roles; they are not two successive stages that every object visits exactly once.

## Object age is collector bookkeeping

Follow cache entry A across young collections. In this HotSpot model, an object retained in survivor memory acquires an age as it survives collections. The age counts survival events, not elapsed seconds. Two objects allocated a second apart can have the same GC age.

<figure>
<a href="/images/courses/jvm/object-aging.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/object-aging.svg" alt="A remains the same logical object while its GC age increases across young collections. The numbers are illustrative." width="480" height="440" /></a>
<figcaption>A remains the same logical object while its GC age increases across young collections. The numbers are illustrative. <a href="/images/courses/jvm/object-aging.svg">Open full-size diagram</a>.</figcaption>
</figure>

**Object age is a GC optimization heuristic, not a property of the Java object model.** Java provides no ordinary object method for asking its GC age. Moving or aging A does not change its identity or the meaning of its fields.

## Promotion avoids repeated young copying

A cache entry that remains reachable for hours could otherwise bounce between survivor areas on every young collection. **Promotion**, also called **tenuring**, moves it into old memory so it no longer participates in every ordinary young evacuation.

Do not memorize a universal promotion age. HotSpot can choose an effective tenuring threshold using the object-age distribution and a desired survivor-space size, subject to a maximum threshold. If Survivor space is running low, HotSpot may promote an object sooner. The policy varies with the collector and configuration.

<figure>
<a href="/images/courses/jvm/promotion.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/promotion.svg" alt="Repeated survival provides evidence of longevity; age policy and available survivor capacity determine promotion." width="480" height="440" /></a>
<figcaption>Repeated survival provides evidence of longevity; age policy and available survivor capacity determine promotion. <a href="/images/courses/jvm/promotion.svg">Open full-size diagram</a>.</figcaption>
</figure>

Old objects can still die and need reclamation. Also, the Eden → Survivor → Old path is a default teaching model, not a required journey. Large or special allocations can bypass it. In G1, humongous objects are allocated directly into contiguous regions belonging to old memory. An object can also be promoted without spending many collections in Survivor.

## Young and old have different survival patterns

Young memory commonly sees rapid allocation and high mortality. Old memory commonly holds a greater proportion of longer-lived objects. That difference explains why collectors can make different choices for different populations.

<figure>
<a href="/images/courses/jvm/young-vs-old.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/young-vs-old.svg" alt="Young collections often find few survivors. Old memory tends to contain more persistent graphs; this is a workload tendency." width="480" height="335" /></a>
<figcaption>Young collections often find few survivors. Old memory tends to contain more persistent graphs; this is a workload tendency. <a href="/images/courses/jvm/young-vs-old.svg">Open full-size diagram</a>.</figcaption>
</figure>

Historically, a JVM might combine copying in young memory with marking and compaction or sweeping in old memory. This is not a universal mapping: G1 evacuates selected old regions as well as young ones. The reason for separating generations is the survival distribution, not a rule that Old must use one algorithm.

## References still cross the generation boundary

Imagine a long-lived `Customer` object has already been promoted to old memory. During a later request, the application creates a new `Order` in Eden and stores it in `Customer.latestOrder`. When a young collection begins, following only roots that point directly into young memory would miss the path through `Customer`. The `Order` must survive even if no local variable points to it anymore.

<figure>
<a href="/images/courses/jvm/old-to-young-reference.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/old-to-young-reference.svg" alt="A root reaches an old Customer, whose latestOrder field reaches a young Order. Young GC must account for that incoming reference." width="480" height="440" /></a>
<figcaption>A root reaches an old Customer, whose latestOrder field reaches a young Order. Young GC must account for that incoming reference. <a href="/images/courses/jvm/old-to-young-reference.svg">Open full-size diagram</a>.</figcaption>
</figure>

One solution is to traverse all old objects during every young collection. But repeatedly scanning a 20 GB old population to collect a 500 MB young area would undermine the benefit of collecting young separately. Those sizes are illustrative. We need a way to find the relevant incoming references without retracing all of Old.

## Remember where references may have changed

Application threads are often called **mutators** because they mutate the object graph. When a mutator executes the following illustrative assignment, it may create a new cross-generation edge:

```java
oldCustomer.latestOrder = youngOrder;
```

A **write barrier** is GC bookkeeping associated with a reference write. Conceptually, the runtime stores the reference and records that some part of memory may now contain an interesting reference. The exact operations and ordering depend on the collector; this is not Java synchronization or a user-written memory barrier.

<figure>
<a href="/images/courses/jvm/remembered-reference.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/remembered-reference.svg" alt="A mutator stores a reference; write-barrier bookkeeping records candidate memory for the collector to inspect later." width="480" height="440" /></a>
<figcaption>A mutator stores a reference; write-barrier bookkeeping records candidate memory for the collector to inspect later. <a href="/images/courses/jvm/remembered-reference.svg">Open full-size diagram</a>.</figcaption>
</figure>

A **card table** can mark small ranges of heap memory that need attention. **Remembered metadata** helps the collector locate references entering the collected area. It may identify candidate ranges rather than an exact list of current old-to-young edges, so GC still examines those locations. G1 uses remembered sets for references between regions, a broader problem than only old-to-young references.

This exchanges some application-side work and metadata memory for less scanning during collection. It does not eliminate roots, scanning, or the need to maintain correct references. Efficient GC depends on tracking important graph changes while the application runs as well as examining the graph during collection.

## Allocation, survival, promotion, and occupancy

High allocation alone does not tell you how quickly old memory will fill. Imagine two services each allocating 1,000 MB/s. In a steady illustrative workload, one eventually promotes 10 MB/s and another 400 MB/s. The second sends much more data into Old, even though their allocation traffic is identical.

<figure>
<a href="/images/courses/jvm/allocation-vs-promotion.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/allocation-vs-promotion.svg" alt="Two illustrative services allocate 1,000 MB/s. Their promotion rates differ, while old occupancy also depends on reclamation and direct old allocation." width="480" height="440" /></a>
<figcaption>Two illustrative services allocate 1,000 MB/s. Their promotion rates differ, while old occupancy also depends on reclamation and direct old allocation. <a href="/images/courses/jvm/allocation-vs-promotion.svg">Open full-size diagram</a>.</figcaption>
</figure>

<div class="overflow-x-auto">

| Measurement | What it tells you |
| --- | --- |
| Allocation rate | Bytes of new heap objects allocated per unit time. |
| Survival rate | The percentage of young-generation data that remains alive after a young collection. |
| Promotion rate | Bytes moved from young to old per unit time. |
| Old-gen occupancy | Bytes currently used in old memory, including garbage not yet reclaimed. |

</div>

Surviving one young collection is not the same as being promoted. Some survivors die before a later collection, while others remain in Survivor for several collections before promotion. Because promotion happens later than allocation, one collection's survival rate does not tell you the current promotion rate.

Old occupancy is a stock, not a rate or a count of guaranteed live bytes. Its change reflects promotion plus direct old allocations, minus reclamation, with collector-specific accounting details. Higher promotion increases pressure when reclamation does not keep pace; occupancy need not rise forever if old collections recover that space.

Even a workload with 99.9% young mortality can spend significant CPU or pause time on a very high allocation rate. High allocation with low survival can be manageable, but it is not automatically cheap. Read allocation, survival, promotion, occupancy, and collection cost together before deciding what is wrong.

## Check your reasoning

Two services each allocate 5 GB/s. Service A loses 99% of its allocated data before it leaves young memory. Service B repeatedly retains and promotes 40%. Assuming comparable direct-old allocation and old reclamation, which puts more pressure on old memory?

<details class="lesson-check">
<summary>Pause here, then check your reasoning</summary>
<p>Service B. Much more of its allocation stream reaches Old. That predicts greater inflow, not an exact pause time or inevitable unbounded growth: old reclamation and eventual lifetime still matter. Service A may still pay substantial young-collection and allocation costs.</p>
</details>

<details class="lesson-check">
<summary>Can a young Order die if only an old Customer points to it?</summary>
<p>If Customer is reachable, Order remains reachable through it. Young GC must account for that edge. Write barriers and remembered metadata help it find incoming references without traversing every old object. If Customer itself is dead but not yet reclaimed, conservative incoming-reference handling can also retain Order longer than a whole-heap liveness analysis would require.</p>
</details>

## Next: make the bookkeeping concrete

We now have two connected paths: ordinary allocations move through Eden, Survivor, and possibly Old, while reference writes leave metadata that helps collection find incoming edges. The first path explains why generations can reduce work; the second makes collecting only part of the heap practical.

The next [Lesson 7: write barriers, card tables, and remembered sets](/courses/jvm/write-barriers-card-tables) asks what a card records, when it becomes dirty, and how HotSpot turns that information into references worth scanning.

<details class="lesson-sources">
<summary>Sources and further reading</summary>
<ul>
<li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-collector-implementation.html">Oracle JDK 25: generational hypothesis and classic Survivor mechanics</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html">Oracle JDK 25: G1 regions, remembered sets, evacuation, and humongous objects</a></li>
<li><a href="https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/gc/shared/ageTable.cpp">OpenJDK 25 AgeTable: effective tenuring threshold calculation</a></li>
</ul>
</details>
