---
title: JVM memory ergonomics in containers — why Xmx is not enough
summary: Budget a container for heap and native memory, then distinguish HotSpot commitment, process RSS and cgroup charges during an OOM investigation.
course: jvm
lessonSlug: jvm-memory-ergonomics-containers
module: HotSpot Internals
order: 520
sourceByte: byte-052
draft: true
prerequisites:
  - gc-ergonomics
jdk: JDK 25 · Linux containers
---

[Lesson 51](/courses/jvm/gc-ergonomics) showed how HotSpot makes decisions using its view of available resources. In a container, that view matters immediately: a heap limit chosen at startup has to coexist with every other part of the process. A pod can be killed while a Java heap chart still looks healthy.

`-Xmx2g` sets the **maximum Java heap size**. It does not cap the whole JVM process or the container's memory charge. Metaspace and compressed class space hold class metadata; the Code Cache holds compiled machine code; platform threads have native stacks; GC uses supporting structures; direct buffers, JNI libraries and other native facilities can allocate outside the heap. A virtual thread's suspended stack chunks are generally heap objects, while a mounted virtual thread uses a carrier platform thread and its native stack. Count both boundaries according to what is actually resident.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable JVM container memory budget"><a href="/images/courses/jvm/xmx-vs-container-memory-budget.svg" aria-label="Open container memory budget diagram"><img src="/images/courses/jvm/xmx-vs-container-memory-budget.svg" alt="A container limit encloses resident Java heap, Metaspace, Code Cache, native thread stacks, direct and JNI allocations, GC structures and kernel-charged cache; Xmx marks only the heap ceiling." width="1080" height="540" /></a><figcaption>Plan for the entire container charge at peak load; `-Xmx` is one boundary inside it.</figcaption></figure>

## Three meanings of memory size

**Reserved** memory is virtual address space set aside for possible use. **Committed** memory has backing made available by the operating system. **Resident set size (RSS)** is physical pages currently resident for one process. A large compressed-class-space reservation can inflate virtual size without using the same quantity of physical RAM. A heap can be reserved to its maximum while only part is committed or resident.

Native Memory Tracking (NMT) reports HotSpot reservation and commitment for categories it tracks. <mark>NMT committed is not the same metric as process RSS, and process RSS is not the same metric as cgroup `memory.current`.</mark> Residency changes with paging and mapping. A cgroup also charges memory beyond one process's RSS, including some file cache and kernel memory, and can contain multiple processes. These are related views with different ownership and accounting rules, not rows to reconcile by subtraction alone.

## Which container number does HotSpot see?

On supported Linux containers, JDK 25 enables `-XX:+UseContainerSupport` by default. HotSpot uses container resource information for relevant startup choices. A Kubernetes **request** helps scheduling and influences resource guarantees; a **limit** is an enforced ceiling. With a `1Gi` memory request and `4Gi` limit, a container-aware JVM normally sizes its automatic heap from the limit, not the request. At the default `MaxRAMPercentage=25`, the simple estimate is about `1Gi` maximum heap. At `-XX:MaxRAMPercentage=60`, it is about `2.4Gi`. Actual values can reflect other HotSpot constraints and rounding; inspect the running configuration. An explicit `-Xmx` supersedes automatic maximum-heap percentage sizing.

```bash
java -XshowSettings:system -version
java -Xlog:os+container=trace -version
```

The first command displays detected operating-system/container settings when available. The second exposes container-detection detail for diagnosis and may be verbose. Use the same JDK and environment as the service; a laptop result does not prove what a pod sees. Oracle's [JDK 25 `java` options](https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html) document `UseContainerSupport` and `MaxRAMPercentage`.

## A two-gibibyte limit with a two-gibibyte heap ceiling

Imagine a container limited to `2 GiB = 2048 MiB`, launched with `-Xmx2g`. At one peak, its resident footprint might be:

| Component | Illustrative resident use |
|---|---:|
| Java heap | 1650 MiB |
| Metaspace | 120 MiB |
| Native thread stacks | 100 MiB |
| Code Cache | 60 MiB |
| GC and other native memory | 180 MiB |
| **Total** | **2110 MiB** |

