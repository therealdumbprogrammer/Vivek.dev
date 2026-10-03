---
title: G1 SATB — marking while the application keeps changing the heap
summary: See how G1 preserves overwritten references during concurrent marking, why buffers and TAMS matter, and what Remark finishes.
course: jvm
lessonSlug: g1-satb
module: Garbage Collection
order: 250
sourceByte: byte-025
draft: true
prerequisites: [g1-internals]
jdk: JDK 25 · HotSpot G1
---

In [Lesson 24](/courses/jvm/g1-internals), G1 marked old-generation liveness while application threads kept running. A collection set later uses that liveness to choose useful old regions. But how can the marker follow a graph that the application is changing at the same time?

Suppose marking begins with `Root → A → B`. The collector reaches `A`, but before it reads `A.child`, an application thread executes `A.child = C`. A marker that only follows the *current* edge can reach `C` and miss `B`, even though `B` was reachable when marking began.

<figure><a href="/images/courses/jvm/satb-problem.svg" aria-label="Open changing graph diagram"><img src="/images/courses/jvm/satb-problem.svg" alt="At marking start Root points to A and A points to B. Before the marker follows A's edge, the application replaces B with C, leaving B unseen by a current-graph-only traversal." width="900" height="450" /></a><figcaption>The disappearing edge to B is the correctness problem for concurrent marking.</figcaption></figure>

## A logical snapshot of beginning-of-cycle reachability

G1 uses **Snapshot-At-The-Beginning (SATB)**. Its marking result conservatively treats objects live at the start of the cycle as live for that cycle. “Snapshot” describes the liveness view; G1 does not copy the entire heap into a second heap. The real heap keeps changing while marking data and reference-write barriers preserve information the marker needs.

<mark>SATB protects the old reference that is about to disappear while marking is in progress.</mark>

In the example, that reference is `B`. The assignment creates a new edge to `C`, but deletion of the old `A → B` edge could hide a snapshot-live object. This is the reason to inspect the old value *before* replacing it.

## What the pre-write barrier records

Conceptually, the write has this order:

```text
old = A.child            // B
SATB pre-write barrier: preserve old when needed
A.child = C
```

The **pre-write barrier** is conditional collector bookkeeping around a reference store during active SATB marking. For a relevant non-null old reference, HotSpot can place that reference in a thread-local SATB buffer before the new store is installed. The diagram shows the logical sequence; it is not a Java-level implementation of every generated barrier fast path.

<figure><a href="/images/courses/jvm/satb-pre-barrier.svg" aria-label="Open SATB pre-write sequence"><img src="/images/courses/jvm/satb-pre-barrier.svg" alt="Read old A.child value B, preserve B in SATB bookkeeping, then install C as the new A.child value." width="900" height="450" /></a><figcaption>The old value B is available before the store removes its edge.</figcaption></figure>

A small action on the mutator thread records marking work. Each thread can collect entries in its own SATB buffer, allowing collector work to be processed in batches. <mark>Enqueuing B preserves work for the marker; it does not mean B and everything reachable from B are already marked.</mark> The marker must process B and follow its references. If B leads to `Q → R`, those objects may become additional work.

<figure><a href="/images/courses/jvm/satb-buffer-to-marker.svg" aria-label="Open buffer to marker flow"><img src="/images/courses/jvm/satb-buffer-to-marker.svg" alt="Two application threads append old references to SATB buffers; the concurrent marker drains entries, processes objects, and follows their outgoing references." width="900" height="450" /></a><figcaption>Buffering keeps the common mutator action small while deferring graph traversal to marking work.</figcaption></figure>

## The other G1 barrier watches the new relationship

[Lesson 23](/courses/jvm/generational-gc-mechanics) introduced card and remembered-set bookkeeping for partial collections. Its **post-write barrier** observes the newly installed reference relationship, marks a card when needed, and helps G1 maintain approximate incoming-reference information for a collection set. SATB asks which *old* reference is disappearing; card bookkeeping asks what *new* relationship may need remembering. A card is a coarse heap location, not an SATB queue entry.

