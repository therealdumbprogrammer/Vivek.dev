---
title: JVM process memory — heap is only one part
summary: Learn where a JVM process uses memory, why a healthy heap can coexist with a container OOM, and which evidence to collect first.
course: jvm
lessonSlug: memory
module: Foundations
order: 20
sourceByte: byte-002
draft: false
prerequisites: [runtime]
jdk: HotSpot · JDK 25 reference
---

Your service has a 4 GiB maximum heap and a 5 GiB container memory limit. The heap dashboard looks comfortable, yet the container is killed for running out of memory. Has the JVM ignored its heap setting?

In [Lesson 1](/courses/jvm/runtime), we separated execution, memory, and runtime services. Now we'll zoom into memory. The distinction that explains this incident is **JVM process memory ≠ Java heap**. The heap setting controls one region inside a larger process; understanding the other regions tells you where to investigate.

## Start with the process boundary

A running HotSpot JVM needs somewhere to store objects, track method calls, describe classes, and keep generated machine code. Each job has its own memory needs. The map below groups those responsibilities inside one process. Native memory is a broad category here: Metaspace and the Code Cache are themselves native memory.

<figure>
<a href="/images/courses/jvm/process-memory.svg" aria-label="Open the JVM process memory diagram at full size"><img src="/images/courses/jvm/process-memory.svg" alt="One HotSpot process contains the Java heap plus native regions: platform-thread stacks, Metaspace, Code Cache, direct and native buffers, and HotSpot internal allocations. Xmx bounds only the heap. Box sizes do not represent memory usage." width="480" height="760" /></a>
<figcaption>The process boundary encloses more than the heap. Regions are grouped by responsibility, not drawn to scale. <a href="/images/courses/jvm/process-memory.svg">Open full-size diagram</a>.</figcaption>
</figure>

Before attaching numbers to that map, distinguish three measurements. **Reserved** memory is virtual address space set aside for possible use. **Committed** memory is memory the runtime has made available for use within its reservations. **Resident** memory is the portion currently in physical RAM; process RSS measures resident pages. Committed memory and RSS are not interchangeable, and reserved memory is not a bill for RAM already consumed.

That distinction matters when reading JVM tools alongside an operating-system dashboard. A large reservation alone does not prove physical memory pressure. Equally, a heap occupancy chart cannot tell you the resident footprint of the whole process.

## The heap holds Java objects

Consider a request handler that creates a customer:

```java
Customer customer = new Customer();
```

Conceptually, the object lives on the Java heap, shared by the application's threads. HotSpot may optimize some allocations away, as we noted in Lesson 1. For objects that are allocated, garbage collection manages their heap lifetime and can reclaim space when they are no longer reachable.

`-Xmx4g` sets a maximum heap size of 4 GiB. It does not mean that 4 GiB of objects exist, that all of that heap is resident, or that the entire process must fit within 4 GiB. Heap usage, committed heap, and maximum heap answer different questions.

The request handler needs more than its `Customer` object to execute. Following that request takes us into the other regions.

## Platform threads need stacks

When a platform thread calls the handler, its stack supports method frames: local working state, operand state, and information needed to return to callers. In HotSpot, platform threads use native stacks; `-Xss` influences their stack size. Actual frame representation depends on interpretation, compilation, and the platform.

Suppose you have 1,000 platform threads with a nominal 1 MiB stack each. That suggests roughly 1 GiB of stack reservation, before implementation details such as rounding and guard areas. It does **not** establish 1 GiB of RSS. How much becomes resident depends on stack use and OS behavior. More threads still create more potential memory demand, even if heap occupancy stays flat.

This arithmetic is specifically about platform threads. Virtual threads do not each reserve a matching native stack: their stack chunks live on the heap, and they execute on carrier platform threads that have native stacks. We'll return to that distinction when we study threads.

<details class="lesson-check">
<summary>More threads, unchanged heap: what can you conclude?</summary>
<p>Stack reservation may have increased, and resident stack memory may also increase as those threads do work. You cannot calculate the RSS increase from thread count multiplied by <code>-Xss</code> alone. Compare thread counts and stack accounting with OS measurements.</p>
</details>

## Metaspace follows loaded classes

The `Customer` object and the description of the `Customer` class are different things. HotSpot stores much of its class metadata in native **Metaspace**: structures describing methods, fields, and runtime class information. Java's heap-resident <code>Class</code> object is not the entirety of that metadata. Metaspace replaced PermGen in HotSpot in Java 8.

Growth therefore follows loaded classes and their class loaders, rather than just the number of customer objects. Frameworks that generate classes or applications that repeatedly reload plugins can make this visible.

Imagine a plugin is replaced, but a long-lived registry still holds its old class loader. That reference can keep the loader reachable, preventing its classes from becoming eligible for unloading. Their metadata remains needed even after the plugin has stopped handling requests. Removing the reference can make unloading possible; it does not promise immediate unloading or an immediate RSS drop. Reclamation depends on runtime behavior, and returning unused native memory to the OS is another step.

This is why a Metaspace investigation follows class counts and class-loader reachability. Increasing the Java heap does not remove the retained loader.

## The Code Cache holds generated code

Our handler may start out interpreted and later become hot enough for JIT compilation. The resulting native machine code needs executable memory. HotSpot keeps compiled methods and other generated code, such as runtime stubs, in its **Code Cache**.

The same method can therefore involve bytecode and metadata as well as compiled machine code. Those are different representations with different jobs. Code Cache growth during warmup can be expected as more methods compile; it isn't evidence that more application objects are being retained. Code Cache capacity and compilation activity deserve their own measurements.

## Direct buffers put backing storage outside the heap

Now suppose the handler works with a direct buffer for I/O:

