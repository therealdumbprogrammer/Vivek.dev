---
title: Native memory — why -Xmx is not your process limit
summary: Account for the heap, HotSpot native memory, and library allocations without confusing JVM reports with process RSS.
course: jvm
lessonSlug: native-memory-architecture
module: Native Memory
order: 310
sourceByte: byte-031
draft: true
prerequisites: [reading-gc-logs-jdk-25]
jdk: JDK 25 · HotSpot Native Memory Tracking
---

Your GC logs show a stable post-collection heap, yet the process keeps growing until its container is killed. [Lesson 30](/courses/jvm/reading-gc-logs-jdk-25) taught us how to reconstruct heap behavior from collection events. Now we need to widen the boundary: an operating system runs a **process**, not a Java heap.

<mark>`-Xmx` limits the Java heap; it does not limit the entire JVM process or its container footprint.</mark>

## Draw the process boundary

A useful first model has three parts: the Java heap; native memory managed by HotSpot, the JVM implementation; and native memory allocated through JDK libraries, application code, or other libraries. All can contribute to process memory. A heap chart covers only the first part.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable JVM process memory map"><a href="/images/courses/jvm/native-process-memory-map.svg" aria-label="Open JVM process memory map"><img src="/images/courses/jvm/native-process-memory-map.svg" alt="One JVM process contains a Java heap, HotSpot native areas such as Metaspace, Code Cache, stacks and GC structures, plus JDK and application native allocations." width="900" height="450" /></a><figcaption>Memory outside the heap still belongs in the process and container budget.</figcaption></figure>

Consider an **illustrative inventory**, not a sizing rule:

| Area | Example amount |
| --- | ---: |
| Java heap | 4.0 GB |
| Metaspace and class space | 300 MB |
| Code Cache | 150 MB |
| Platform-thread stacks | 500 MB |
| GC structures | 250 MB |
| Direct buffers | 1.0 GB |
| Other native allocations | 300 MB |

