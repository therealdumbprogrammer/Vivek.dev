---
title: Direct and mapped memory — off-heap memory outside -Xmx
summary: Separate native direct buffers from file-backed mappings, follow their lifetimes and limits, and diagnose process memory beyond the Java heap.
course: jvm
lessonSlug: direct-mapped-memory
module: Native Memory
order: 350
sourceByte: byte-035
draft: true
prerequisites: [thread-stacks-stack-walking]
jdk: JDK 25 · NIO direct and mapped memory
---

The heap chart is calm, but the process RSS keeps climbing. One likely missing piece is that some NIO buffers store their bytes outside the ordinary Java heap. There are two important mechanisms to separate:

```text
ByteBuffer.allocateDirect(...)  → explicit native direct-buffer storage
FileChannel.map(...)            → an OS virtual-memory mapping backed by a file
```

Both are outside the normal Java object heap. They differ in who provides the storage, how pages become resident, and how the memory is accounted for.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable overview of direct and mapped memory"><a href="/images/courses/jvm/direct-vs-mapped-memory.svg" aria-label="Open direct versus mapped memory diagram"><img src="/images/courses/jvm/direct-vs-mapped-memory.svg" alt="allocateDirect explicitly allocates native buffer storage; FileChannel.map creates a virtual mapping backed by a file whose pages become resident as the operating system supplies them." width="900" height="450" /></a><figcaption>“Outside the heap” names a location, not one memory-management mechanism.</figcaption></figure>

<mark>Outside-heap is a location category, not a single memory-management mechanism.</mark> [Lesson 34](/courses/jvm/thread-stacks-stack-walking) covered native thread stacks. Here we follow two storage APIs whose Java objects remain visible to the garbage collector while their contents or mappings live beyond the heap.

## A heap buffer and a direct buffer split in different places

With `ByteBuffer.allocate(...)`, both the `ByteBuffer` object and its backing `byte[]` are on the Java heap. The array follows ordinary GC reachability and reclamation. With `allocateDirect(...)`, the Java-side buffer wrapper is still a heap object, but its content occupies native memory.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable heap versus direct buffer comparison"><a href="/images/courses/jvm/heap-vs-direct-buffer.svg" aria-label="Open heap versus direct buffer diagram"><img src="/images/courses/jvm/heap-vs-direct-buffer.svg" alt="A heap ByteBuffer points to a byte array on the Java heap; a DirectByteBuffer wrapper on the heap points instead to backing bytes in native memory." width="900" height="450" /></a><figcaption>The wrapper is garbage-collected; the direct buffer's bytes are not heap bytes.</figcaption></figure>

That split helps explain direct I/O. Operating-system calls ultimately consume native-accessible memory. With a heap buffer, an implementation may need an intermediate native-accessible buffer around an I/O operation. A direct buffer gives the runtime storage it can use directly, potentially avoiding a copy to or from a temporary buffer on each call. The `ByteBuffer` API describes this as a best effort, not a guarantee that every operation is copy-free or faster.

Direct buffers also have higher allocation and deallocation costs than ordinary heap buffers. They are most plausible when a relatively large buffer stays around and is reused for many native I/O operations. Allocate, use once, and discard at high frequency can make direct buffers a poor fit. Measure the application; direct does not mean automatically faster. [JDK 25 `ByteBuffer`](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/ByteBuffer.html)

## How a direct buffer is created and reclaimed

Conceptually, `allocateDirect(capacity)` reserves capacity against the JDK's direct-buffer budget, allocates native bytes, initializes them, creates the Java wrapper, and associates cleanup with the Java-side owner. That path does substantially more work than a small heap allocation.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable direct buffer allocation path"><a href="/images/courses/jvm/direct-buffer-allocation-path.svg" aria-label="Open direct buffer allocation path"><img src="/images/courses/jvm/direct-buffer-allocation-path.svg" alt="The direct allocation path reserves buffer capacity, allocates native storage, initializes it, creates a Java wrapper and registers cleanup." width="900" height="450" /></a><figcaption>Capacity reservation and native allocation are related steps, but they are separate accounting facts.</figcaption></figure>

