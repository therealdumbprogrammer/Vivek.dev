---
title: Code Cache internals — where JIT-compiled code lives
summary: Follow compiled methods into native executable memory, inspect the metadata in an nmethod, and diagnose Code Cache pressure.
course: jvm
lessonSlug: code-cache-internals
module: Native Memory
order: 330
sourceByte: byte-033
draft: true
prerequisites: [metaspace-internals]
jdk: JDK 25 · HotSpot Code Cache
---

A service warms up, then its CPU cost per request falls. Later, with a healthy Java heap, latency rises and the compiler reports that it cannot install more code. The two observations meet in the **Code Cache**: the native memory where HotSpot keeps code it generated while the application runs.

[Lesson 32](/courses/jvm/metaspace-internals) followed loaded classes into Metaspace. Now recall the execution path from [tiered compilation](/courses/jvm/tiered-compilation): `.class` bytecode is interpreted, execution supplies profiles, and C1 or C2 may compile a method into processor instructions. The CPU needs an executable address for those instructions.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable Code Cache runtime pipeline"><a href="/images/courses/jvm/code-cache-runtime-pipeline.svg" aria-label="Open Code Cache runtime pipeline"><img src="/images/courses/jvm/code-cache-runtime-pipeline.svg" alt="Bytecode passes through interpreter profiling and C1 or C2 compilation; an nmethod enters the native Code Cache, where the CPU executes its instructions." width="900" height="450" /></a><figcaption>The Code Cache gives a runtime compilation decision an executable address.</figcaption></figure>

<mark>The Code Cache is the native-memory home of HotSpot's runtime compilation decisions.</mark> It sits outside the Java heap and its `-Xmx` limit. More installed compiled methods can use more native process memory; the amount reserved for this subsystem is principally bounded by `-XX:ReservedCodeCacheSize`. Reservation, committed pages, and resident pages remain different quantities, as in [Lesson 31](/courses/jvm/native-memory-architecture).

## The installed unit is an `nmethod`

Consider a hot `price(Order)` method. The interpreter can execute its bytecode first. A profiled compiled version may gather receiver types and branch behavior. A later version can use those observations to inline calls and optimize. Each installed compiled version is a HotSpot **`nmethod`**, not an anonymous run of instruction bytes.

An `nmethod` contains executable instructions and entry points, plus relocation information, exception handling data, OopMaps (maps of object-reference locations), safepoint and deoptimization information, dependencies, and scope or debug metadata. The exact internal layout is a HotSpot implementation detail. The categories explain why a compiled method can cooperate with the rest of the VM. [HotSpot `nmethod` source](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/code/nmethod.hpp)

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable nmethod anatomy"><a href="/images/courses/jvm/code-cache-nmethod-anatomy.svg" aria-label="Open nmethod anatomy"><img src="/images/courses/jvm/code-cache-nmethod-anatomy.svg" alt="An nmethod groups machine instructions and entry points with relocation and exception data, OopMaps, safepoint and deoptimization information, dependencies, and scope metadata." width="900" height="450" /></a><figcaption>The supporting data lets HotSpot interpret optimized machine execution as managed Java execution.</figcaption></figure>

Why keep those maps? GC must find references held in a running compiled frame. A stack walker or profiler must map a program counter back to Java methods, including inlined calls. Exceptions need a suitable continuation. Deoptimization must rebuild Java state when an optimization assumption fails. Dependencies help identify code affected by class changes or unloading. These tasks use related metadata, though they do not all use the same API or record.

<mark>An `nmethod` bridges optimized native execution and the rest of HotSpot.</mark> Lesson 34 will use that bridge to walk stacks and find precise GC roots.

## Tiered compilation has a physical footprint

