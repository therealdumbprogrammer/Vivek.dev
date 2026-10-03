---
title: G1 internals — regions, evacuation, concurrent marking, and mixed collections
summary: Follow a G1 collection set from roots through evacuation, then see how concurrent marking selects old regions for mixed collections.
course: jvm
lessonSlug: g1-internals
module: Garbage Collection
order: 240
sourceByte: byte-024
draft: true
prerequisites: [generational-gc-mechanics]
jdk: JDK 25 · HotSpot G1
---

In [Lesson 23](/courses/jvm/generational-gc-mechanics), an old `Customer` kept a young `Order` alive. Remembered information gave the collector an incoming reference without searching every old object. What does a collector do with that information when it must recover space repeatedly, while old objects also accumulate?

On normal JDK 25 server-class configurations, the default collector is **G1**, or Garbage-First. G1 divides the heap into regions and selects a **Collection Set (CSet)** of source regions for each evacuation pause. It copies reachable objects out and makes successfully evacuated source regions reusable. The choice of old regions later in the cycle uses liveness and predicted cost.

<figure><a href="/images/courses/jvm/g1-overview.svg" aria-label="Open G1 overview"><img src="/images/courses/jvm/g1-overview.svg" alt="A G1 heap has Eden, Survivor, Old, and free regions. Selected source regions form a collection set; their live objects move to destination regions." width="900" height="450" /></a><figcaption>G1 selects regions to collect, evacuates their live objects, and reuses the source space.</figcaption></figure>

<mark>Regions are G1's units of space management; the Collection Set defines the source regions a pause will evacuate.</mark>

## Generation roles on a regional heap

Each G1 region is an equally sized contiguous range of virtual heap memory. Eden, Survivor, and Old are **roles assigned to regions**. A heap can therefore have an Eden region beside an Old region, with a free region elsewhere. The generations remain useful logical groups, but they do not require three fixed, contiguous address partitions.

<figure><a href="/images/courses/jvm/g1-region-roles.svg" aria-label="Open G1 region roles"><img src="/images/courses/jvm/g1-region-roles.svg" alt="Equal-sized regions in address order have interleaved Eden, Old, Survivor, and Free roles. A free region later becomes Eden and can return to free after evacuation." width="900" height="450" /></a><figcaption>Region role changes over time; physical address order does not define generation boundaries.</figcaption></figure>

For example, a free region can become Eden when allocation needs space. After a successful young collection moves its survivors away, that same source region becomes free again. G1 can later assign it another role. This flexibility lets the young and old portions of the heap adapt without moving a permanent boundary between them.

## One young evacuation, from roots to free regions

Imagine two Eden regions in the CSet. The first contains live objects `A` and `B` among dead objects; the second contains live `C`. G1 must identify all three survivors, including any reached from outside the CSet. VM and thread roots, code roots, and remembered references from other heap regions provide starting points. A **remembered set** records approximate outside locations, typically cards, that may contain references into selected regions. The collector scans the relevant locations; they are not a perfect list of individual pointers.

<figure><a href="/images/courses/jvm/g1-collection-set.svg" aria-label="Open collection set roots"><img src="/images/courses/jvm/g1-collection-set.svg" alt="VM and thread roots plus remembered outside references enter a selected collection set. Other heap regions remain outside the selected source set." width="900" height="450" /></a><figcaption>Incoming roots make partial collection correct without a full scan of every unselected region.</figcaption></figure>

During the **stop-the-world** young pause, G1 follows those roots, copies live young objects to Survivor or Old destination regions according to age and policy, and updates references to the moved objects. Dead objects stay in the source regions. Once evacuation succeeds, the complete source regions are available for reuse.

<figure><a href="/images/courses/jvm/g1-young-evacuation.svg" aria-label="Open young evacuation"><img src="/images/courses/jvm/g1-young-evacuation.svg" alt="Live A, B, and C are copied from two Eden source regions into Survivor or Old destinations while dead objects remain behind; the sources then become free." width="900" height="450" /></a><figcaption>Copying survivors both reclaims dead space and packs live objects into destinations. The source region is the unit recovered.</figcaption></figure>

This is reclamation **and** compaction at region granularity: destinations hold copied survivors, and successfully emptied source regions have no holes to manage. Normal G1 evacuation still pauses application threads, even though a different part of G1's cycle performs marking concurrently.

## Why old liveness must be measured