The wrapper is reachable like any other Java object. When its backing owner becomes unreachable, garbage collection and reference/cleaner processing can eventually invoke cleanup and release the native allocation. Assigning `null` only removes one reference; it does not synchronously free the bytes. Cleanup timing is not a deterministic resource-management API.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable direct buffer cleanup lifecycle"><a href="/images/courses/jvm/direct-buffer-cleanup.svg" aria-label="Open direct buffer cleanup diagram"><img src="/images/courses/jvm/direct-buffer-cleanup.svg" alt="A reachable Java direct-buffer owner keeps native bytes allocated; after it becomes unreachable, GC and cleanup processing eventually release the native storage." width="900" height="450" /></a><figcaption>Dropping a Java reference begins a possible path to cleanup; it is not an immediate free.</figcaption></figure>

<aside class="lesson-callout" data-kind="key-idea" aria-label="Key idea"><p class="callout-label">Key idea</p><p>Direct storage is native, but ordinary direct-buffer lifetime is tied indirectly to Java reachability. The cleanup happens <strong>eventually</strong>, after the relevant owner is unreachable and cleanup machinery gets to process it.</p></aside>

Views make “the owner” less obvious. `slice()`, `duplicate()`, and typed or read-only derived views share the original content. A view that remains reachable must keep the backing owner alive so the storage it uses cannot be released underneath it. In HotSpot's direct-buffer implementation, attachment relationships retain that ownership chain; treat the view as a dependent reference, not a separate copy of the bytes.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable direct-buffer view lifetime"><a href="/images/courses/jvm/direct-buffer-view-lifetime.svg" aria-label="Open direct-buffer view lifetime diagram"><img src="/images/courses/jvm/direct-buffer-view-lifetime.svg" alt="A slice and duplicate share the original direct buffer's native bytes and retain a dependency on the backing owner; the bytes are eligible for cleanup only after dependent views are unreachable." width="900" height="450" /></a><figcaption>A reachable view can keep native storage alive after the original variable is gone.</figcaption></figure>

This gives direct-buffer trouble two distinct shapes. **Retention** means wrappers or derived views remain reachable, so their native backing cannot be reclaimed. **Churn** means buffers are created and discarded rapidly, increasing native allocation work and cleanup/reference-processing pressure. A pool can reduce churn by reusing buffers, but an oversized or poorly bounded pool can become retention.

## Direct-buffer exhaustion has its own limit and error

The option `-XX:MaxDirectMemorySize=<size>` limits the total capacity of NIO direct-buffer allocations as accounted by the JDK. It is not a process-wide native-memory limit. Native thread stacks, Metaspace, Code Cache, arbitrary JNI/library allocations and file mappings do not all become subject to this one setting.

<mark>`MaxDirectMemorySize` limits direct-buffer capacity; it does not cap all native memory in the process.</mark>

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable direct-memory capacity limit"><a href="/images/courses/jvm/direct-memory-limit.svg" aria-label="Open direct-memory limit diagram"><img src="/images/courses/jvm/direct-memory-limit.svg" alt="The MaxDirectMemorySize budget measures NIO direct-buffer capacity, while actual native bytes and all other process memory remain separate quantities." width="900" height="450" /></a><figcaption>The configured direct-buffer budget covers one allocation domain.</figcaption></figure>

Capacity and actual reserved bytes can differ slightly. For example, an implementation may align native reservations to page boundaries while the limit accounts for requested buffer capacities. In current OpenJDK, when a reservation does not fit, the slow path can attempt cleaner/reference processing and retry before ultimately throwing an `OutOfMemoryError` for direct-buffer memory. That failure is distinct from `OutOfMemoryError: Java heap space`. Details of the slow path are implementation-specific; the key operational point is to check the exhausted domain before changing heap settings. [OpenJDK JDK 25 `Bits`](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/java.base/share/classes/java/nio/Bits.java)

## A mapped file uses the operating system's mapping machinery