<figure><a href="/images/courses/jvm/g1-pre-vs-post-barrier.svg" aria-label="Open G1 barrier comparison"><img src="/images/courses/jvm/g1-pre-vs-post-barrier.svg" alt="The SATB pre-write barrier captures the previous reference before the store; after the store, card bookkeeping tracks a newly created relationship for remembered-set maintenance." width="900" height="450" /></a><figcaption>The same assignment can require two different forms of bookkeeping for different GC problems.</figcaption></figure>

## Allocations after marking starts: TAMS

An object allocated after the marking snapshot did not exist in the beginning-of-cycle graph. G1 must not treat its absence from that traversal as proof that it is garbage. HotSpot keeps a per-region **Top At Mark Start (TAMS)** boundary: a conceptual dividing line between objects already present when marking began and allocations made afterward in that region. Newly allocated objects are handled conservatively for the current cycle. The diagram describes the boundary, not a promise that every region is a static stack of objects throughout every pause.

<figure><a href="/images/courses/jvm/g1-tams.svg" aria-label="Open TAMS region diagram"><img src="/images/courses/jvm/g1-tams.svg" alt="A region has objects present before marking below its Top At Mark Start boundary and later allocations above that conceptual boundary." width="900" height="450" /></a><figcaption>TAMS separates the snapshot population from subsequent allocations in a region.</figcaption></figure>

## The cost of preserving beginning-of-cycle liveness

Imagine `B` was live at mark start, then `A.child = null` makes it unreachable. SATB may still preserve that old reference and treat B as live for this cycle. This **floating garbage** occupies space until a later marking cycle can recognize it as dead, subject to G1's other reclamation paths.

<figure><a href="/images/courses/jvm/satb-floating-garbage.svg" aria-label="Open floating garbage timeline"><img src="/images/courses/jvm/satb-floating-garbage.svg" alt="B is reachable when marking starts, becomes unreachable during marking, remains conservatively live for the current cycle, and may be reclaimed after a later mark." width="900" height="450" /></a><figcaption>Snapshot liveness can temporarily overestimate the objects still needed by the application.</figcaption></figure>

<aside class="lesson-callout" data-kind="important" aria-label="Important"><p class="callout-label">Important</p><p>Floating garbage is conservative retention. A reference disappearing during marking can keep an object in this cycle's live estimate even when the application can no longer reach it. That space can become reclaimable after a later marking cycle; SATB does not promise an exact current live set.</p></aside>

Mutation and allocation continue while G1 traces. Heavy reference churn can add SATB work, and rapid promotion or allocation can raise old occupancy before marking completes. G1 therefore needs enough free heap and old-generation headroom to finish marking and reclaim space before allocation pressure becomes critical. A late start or insufficient marking capacity can make the cycle fall behind; investigate the actual logs before changing a threshold or heap size.

## Where Remark fits in the cycle

The high-level sequence is **Concurrent Start → Concurrent Mark → Remark → Cleanup**. Concurrent Start is a young pause that starts the cycle. Most graph traversal takes place during Concurrent Mark while mutators run; ordinary young collections can also occur then. **Remark** is a stop-the-world finishing point, and Cleanup prepares the result for subsequent reclamation decisions.

At Remark, G1 finalizes outstanding marking and SATB work and performs related reference processing, class unloading, and cleanup. Draining a buffer is not enough if its `B` entry leads to unprocessed `Q → R`. Marking must reach a **fixed point**: relevant SATB entries and the graph work they generate have been processed so no reachable work remains pending for this cycle. Remark finishes a concurrent traversal; it does not start a whole-heap mark from scratch.

<figure><a href="/images/courses/jvm/g1-remark.svg" aria-label="Open G1 Remark diagram"><img src="/images/courses/jvm/g1-remark.svg" alt="Concurrent Mark does most traversal while the application runs. Stop-the-world Remark drains remaining SATB entries and their descendant marking work, then finalizes marking with reference processing and class unloading." width="900" height="450" /></a><figcaption>Queued entries can reveal more reachable objects, so finalization continues until marking reaches a fixed point.</figcaption></figure>

