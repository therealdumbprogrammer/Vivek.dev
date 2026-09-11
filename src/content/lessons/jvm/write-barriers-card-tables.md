---
title: Write barriers, card tables, and remembered sets
summary: See how HotSpot tracks reference changes so collectors can find incoming references without repeatedly scanning the entire heap.
course: jvm
lessonSlug: write-barriers-card-tables
module: Foundations
order: 70
sourceByte: byte-007
draft: false
prerequisites: [generational-gc]
jdk: HotSpot · GC barriers and remembered references
---

A reachable Customer has lived long enough to reach old memory. During a new request, you attach a newly allocated Order to it. The request finishes, and the local variable holding Order disappears. Customer still points to it, so Order must survive the next young collection.

[Lesson 6](/courses/jvm/generational-gc) explained why collecting young memory separately can save work. This reference crosses the boundary that makes that optimization possible. Following only roots directly into young memory would miss the path through Customer. How can the collector find it without repeatedly traversing all of Old?

<figure>
<a href="/images/courses/jvm/barrier-problem.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/barrier-problem.svg" alt="A root reaches an old Customer, which keeps a young Order reachable." width="480" height="440" /></a>
<figcaption>A root reaches an old Customer, which keeps a young Order reachable. <a href="/images/courses/jvm/barrier-problem.svg">Open full-size diagram</a>.</figcaption>
</figure>

Imagine a 500 MB young generation beside 20 GB of old memory. These are illustrative sizes. Scanning that entire old population on every young collection would undermine the benefit of collecting a smaller area. HotSpot therefore maintains information about places that may contain incoming references while the application runs.

## The application already knows when the graph changes

The following assignment changes the graph at a known location:

```java
customer.latestOrder = order;
```

The running application thread is called a **mutator** because it mutates the object graph. At the moment of the store, the runtime has the destination address and the reference being stored. This is an efficient place to record a little information for GC, instead of reconstructing every change later.

A **write barrier** is lightweight GC logic associated with a reference write. Conceptually, this assignment becomes **store the reference + perform GC bookkeeping**. HotSpot supplies that logic through its interpreted and compiled execution paths; you do not write a Java callback for it.

<figure>
<a href="/images/courses/jvm/write-barrier.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/write-barrier.svg" alt="The mutator stores a reference and runs lightweight GC logic; this is not a blocking gate." width="480" height="440" /></a>
<figcaption>The mutator stores a reference and runs lightweight GC logic; this is not a blocking gate. <a href="/images/courses/jvm/write-barrier.svg">Open full-size diagram</a>.</figcaption>
</figure>

Here, barrier does not mean a gate that blocks until collection finishes, or a Java synchronization operation. It means additional runtime logic. Our focus is the **post-write remembered-reference barrier**: bookkeeping about the new reference relationship. The actual checks, ordering, and instructions depend on the collector and JDK, and some unnecessary barrier work can be optimized away.

## A card table remembers areas, not assignments

Recording a precise history of millions of assignments would itself be expensive. A common alternative is a **card table**, a coarse map over heap address ranges. Each card represents a small fixed-size range of heap memory; a metadata entry records state for that range. Cards are not objects, and object boundaries do not have to align with card boundaries.

Suppose the modified reference slot lies in card 2. The barrier can mark its corresponding entry dirty, leaving a cheap hint for later inspection.

<figure>
<a href="/images/courses/jvm/card-table.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/card-table.svg" alt="Each table entry represents a heap range. Dirty means inspect this area, not a confirmed reference." width="480" height="440" /></a>
<figcaption>Each table entry represents a heap range. Dirty means inspect this area, not a confirmed reference. <a href="/images/courses/jvm/card-table.svg">Open full-size diagram</a>.</figcaption>
</figure>

The address relationship is the useful part of this conceptual pseudocode:

```text
store reference into destination slot
card = cardOf(destination address)
cardTable[card] = DIRTY
```

This is not a literal instruction sequence or a universal implementation contract. In particular, describing the card only by the object's starting address can mislead you for a large object or array spanning multiple cards. Think of the affected heap range and the collector's marking rules.

## Dirty means inspect this area

A dirty card does **not** prove that a current old-to-young reference exists there. It says the area needs attention under the collector's tracking rules. A reference could have been overwritten again before inspection, and the card may contain several objects or reference slots. Some implementations filter writes, but the remaining metadata is still deliberately coarse.

This separates cheap recording from more expensive interpretation. The mutator records candidate work. Collection or background refinement examines the area to discover the references that matter. Repeated changes in the same area need not become a complete assignment log.

The metadata is therefore useful even when it is conservative. A false positive causes extra inspection; missing a required incoming edge could cause incorrect reclamation. Correct collectors maintain enough information across writes and collections to avoid that omission. Cleaning or refining a card does not mean a surviving cross-generation reference can now be forgotten.

