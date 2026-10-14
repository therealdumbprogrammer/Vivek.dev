---
title: GC barriers inside JIT-generated machine code
summary: Trace a Java reference access through bytecode, C2's collector-specific barriers, optimized machine code and mutator-side cost.
course: jvm
lessonSlug: gc-barriers-in-jit-code
module: HotSpot Internals
order: 490
sourceByte: byte-049
draft: true
prerequisites:
  - zgc-concurrent-relocation-protocol
jdk: JDK 25 · C2, G1 and Generational ZGC
---

[Lesson 48](/courses/jvm/zgc-concurrent-relocation-protocol) followed an `Order` through concurrent relocation. The load barrier that helps a Java thread reach its current location must run somewhere. This lesson follows an ordinary field access from Java through HotSpot's optimizing compiler, **C2**, into the machine code executed by that Java thread.

```java
class Customer { Order latestOrder; }
void update(Customer customer, Order order) {
    customer.latestOrder = order;
}
```

The important bytecode is `putfield Customer.latestOrder`. The compiled operation needs a reference store, but the selected collector may also require bookkeeping around it. G1 can need a pre-write SATB action and a post-write card action. Generational ZGC has its own reference load and store protocols. <mark>Some GC work runs in the mutator's generated instructions, not only on background collector threads.</mark>

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable Java to machine code path"><a href="/images/courses/jvm/java-putfield-to-machine-code.svg" aria-label="Open Java to machine code diagram"><img src="/images/courses/jvm/java-putfield-to-machine-code.svg" alt="Java reference assignment becomes putfield bytecode, C2 memory operations with collector barrier logic, then optimized machine code run by an application thread." width="1080" height="430" /></a><figcaption>The drawing shows the compilation relationship, not a fixed instruction listing.</figcaption></figure>

## How C2 receives collector-specific behavior

HotSpot's shared **BarrierSet** abstraction lets collectors define reference-access behavior. C2 has a corresponding `BarrierSetC2` layer; G1 and ZGC supply `G1BarrierSetC2` and `ZBarrierSetC2`. C2 works with an intermediate representation (IR) of loads, stores, control flow and memory effects. Collector logic participates as accesses are built, optimized and lowered toward machine code. It is misleading to picture a naïve pass that appends a fixed barrier after compilation is finished.

The resulting code depends on the collector, access type and what C2 can prove. A primitive `int` load generally has no object-reference relocation to resolve. An object-reference load can need a barrier; weak references and atomic or native reference accesses have different access semantics and may use specialized paths. Reference stores likewise depend on destination, collector phase and optimization. The interpreter and C1 also implement the chosen collector's required access semantics when a method has not been compiled by C2.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable C2 barrier architecture"><a href="/images/courses/jvm/hotspot-barrierset-architecture.svg" aria-label="Open BarrierSet architecture diagram"><img src="/images/courses/jvm/hotspot-barrierset-architecture.svg" alt="C2 memory access IR uses a shared BarrierSetC2 interface, with G1BarrierSetC2 and ZBarrierSetC2 supplying different collector behavior before machine code generation." width="1080" height="460" /></a><figcaption>Barrier choices are integrated with compilation and optimization.</figcaption></figure>

## G1 surrounds a reference store for two different reasons

Imagine `customer.latestOrder` currently contains `oldOrder`, and the method stores `newOrder`. During G1 concurrent marking, the **SATB pre-write barrier** may preserve the overwritten, non-null reference to `oldOrder` so marking can account for the logical snapshot. The action is conditional: if marking is inactive or the old value is null, the enqueue work is unnecessary. The normal Java store then updates the field.

After the store, G1's **post-write barrier** may dirty a card, a coarse piece of metadata covering a small heap address range. This helps maintain remembered information about references crossing relevant region boundaries, so a later collection can inspect incoming edges without scanning the whole heap. Conditions can avoid work when the edge cannot require it or the card is already in the needed state. SATB and card bookkeeping protect separate invariants; their costs and elimination opportunities differ.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable G1 reference store"><a href="/images/courses/jvm/g1-pre-store-post-barriers.svg" aria-label="Open G1 store sequence diagram"><img src="/images/courses/jvm/g1-pre-store-post-barriers.svg" alt="G1 optionally records the overwritten old reference for SATB marking, performs the Java reference store, then conditionally marks a card for cross-region tracking." width="1080" height="430" /></a><figcaption>Pre-write marking and post-write remembered information serve different collection tasks.</figcaption></figure>

## ZGC makes loaded references usable

For `Order order = customer.latestOrder`, ZGC's generated load path can check whether the reference is usable. A common fast path continues in compiled code. A less common path performs the required processing, potentially resolving forwarding information during relocation, before the Java code uses the object. Generational ZGC also uses store barriers for marking and generation-related invariants. A store is not a universal pre/store/post sequence borrowed from G1.

The fast path still occupies instructions and registers and may read metadata. A slow path can branch to a stub or runtime work, and mutator assistance can add more latency. Its exact code depends on JDK, platform, phase and access kind. <mark>A tiny global GC pause does not imply a zero-cost reference access.</mark>

## When C2 can remove barrier work

Consider the first reference write into a newly allocated `Holder` whose field is known to contain null:

```java
Holder holder = new Holder();
holder.value = order;
consume(holder);
```

G1's `g1_can_remove_pre_barrier(...)` recognizes cases in which C2 can establish that the overwritten value is null, so recording an old reference for SATB would have no effect. The relevant proof concerns the **pre** barrier; it does not automatically remove every post-store action. The JDK 25 [G1 C2 implementation](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/g1/c2/g1BarrierSetC2.cpp) contains this check.