<aside class="lesson-callout" data-kind="production" aria-label="Production note"><p class="callout-label">Production note</p><p>Identify the pause before interpreting its duration. A long Remark pause calls for investigation of marking finalization, SATB work, reference processing, and class unloading. A long young or Mixed evacuation pause calls for collection-set, root and remembered-set scanning, and object-copy evidence. Equal pause times do not imply equal causes.</p></aside>

Start diagnosis with `-Xlog:gc*` to identify Concurrent Start, Concurrent Mark, Remark, Cleanup, Young, Mixed, or Full GC events and their timing. For evacuation phase costs, `-Xlog:gc+phases=debug` can expose root scanning and Object Copy. Correlate repeated cycles with old occupancy and available destination space: marking falling behind and evacuation running out of room are related pressure signals, but they require different explanations.

## Check your reasoning

<details class="lesson-check"><summary>At mark start A points to B. The application replaces B with C before the marker reads the field. Which value matters to SATB, and why?</summary><p>B is the old value whose edge is disappearing. Preserving it gives the marker a way to discover an object that belonged to beginning-of-cycle reachability. C is the new relationship; card bookkeeping addresses that separate concern.</p></details>

<details class="lesson-check"><summary>The pre-barrier enqueues B. Is B now fully marked?</summary><p>No. The buffer preserves a reference as marking work. Processing B may reveal further objects; marking completes only when the relevant queued and discovered work has been drained to a fixed point.</p></details>

<details class="lesson-check"><summary>B becomes unreachable just after Concurrent Start. Why might old-space reclamation still count it as live?</summary><p>It was live in the SATB snapshot. Conservative retention can leave floating garbage until a later cycle, even though the application no longer reaches B.</p></details>

<details class="lesson-check"><summary>A log shows a long Remark and a separate long Mixed pause. Would one CSet-size explanation cover both?</summary><p>No. Remark finalizes marking and related work; Mixed evacuation scans roots and remembered information and copies live objects. Inspect their phase evidence separately.</p></details>

## The combined G1 barrier model

<mark>SATB's pre-write barrier preserves old disappearing references; the post-write card barrier records new relationships for remembered-set maintenance.</mark> Together they let G1 mark a changing graph and evacuate selected regions using incoming-reference information.

<figure><a href="/images/courses/jvm/g1-barriers-complete.svg" aria-label="Open combined barrier model"><img src="/images/courses/jvm/g1-barriers-complete.svg" alt="An application reference store feeds an old-reference SATB path into concurrent marking and a new-relationship card path into remembered information for evacuation." width="900" height="450" /></a><figcaption>Two barriers on one store support two different collector jobs.</figcaption></figure>

<figure><a href="/images/courses/jvm/g1-satb-complete.svg" aria-label="Open complete SATB model"><img src="/images/courses/jvm/g1-satb-complete.svg" alt="Concurrent Start establishes snapshot and TAMS state; overwritten old references enter SATB buffers; Concurrent Mark processes them; Remark finishes outstanding work; Cleanup prepares reclamation." width="900" height="450" /></a><figcaption>SATB connects the logical snapshot, mutator barriers, buffer work, and Remark into one cycle.</figcaption></figure>

Continue to [Lesson 26](/courses/jvm/g1-failure-modes) for G1 failure modes: evacuation failure, humongous objects, marking that falls behind, Full GC, and the headroom that connects them.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on Daily JVM Byte #25 and its reviewed draft. Object names, timelines, and diagrams are illustrative; no GC workload was run. SATB, TAMS, and barrier details describe HotSpot G1 in JDK 25 rather than Java language guarantees or every collector. Exact barrier paths and phase costs depend on runtime state and configuration.</p><ul><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html">JDK 25 G1 collector guide: SATB, cycle, Remark, and evacuation</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-garbage-collector-tuning.html">JDK 25 G1 tuning and marking guidance</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/g1/g1BarrierSet.cpp">OpenJDK 25 G1 barrier implementation</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/g1/g1ConcurrentMark.cpp">OpenJDK 25 G1 concurrent marking implementation</a></li></ul></details>