## Young GC can inspect selected old-memory ranges

Without a remembered set, a collector could discover old-to-young references by scanning all old objects. With a remembered set, it can go directly to the old-memory areas that may point into Young.

<figure>
<a href="/images/courses/jvm/card-scan-comparison.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/card-scan-comparison.svg" alt="Selected-card scanning reduces incoming-reference discovery; roots and live-object work remain." width="480" height="440" /></a>
<figcaption>Selected-card scanning reduces incoming-reference discovery; roots and live-object work remain. <a href="/images/courses/jvm/card-scan-comparison.svg">Open full-size diagram</a>.</figcaption>
</figure>

Card metadata reduces how much of Old the collector must search. A young collection still has other work: scanning roots, following live young objects, copying survivors, and updating references. If many cards are dirty, the scan can still be large. Even a few old-to-young references can lead to extra scanning because each card covers a whole range of memory.

The trade-off is continuous mutator work and metadata memory in exchange for less collector discovery work. Finer metadata may reduce scanning but cost more to maintain. Coarser metadata can make updates cheaper while leaving more interpretation for the collector. Neither choice makes the work disappear.

## A remembered set tells GC which outside cards to scan

A dirty card and a remembered-set entry answer two different questions.

Return to our `Customer` and `Order` example:

```text
Old:   Customer is stored in Card 17
Young: Order is stored in Young

Customer.latestOrder ─────► Order
```

When the reference is written, the write barrier already knows that the changed field is inside Card 17. It marks that card dirty:

```text
Card table

Card 17 = DIRTY
```

This says that a reference write happened somewhere in Card 17. It does not yet say where the new reference points.

How does refinement find Card 17? The write barrier also hands the card number to G1 as pending work, typically through a small buffer. This buffer is only the delivery path from the write barrier to refinement; it is not another structure that young GC consults.

While the application continues running, a **refinement worker** takes Card 17 from that pending work and scans it. It does not search the whole old generation to discover which card changed—the write barrier already identified the card. If the scan finds a reference from Card 17 into Young, the worker adds Card 17 to the remembered set for Young:

```text
Remembered set for Young

Card 17 may contain a reference into Young
```

When Young is collected, GC reads the remembered set and scans Card 17. It does not need to search the whole old generation to find the reference to `Order`.

<figure>
<a href="/images/courses/jvm/remembered-set.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/remembered-set.svg" alt="A reference store dirties old Card 17 and places its number in pending refinement work. A background refinement worker scans Card 17 and records it in the remembered set for Young. Young GC reads the remembered set and scans Card 17." width="480" height="660" /></a>
<figcaption>A simplified G1-style flow: the write barrier identifies Card 17, background refinement processes it, and the remembered set later tells young GC to scan it. <a href="/images/courses/jvm/remembered-set.svg">Open full-size diagram</a>.</figcaption>
</figure>

The difference is:

<div class="overflow-x-auto">

| Structure | What it records | Question it answers |
| --- | --- | --- |
| Card table | Card 17 is dirty. | Where did a reference write happen? |
| Remembered set for Young | Card 17 may point into Young. | Which outside cards should Young GC scan? |

</div>

So a remembered set is not best defined as a hash table of dirty cards. A collector may use a hash table, bitmap, or another internal representation, but that is an implementation choice. The important idea is what the structure remembers:

```text
Card table:      source areas where writes happened
Remembered set:  source areas that may point into a collection target
```

After refinement, the two entries can have different states:

```text
Card table:               Card 17 = CLEAN
Remembered set for Young: Card 17 may point into Young
```

Card 17 can be clean because the dirty-card work has been processed. Its remembered-set entry stays because `Customer` may still point to `Order`. In other words, **dirty** means “this write still needs processing,” while the remembered-set entry means “scan this card when collecting Young.”

Young GC reads the remembered set for Young, which contains only the outside cards that may point into Young. It does not use the remembered set to find every dirty card in the heap.

If a young collection starts before refinement has finished all pending cards, G1 completes enough of that pending work during the pause. The key point is that the write barrier has already identified the changed cards; GC does not rediscover them by scanning every object in Old.

This flow is a teaching model. Some collectors use card-table information more directly, while others refine it into collector-specific remembered structures. Card tables and remembered sets are closely related, but they are not two names for the same thing.

## G1 extends the problem across regions

G1 partitions the heap into regions. Suppose cards in A and C contain references into B. Collecting B requires finding those incoming references, even though their sources lie outside B. G1's remembered set tells the collector to examine those source cards.

<figure>
<a href="/images/courses/jvm/g1-remembered-set.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/g1-remembered-set.svg" alt="Cards in A and C may point into B. The drawing is conceptual; G1 can group regions in remembered sets." width="480" height="440" /></a>
<figcaption>Cards in A and C may point into B. The drawing is conceptual; G1 can group regions in remembered sets. <a href="/images/courses/jvm/g1-remembered-set.svg">Open full-size diagram</a>.</figcaption>
</figure>

