---
title: ZGC concurrent relocation — how objects move while Java threads keep running
summary: Follow one Order through page selection, forwarding, barrier resolution, competing copies and safe reclamation in JDK 25 Generational ZGC.
course: jvm
lessonSlug: zgc-concurrent-relocation-protocol
module: HotSpot Internals
order: 480
sourceByte: byte-048
draft: true
prerequisites:
  - zgc-vs-g1-concurrent-relocation
jdk: JDK 25 · Generational ZGC
---

[Lesson 47](/courses/jvm/zgc-vs-g1-concurrent-relocation) introduced ZGC's colored references and its mostly concurrent movement of objects. Now follow one `Order` while application threads are still reading and updating it. How can a reference to its former address remain safe?

Imagine `Customer.latestOrder` refers to an `Order` at conceptual address `0x1000`. ZGC chooses its page for relocation and moves the logical object to `0x5000`. Three problems appear at once: a thread may load the old reference, two threads may try to copy the same object, and a field may change while copying is underway. The addresses and timelines here are illustrations, not a description of ZGC's pointer encoding.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable concurrent relocation problems"><a href="/images/courses/jvm/zgc-relocation-three-problems.svg" aria-label="Open relocation problems diagram"><img src="/images/courses/jvm/zgc-relocation-three-problems.svg" alt="An Order moving from an old page to a new page presents three concurrent problems: stale references, competing copies, and writes during movement." width="1080" height="420" /></a><figcaption>These three races explain why copying alone cannot implement concurrent relocation.</figcaption></figure>

## First select a page, then preserve its live objects

After marking has identified live objects, ZGC selects **ZPages** for a relocation set. A ZPage is ZGC's heap-management unit; it is not a G1 region. Selection asks whether moving the live objects can recover useful space. Objects on a selected page are still reachable while relocation proceeds, so the collector must preserve both their state and the meaning of references to them.

For this activity ZGC associates a `ZForwarding` structure with the source page. It records a mapping from an object's old location to its authoritative destination. <mark>The forwarding information belongs to a relocation activity; it is not a permanent global address book for every Java object.</mark> The old page and its forwarding metadata remain available for the period in which a stale reference may still need resolution.

## The reference-load path

When compiled Java code loads `Customer.latestOrder`, ZGC's load barrier checks whether the reference is usable in the current phase. The common path can continue cheaply. A reference needing processing takes a slow path, which may use forwarding information to obtain the current location and return a usable reference. Under suitable conditions, that path can also help relocate an object for which no forwarding entry has yet been published. This is **mutator assistance**: the Java thread performs some collector work before continuing.

The implementation can also repair a reference in its heap slot so later readers encounter a more current value. That repair is conditional; some references are remapped by other paths, and a load barrier does not necessarily call a runtime stub. Likewise, an old-looking reference does not imply every load relocates its object.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable ZGC reference path"><a href="/images/courses/jvm/zgc-load-barrier-reference-path.svg" aria-label="Open ZGC reference path diagram"><img src="/images/courses/jvm/zgc-load-barrier-reference-path.svg" alt="A loaded Order reference takes a usable fast path or a processing path that consults forwarding, may assist relocation, and returns the canonical location." width="1080" height="450" /></a><figcaption>Barrier processing happens when required by reference state and collector phase; this is a conceptual path.</figcaption></figure>

## One authoritative copy wins

Suppose a GC worker and a Java thread both encounter `Order` before a forwarding entry exists. Each can prepare a candidate destination. They cannot publish two independent copies as the same logical Java object. In JDK 25, `ZRelocate::relocate_object()` first looks for an existing forwarding entry, retains the source page while needed, allocates and copies when appropriate, then calls `forwarding->insert(...)`. The atomic insertion selects one canonical destination. A losing speculative allocation can be undone with `undo_alloc_object(...)`.

```cpp
// Simplified from the JDK 25 relocation path; surrounding checks omitted.
const zaddress to_addr_final = forwarding->insert(from_addr, to_addr, cursor);
if (to_addr_final != to_addr) {
    allocator->undo_alloc_object(to_addr, size);
}
```