These example amounts sum to 6.5 GB. They are not a prediction of RSS: the rows can mix reserved, committed, and resident measurements unless each is defined. They show why a `-Xmx4g` configuration cannot by itself make a 4 GB container safe. Budget heap, JVM native memory, library and application native memory, and headroom under the container limit. [JDK 25 NMT guide](https://docs.oracle.com/en/java/javase/25/vm/java-virtual-machine-guide.pdf)

<aside class="lesson-callout" data-kind="important" aria-label="Important"><p class="callout-label">Important</p><p>A healthy heap graph does not establish a healthy process-memory footprint. First identify which boundary the graph measures.</p></aside>

## Where the additional memory goes

**Metaspace** holds much of HotSpot's class metadata, such as runtime class and method structures. With compressed class pointers, a distinct **Compressed Class Space** holds `Klass` structures. The Java `Class` mirror is a heap object; it is not the whole VM-side representation. We will follow class-loader lifetime in [Lesson 32](/courses/jvm/metaspace-internals).

**Code Cache** stores compiled machine code and runtime stubs. The C1 and C2 compilers introduced earlier turn hot bytecode into native instructions; those instructions need non-heap process memory. Compiler working state and other JVM internals also allocate native memory. A later lesson will examine code lifetime and pressure in detail.

Each **platform thread** has a native stack. `-Xss` influences its stack size, so a large platform-thread population can reserve substantial virtual address space. But multiplying thread count by `-Xss` does **not** give RSS: reserved address space, committed pages, and pages currently resident in physical memory are different. Virtual threads do not each permanently own a dedicated native stack. Their stack state is primarily heap-resident stack chunks while unmounted; carrier platform threads still have native stacks. [JEP 444](https://openjdk.org/jeps/444)

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable platform and virtual thread memory comparison"><a href="/images/courses/jvm/platform-vs-virtual-thread-memory.svg" aria-label="Open platform and virtual thread memory diagram"><img src="/images/courses/jvm/platform-vs-virtual-thread-memory.svg" alt="Platform threads each have a native stack; virtual threads can store unmounted stack chunks on the heap while their carrier platform threads retain native stacks." width="900" height="450" /></a><figcaption>Virtual threads change stack ownership, but carrier stacks remain part of process memory.</figcaption></figure>

Collectors need structures beyond object space. Depending on collector and phase, these include card tables, remembered sets, marking bitmaps and queues, region or page metadata, worker structures, and relocation metadata. G1's remembered sets and ZGC's relocation machinery are examples. Thus `-Xmx8g` never means the entire process is bounded at 8 GB.

## Direct and mapped memory crosses the heap boundary

`ByteBuffer.allocateDirect(...)` returns a Java wrapper on the heap while its backing storage is outside the ordinary Java heap. A heap dump can show the wrapper and its reachability without accounting for all backing bytes in heap occupancy. `-XX:MaxDirectMemorySize` can constrain some direct-buffer allocations; it is not a universal native-memory ceiling. Memory-mapped buffers add file-backed mappings with their own residency behavior. JNI code and native libraries can allocate or map memory independently. [ByteBuffer API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/ByteBuffer.html)

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable direct buffer boundary"><a href="/images/courses/jvm/direct-buffer-memory.svg" aria-label="Open direct buffer diagram"><img src="/images/courses/jvm/direct-buffer-memory.svg" alt="A small DirectByteBuffer wrapper in the Java heap points to backing bytes outside the heap; a heap dump and process memory report see different parts." width="900" height="450" /></a><figcaption>The wrapper's heap size does not measure its backing storage.</figcaption></figure>

## Three quantities and three accounting layers

**Reserved** means an address range is set aside. **Committed** means backing has been made available for use. **Resident**, often expressed as RSS, means pages currently present in physical RAM under an OS accounting rule. A large reservation need not be a large physical-memory cost, and committed bytes need not equal resident bytes. Shared and file-backed mappings complicate a process total further.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable reserved committed resident diagram"><a href="/images/courses/jvm/native-reserved-committed-rss.svg" aria-label="Open memory quantity diagram"><img src="/images/courses/jvm/native-reserved-committed-rss.svg" alt="A large reserved address range contains a smaller committed portion and a possibly different set of resident physical pages." width="900" height="450" /></a><figcaption>Use the same quantity and time window before comparing memory figures.</figcaption></figure>

There are also three **accounting layers**:

1. JVM/Java memory-pool metrics describe selected logical areas such as heap, Metaspace, and Code Cache.
2. **Native Memory Tracking (NMT)** reports HotSpot-managed allocations and reservations that its instrumentation knows about, grouped by category.
3. OS process and container tools report mappings, RSS, or charged memory under their own rules. Examples include Activity Monitor, `top`, Kubernetes metrics, and Linux `/proc`.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable accounting layers"><a href="/images/courses/jvm/native-memory-accounting-layers.svg" aria-label="Open memory accounting layers"><img src="/images/courses/jvm/native-memory-accounting-layers.svg" alt="JVM pool metrics, HotSpot NMT, and OS RSS or mappings are three overlapping views with different coverage and units." width="900" height="450" /></a><figcaption>Tools can legitimately disagree because their scopes and accounting rules differ.</figcaption></figure>

## Use NMT for the memory it can see

Enable NMT when starting the JVM with `-XX:NativeMemoryTracking=summary` or `-XX:NativeMemoryTracking=detail`. It cannot simply be started later with `jcmd` if the process began with NMT off. Summary groups allocations into areas such as `Class`, `Thread`, `Code`, and `GC`; detail adds allocation call-site and virtual-memory-map granularity. Tracking has overhead, so choose its level deliberately. [JDK 25 NMT guide](https://docs.oracle.com/en/java/javase/25/vm/java-virtual-machine-guide.pdf)

```text
jcmd <pid> VM.native_memory summary
jcmd <pid> VM.native_memory detail
jcmd <pid> VM.native_memory baseline
jcmd <pid> VM.native_memory summary.diff
jcmd <pid> VM.native_memory detail.diff
```

Take a baseline during a representative period, then compare a later report while the same workload runs. `summary.diff` identifies growing categories; `detail.diff` helps locate call sites when detail tracking was enabled at startup. The commands inspect a live local process; the output and growth rates here are deliberately not fabricated. [JDK 25 jcmd](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html)

<mark>NMT explains tracked HotSpot/JVM-managed memory; its total is not a complete account of process RSS.</mark>

<aside class="lesson-callout" data-kind="production" aria-label="Production note"><p class="callout-label">Production note</p><p>NMT does not track third-party native code or all JDK class-library native allocations. A difference between NMT totals and RSS is expected and is not, by itself, broken accounting. Compare categories and trends, then inspect the remaining process mappings with OS tools.</p></aside>

## Diagnose a rising process footprint

Start with the heap trend, using comparable GC points or pool metrics. If heap occupancy rises, investigate heap retention and allocation as in the GC block. If heap is stable while RSS rises, compare NMT baseline and diff. Growth in `Class`, `Thread`, `Code`, or `GC` gives a subsystem-specific lead. If NMT does not explain the RSS trend, inspect OS mappings and native allocators, including direct or mapped memory, JDK library allocations, JNI libraries, and other mappings. Align observations by time and workload; none of these totals is interchangeable.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable native memory diagnostic flow"><a href="/images/courses/jvm/native-memory-diagnostic-flow.svg" aria-label="Open native memory diagnostic flow"><img src="/images/courses/jvm/native-memory-diagnostic-flow.svg" alt="A rising process footprint leads first to a heap trend check, then NMT category diffs if heap is stable, then OS and native mapping analysis if NMT leaves a gap." width="900" height="450" /></a><figcaption>Choose the next tool from the memory domain that is actually growing.</figcaption></figure>

Test two conclusions before changing limits. Stable heap plus high RSS does **not** prove a heap leak. NMT total below RSS does **not** prove NMT is broken. Both follow from the boundaries we drew.

Class loading now points to Metaspace; C1/C2 compilation points to Code Cache; platform threads point to native stacks; unmounted virtual threads point mainly to heap stack chunks; G1 and ZGC point to collector structures; and NIO can point to direct or mapped storage. The next lesson follows the first of those links: how Metaspace allocation and class-loader reachability determine when native class metadata can be reclaimed.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Daily JVM Byte #31 and its reviewed draft inform this lesson. The process budget and diagrams are illustrative; no JVM workload or command output was measured here. NMT and subsystem details describe JDK 25 HotSpot, while OS residency rules vary by platform.</p><ul><li><a href="https://docs.oracle.com/en/java/javase/25/vm/java-virtual-machine-guide.pdf">JDK 25 Java Virtual Machine Guide, Native Memory Tracking</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html">JDK 25 jcmd command</a></li><li><a href="https://openjdk.org/jeps/444">JEP 444: Virtual Threads</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/ByteBuffer.html">JDK 25 ByteBuffer API</a></li></ul></details>