If escape analysis proves `Holder` need not exist as a heap object, **scalar replacement** can eliminate the physical allocation and its field store. With no heap reference store, its associated GC barrier work can disappear too. This is a stronger optimization than merely simplifying one barrier. It is conditional on a valid compiler proof; `consume(holder)` might cause escape and prevent it.

The JDK 25 [ZGC C2 source](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/z/c2/zBarrierSetC2.cpp) includes tightly coupled allocation handling (`C2_TIGHTLY_COUPLED_ALLOC`) and a `ZBarrierElided` state for cases where barrier work can be omitted under the compiler's conditions. These are examples of a general rule: <mark>C2 may remove barrier work only when it preserves the collector's invariant.</mark> The fact that GC bookkeeping is invisible to Java source is not a sufficient proof.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable barrier elimination cases"><a href="/images/courses/jvm/gc-barrier-elimination.svg" aria-label="Open barrier elimination diagram"><img src="/images/courses/jvm/gc-barrier-elimination.svg" alt="A first store to a known-null field can omit G1's SATB pre-barrier; scalar replacement can remove the heap allocation, store, and associated barriers entirely." width="1080" height="480" /></a><figcaption>Eliminating one conditional pre-barrier and eliminating a physical store are distinct proofs.</figcaption></figure>

## GC barriers and Java ordering have different jobs

A GC barrier protects marking, remembered information or relocation. A Java Memory Model `volatile` access has visibility and ordering requirements, which may lead to machine ordering operations or fences. A volatile reference field can require both kinds of work. The compiler may implement them efficiently together where legal, but GC barrier and memory-ordering fence are not synonyms. Neither turns an ordinary unsynchronized field access into a volatile one.

## What the instructions cost in a service

Barrier cost includes extra instructions and register pressure, branches, metadata or card-table memory traffic, cache effects, and occasional runtime slow paths. A graph traversal dominated by reference loads exposes a different profile from a primitive arithmetic loop; frequent reference updates can expose G1 bookkeeping. G1 and ZGC trade pause exposure, concurrent CPU, mutator-side work and throughput differently. The right comparison is a controlled workload with the same heap, warm-up, hardware and request mix, measuring throughput and tail latency as well as pauses.

Ordinary GC logs and Java Flight Recorder events can show cycles, pauses, allocation and some collector activity, but they do **not** precisely count every barrier executed in generated code. A controlled JMH microbenchmark can isolate a suspected hot path, while whole-service measurements reveal whether the cost matters in production. Inspect generated machine code only when needed to answer a specific hypothesis; `PrintAssembly` requires an available machine-code disassembler and configuration support. Bytecode listings alone cannot establish the final instruction sequence.

## Read the source from shared access to collector specialization

Start in [shared `barrierSetC2.cpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/shared/c2/barrierSetC2.cpp) to see the common C2 access infrastructure. Follow a reference store through [G1's C2 implementation](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/g1/c2/g1BarrierSetC2.cpp), separating SATB pre-write and card post-write behavior and finding `g1_can_remove_pre_barrier`. Then read [ZGC's C2 implementation](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/z/c2/zBarrierSetC2.cpp) for load/store specialization and barrier-elision cases. This is a source-reading trail, not a claim that every compiled access calls these C++ functions at runtime.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable complete barrier compilation path"><a href="/images/courses/jvm/gc-barrier-complete.svg" aria-label="Open complete barrier path diagram"><img src="/images/courses/jvm/gc-barrier-complete.svg" alt="Java source becomes bytecode, C2 memory access IR, collector-specific optimized barriers, then machine code with fast and occasional slow paths." width="1080" height="430" /></a><figcaption>The whole path explains why collector choice changes code executed by Java threads.</figcaption></figure>

## Check your reasoning

<details class="lesson-check"><summary>Why can `putfield` become more than a reference store?</summary><p>The chosen collector may need mutator-side marking or remembered-reference bookkeeping around the store.</p></details>
<details class="lesson-check"><summary>What does G1's SATB pre-barrier preserve, and how does that differ from its post-barrier?</summary><p>It conditionally records an overwritten old reference for concurrent marking. The post-barrier tracks relevant modified cards for incoming-reference discovery.</p></details>
<details class="lesson-check"><summary>Why may a first write to a new null field omit G1's pre-barrier?</summary><p>There is no non-null overwritten reference to record, if C2 can prove the field's prior value.</p></details>
<details class="lesson-check"><summary>When can scalar replacement remove more work than a barrier-specific optimization?</summary><p>When it removes the physical object and its heap store, the corresponding store barriers are unnecessary too.</p></details>
<details class="lesson-check"><summary>Do short GC pauses or GC logs prove barriers are cheap?</summary><p>No. Barriers execute in mutator paths and their individual executions are not precisely counted by normal logs. Measure application behavior and inspect generated code for a focused hypothesis.</p></details>

The path is now complete: **Java source → bytecode → C2 memory-access IR → collector-specific barriers and optimization → machine code → fast or slow execution paths**. [Lesson 50](/courses/jvm/measuring-gc-overhead), *Measuring GC overhead beyond pause times*, applies this model to throughput, concurrent GC CPU, allocation stalls and request latency.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on Daily JVM Byte #49 and its approved review. Code and pipeline diagrams are illustrative; no JMH benchmark or machine-code inspection was run for this lesson. The examples describe JDK 25 HotSpot C2 with G1 or Generational ZGC; other tiers retain GC correctness with their own implementations.</p><ul><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/shared/c2/barrierSetC2.cpp">JDK 25 shared BarrierSetC2</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/g1/c2/g1BarrierSetC2.cpp">JDK 25 G1BarrierSetC2</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/z/c2/zBarrierSetC2.cpp">JDK 25 ZBarrierSetC2</a></li></ul></details>
