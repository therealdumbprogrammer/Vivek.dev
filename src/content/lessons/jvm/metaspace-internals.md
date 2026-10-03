---
title: Metaspace internals — class-loader arenas, unloading, and class-loader leaks
summary: Follow class metadata from a loader into Metaspace chunks, then diagnose why retained loaders prevent native memory reclamation.
course: jvm
lessonSlug: metaspace-internals
module: Native Memory
order: 320
sourceByte: byte-032
draft: true
prerequisites: [native-memory-architecture]
jdk: JDK 25 · HotSpot Metaspace and class unloading
---

A service reloads plugins repeatedly. Its heap settles after each GC, yet the `Class` category in Native Memory Tracking keeps rising. [Lesson 31](/courses/jvm/native-memory-architecture) placed Metaspace in the larger process budget. To explain this pattern, follow the **loader that owns the metadata**, not just an individual class name.

<mark>Class-loader lifetime is the normal reclamation boundary for Metaspace allocations.</mark>

## A Java class has two related representations

`Example.class` refers to a `java.lang.Class` **mirror** on the Java heap. HotSpot also needs VM-side information to execute the type: `Klass` structures, methods, field descriptions, runtime constant-pool information, and inheritance and interface relationships. Much of that metadata occupies native Metaspace. A heap dump can show a mirror and the references retaining a loader; it does not measure the full native metadata footprint. [HotSpot Metaspace](https://wiki.openjdk.org/display/HotSpot/Metaspace)

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable class mirror and Metaspace diagram"><a href="/images/courses/jvm/class-mirror-to-metaspace.svg" aria-label="Open class mirror to Metaspace diagram"><img src="/images/courses/jvm/class-mirror-to-metaspace.svg" alt="The Java heap contains a Class mirror and class loader, while HotSpot's related Klass, methods and constant-pool metadata occupy native Metaspace." width="900" height="450" /></a><figcaption>The heap mirror and native metadata describe the same loaded type at different layers.</figcaption></figure>

The class loader supplies the useful ownership boundary. A plugin loader may define many classes. HotSpot normally groups their metadata lifetime with that loader, so reclamation can occur in bulk when the loader and its classes become unloadable. It does not ordinarily free each method's metadata as soon as that method becomes unused. Special class forms, including hidden classes, add implementation nuance; the loader-scoped model remains the right starting point.

## Follow one allocation into an arena

Here is the conceptual HotSpot path:

```text
Java ClassLoader
  → ClassLoaderData
  → ClassLoaderMetaspace
  → MetaspaceArena
  → Metachunks
  → Metaspace virtual memory
```

`ClassLoaderData` is HotSpot's native bookkeeping for a loader's classes and lifetime. Its `ClassLoaderMetaspace` provides class and non-class allocation contexts; `MetaspaceArena` serves many small metadata allocations from larger **Metachunks**. An arena can advance through free space in a chunk with bump-pointer-like work, similar in spirit to the cheap allocation path of a TLAB. The analogy concerns allocation speed, not where objects live: a TLAB is inside the Java heap, while these chunks back VM metadata. Chunk sizes and growth policies are implementation details. [JEP 387](https://openjdk.org/jeps/387), [HotSpot Metaspace implementation](https://github.com/openjdk/jdk/tree/master/src/hotspot/share/memory/metaspace)

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable Metaspace allocation path"><a href="/images/courses/jvm/metaspace-allocation-path.svg" aria-label="Open Metaspace allocation path"><img src="/images/courses/jvm/metaspace-allocation-path.svg" alt="A Java ClassLoader connects to ClassLoaderData, ClassLoaderMetaspace, an arena, metachunks, and reserved Metaspace virtual memory." width="900" height="450" /></a><figcaption>Chunk-backed arenas make repeated small metadata allocations cheap and tie their eventual release to loader lifetime.</figcaption></figure>

Suppose a reload creates loader A with 400 classes, then loader B with 400 replacement classes. Each loader accumulates arena allocations. If A becomes unloadable, its arena can return chunks for reuse and potentially release committed backing. If a registry still references A, both generations stay alive even if application code only calls B. This is why bulk lifetime is operationally important.

## Unloading connects heap reachability to native reclamation

The garbage collector determines whether a loader and its class graph remain reachable. When the loader becomes unloadable and the collector performs class unloading, HotSpot can retire its `ClassLoaderData` and associated Metaspace allocation state. The chunks can be reused; unused committed portions can be uncommitted under Elastic Metaspace. The exact timing depends on the collector, GC cycle, class-unloading configuration, and active use of classes. [JEP 387](https://openjdk.org/jeps/387)

<mark>Metaspace is native memory, yet Java heap reachability can determine when its class metadata becomes reclaimable.</mark>

Metaspace pressure can also induce a GC or class-unloading opportunity when a high-water threshold is reached. The trigger does not mean Metaspace bytes are ordinary heap objects. It means GC is part of deciding which loaders and classes can be released. Raising `-XX:MaxMetaspaceSize` changes the allowed limit; it does not change the reachability of a retained loader. [HotSpot Metaspace](https://wiki.openjdk.org/display/HotSpot/Metaspace)

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable Elastic Metaspace reclamation"><a href="/images/courses/jvm/elastic-metaspace-reclamation.svg" aria-label="Open Elastic Metaspace reclamation"><img src="/images/courses/jvm/elastic-metaspace-reclamation.svg" alt="After a loader becomes unloadable, its arena releases chunks for reuse or merging and free committed granules may be uncommitted; a retained loader blocks that path." width="900" height="450" /></a><figcaption>Allocator elasticity can return unused backing after unloading; it cannot reclaim a live loader's metadata.</figcaption></figure>

## Compressed Class Space has a separate role

Recall the compressed class pointer in an object header from the object-layout lesson. With compressed class pointers enabled, HotSpot places `Klass` structures in a distinct **Compressed Class Space** (CCS), while other class metadata uses non-class Metaspace. The exact pointer encoding is an implementation detail; the useful connection is that an object's class pointer must locate its VM-side class description. [JEP 387](https://openjdk.org/jeps/387)

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable compressed class space diagram"><a href="/images/courses/jvm/compressed-class-space.svg" aria-label="Open compressed class space diagram"><img src="/images/courses/jvm/compressed-class-space.svg" alt="An object header's compressed class pointer leads to a Klass in Compressed Class Space; methods and other metadata use non-class Metaspace." width="900" height="450" /></a><figcaption>CCS is a distinct address space for class structures, not a second Java heap.</figcaption></figure>

For both non-class Metaspace and CCS, distinguish **used** metadata bytes, **committed** backing, and **reserved** virtual address range. A large reserved CCS value does not imply that amount of resident RAM. Elastic Metaspace uses variable-size chunks, chunk reuse and merging, and uncommit of unused committed memory after loaders die. These allocator improvements reduce waste after reclamation; they cannot change the lifetime of a loader that is still reachable. [JEP 387](https://openjdk.org/jeps/387)

## What a class-loader leak looks like

Imagine a plugin refresh that registers each new loader in a static cache but never removes old entries. Threads, listeners, `ThreadLocal` values, or thread context class loaders can create similar retention paths. The chain is small in heap terms: a root → registry → loader. Yet that loader may keep hundreds of classes and their native metadata alive. Repeated refreshes raise the loader and class counts, and Metaspace grows.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable class-loader retention path"><a href="/images/courses/jvm/classloader-leak.svg" aria-label="Open class-loader leak diagram"><img src="/images/courses/jvm/classloader-leak.svg" alt="A static registry holds old plugin class loaders reachable, so their ClassLoaderData and Metaspace chunks remain while new loader generations accumulate." width="900" height="450" /></a><figcaption>A small retaining path on the heap can cause a much larger native Class and Metaspace symptom.</figcaption></figure>

An ordinary heap-object leak grows retained Java objects directly. A class-loader leak may have a comparatively small Java retaining graph but a large native metadata cost. Heap analysis still matters because it identifies **why the loader is reachable**. Class histograms show heap-object counts, including loader and mirror objects, but `GC.class_histogram` is not a complete accounting of native Metaspace. [JDK 25 jcmd](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html)

<aside class="lesson-callout" data-kind="production" aria-label="Production note"><p class="callout-label">Production note</p><p>Find the reference that retains old loaders before changing the Metaspace limit. Increasing <code>-XX:MaxMetaspaceSize</code> may delay an error, but it does not repair repeated loader retention.</p></aside>

## Diagnose loader growth in a running process

Start with the Lesson 31 boundary check: heap occupancy is broadly stable but RSS rises. If NMT is enabled, a growing `Class` category in `VM.native_memory summary` or `summary.diff` narrows the search. That category is a lead, not a complete RSS measurement. Compare loader and class counts over the same period, and look for few unloads. [JDK 25 NMT guide](https://docs.oracle.com/en/java/javase/25/vm/java-virtual-machine-guide.pdf)

```text
jcmd <pid> VM.native_memory summary
jcmd <pid> VM.native_memory summary.diff
jcmd <pid> VM.classloader_stats
jcmd <pid> VM.classloaders
jcmd <pid> VM.metaspace
jcmd <pid> VM.metaspace show-loaders
jcmd <pid> VM.metaspace by-chunktype
```

`VM.classloader_stats` reports loader statistics; `VM.classloaders` shows loader hierarchy and can show classes with supported options. `VM.metaspace` gives overall Metaspace figures and supports loader, class, chunk, and virtual-space views depending on options. Ask the target JDK's `jcmd <pid> help VM.metaspace` for its exact syntax. JFR class-loading and unloading events can add the time dimension: which loader generation appeared, and did old generations unload? [JDK 25 jcmd](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html), [JFR event catalog](https://docs.oracle.com/en/java/javase/25/jfapi/)

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable Metaspace diagnostic flow"><a href="/images/courses/jvm/metaspace-diagnostic-flow.svg" aria-label="Open Metaspace diagnostic flow"><img src="/images/courses/jvm/metaspace-diagnostic-flow.svg" alt="Stable heap and rising RSS lead to NMT Class growth, increasing loader and class counts, few unloads, and heap reachability analysis of a retained loader." width="900" height="450" /></a><figcaption>Native growth identifies the subsystem; heap reachability identifies the root cause.</figcaption></figure>

The full investigation is a chain of evidence: stable heap plus rising RSS → growing NMT `Class` → increasing loader and class counts → few unloads → one or more retained loader generations → a heap root that retains them. Work backward from that root to the lifecycle bug. A large reserved CCS value alone is not proof of physical-memory pressure, and a higher Metaspace maximum should not be the first response to sustained growth.

<mark>Raising `MaxMetaspaceSize` is a limit change, not a class-loader leak repair.</mark>

## The complete lifecycle

Loading a class creates a heap mirror and VM-side metadata. HotSpot associates the metadata with `ClassLoaderData`, allocates it through a loader's Metaspace arenas and chunks, and keeps it while the loader remains needed. A later GC may establish that the loader is unloadable; class unloading retires its metadata, returns chunks for reuse, and can allow unused committed memory to be uncommitted. A retained loader interrupts that path before reclamation begins.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable complete Metaspace lifecycle"><a href="/images/courses/jvm/metaspace-complete.svg" aria-label="Open complete Metaspace lifecycle"><img src="/images/courses/jvm/metaspace-complete.svg" alt="Class loading creates a mirror and native metadata, arena allocation persists while the loader is reachable, and unloading releases chunks for reuse or uncommit." width="900" height="450" /></a><figcaption>Follow ownership from class definition to loader unreachability to chunk reclamation.</figcaption></figure>

This explains one major native-memory subsystem. The next chapter will examine **Code Cache internals**: how C1/C2 generated methods become installed nmethods, why code heaps are segmented, how compiled code is reclaimed, and what changes when Code Cache pressure rises.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Daily JVM Byte #32 and its reviewed draft inform this lesson. The plugin example and diagrams are illustrative; no live JVM command output was measured. The named allocation layers, CCS split, and Elastic Metaspace behavior describe HotSpot; class-unloading timing and command options can vary by JDK and configuration.</p><ul><li><a href="https://openjdk.org/jeps/387">JEP 387: Elastic Metaspace</a></li><li><a href="https://wiki.openjdk.org/display/HotSpot/Metaspace">OpenJDK HotSpot Metaspace</a></li><li><a href="https://github.com/openjdk/jdk/tree/master/src/hotspot/share/memory/metaspace">OpenJDK HotSpot Metaspace source</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html">JDK 25 jcmd command</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/vm/java-virtual-machine-guide.pdf">JDK 25 Native Memory Tracking guide</a></li></ul></details>