`FileChannel.map(...)` establishes a virtual-memory mapping between part of a file and an address range in the process. A `MappedByteBuffer` provides access to that mapped range. This is not equivalent to asking the JDK for an anonymous native allocation with `allocateDirect`, even though the mapped buffer is also a direct buffer.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable mapped-file page behavior"><a href="/images/courses/jvm/mapped-file-pages.svg" aria-label="Open mapped-file pages diagram"><img src="/images/courses/jvm/mapped-file-pages.svg" alt="A large virtual address mapping refers to file offsets; pages accessed by the program can fault in and become resident while untouched pages need not occupy resident RAM." width="900" height="450" /></a><figcaption>A mapped range describes virtual address space; touched pages determine much of its resident footprint.</figcaption></figure>

Imagine mapping a 20 GB file. The process can have a 20 GB virtual mapping without 20 GB of resident RAM. As code touches addresses, missing pages are serviced through operating-system page faults and file-backed paging. The number of resident pages depends on access history and the OS's page-cache and reclamation behavior. Thus mapped-file RSS is operationally different from anonymous direct-buffer storage: the mapped pages are backed by a file and may be paged or reclaimed under OS policy.

<aside class="lesson-callout" data-kind="important" aria-label="Important"><p class="callout-label">Important</p><p>A 20 GB mapping reports the size of a virtual range. It does not tell you that 20 GB of file pages are resident in RAM.</p></aside>

The mapping's validity and eventual unmapping are associated with the mapped buffer's lifetime in the traditional `MappedByteBuffer` model. Exact unmapping timing and OS behavior are not a portable deterministic cleanup contract. JDK 25 also offers file mapping to a `MemorySegment` controlled by an `Arena`; that gives code a scoped lifetime when deterministic cleanup is needed, but it is a separate API model. [JDK 25 `FileChannel`](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/FileChannel.html), [JDK 25 `Arena`](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/Arena.html)

## Diagnose each memory question with the right view

A heap dump can show Java wrappers, object fields and the retaining paths that keep wrappers reachable. It cannot become a full dump of native direct-buffer storage or mapped pages. A `DirectByteBuffer` can be tiny in shallow and retained heap size while its native backing is large. A heap dump that looks fine means the Java heap looks fine; it does not establish that the process is healthy.

<aside class="lesson-callout" data-kind="misconception" aria-label="Common misconception"><p class="callout-label">Common misconception</p><p>A heap dump can explain <strong>which Java objects retain a wrapper</strong>; it does not measure that wrapper's full native backing or the process's mapped-page residency.</p></aside>

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable buffer-pool diagnostics diagram"><a href="/images/courses/jvm/buffer-pool-diagnostics.svg" aria-label="Open buffer-pool diagnostics diagram"><img src="/images/courses/jvm/buffer-pool-diagnostics.svg" alt="BufferPoolMXBean reports direct and mapped buffer count, total capacity and memory used; heap tools find Java retainers, NMT shows tracked HotSpot categories and OS tools show residency and mappings." width="900" height="450" /></a><figcaption>Pool metrics, heap retainers, NMT categories and OS residency each see a different part.</figcaption></figure>

