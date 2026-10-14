---
title: G1 concurrent marking — finding old-generation garbage
summary: Trace JDK 25 G1 from adaptive marking initiation through SATB, Remark, region liveness, and mixed collections.
course: jvm
lessonSlug: g1-concurrent-marking
module: HotSpot Internals
order: 450
sourceByte: byte-045
draft: true
prerequisites:
  - g1-young-gc-end-to-end
jdk: JDK 25 · G1
---

[Lesson 44](/courses/jvm/g1-young-gc-end-to-end) followed a young evacuation: live objects leave selected Eden and Survivor regions during a pause, and successful source regions become reusable. Some survivors promote to **Old**. What happens when those Old regions begin to fill, including with objects that have since died?

G1 uses **concurrent marking** to estimate which Old regions contain live data while application threads continue running for much of the cycle. Later **mixed collections** evacuate selected Old regions. <mark>Marking discovers reclaimable Old space; mixed collections usually perform the evacuation that reclaims partially live Old regions.</mark>

## Why start before Old is full?

Imagine an order service promotes cached `Customer` records. Some remain in use; others become unreachable as cache entries expire. A young-only collection reclaims young regions but does not normally evacuate those partially live Old regions. G1 needs liveness information early enough to finish marking and reclaim space before promotion exhausts its headroom.

The **Initiating Heap Occupancy Percent** (IHOP) is the threshold used to schedule a marking cycle. With adaptive IHOP enabled, G1 predicts an appropriate threshold from recent marking duration and allocation behavior. A rising promotion rate may call for an earlier start. The threshold is a policy decision and can be revised; neither a fixed 45% trigger nor a guarantee that marking completes before space runs out is a sound mental model.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable adaptive IHOP and marking timeline"><a href="/images/courses/jvm/g1-marking-ihop-timeline.svg" aria-label="Open marking timeline"><img src="/images/courses/jvm/g1-marking-ihop-timeline.svg" alt="Old occupancy rises; adaptive IHOP starts a cycle with headroom for concurrent marking and later mixed collections before capacity pressure becomes critical." width="1080" height="460" /></a><figcaption>G1 tries to start early enough to cover marking time and subsequent reclamation; the sketch is illustrative.</figcaption></figure>

## The cycle starts inside a young pause

G1 schedules a **Concurrent Start** young collection (also called Initial Mark). Its ordinary young evacuation is STW, and initial marking work piggybacks on that pause. Mutators then resume. A **root-region scan** follows: Survivor regions can hold references into Old, and those regions must be scanned and coordinated with subsequent young evacuations so their Old targets are not missed. The bulk of graph traversal then happens during **Concurrent Mark**, overlapping application execution. Normal young collections can still occur while marking runs.

The staged path is:

```text
Old pressure → Concurrent Start young pause → root-region scan
             → concurrent graph mark → STW Remark → Cleanup
             → several possible mixed young + Old pauses
```

This is why a GC log can show both young pauses and concurrent marking events in the same interval. “Concurrent” describes much of the marking work, not every phase of the cycle and not the later mixed evacuations.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable root-region scan and concurrent marking diagram"><a href="/images/courses/jvm/g1-marking-root-region-scan.svg" aria-label="Open root-region scan diagram"><img src="/images/courses/jvm/g1-marking-root-region-scan.svg" alt="Concurrent Start identifies the marking snapshot; survivor root regions with references into Old are scanned before they can be evacuated by another young pause; concurrent marking then proceeds with mutators running." width="1080" height="440" /></a><figcaption>The root-region scan connects young survivors to Old marking and must coordinate with later young evacuations.</figcaption></figure>

For the order service, a Survivor `Customer` can still point to an Old `Account`. If the next young collection moved the `Customer` before that relationship was accounted for, marking could lose an Old starting edge. G1 coordinates the scan with those young-region changes. This is a root-discovery step for the **marking cycle**, distinct from the incoming heap-root merge in each young evacuation pause.