Young collections remove short-lived objects, but survivors may promote. Old regions then contain a mix of retained objects and objects that later become unreachable. Occupancy alone cannot tell G1 how much useful space an old region would yield: a nearly full region could be almost entirely live or mostly garbage.

G1 therefore runs a broader liveness analysis before choosing old regions. At a high level its cycle moves through a **Young-Only phase**, a **Concurrent Start** young pause, **Concurrent Mark**, **Remark**, **Cleanup**, and a **Space-Reclamation phase** with Mixed collections. Normal young collections can also occur while marking is in progress; the diagram simplifies that overlap.

<figure><a href="/images/courses/jvm/g1-cycle.svg" aria-label="Open G1 cycle"><img src="/images/courses/jvm/g1-cycle.svg" alt="Young-Only collections lead to a Concurrent Start young pause, Concurrent Mark, stop-the-world Remark and Cleanup, then a Space-Reclamation phase of mixed collections before the cycle repeats." width="900" height="450" /></a><figcaption>Concurrent Start also collects young regions. Marking prepares old-region choices; Mixed collections reclaim selected old space later.</figcaption></figure>

**Concurrent Start** starts marking as part of a young collection. **Concurrent Mark** traces liveness while application threads continue changing references. **Remark** and **Cleanup** are stop-the-world pauses that finish the marking transition and prepare the next phase. Older descriptions may call the initiating work “Initial Mark”; Concurrent Start is the current JDK 25 phase name used here.