One Java method can have multiple compiled incarnations over time. For `price(Order)`, HotSpot might first install profiled C1 code, then install more optimized code informed by those profiles. The newer version can be chosen for future calls while an older version is still relevant to a frame already running. This is one reason Code Cache occupancy does not equal the number of source methods.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable tiered compilation and Code Cache"><a href="/images/courses/jvm/tiered-compilation-code-cache.svg" aria-label="Open tiered compilation and Code Cache"><img src="/images/courses/jvm/tiered-compilation-code-cache.svg" alt="One Java method gains an interpreted execution path, a profiling compiled incarnation, and a later optimized incarnation in the Code Cache." width="900" height="450" /></a><figcaption>One method can leave several compiled artifacts during its adaptive lifetime.</figcaption></figure>

In a normal JDK 25 tiered configuration, HotSpot can divide the cache into **non-method**, **profiled**, and **non-profiled** code heaps. `SegmentedCodeCache` is enabled by default when tiered compilation is enabled and the reserved cache is at least 240 MB; other configurations can use a different layout. [JDK 25 `java` options](https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html)

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable segmented Code Cache"><a href="/images/courses/jvm/segmented-code-cache.svg" aria-label="Open segmented Code Cache"><img src="/images/courses/jvm/segmented-code-cache.svg" alt="A configuration-dependent Code Cache layout separates non-method runtime support, profiled compiled methods, and non-profiled compiled methods." width="900" height="450" /></a><figcaption>Segmentation groups code by role and expected lifetime; it is a configuration-dependent HotSpot layout.</figcaption></figure>

**Profiled code** still gathers information useful for later optimization, commonly in lower tier C1 output. **Non-profiled code** is often a more mature optimized version, commonly higher tier or C2 output. The categories describe code behavior, not an absolute C1 versus C2 partition: some C1 code is non-profiled. **Non-method code** includes interpreter support, runtime stubs and adapters, and other JVM-generated executable code that is not an ordinary compiled Java method. The segments have separate capacities, so one heap can feel pressure even when the total looks comfortable.

## Losing validity is not freeing storage

Compilation can speculate about receiver types or class relationships while preserving Java behavior through guards and fallback. A failed assumption, a dependency change, class unloading or redefinition, or a better replacement compilation can make an older `nmethod` unsuitable for new calls. HotSpot may then redirect future entry or deoptimize affected frames. [Lesson 15](/courses/jvm/speculative-optimization-deoptimization) developed the recovery path.

An already executing frame may still point into that older code. HotSpot therefore separates the decision to stop entering a version from the decision that its storage is safe to reuse. The exact states and sweeper timing are internal details; the lifetime rule matters more here.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable nmethod lifecycle"><a href="/images/courses/jvm/code-cache-nmethod-lifecycle.svg" aria-label="Open nmethod lifecycle"><img src="/images/courses/jvm/code-cache-nmethod-lifecycle.svg" alt="A compiled nmethod is installed, used, superseded or invalidated, kept while active frames may depend on it, and eventually reclaimed for reuse." width="900" height="450" /></a><figcaption>New calls can stop using a version before its storage becomes reusable.</figcaption></figure>

<mark>Invalidation does not imply immediate reclamation.</mark> A running frame can still require the old code and its maps. This explains why a burst of invalidations does not instantly produce an equal amount of free Code Cache space.

## Recognize pressure before changing a limit

Code Cache pressure is primarily a compilation and performance problem. The Java heap and GC may look normal while the compiler becomes constrained, more work stays interpreted or uses older compiled versions, CPU rises, and throughput or latency deteriorates. The exact response depends on which code heap is full and the JDK's code sweeping and compiler policy. Raising `-Xmx` does not add Code Cache capacity.