`BufferPoolMXBean` exposes buffer pools such as `direct` and `mapped`, with count, total capacity and memory used. Query it through JMX or `ManagementFactory.getPlatformMXBeans(BufferPoolMXBean.class)`. These metrics answer what the JDK reports for its buffer pools; they are not an RSS meter. [JDK 25 `BufferPoolMXBean`](https://docs.oracle.com/en/java/javase/25/docs/api/java.management/java/lang/management/BufferPoolMXBean.html)

<div class="lesson-table-scroll" role="region" tabindex="0" aria-label="Scrollable memory diagnostics comparison">
<table class="lesson-comparison">
<thead><tr><th>Question</th><th>Useful view</th><th>What it does not answer by itself</th></tr></thead>
<tbody>
<tr><th>Which Java objects retain buffer wrappers or views?</th><td>Heap histogram or heap dump</td><td>Full native backing size or mapped-page residency</td></tr>
<tr><th>How many direct or mapped buffers and bytes does NIO report?</th><td><code>BufferPoolMXBean</code> / JMX</td><td>Total process RSS or memory outside those pools</td></tr>
<tr><th>Which tracked HotSpot categories are changing?</th><td>NMT summary/detail and diffs</td><td>All process memory; NMT is not complete process accounting</td></tr>
<tr><th>What is resident, file-backed, or mapped in the process/container?</th><td>OS and container metrics, mapping tools</td><td>Which Java references retain a wrapper</td></tr>
</tbody>
</table>
</div>

For a rising footprint, first compare heap, direct and mapped pool trends with process/container RSS. Use NMT to look at HotSpot-managed categories, remembering Lesson 31's boundary: NMT is not a complete accounting of process memory. Use OS metrics and mapping views to distinguish resident anonymous memory, file-backed pages, native libraries and other mappings. If buffer-pool usage points to direct memory, use a heap histogram or dump to find the Java owners and view chains.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable off-heap diagnostic flow"><a href="/images/courses/jvm/offheap-diagnostic-flow.svg" aria-label="Open off-heap diagnostic flow"><img src="/images/courses/jvm/offheap-diagnostic-flow.svg" alt="Start with process or container growth, compare heap and BufferPoolMXBean, use NMT for tracked HotSpot categories, then inspect OS mappings and residency; use heap tools to find Java retainers when buffer pools are high." width="900" height="450" /></a><figcaption>Follow the evidence from process footprint to the accounting view that can explain it.</figcaption></figure>

Two reasoning checks catch common mistakes. A small post-GC heap does not imply process-memory headroom when direct memory is large. Mapping a 20 GB file does not imply 20 GB RSS. And `MaxDirectMemorySize` does not cap every off-heap or native allocation.

Increasing `-Xmx` during a non-heap memory incident can make the process budget tighter. Heap, direct buffers, mapped resident pages, stacks and other native allocations all compete within the same process or container limit. If RSS is the problem, a larger heap ceiling does not explain or remove the other memory; it can leave less room before the container limit is reached.

<mark>Increasing `-Xmx` can worsen a non-heap incident because heap and native memory share the process/container budget.</mark>

## Put direct and mapped storage back into the process model

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable complete JVM memory model"><a href="/images/courses/jvm/direct-mapped-complete.svg" aria-label="Open complete direct and mapped memory model"><img src="/images/courses/jvm/direct-mapped-complete.svg" alt="A JVM process contains distinct domains: Java heap, HotSpot native memory such as Metaspace, Code Cache and stacks, NIO direct-buffer storage, file-backed mapped regions, and native libraries; each has different lifetime and diagnostic views." width="900" height="450" /></a><figcaption>One process contains multiple memory domains, each with its own owner, lifetime and accounting view.</figcaption></figure>

The useful model now has distinct domains: the Java heap; HotSpot native memory such as Metaspace, Code Cache, stacks and GC structures; direct-buffer native storage; file-backed mappings and their resident pages; and native-library allocations. The JVM wrapper may connect Java reachability to a resource lifetime, but the underlying resource can still be managed by a different subsystem.

The central rule is: **moving storage off heap changes who manages it, how lifetime is controlled, which limit applies, and which diagnostic tool sees it.** Next, Lesson 36 follows execution across the boundary: [JNI and native libraries](/courses/jvm/jni-native-boundary), including JNI references and GC safety, critical sections and pinning, native allocations, crashes, and what changes when memory and execution leave the managed JVM world.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Daily JVM Byte #35 and its reviewed draft from the originating conversation inform this local lesson. Diagrams and examples are explanatory, not measured process data. The API-level explanation follows JDK 25 documentation; cleaner retries and attachment relationships are identified as current OpenJDK/HotSpot implementation details, while mapping residency and page reclamation depend on the operating system.</p><ul><li><a href="https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/ByteBuffer.html">JDK 25 ByteBuffer</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25-ga/src/java.base/share/classes/java/nio/Bits.java">OpenJDK JDK 25 direct-buffer accounting</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25-ga/src/java.base/share/classes/java/nio/DirectByteBuffer.java">OpenJDK JDK 25 DirectByteBuffer</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/FileChannel.html">JDK 25 FileChannel</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/docs/api/java.management/java/lang/management/BufferPoolMXBean.html">JDK 25 BufferPoolMXBean</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/Arena.html">JDK 25 Arena</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/vm/java-virtual-machine-guide.pdf">JDK 25 Java Virtual Machine Guide: Native Memory Tracking</a></li></ul></details>
