---
title: ZGC vs G1 — why concurrent relocation changes GC architecture
summary: Follow a moving object through Generational ZGC's colored references and barriers, then compare latency, headroom and throughput with G1.
course: jvm
lessonSlug: zgc-vs-g1-concurrent-relocation
module: HotSpot Internals
order: 470
sourceByte: byte-047
draft: true
prerequisites:
  - g1-failure-recovery
jdk: JDK 25 · G1 and Generational ZGC
---

[Lesson 46](/courses/jvm/g1-failure-recovery) showed why G1 needs destination space to evacuate live objects during a pause. Generational ZGC also traces live objects and moves them, but it moves much of the work alongside running Java threads. The central problem is keeping every object access correct while old and new locations may coexist.

On JDK 25, `-XX:+UseZGC` selects **Generational ZGC**. Its non-generational mode was removed in JDK 24 by [JEP 490](https://openjdk.org/jeps/490); the old `-XX:+ZGenerational` selector is not needed. This lesson describes JDK 25 HotSpot behavior, not a promise about every JVM implementation.

## Follow one Order while it moves

Suppose `Customer` contains a reference to `Order` at conceptual address `0x1000`. A collector copies `Order` to `0x5000`. Java must still observe the same logical `Order`, including its identity and fields. If a Java thread loads the old reference during concurrent relocation, simply interpreting `0x1000` as the current object location would be unsafe.

G1 normally solves this during **stop-the-world (STW) evacuation**: Java threads stop, G1 moves selected live objects and makes their references consistent, and then the threads resume. G1 still marks much Old data concurrently, as [Lesson 45](/courses/jvm/g1-concurrent-marking) explained. ZGC instead makes reference use participate in the relocation protocol, allowing the costly marking and moving work to run largely concurrently. Short STW coordination phases remain.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable G1 and ZGC execution timeline"><a href="/images/courses/jvm/g1-vs-zgc-execution-timeline.svg" aria-label="Open collector execution timeline"><img src="/images/courses/jvm/g1-vs-zgc-execution-timeline.svg" alt="G1 stops Java execution for selected-region evacuation, while ZGC overlaps relocation with Java execution and uses brief coordination pauses." width="1080" height="470" /></a><figcaption>The bars compare when evacuation work occurs. Their lengths are conceptual, not measured pause durations.</figcaption></figure>

## Metadata in the reference helps ZGC interpret it

ZGC uses **colored pointers**: an object reference carries GC state as well as information used to locate an object. That metadata is in the *reference*, not an extra Java field in each `Order`. It helps ZGC decide whether a loaded reference is immediately usable for the current phase or needs processing. The exact bit layout and encoding are implementation details that change; a fixed bit diagram would be misleading.

When generated code loads an object reference, a **load barrier** can check its state. The common fast path proceeds when the reference is already in a usable state. A slow path can resolve a reference that needs remapping, using forwarding or relocation information to find the current object, then return a usable reference. ZGC can update references incrementally, including repairing a reference as it is encountered. It does not need one global pause that rewrites every reference at once.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable colored reference and load barrier flow"><a href="/images/courses/jvm/zgc-reference-repair.svg" aria-label="Open ZGC reference repair diagram"><img src="/images/courses/jvm/zgc-reference-repair.svg" alt="A colored reference loaded from Customer takes the fast path if usable; otherwise the load-barrier slow path consults relocation information to reach Order at its new location and may repair the stored reference." width="1080" height="540" /></a><figcaption>A stale reference can be resolved as it is loaded while relocation proceeds; this is a conceptual protocol, not a literal pointer encoding.</figcaption></figure>

The relocation protocol also coordinates copying, forwarding information and when the old location may be reused. The load barrier is one part of that larger correctness system. <mark>Concurrent relocation shifts reference repair from one large evacuation pause into coordinated, incremental work during application execution.</mark> Lesson 48 will trace the forwarding and slow-path protocol in more detail.

## A young collection also needs information about stores

Generational ZGC has young and old generations. Suppose an old `Customer` stores a reference to a young `Order`:

```java
oldCustomer.latestOrder = youngOrder;
```

A later young collection cannot ignore that old-to-young edge. ZGC uses **store barriers** to help maintain marking and cross-generation reference information as application threads modify the object graph. Colored references carry GC state; load barriers make loaded references usable; store barriers record relevant changes and preserve collection invariants. Their jobs are related but distinct. G1 also has multiple barrier mechanisms, including SATB pre-write and card tracking; reducing either collector to a single barrier type hides the work it must do.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable ZGC load and store barrier responsibilities"><a href="/images/courses/jvm/zgc-load-vs-store-barriers.svg" aria-label="Open barrier responsibilities diagram"><img src="/images/courses/jvm/zgc-load-vs-store-barriers.svg" alt="Loading an Order reference invokes a check that can resolve relocation; storing an old-to-young edge records information needed for marking and young collection. Colored reference metadata assists both GC state decisions." width="1080" height="480" /></a><figcaption>Access and mutation require different bookkeeping. The diagram omits lower-level barrier optimizations.</figcaption></figure>

## The cost moves into concurrent work and headroom

G1 combines concurrent Old marking with normal STW young and mixed evacuation. ZGC performs marking and relocation predominantly concurrently, using barriers and brief coordination pauses. That can greatly reduce GC pause exposure. It also consumes CPU and memory bandwidth while application threads run, adds relevant reference-access work, and needs enough free heap for allocation while collection progresses. Neither collector guarantees the best throughput for every workload.

If allocation consumes free space faster than concurrent ZGC can reclaim it, allocating threads can **stall** waiting for space. If recovery remains insufficient, allocation can end in `OutOfMemoryError`. This is a key production distinction: <mark>short STW GC pauses do not guarantee low application latency.</mark> A request waiting to allocate can have poor tail latency even when the GC pause histogram looks excellent.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable ZGC heap headroom and allocation stall diagram"><a href="/images/courses/jvm/zgc-headroom-allocation-stall.svg" aria-label="Open ZGC allocation stall diagram"><img src="/images/courses/jvm/zgc-headroom-allocation-stall.svg" alt="During concurrent collection, application allocations consume free heap while GC reclaims space. If free space reaches zero before reclamation catches up, allocating threads wait despite short global pauses." width="1080" height="490" /></a><figcaption>Headroom covers allocations during concurrent work; zero headroom can turn into an allocation stall.</figcaption></figure>

The optional `-XX:SoftMaxHeapSize` setting is a *soft target*, not a hard cap. For example, with `-Xmx5g -XX:SoftMaxHeapSize=4g`, ZGC tries to manage around 4 GB but may use up to 5 GB to avoid stalls. The process still needs memory beyond its Java heap, so compare `-Xmx` with container or host limits and observed process memory. A soft target cannot manufacture headroom beyond the hard maximum.

## Compare the collectors against an application objective

| Dimension | G1 on JDK 25 | Generational ZGC on JDK 25 |
|---|---|---|
| Normal relocation | Selected young and mixed regions during STW pauses | Predominantly concurrent relocation with brief coordination pauses |
| Marking | Old marking mostly concurrent, with STW phases | Predominantly concurrent marking, with brief coordination phases |
| Reference work | G1 barriers and remembered information; evacuation resolves moved references in pauses | Colored references plus load and store barrier work during execution |
| Pause profile | Selected-region work can become substantial; Full GC is costly | Designed for very short GC pauses; allocation stalls remain possible |
| Throughput cost | Pause work competes with response latency | Concurrent GC CPU, bandwidth and barrier work can reduce throughput |
| Memory need | Evacuation destination and Old reclamation headroom | Allocation headroom throughout concurrent collection |

Suppose a service has a 500 ms response SLO and healthy G1 runs with pauses well below its latency budget. A collector switch may buy little user-visible improvement. If a service has a 10 ms tail-latency budget and G1 evacuation pauses materially affect requests, ZGC deserves a controlled comparison. Neither example is a recommendation without measurements of the actual service.

## Run a controlled JDK 25 comparison

Use the same application build, heap size, load shape, warm-up and host or container resources. Run each collector separately, long enough to cover steady state and bursts. These commands are templates, not results from this lesson:

```bash
java -Xms2g -Xmx2g -XX:+UseG1GC \
  '-Xlog:gc*:file=g1.log:time,uptime,level,tags' \
  -jar application.jar
```

```bash
java -Xms2g -Xmx2g -XX:+UseZGC \
  '-Xlog:gc*:file=zgc.log:time,uptime,level,tags' \
  -jar application.jar
```

Compare the **distribution** of GC pauses, real request p99 and p99.9 latency, completed work per second, application and GC CPU, memory use and headroom, allocation stalls, and post-collection occupancy or retained live-set evidence. A smaller pause number is useful only if it improves the application objective without unacceptable CPU or memory cost. GC logs show collector events; request telemetry shows user-facing latency.

Consider three investigations:

1. **ZGC has tiny pauses but p99.9 requests spike during traffic bursts.** Check allocation stalls, free heap near the burst, concurrent GC CPU and container CPU limits. Pause time alone misses a waiting allocator.
2. **G1 has occasional long pauses but meets the service SLO with more throughput.** Keep the SLO and throughput in view; the lower ZGC pause metric alone does not establish a better outcome.
3. **Both collectors run near `-Xmx` after collection.** Inspect retained objects and paths to roots. A collector change cannot reclaim a reachable cache or dataset.

<details class="lesson-check"><summary>A reference still names Order's old address after concurrent relocation. Why can Java use it safely?</summary><p>ZGC's load path checks reference state. If remapping is needed, the barrier can use relocation or forwarding information to resolve a usable current reference before the access proceeds. The collector also coordinates the old location's lifetime.</p></details>

<details class="lesson-check"><summary>Why does Generational ZGC need a store barrier when it already has load barriers?</summary><p>The load path makes a reference usable when read. A store can create an old-to-young edge or affect marking, and young collection must know about such changes. The two operations protect different invariants.</p></details>

<details class="lesson-check"><summary>ZGC pauses are short, but request latency rises as allocation rate doubles. What should you examine first?</summary><p>Look for allocation stalls and shrinking heap headroom, then compare concurrent GC CPU with available CPU and the retained live set. Short global pauses do not rule out waiting for space.</p></details>

G1 and ZGC both preserve the same Java-level object graph while physical locations change. G1 makes normal evacuation consistent in a pause; ZGC resolves references through concurrent relocation and barriers. **Next:** [Lesson 48](/courses/jvm/zgc-concurrent-relocation-protocol) follows one object through forwarding, load-barrier slow paths and reference repair.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on Daily JVM Byte #47 and its approved review. Addresses, timelines, rates, scenarios and diagrams are illustrative; the comparison commands were not executed for this lesson. Barrier and relocation behavior describes JDK 25 HotSpot Generational ZGC and G1, not a fixed Java reference layout or universal JVM guarantee.</p><ul><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/z-garbage-collector.html">Oracle JDK 25 ZGC guide</a></li><li><a href="https://openjdk.org/jeps/490">JEP 490: Remove the Non-Generational ZGC Mode</a></li><li><a href="https://openjdk.org/jeps/439">JEP 439: Generational ZGC</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html">Oracle JDK 25 G1 collector guide</a></li></ul></details>