The decisive result is `to_addr_final`: both racing threads use it, even if one copied into another location first. The exact checks and allocation paths are in [the tagged `zRelocate.cpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/z/zRelocate.cpp). <mark>One logical object has one authoritative relocated destination.</mark>

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable forwarding publication race"><a href="/images/courses/jvm/zgc-forwarding-publication-race.svg" aria-label="Open forwarding race diagram"><img src="/images/courses/jvm/zgc-forwarding-publication-race.svg" alt="Two threads prepare candidate copies, an atomic forwarding insertion chooses destination 0x5000, and the losing candidate allocation is undone." width="1080" height="470" /></a><figcaption>Speculative copying is safe only because publication converges on one destination.</figcaption></figure>

## A concurrent field write needs coordination too

Now suppose the application executes `order.quantity = 10` while `Order` is moving. A naïve copy could capture `quantity = 5`, then leave the new location with that stale value after the application writes 10. ZGC's relocation and access protocol must coordinate which object location mutators can use, when copying and forwarding are published, and how source storage remains valid. This is more than an unprotected `memcpy`.

The invariant is that a mutator using a correctly resolved reference observes the authoritative logical object according to Java's usual memory rules. **GC correctness does not make racy application code race-free.** Two Java threads writing `quantity` without the synchronization required by the Java Memory Model still have an application data race; the collector promises neither a deterministic last writer nor extra happens-before edges.

<aside class="lesson-callout" data-kind="important" aria-label="Important"><p class="callout-label">Important</p><p>Relocation preserves Java object identity and field state through coordinated access. It does not repair unsynchronized application field writes.</p></aside>

There is also a specialized **in-place relocation** path when source and destination page space overlap. Moving contents within overlapping storage requires additional page and access coordination. It is useful evidence that the source-page lifetime and access rules are part of the algorithm, not a detail supplied by a forwarding lookup alone.

## Why the old page cannot disappear immediately

After `Order` has moved, another thread may still hold a reference that needs remapping. ZGC retains the source page and forwarding information for the relevant interval, resolves outstanding references safely, and only then reclaims or reuses old storage. Reuse too early would let a stale reference name unrelated bytes. The complete lifecycle is **mark → choose relocation pages → copy or assist → publish forwarding → resolve references → retire old storage safely**.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable relocation lifecycle"><a href="/images/courses/jvm/zgc-relocation-complete.svg" aria-label="Open complete relocation diagram"><img src="/images/courses/jvm/zgc-relocation-complete.svg" alt="Mark live objects, select pages, move Order, publish one destination, resolve stale references, then reclaim the old page after safe coordination." width="1080" height="450" /></a><figcaption>Old storage outlives the copy until the collector can safely retire it.</figcaption></figure>

## Read the JDK 25 source in one focused pass

Start with [`zForwarding.hpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/z/zForwarding.hpp) to identify page-scoped forwarding lookup and insertion. Then follow `ZRelocate::relocate_object()` in [`zRelocate.cpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/z/zRelocate.cpp): lookup, source-page retention, candidate copy, insertion, and undo of a loser. Next inspect [`zBarrier.cpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/z/zBarrier.cpp) for barrier slow paths and reference processing. Finally, [`zBarrierSetC2.cpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/z/c2/zBarrierSetC2.cpp) shows how the compiled reference-access path connects to those runtime mechanisms. Read these as cooperating components, not a single universal call sequence.

The price of this coordination is CPU, memory traffic, and occasional barrier slow-path or mutator-assist latency while Java runs. Small global pause times therefore do not mean zero collector cost in a request. Measure application throughput and tail latency alongside GC pauses, concurrent GC CPU, and allocation stalls, as Lesson 47 recommended.

## Check your reasoning

<details class="lesson-check"><summary>Why can `Customer.latestOrder` still contain an old-looking reference?</summary><p>Reference processing can resolve it through current phase state and forwarding information before unsafe use; repair may happen incrementally.</p></details>
<details class="lesson-check"><summary>Two threads copy the same `Order`. Which copy represents the object?</summary><p>The destination returned by atomic forwarding insertion is authoritative. A losing candidate allocation can be undone.</p></details>
<details class="lesson-check"><summary>Does every load of a stale reference force a fresh relocation?</summary><p>No. An existing forwarding entry can resolve it, and barrier paths depend on phase and reference state.</p></details>
<details class="lesson-check"><summary>Does ZGC make unsynchronized writes to `order.quantity` safe?</summary><p>No. Collector coordination preserves object state through relocation; Java data-race semantics still apply.</p></details>
<details class="lesson-check"><summary>Why retain the original page after publishing a destination?</summary><p>Outstanding references may still need safe resolution. The collector must coordinate forwarding lifetime and page reuse.</p></details>

We can now explain how a running application reaches the right `Order` while its physical location changes. [Lesson 49](/courses/jvm/gc-barriers-in-jit-code) follows the barrier instructions C2 places in application machine code to support that protocol.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on Daily JVM Byte #48 and its approved review. Addresses, race diagrams, and code reductions are illustrative; no JVM workload was executed for this lesson. The mechanism describes JDK 25 HotSpot Generational ZGC, not a Java-level pointer format or a guarantee for other collectors.</p><ul><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/z/zForwarding.hpp">JDK 25 ZForwarding</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/z/zRelocate.cpp">JDK 25 ZRelocate</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/z/zBarrier.cpp">JDK 25 ZBarrier</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/z/c2/zBarrierSetC2.cpp">JDK 25 ZBarrierSetC2</a></li></ul></details>
