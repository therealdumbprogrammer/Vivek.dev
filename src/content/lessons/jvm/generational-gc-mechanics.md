---
title: Generational GC — young collections, promotion, and remembered sets
summary: Follow a young collection from roots through remembered references, survivor evacuation, and promotion without scanning the whole old generation.
course: jvm
lessonSlug: generational-gc-mechanics
module: Garbage Collection
order: 230
sourceByte: byte-023
draft: true
prerequisites: [gc-foundations, generational-gc, write-barriers-card-tables]
jdk: JDK 25 · HotSpot G1 and generational GC mechanics
---

A request creates a new `Order`. A long-lived `Customer` object stores it in a field, then the request's local reference disappears. When young memory fills, the collector must keep that `Order`: a reachable old object still points to it.

[Lesson 22](/courses/jvm/gc-foundations) separated tracing, which discovers live objects, from reclamation, which recovers space. [Lesson 6](/courses/jvm/generational-gc) introduced generations, and [Lesson 7](/courses/jvm/write-barriers-card-tables) introduced the reference tracking that crosses them. Here we follow one young collection end to end. Its central question is: **how can it find the young `Order` without scanning every old object?**

<figure>
<a href="/images/courses/jvm/generational-gc-problem.svg" aria-label="Open the generational collection problem"><img src="/images/courses/jvm/generational-gc-problem.svg" alt="A root reaches an old Customer, which points to a young Order. A young-only scan starting at direct young roots would miss Order." width="900" height="450" /></a>
<figcaption>The incoming old-to-young edge makes a partial collection a correctness problem, not just a space-saving choice.</figcaption>
</figure>

<mark>To collect young safely, the collector must discover references into young from outside young without searching all of old.</mark>

## An object's path through generations

The **young generation** holds recent allocations. Objects that remain reachable through collection may enter a **survivor** area and eventually move to the **old generation**. That move is called **promotion** or **tenuring**. Many new objects never take the survivor branch: they become unreachable and their source space is reused.

<figure>
<a href="/images/courses/jvm/generational-lifecycle.svg" aria-label="Open the generational object lifecycle"><img src="/images/courses/jvm/generational-lifecycle.svg" alt="Allocate into young Eden; unreachable objects are reclaimed; live objects move through survivor roles and may be promoted to old." width="900" height="450" /></a>
<figcaption>Allocate → young → survive → survivor → perhaps promote. The arrows describe possible transitions, not a fixed number of collections.</figcaption>
</figure>

Eden, Survivor, and Old name **roles** in that path. In HotSpot's G1 collector, the heap is split into regions whose roles can change; the roles do not require three permanent, contiguous address ranges. G1 is the default on typical JDK 25 server-class configurations, although a selected collector and machine can differ.

<figure>
<a href="/images/courses/jvm/g1-generational-regions.svg" aria-label="Open G1 region roles"><img src="/images/courses/jvm/g1-generational-regions.svg" alt="G1 heap regions are interleaved; separate regions have Eden, Survivor, and Old roles, rather than three contiguous blocks." width="900" height="450" /></a>
<figcaption>Logical generations sit on a regional heap. A region's role is collector state, not a permanent address-range identity.</figcaption>
</figure>

## Low survival makes young evacuation useful

Imagine 100 MB allocated into young regions, with 95 MB unreachable by the time collection starts and 5 MB live. An **evacuating collection** copies the live objects to destination regions, updates relevant references, then makes the source regions reusable. It does not copy the 95 MB of dead objects one by one.

<figure>
<a href="/images/courses/jvm/young-evacuation.svg" aria-label="Open young evacuation"><img src="/images/courses/jvm/young-evacuation.svg" alt="A 100 MB young source has 95 MB dead and 5 MB live. Only the survivors move to destination regions; source regions become reusable." width="900" height="450" /></a>
<figcaption>In this illustrative cohort, low survival limits copying. Roots, remembered references, reference repair, and coordination still cost work.</figcaption>
</figure>

The amount of surviving data often matters more to evacuation cost than bytes allocated alone. This is an intuition, not a pause-time formula. G1 also processes roots and incoming references, performs bookkeeping, and needs destination capacity for survivors.

## The reference that young roots alone miss

Suppose `Customer` has survived long enough to reside in Old. A request runs `customer.latestOrder = order`, storing a reference to a young `Order`. Once the request's local variable disappears, a trace of direct roots into Young misses `Order`; the live path runs through Old.

One way to discover that edge would be to scan every old object at every young collection. If Young is 500 MB and Old is 8 GB, repeatedly searching that 8 GB defeats much of the benefit of collecting only Young. The collector instead records where relevant reference changes happened while the application runs.