This simplified total exceeds 2048 MiB before considering additional cgroup charges. The numbers are illustrative; some real measurements overlap or differ by accounting basis, so do not use the table as an exact RSS-to-cgroup identity. It shows why a 2 GiB heap maximum gives no whole-process safety margin in a 2 GiB container. <mark>Budget peak heap residency plus native memory and cgroup charges below the enforced limit, with room for bursts.</mark>

For a 4 GiB container, first measure peak retained heap, allocation behavior, Metaspace, Code Cache, thread stacks, direct buffers and external native use. Leave room for GC structures, mappings and file cache that the cgroup charges. Set `-Xmx` from that budget and validate at realistic peaks, rather than choosing a fixed percentage for every application. If the live set nearly fills the proposed heap, lowering `-Xmx` may merely increase GC pressure or cause a Java heap failure.

For example, suppose repeated load tests show about 2.2 GiB of peak resident heap, 0.8 GiB of other process residency, and 0.3 GiB of additional cgroup charge. That is approximately 3.3 GiB, leaving 0.7 GiB before a 4 GiB limit. A proposed `-Xmx` around 2.6 GiB would leave growth room above the observed heap peak while recognizing that native and cgroup costs can also spike. The proposal is **illustrative**, not a recommended ratio. Check the highest combined peaks, not independent maxima observed at unrelated times; then rerun with the same CPU quota, traffic, thread count and class-loading pattern as production. If the margin disappears during a burst, change the budget or resource limit based on the measured source of growth.

## Java failure and container kill have different evidence

A Java `OutOfMemoryError` is thrown by the JVM when a particular allocation or JVM memory subsystem cannot meet its requirement. It may appear as `Java heap space`, `Metaspace`, `Direct buffer memory` or another message. The process may continue or exit depending on the application and flags.

A Kubernetes `OOMKilled` status reports a container termination associated with memory pressure or a cgroup limit. The kernel sends `SIGKILL`; Java has no chance to throw an ordinary exception or write a final stack trace at that moment. Exit code **137** conventionally means termination by `SIGKILL`, but code 137 alone does not prove an OOM kill. Read the pod's **Last State Reason**, cgroup events and surrounding memory telemetry. A Java OOME and an OOMKilled event can also occur at different times in one incident; classify the specific termination you are investigating.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable OOME and OOMKilled comparison"><a href="/images/courses/jvm/java-oome-vs-kubernetes-oomkill.svg" aria-label="Open failure comparison diagram"><img src="/images/courses/jvm/java-oome-vs-kubernetes-oomkill.svg" alt="Two branches separate JVM allocation failure that throws OutOfMemoryError from kernel SIGKILL and Kubernetes OOMKilled evidence; exit 137 alone is labeled insufficient." width="1080" height="470" /></a><figcaption>Identify the actor that ended execution before changing memory flags.</figcaption></figure>

## Direct buffers and stacks need precise boundaries

`ByteBuffer.allocateDirect` creates a Java wrapper with native backing storage. Its wrapper appears on the heap; the backing bytes do not. `-XX:MaxDirectMemorySize` controls the capacity of standard NIO direct buffers. It is not a universal cap on JNI `malloc`, every mapping, native library or all off-heap memory. A buffer view can keep its backing storage reachable after the original variable is gone, as [the direct-memory lesson](/courses/jvm/direct-mapped-memory) explains.

For platform threads, a configured stack size is often a reservation rather than fully resident pages from birth. The resident amount grows with touched stack pages and platform behavior. Virtual-thread stack chunks live on the heap when suspended, while mounted work uses carrier native stacks. Counting every virtual thread as a full native platform stack overstates its native memory. Counting no native stacks ignores carriers and other JVM threads.

## Investigate through four observation layers

Start NMT **at JVM startup** if you need its categories:

```bash
java -XX:NativeMemoryTracking=summary -jar application.jar
jcmd <pid> VM.native_memory summary scale=MB
jcmd <pid> VM.native_memory baseline
# After a comparable workload interval:
jcmd <pid> VM.native_memory summary.diff scale=MB
```

NMT helps attribute HotSpot-managed reservation and commitment. It does not comprehensively track third-party native code or every JDK library allocation. A growing RSS with flat NMT committed therefore remains possible. Oracle's [JDK 25 NMT guide](https://docs.oracle.com/en/java/javase/25/vm/native-memory-tracking.html) states this scope.

On a Linux host or inside the container where procfs is available, compare process virtual size, RSS and threads:

```bash
cat /proc/<pid>/status       # VmSize, VmRSS, Threads
cat /proc/<pid>/smaps_rollup # aggregated process mappings
```

For a typical cgroup v2 mount, inspect its charge, limit, breakdown and event counters:

```bash
cat /sys/fs/cgroup/memory.current
cat /sys/fs/cgroup/memory.max
cat /sys/fs/cgroup/memory.stat
cat /sys/fs/cgroup/memory.events
```

Those paths assume the container's cgroup v2 root is mounted there; nested or differently mounted cgroups need their actual path. `memory.current` is the cgroup charge, not the JVM's RSS. `memory.stat` can reveal file and kernel components, and `memory.events` can show pressure/kill counters. Inspect the correct cgroup and the relevant time window.

In Kubernetes, gather termination context and the prior container's log:

```bash
kubectl describe pod <pod>
kubectl logs <pod> --previous
```

The four layers are **heap metrics → NMT HotSpot categories → process RSS/mappings → cgroup charge and kill events**. Align their timestamps. If the heap is stable but the pod is OOMKilled, inspect NMT growth, direct buffers and native libraries, RSS mappings, other processes in the cgroup, file cache and kernel charges. If the heap itself climbs toward its limit, investigate allocation and retention before shrinking or enlarging `-Xmx`. The four layers narrow the cause; no single layer is a complete process-memory ledger.

Suppose a dashboard shows heap used flat near 1.3 GiB while `memory.current` climbs toward a 2 GiB limit. First confirm that the dashboard is showing **used** heap, not maximum or committed heap. If NMT's committed categories are also flat but process RSS rises, inspect mappings and native allocations outside NMT's coverage, including direct-buffer and JNI use. If process RSS remains flat while `memory.current` rises, inspect `memory.stat` for file cache or kernel charges and check for another process in the cgroup. If both RSS and NMT's GC category grow, investigate the collector's structures and workload change. Each observation narrows the next question; none alone proves a leak.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable memory observation layers"><a href="/images/courses/jvm/four-memory-observation-boundaries.svg" aria-label="Open memory observation diagram"><img src="/images/courses/jvm/four-memory-observation-boundaries.svg" alt="Nested diagnostic views show Java heap occupancy, HotSpot NMT reserved and committed categories, process virtual and resident memory, and cgroup memory charge with distinct boundaries." width="1080" height="510" /></a><figcaption>Move outward from JVM pools to the enforced container boundary without equating the reported numbers.</figcaption></figure>

## Check your reasoning

<details class="lesson-check"><summary>Can a process be OOMKilled when used Java heap is well below `-Xmx`?</summary><p>Yes. Native memory, other resident mappings and cgroup charges can consume the remaining limit.</p></details>
<details class="lesson-check"><summary>Does a large compressed-class-space reservation mean that much physical RAM is resident?</summary><p>No. Reservation is virtual address space; commitment and RSS describe different later stages of use.</p></details>
<details class="lesson-check"><summary>Does exit code 137 alone prove a Kubernetes OOM kill?</summary><p>No. It indicates SIGKILL. Confirm the Last State Reason and corroborate with memory events and telemetry.</p></details>
<details class="lesson-check"><summary>Will raising `MaxDirectMemorySize` cap or fix every native allocation?</summary><p>No. It governs standard NIO direct-buffer capacity, not all JNI, native library, stack, mapping or GC allocations.</p></details>

The resulting model has two parts: **`-Xmx` bounds one JVM region; the container enforces a broader memory charge.** Diagnose at the boundary that failed, then move across heap, NMT, RSS and cgroup evidence. [Lesson 53, *Why JVM RSS keeps growing while heap usage stays flat*](/courses/jvm/jvm-rss-growth-stable-heap), continues the unexplained-RSS investigation by separating heap commitment, native allocation ownership, allocator retention and page residency.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on approved Daily JVM Byte #52 and its review. Memory budgets and diagrams are illustrative; no container workload was run for this lesson. Commands describe JDK 25 HotSpot on Linux with cgroup v2 where indicated. Kubernetes status, procfs and cgroup paths depend on the deployment.</p><ul><li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html">JDK 25 java options and container support</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/vm/native-memory-tracking.html">JDK 25 Native Memory Tracking</a></li><li><a href="https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html">Linux cgroup v2 memory controller</a></li><li><a href="https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/">Kubernetes resource requests and limits</a></li></ul></details>