```java
ByteBuffer buffer = ByteBuffer.allocateDirect(1024 * 1024);
```

The Java buffer object is on the heap, while a direct buffer's backing storage is outside the ordinary garbage-collected heap. The example requests 1 MiB of buffer capacity, not a 1 MiB Java byte array. Direct buffers can help avoid intermediate copying in native I/O, although this is a best-effort capability rather than a universal zero-copy guarantee.

A heap graph can therefore retain a comparatively small wrapper that keeps a much larger native allocation alive. Heap occupancy may look stable while buffer pools and RSS grow. Cleanup can be connected to Java reachability, but that does not turn backing storage into heap memory or guarantee prompt release. Libraries may also pool and explicitly manage native resources.

JNI code and native libraries add further allocations with their own ownership rules. Direct-buffer statistics are useful evidence for NIO buffers; they are not a census of every native library allocation.

## HotSpot also needs memory to do its work

Garbage collectors need bookkeeping structures, JIT compilers need working memory, and the runtime needs internal tables and synchronization structures. These consume native memory beyond the regions already discussed. Their size depends on the collector, JDK, workload, and configuration; there is no universal fixed overhead to add to every heap.

Keep the boundary precise: **GC manages Java heap object lifetime, rather than total process memory**. It can participate in related cleanup, including class unloading and reachability-triggered resource cleanup. But it is not a general owner of every native allocation, and reclaiming an object does not imply the process immediately returns the same number of bytes to the OS.

## Leave room around the heap in containers

Return to the service with a 5 GiB container limit and `-Xmx4g`. If the heap eventually contributes close to 4 GiB of resident memory and everything else contributes another 1.3 GiB, the process alone could be around 5.3 GiB. This is an illustrative budget, not measured output or a prediction from `-Xmx`. It assumes resident contributions, not a sum of reservations and limits.

On Linux, Kubernetes memory limits are enforced through cgroups. The kernel can OOM-kill a process when the applicable memory limit is exceeded under pressure. Container accounting is broader than a single JVM's RSS: other charged memory, including file cache and memory-backed volumes, can matter. A container OOM kill is also different from a Java <code>OutOfMemoryError</code>; you may receive no Java heap dump from the kill.

Choose heap size with headroom for the rest of the workload. Measure startup, warmup, peak traffic, thread counts, buffer pools, and class loading. There is no safe percentage for every service. A comfortable heap chart tells you about the heap, not whether the container has enough headroom.

<details class="lesson-check">
<summary>The container is killed while heap usage is stable. What comes next?</summary>
<p>Check the termination reason and container memory metrics, then compare process RSS with heap, thread, class, and buffer trends. Native growth is one possibility; other memory charged to the container is another. A heap dump alone cannot explain all of them, and raising <code>-Xmx</code> may reduce the headroom further.</p>
</details>

## Match the evidence to the region

Ask **which region is growing** before choosing a tool. These are starting points for an investigation, not one-to-one proofs of a leak.

| Suspected region | Useful first evidence |
| --- | --- |
| Java heap | GC logs and post-GC occupancy; histogram or heap dump for retained objects |
| Metaspace | Loaded/unloaded class counts, class-loader statistics, loader retention paths |
| Platform-thread stacks | Platform-thread counts, thread dumps, stack settings, native stack accounting |
| Code Cache | Code Cache usage and compiler activity |
| Direct/native buffers | NIO BufferPool metrics, library pool metrics, allocation ownership |
| HotSpot internal native memory | Native Memory Tracking categories and changes over time |
| Unexplained process/container growth | OS memory maps, container accounting, native allocation tools |

For HotSpot, **Native Memory Tracking (NMT)** provides a useful view of internal allocations. Enable it when starting a disposable local application with `-XX:NativeMemoryTracking=summary`. It is off by default, adds overhead, and cannot be started later with `jcmd`.

With NMT enabled, replace `<pid>` with that JVM's process ID and run:

```bash
jcmd <pid> VM.native_memory summary
```

Read reserved and committed columns separately. Categories such as Java Heap, Class, Thread, Code, GC, and Compiler help locate changes; they are not an RSS breakdown. Establish a baseline to compare later activity:

```bash
jcmd <pid> VM.native_memory baseline
# After the workload has run:
jcmd <pid> VM.native_memory summary.diff
```

NMT is HotSpot-focused, **not a complete profiler for every native allocation**. Third-party native code and some JDK library allocations can lie outside its tracking. A flat report does not rule out native growth; compare it with OS and application measurements. These commands introduce the workflow; a full leak investigation belongs in a later lesson.

## Zoom into one object next

You now have two boundaries to keep separate: the Java heap inside the JVM process, and the process inside its container's memory accounting. When the numbers disagree, identify what each measurement includes before changing a setting.

The [object-layout preview](/courses/jvm/object-layout) marks our next step: looking inside a heap object at its header, mark word, class pointer, and alignment. That will explain why the space occupied by an object can exceed the sizes of its fields.

<details class="lesson-sources">
<summary>Sources and further reading</summary>
<ul>
<li><a href="https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-2.html">JVM specification: heap, stacks, and frames</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html">Java launcher: heap, stack, and tracking options</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/other-considerations.html">HotSpot: class metadata and native memory</a></li>
<li><a href="https://openjdk.org/jeps/444">JEP 444: virtual-thread stacks and carriers</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/vm/java-hotspot-virtual-machine-performance-enhancements.html">HotSpot: tiered compilation and the Code Cache</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/ByteBuffer.html">ByteBuffer: direct buffers and allocation behavior</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/vm/native-memory-tracking.html">Native Memory Tracking: setup, reports, and coverage limits</a></li>
<li><a href="https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/">Kubernetes: memory limits and container accounting</a></li>
</ul>
</details>