The application threads that update the object graph are **mutators**. A **write barrier** is a small piece of runtime bookkeeping associated with a reference update. The post-write side considered here records information useful for finding incoming references; it does **not** perform a garbage collection at each assignment.

<aside class="lesson-callout" data-kind="important" aria-label="Important">
<p class="callout-label">Important</p>
<p>For a reference store such as <code>customer.latestOrder = order</code>, the mutator executes the store and collector-specific barrier logic. The barrier helps preserve information for a later collection. Its checks and delivery path depend on the collector, and a write need not always create new remembered-set work.</p>
</aside>

<figure>
<a href="/images/courses/jvm/generational-write-barrier.svg" aria-label="Open generational write barrier flow"><img src="/images/courses/jvm/generational-write-barrier.svg" alt="Mutator reference store is followed by small barrier bookkeeping that records a changed source area for later refinement; GC happens separately." width="900" height="450" /></a>
<figcaption>The barrier runs with application execution; it supplies a clue for later collector work.</figcaption>
</figure>

## A card marks a range, not a pointer

A **card** is a small logical range of heap addresses. A **card table** associates metadata with those ranges. If the reference slot in `Customer` changes, barrier bookkeeping can mark its source card **dirty**: this range is interesting and may need inspection. The card is based on the address of the modified slot, not necessarily the start of its containing object. A large object can span cards.

<figure>
<a href="/images/courses/jvm/generational-card-table.svg" aria-label="Open card table diagram"><img src="/images/courses/jvm/generational-card-table.svg" alt="A reference field changes inside heap card 2. Card-table entry 2 becomes dirty while neighboring entries remain clean." width="900" height="450" /></a>
<figcaption>Dirty is a coarse pending-work state. It does not prove that a current old-to-young pointer still exists in the range.</figcaption>
</figure>

The reference might be overwritten before that range is examined. Several slots may share one card. The mutator can record the candidate cheaply; collector-side **refinement** can inspect it later. Correctness requires pending changes to be accounted for before a collection relies on the remembered information.

A **remembered set** answers a different question: which source locations *outside the selected collection set* may contain references *into it*? In G1, its entries are approximate source locations represented with cards, not a list of exact pointer addresses. Refinement can turn a dirty source card into remembered information for a target region or region group. Processing a dirty card does not erase a still-relevant incoming edge.

<figure>
<a href="/images/courses/jvm/card-to-remset.svg" aria-label="Open card to remembered-set flow"><img src="/images/courses/jvm/card-to-remset.svg" alt="A reference update dirties a source card, refinement scans it, and remembered information identifies that outside card as a possible source into the target collection set." width="900" height="450" /></a>
<figcaption>Barrier, dirty-card state, and remembered information are cooperating steps with different jobs.</figcaption>
</figure>

<mark>A dirty card says “inspect this changed range”; a remembered-set entry says “this outside range may point into the collection set.”</mark> Both are conservative. Scanning a candidate card can add work; missing a required incoming edge could incorrectly discard a live object.

## Follow one young collection

G1's **collection set** is the group of source regions selected for a pause. For a young collection, think of the selected Eden and survivor regions as the target. The collector starts from ordinary roots, such as live execution and runtime references, and also scans the outside source locations identified by remembered information. The old `Customer` card supplies the edge to the young `Order`.

It then traces the reachable young graph, leaves unreachable objects behind, evacuates survivors to destination regions, repairs the relevant references, and reuses the evacuated source regions. A survivor may remain young in a survivor region or promote into Old. G1 uses remembered locations as roots **into the collection set**; its regional model generalizes our old-to-young example to **outside the collection set → inside the collection set**.

<figure>
<a href="/images/courses/jvm/remembered-set-young-gc.svg" aria-label="Open young collection with remembered references"><img src="/images/courses/jvm/remembered-set-young-gc.svg" alt="Ordinary roots and remembered outside cards both feed tracing of young live objects, followed by evacuation and reuse of source regions." width="900" height="450" /></a>
<figcaption>Incoming references supplement ordinary roots, allowing a selected set of regions to be collected without searching all other regions.</figcaption>
</figure>

The path is a teaching model. Actual G1 pauses assemble and process remembered information, coordinate reference updates, and handle exceptional cases. Cards and remembered sets reduce broad old-heap scanning; they do not eliminate root work or all collector-side scanning.

## Promotion follows pressure and policy

Object age matters, but “survive exactly N collections, then promote” is too rigid. Collector heuristics and age thresholds, survivor capacity, object characteristics, available destination regions, and current heap conditions can influence whether an object stays young or moves to Old. Promotion itself consumes space and copies or otherwise handles the survivor; it is not a free change of label.