This drawing expresses the incoming-reference idea, not a promise of one independent data structure per region. The [JDK 25 G1 guide](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html) describes remembered sets covering groups of regions and combining information for the selected collection set. G1 regions contain many smaller cards; region and card are different granularities.

The important extension is from old-to-young references to references crossing the boundary of the selected collection area. G1 uses cards as remembered-set entries for those outside locations. Exact maintenance and refinement mechanisms evolve between JDK versions.

## Small barrier costs accumulate on hot paths

Reference assignments happen throughout ordinary application execution: replacing a customer address, linking nodes, updating an object array, or replacing a map value. A barrier may calculate an address, check state, and update metadata. Even a small instruction cost can matter when multiplied by a high reference-update rate.

That is why HotSpot optimizes barriers carefully. It does not follow that every source-level assignment executes an identical barrier sequence. Collector choice, compilation, and what the runtime knows about the store affect the work required.

Compare a graph built once and then mostly read with a graph whose references are continuously replaced. The second creates more mutation-tracking work, even if both retain a similar number of bytes. Heap size alone cannot describe that difference. For most applications, this is a way to reason about measured CPU and throughput, not a reason to manually optimize card-table writes.

## Concurrent collection needs more kinds of cooperation

So far, the collector needs to remember incoming references. During concurrent GC, another problem appears: application threads can change the graph while the collector is tracing it. Collectors need protocols that preserve correctness despite those changes.

GC barriers support different tasks, including mutation tracking, marking correctness, and relocation. **Not every GC barrier is a write barrier.** Some collectors use load or read barriers too. G1, ZGC, and Shenandoah make different choices; we will study their marking and relocation protocols later. The post-write card-marking model here does not explain all of them.

## Pause time is only part of GC cost

A dashboard showing short pauses does not establish that collection is nearly free. Some work happens in mutator barriers, some in background refinement or concurrent GC threads, and some during pauses. Which activities exist depends on the collector. In particular, not every concurrent collector relocates objects concurrently.

These costs consume CPU and memory bandwidth while the application is running. Shorter pauses can be worth that trade-off for a latency-sensitive service, but pause duration and total CPU overhead are different measurements. Concurrent wall-clock intervals also overlap, so adding their elapsed times to pauses is not a valid calculation of total GC cost.

## Check your production reasoning

A service has a 500 MB young generation and 30 GB of old memory. Only a small portion of Old points into Young. Why maintain cards or remembered sets?

<details class="lesson-check">
<summary>Pause here, then check your reasoning</summary>
<p>Maintained metadata tells the collector where to look for incoming references, avoiding a full old-memory scan solely to discover those edges. Actual scan work depends on metadata precision and state, not just the number of true edges. Roots, survivor traversal, and evacuation can still dominate the pause.</p>
</details>

<details class="lesson-check">
<summary>A card is dirty. Must it contain an old-to-young reference?</summary>
<p>No. Dirty identifies candidate work. A later overwrite or conservative tracking can leave no such reference when the area is inspected. A card is not an exact current edge list.</p>
</details>

<details class="lesson-check">
<summary>Pauses fell, but CPU rose and throughput fell. Did GC become cheaper?</summary>
<p>It became better on the pause metric, but total cost is not established. Compare equivalent workloads, throughput, application and GC CPU profiles, reference-update behavior, allocation and survival, and concurrent/background activity. Barrier cost may be paid on application threads. The observation is a reason to investigate, not proof that barriers caused the regression.</p>
</details>

## Put the mechanism together

The mutator and collector cooperate. Reference writes leave useful metadata, and the collector consumes that information to narrow its search. Modern GC includes work continuously performed while your application runs.

<figure>
<a href="/images/courses/jvm/barrier-mental-model.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/barrier-mental-model.svg" alt="The mutator maintains useful metadata so the collector can narrow its search." width="480" height="440" /></a>
<figcaption>The mutator maintains useful metadata so the collector can narrow its search. <a href="/images/courses/jvm/barrier-mental-model.svg">Open full-size diagram</a>.</figcaption>
</figure>

We now have a path from **mutator → write barrier → GC metadata → collector scans less memory**. The [TLAB allocation lesson](/courses/jvm/tlabs-allocation) turns to how HotSpot lets many threads allocate cheaply without contending on one global heap pointer.

<details class="lesson-sources">
<summary>Sources and further reading</summary>
<ul>
<li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html">Oracle JDK 25: G1 regions, remembered sets, and concurrent CPU trade-offs</a></li>
<li><a href="https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/gc/shared/cardTable.hpp">OpenJDK 25: card-table address mapping and card states</a></li>
</ul>
</details>