## The graph changes while G1 marks it

Suppose `Customer A` points to `Order B` when marking starts. While a marker walks the graph, application code executes `a.latestOrder = c`. The old edge to B disappears. A naive concurrent traversal could lose information about an object considered live in the cycle's logical starting snapshot.

G1 uses **Snapshot-At-The-Beginning** (SATB). Its **pre-write barrier** observes the field's *old* reference before the overwrite and, when relevant, records it in a buffer for marking. If the old value was B, the marker can process B even after the field holds C. The details include filtering and buffered work; the important invariant is preserving relevant overwritten references for the current snapshot.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable SATB overwrite diagram"><a href="/images/courses/jvm/g1-marking-satb-overwrite.svg" aria-label="Open SATB overwrite diagram"><img src="/images/courses/jvm/g1-marking-satb-overwrite.svg" alt="Before A.ref changes from B to C, the SATB pre-write barrier records old value B for concurrent marking; afterward A points to C." width="1080" height="500" /></a><figcaption>The pre-write barrier protects the logical snapshot while mutators change edges.</figcaption></figure>

Recall a different barrier from Lesson 44. The **post-write/card barrier** tracks where a new cross-region reference may have been stored, helping future collection-set root discovery. SATB's pre-write barrier records a relevant *old value* for concurrent marking. One reference assignment may participate in both mechanisms, which protect different invariants. <mark>SATB follows the overwritten old reference; card tracking locates a newly written heap edge.</mark>

SATB permits **floating garbage**. An object reachable at the cycle's logical snapshot may become unreachable while marking runs, yet remain classified live for this cycle. It can be reclaimed in a later cycle. That delay is a correctness trade-off, not by itself evidence of a Java memory leak. A truly retained object remains reachable from roots across cycles.

## Remark and Cleanup finish the discovery

**Remark** is STW. G1 drains or reconciles outstanding marking and SATB work and finalizes the mark. It can include reference-processing and class-unloading work; it is not a fresh whole-heap mark from zero. **Cleanup** derives region liveness and candidate information. Completely empty Old regions can be reclaimed without copying live objects; dead humongous regions also have special reclamation opportunities. These exceptions do not turn concurrent marking into general in-place reclamation of partially live Old regions.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable marking and reclamation map"><a href="/images/courses/jvm/g1-marking-region-map.svg" aria-label="Open region liveness diagram"><img src="/images/courses/jvm/g1-marking-region-map.svg" alt="Marking classifies Old regions as mostly live, partly live, or empty. An empty region may be reclaimed directly; useful partly live regions become candidates for later mixed evacuation." width="1080" height="490" /></a><figcaption>Region liveness guides later choices. Percent live alone does not determine the best candidate.</figcaption></figure>

G1 estimates the benefit of reclaiming garbage against the cost of copying live bytes, scanning remembered roots, and fitting work into a pause-time budget. Connectivity and other cost estimates also matter. An Old region with 20% live data may be attractive; a region with 90% live data usually offers less reclaimed space for similar bookkeeping. But selecting by percent full alone ignores evacuation and reference costs.

## Mixed collections recover Old space

After marking, a **mixed collection** remains a STW evacuation pause. Its CSet contains young regions plus selected Old candidate regions. G1 copies live objects out of those Old regions and, when evacuation succeeds, reuses the whole source region. It often spreads candidate work over multiple pauses to manage latency. The cycle therefore has two distinct jobs: discover Old liveness mostly concurrently, then reclaim useful Old regions incrementally through mixed evacuations.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable complete G1 young to old lifecycle"><a href="/images/courses/jvm/g1-marking-complete-lifecycle.svg" aria-label="Open G1 lifecycle diagram"><img src="/images/courses/jvm/g1-marking-complete-lifecycle.svg" alt="Allocation enters Eden; young pauses discard dead objects and promote survivors; Old occupancy triggers concurrent marking with SATB; Remark and Cleanup provide candidates; mixed pauses reclaim selected Old regions." width="1080" height="520" /></a><figcaption>Young evacuation and Old marking form one ongoing allocation and reclamation system.</figcaption></figure>