Concurrent tracing needs a stable *logical* view even though the physical object graph changes. G1 uses **snapshot-at-the-beginning (SATB)**: objects live at the start of marking are treated as live for that cycle, which can conservatively defer some reclamation. [Lesson 25's SATB walkthrough](/courses/jvm/g1-satb) will trace the pre-write barrier that preserves this view. Here the key result is old-region liveness information, not the barrier mechanics.

## Choosing old regions by useful reclamation

Suppose one old region is 90% live and another is 15% live. Copying the first would move much more data for little recovered space; the second looks more promising. Marking supplies the liveness estimate that makes this comparison possible.

<figure><a href="/images/courses/jvm/g1-region-efficiency.svg" aria-label="Open old region efficiency"><img src="/images/courses/jvm/g1-region-efficiency.svg" alt="A mostly live old region requires much copying for little reclaimed space; a sparsely live region needs less copying and yields more space." width="900" height="450" /></a><figcaption>Live fraction is a useful first intuition for old-region value, but it is only part of G1's choice.</figcaption></figure>

“Garbage-First” means G1 tries to spend pause time where reclamation is efficient. Candidate evaluation also considers predicted evacuation cost, root and remembered-set work, connectivity between regions, available pause budget, and reclamation goals. A simple sort by garbage percentage would miss those costs.

<mark>G1 chooses old-region work for useful reclaimed space relative to its predicted collection cost.</mark>

## Mixed collections spread old reclamation across pauses

In the Space-Reclamation phase, a **Mixed collection** includes the required young regions plus selected old candidates in its CSet. Young survivors move to Survivor or Old destinations; live objects from selected Old source regions move to other Old destinations. Successfully evacuated sources become reusable. G1 distributes old work over multiple mixed pauses instead of placing every old candidate in one pause.

<figure><a href="/images/courses/jvm/g1-mixed-collection.svg" aria-label="Open mixed collection"><img src="/images/courses/jvm/g1-mixed-collection.svg" alt="A mixed collection set contains young regions and a few selected old regions. Live objects evacuate to survivor or old destinations and the source regions become reusable." width="900" height="450" /></a><figcaption>Every mixed pause collects young regions and a selected portion of useful old candidates.</figcaption></figure>

G1 uses observations from earlier pauses to predict work when sizing a CSet. Required young work, incoming-root scanning, object copying, and optional old-region work all consume the budget. Larger live-data volume or more cross-region references can change the estimate even when region count looks similar.

<figure><a href="/images/courses/jvm/g1-pause-budget.svg" aria-label="Open pause budget"><img src="/images/courses/jvm/g1-pause-budget.svg" alt="A conceptual pause budget first accounts for young and root work, then fits selected old-region evacuation where the estimated time allows. Actual duration can exceed the target." width="900" height="450" /></a><figcaption>Pause prediction chooses a plausible amount of work; the depicted times are illustrative, not a measured pause.</figcaption></figure>

<aside class="lesson-callout" data-kind="misconception" aria-label="Common misconception"><p class="callout-label">Common misconception</p><p><code>-XX:MaxGCPauseMillis</code> sets a pause-time goal, not a hard deadline. G1 predicts CSet cost from past behavior, but required young work, changed survival, scanning, and other pause phases can exceed that prediction. It is not a real-time guarantee.</p></aside>

## Special paths and production evidence

**Humongous objects** receive special treatment: objects at least half a region in size are allocated directly into old-generation humongous regions, potentially spanning multiple regions. They generally do not follow the ordinary Eden-to-Survivor evacuation path, and G1 normally reclaims their regions after determining they are dead rather than moving them during ordinary collections.

Evacuation also needs destination space. If G1 cannot find enough room for live objects during a pause, **evacuation failure** can leave some objects in place and add recovery work. If memory pressure becomes severe while liveness information is being gathered, G1 may fall back to a stop-the-world Full GC. Heap headroom therefore matters alongside occupancy and the pause target.

<aside class="lesson-callout" data-kind="production" aria-label="Production note"><p class="callout-label">Production note</p><p>When pauses rise, compare <strong>Object Copy</strong> time and live-data volume with external/code/heap root scanning and remembered-set work. Check whether survival or promotion has shifted, whether marking keeps up with old growth, and how much free destination space remains. Those signals explain more than allocation rate or one pause target alone.</p></aside>

Start with unified logging:

```text
-Xlog:gc*
```

For a deeper pause breakdown, add `-Xlog:gc+phases=debug`; for CSet selection details, use `-Xlog:gc+ergo+cset=debug`. The phase log exposes categories such as `Object Copy`, `Ext Root Scanning`, `Code Root Scan`, and `Scan Heap Roots`. Read these as evidence from a particular run, not fixed costs for every G1 workload.

## Check your reasoning

<details class="lesson-check"><summary>An old object outside the CSet points to a young object inside it. Which information lets G1 find that survivor?</summary><p>VM and thread roots alone may miss it. Remembered information identifies outside card locations that may contain references into the CSet; scanning them supplies the incoming edge for evacuation.</p></details>

<details class="lesson-check"><summary>Two old regions each occupy one region. One is 90% live and one is 15% live. Why might G1 prefer the second, and what else affects the choice?</summary><p>It likely yields more free space with less live-object copying. Predicted evacuation and root/remembered-set cost, connectivity, pause budget, and reclamation goals also matter.</p></details>

<details class="lesson-check"><summary>Concurrent Mark is running. Does that mean a young or Mixed evacuation can proceed while application threads run?</summary><p>No. Marking has a concurrent phase, but normal G1 evacuation remains stop-the-world. Concurrent Start, Remark, Cleanup, and evacuation pauses stop application threads for their respective work.</p></details>

## What this adds to the GC model

The regional heap lets G1 reuse source regions after evacuation. Remembered roots make a CSet safe to collect; concurrent marking finds promising old candidates; mixed pauses add a measured portion of those candidates to young work. Together, they explain how G1 pursues useful reclamation while controlling ordinary pause work.

<figure><a href="/images/courses/jvm/g1-complete.svg" aria-label="Open complete G1 model"><img src="/images/courses/jvm/g1-complete.svg" alt="Region roles and remembered roots feed young evacuation; concurrent marking supplies old-region candidates; mixed collections evacuate young and selected old regions under a predicted pause budget." width="900" height="450" /></a><figcaption>Regions, incoming roots, marking, and cost-based CSet selection form the complete path.</figcaption></figure>

The next lesson will examine how SATB keeps concurrent marking correct when an application overwrites references, and what the pre-write barrier and Remark phase contribute.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on Daily JVM Byte #24 and its reviewed draft. Object names, region fractions, and figures are illustrative; no GC workload was run for this lesson. Collector behavior and logging refer to HotSpot G1 in JDK 25, not Java language guarantees or every JVM implementation. Scheduling, CSet choices, and measured pause costs vary by workload and configuration.</p><ul><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/ergonomics.html">JDK 25 GC Tuning Guide: default collector ergonomics</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html">JDK 25 GC Tuning Guide: G1 heap, cycle, collection sets, marking, and exceptions</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-garbage-collector-tuning.html">JDK 25 GC Tuning Guide: pause and diagnostic guidance</a></li></ul></details>