<aside class="lesson-callout" data-kind="production" aria-label="Production note"><p class="callout-label">Production note</p><p>If heap and GC are healthy while compilation warnings and CPU cost rise, inspect Code Cache occupancy and compiler activity. A larger Java heap does not supply executable code space.</p></aside>

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable Code Cache pressure"><a href="/images/courses/jvm/code-cache-pressure-internals.svg" aria-label="Open Code Cache pressure"><img src="/images/courses/jvm/code-cache-pressure-internals.svg" alt="Code Cache pressure constrains new compilation, leaving more execution in slower paths and potentially increasing CPU and latency while heap metrics stay healthy." width="900" height="450" /></a><figcaption>The symptom chain points toward JIT capacity, even when heap occupancy gives no warning.</figcaption></figure>

Start with the subsystem, then decide whether a limit is the issue. On the target JDK, ask `jcmd <pid> help` for command availability and options:

```text
jcmd <pid> Compiler.codecache
jcmd <pid> Compiler.CodeHeap_Analytics
jcmd <pid> Compiler.codelist
jcmd <pid> Compiler.queue
jcmd <pid> VM.native_memory summary
```

`Compiler.codecache` shows heap layout and usage; `Compiler.CodeHeap_Analytics` can examine used and free space; `Compiler.codelist` identifies installed compiled methods; `Compiler.queue` shows pending compilation work. NMT's broader `Code` category helps place this memory in the process budget when NMT was enabled at startup. For a deeper time sequence, use compilation and Code Cache logging, such as `-Xlog:codecache*` and compiler logging supported by the target JVM. Diagnostic commands can have runtime cost, so choose detail appropriate to the incident. [JDK 25 `jcmd`](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html)

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable Code Cache diagnosis"><a href="/images/courses/jvm/code-cache-diagnostics.svg" aria-label="Open Code Cache diagnosis"><img src="/images/courses/jvm/code-cache-diagnostics.svg" alt="A diagnosis moves from compiler warning and codecache occupancy to heap analytics, installed code and queue, then broader NMT Code accounting and configuration decisions." width="900" height="450" /></a><figcaption>Inspect occupancy, fragmentation and compilation demand before changing `ReservedCodeCacheSize`.</figcaption></figure>

<aside class="lesson-callout" data-kind="important" aria-label="Important"><p class="callout-label">Important</p><p>Increase <code>-XX:ReservedCodeCacheSize</code> only after evidence shows that capacity is the constraint. A stalled queue, invalidation churn, or one crowded segment can need a different explanation.</p></aside>

## Check your reasoning

If `-Xmx` rises but `ReservedCodeCacheSize` stays fixed, should code installation have more room? No. They bound different memory areas. If a C2 version replaces a C1 version, may both still occupy the cache for a while? Yes: an active frame can require the old version before reclamation is safe.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable complete Code Cache model"><a href="/images/courses/jvm/code-cache-complete-internals.svg" aria-label="Open complete Code Cache model"><img src="/images/courses/jvm/code-cache-complete-internals.svg" alt="Class bytes pass through the class loader and Metaspace; bytecode runs in the interpreter, feeds C1 or C2, becomes an nmethod in the Code Cache, and supplies CPU instructions." width="900" height="450" /></a><figcaption>The class and execution paths meet when a loaded method becomes executable native code.</figcaption></figure>

The full path is `.class → Class Loader → Metaspace → bytecode → Interpreter → C1/C2 → nmethod → Code Cache → CPU`. Next, [Lesson 34](/courses/jvm/thread-stacks-stack-walking) follows that CPU execution onto a thread stack and asks how HotSpot can still understand it.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Daily JVM Byte #33 and its reviewed scope inform this lesson. The `price(Order)` path and diagrams are illustrative; no live JVM commands or workload measurements were performed. Code heaps, nmethods, and sweeper behavior describe JDK 25 HotSpot, not a JVM specification requirement; options and diagnostics can vary by build.</p><ul><li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html">JDK 25 java command and Code Cache options</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html">JDK 25 jcmd commands</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/code/nmethod.hpp">OpenJDK JDK 25 nmethod definition</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/vm/java-virtual-machine-guide.pdf">JDK 25 Native Memory Tracking guide</a></li></ul></details>