Consider two illustrative services allocating 1 GB/s. In A, 98% of a cohort dies before collection. In B, 50% survives. B asks the collector to trace and evacuate far more live data and may send more of it into Old. Its old occupancy can rise even when every young collection succeeds.

<figure>
<a href="/images/courses/jvm/survival-pressure.svg" aria-label="Open survival and promotion pressure comparison"><img src="/images/courses/jvm/survival-pressure.svg" alt="Two workloads allocate at the same rate. Low survival leaves a small evacuation stream; high survival creates more evacuation and promotion pressure and faster old growth." width="900" height="450" /></a>
<figcaption>Equal allocation does not imply equal GC work. The percentages are illustrative, not measurements.</figcaption>
</figure>

<aside class="lesson-callout" data-kind="production" aria-label="Production note">
<p class="callout-label">Production note</p>
<p>Read allocation rate, young survival, promotion rate, live-set size, old-generation growth, and available heap headroom together. Rising old occupancy may reflect retained objects or promotion pressure; it is not, by itself, proof of a leak. Correlate GC logs with allocation profiles, retention evidence, and application latency before changing settings.</p>
</aside>

Barrier execution adds mutator-side work; card refinement, remembered-set maintenance, and scanning candidate cards add collector-side work and metadata cost. That trade is useful when it avoids repeatedly scanning much larger areas outside the collection set. When many cards are relevant, remembered-set work can itself become significant.

## Check your reasoning

<details class="lesson-check">
<summary>A root reaches an old Customer, which points to a young Order. Why is tracing only direct roots into Young unsafe?</summary>
<p>The live path crosses Old. Without an incoming-reference record or an Old scan, the young trace could miss Order and reclaim it incorrectly.</p>
</details>

<details class="lesson-check">
<summary>A card was marked dirty, then its reference field was overwritten. Does dirty prove a young object is still referenced?</summary>
<p>No. Dirty identifies a changed address range that needs processing. Refinement examines current references; remembered information for a collection target may remain even after the dirty state is cleared.</p>
</details>

<details class="lesson-check">
<summary>Two services allocate equally, but one promotes much more data. Which additional signals help explain its GC pressure?</summary>
<p>Compare survival, promotion, live-set size, old occupancy trend, available evacuation headroom, collection work, and latency. Allocation rate alone cannot explain the difference.</p>
</details>

## The path into G1 internals

Young collection works because ordinary roots and remembered outside references together expose the young live set. Dead objects stay behind; survivors evacuate to survivor or old destinations; source regions become reusable. <mark>Partial collection depends on preserving incoming-reference knowledge across the collection boundary.</mark>

<figure>
<a href="/images/courses/jvm/generational-gc-complete.svg" aria-label="Open complete generational collection path"><img src="/images/courses/jvm/generational-gc-complete.svg" alt="Reference update and card refinement supply remembered incoming references; ordinary roots and remembered references trace the young live set; survivors evacuate to survivor or old regions and source regions are reused." width="900" height="450" /></a>
<figcaption>The complete path joins mutator bookkeeping, remembered roots, evacuation, and promotion.</figcaption>
</figure>

[Lesson 24](/courses/jvm/g1-internals) examines G1's regions, collection sets, evacuation pauses, remembered-set work, concurrent marking, mixed collections, and selection of old regions. This lesson has focused on the **post-write/reference-update barrier** for remembered-reference maintenance. G1's **SATB barrier** supports concurrent marking and will receive its full explanation in Lesson 25.

<details class="lesson-sources">
<summary>Sources and implementation boundaries</summary>
<p>Based on Daily JVM Byte #23 and the reviewed lesson draft. Heap sizes, cohort percentages, diagrams, and the Customer/Order path are illustrative; no GC workload or command was run for this lesson. Region roles, card-based remembered entries, evacuation, and barrier descriptions refer to HotSpot G1 on JDK 25, not Java language guarantees or every JVM collector. Actual phase scheduling, barrier optimization, age policy, and destination choice vary with collector and configuration.</p>
<ul>
<li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html">JDK 25 GC Tuning Guide: G1 regions, collection sets, remembered sets, and evacuation</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-collector-implementation.html">JDK 25 GC Tuning Guide: generations and collection implementation</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/ergonomics.html">JDK 25 GC Tuning Guide: default collector selection</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-garbage-collector-tuning.html">JDK 25 GC Tuning Guide: G1 diagnostics and tuning</a></li>
</ul>
</details>