## Read the evidence during an incident

For a bounded JDK 25 demonstration, the logging template from Lesson 44 also records concurrent events:

```bash
java -Xms256m -Xmx256m -XX:+UseG1GC \
  '-Xlog:gc*,gc+phases=debug:file=g1-cycle.log:uptime,level,tags' \
  YourBoundedDemo
```

Follow timestamps and GC IDs. Look for `Pause Young (Concurrent Start)`, concurrent root-region scan and mark messages, `Pause Remark`, `Pause Cleanup`, and later `Pause Young (Mixed)` entries. Exact labels vary by build and chosen log tags. Compare the Old region/heap occupancy trend before and after those events. JFR and process or container CPU measurements help tell whether concurrent GC workers had enough CPU while application work continued. The logging command is a template; no run or numeric output is claimed here.

Consider an incident where Old occupancy keeps rising despite marking cycles. Ask in order: Did adaptive IHOP start early enough for the current promotion rate? Is young survival driving rapid promotion? Did concurrent work progress under the available CPU or cgroup quota? Did mixed pauses reclaim enough? Is the reachable live set itself close to heap capacity? A 16 GB heap retaining roughly 15 GB of genuinely reachable objects leaves little free space regardless of collector tuning. Concurrent marking reduces pause exposure but consumes CPU and adds barrier work on mutators.

One useful way to separate those causes is to draw the occupancy trend across the whole cycle, rather than judging a single pause. If Old rises steeply **before** Concurrent Start, look at promotion and the predicted IHOP start. If marking takes a long wall-clock interval while the process is CPU constrained, compare concurrent worker activity with the cgroup quota and application CPU. If Cleanup finds candidates but Old barely falls across mixed pauses, inspect how many Old regions were selected and how much space each successful evacuation recovered. If post-collection occupancy remains high through repeated cycles, a heap snapshot and application retention analysis may show a legitimately large live graph. These are different remedies; one tuning flag cannot substitute for identifying which stage falls behind.

<details class="lesson-check"><summary>A field overwrite removes the last path to B during marking. Must B be reclaimed in this cycle?</summary><p>No. SATB may retain B as live according to the cycle's logical snapshot. That floating garbage can be recognized in a later cycle.</p></details>

<details class="lesson-check"><summary>Can a completed mark directly free an Old region that still contains reachable objects?</summary><p>Generally no. It can identify the region as a mixed-collection candidate; a later STW mixed pause evacuates its live objects before the source region can be reused. Completely empty regions and some dead humongous regions have special paths.</p></details>

<details class="lesson-check"><summary>Why might Old occupancy continue rising even with frequent young GCs?</summary><p>Young survivors may promote faster than marking and mixed collections reclaim Old space, or the application may retain a genuinely large live set. Inspect promotion, start timing, concurrent CPU, mixed results, and occupancy trends together.</p></details>

**Next:** [Lesson 46, When G1 Cannot Keep Up](/courses/jvm/g1-failure-recovery), follows an evacuation that cannot finish and the recovery evidence in GC logs.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on Daily JVM Byte #45 and its approved review. The order-service scenario, diagrams, percentages, and command are illustrative; no JDK 25 workload was executed for this lesson. IHOP, SATB, root-region scanning, liveness estimation and mixed collections describe JDK 25 G1 implementation rather than Java specification guarantees. Log details and decisions vary with build and workload.</p><ul><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html">Oracle JDK 25 G1 collector guide</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-garbage-collector-tuning.html">Oracle JDK 25 G1 tuning and diagnostics</a></li><li><a href="https://github.com/openjdk/jdk/tree/jdk-25%2B36/src/hotspot/share/gc/g1">OpenJDK 25 G1 implementation</a></li></ul></details>
