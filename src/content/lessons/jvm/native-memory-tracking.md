---
title: Native Memory Tracking — explaining "heap looks fine, process is huge"
summary: Use HotSpot Native Memory Tracking to identify growing JVM memory categories, interpret reserved and committed memory, and investigate process growth beyond NMT's scope.
course: jvm
lessonSlug: native-memory-tracking
module: Native Memory
order: 370
sourceByte: byte-037
draft: true
prerequisites: [jni-native-boundary]
jdk: JDK 25 · HotSpot Native Memory Tracking
---

Imagine a service nearing its 8 GB container limit. Its Java heap holds 2.1 GB after collection, `-Xmx` is 4 GB, and the garbage collection logs look healthy. A stable heap does not explain why the container metric reads 6.8 GB. It also does not tell us whether the growth belongs to HotSpot, a native library, another process, or the container's file cache.

[Lesson 36](/courses/jvm/jni-native-boundary) followed Java execution into JNI, where native code can allocate memory outside GC ownership. This lesson adds **Native Memory Tracking (NMT)**, HotSpot's accounting view of the allocations and virtual memory reservations it tracks. The useful question is: *which JVM category changed while the incident developed?*

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable NMT accounting boundary"><a href="/images/courses/jvm/nmt-accounting-boundary.svg" aria-label="Open NMT accounting boundary"><img src="/images/courses/jvm/nmt-accounting-boundary.svg" alt="NMT covers tracked HotSpot categories including Java Heap, while process RSS and container memory have broader and different accounting scopes." width="900" height="450" /></a><figcaption>NMT is a HotSpot accounting view inside a larger process and container memory picture.</figcaption></figure>

## What NMT counts

NMT groups tracked allocations by the subsystem responsible for them. The report includes **Java Heap** reserved and committed memory. Despite its name, it is not exclusively a report of memory outside `-Xmx`. Other categories include `Class` (class metadata and related structures), `Thread` (thread-associated storage and stacks), `Code` (generated code and related storage), `GC` (collector structures), `Compiler`, `Internal`, `Symbol`, and `Native Memory Tracking` itself. Category names and breakdowns can vary by HotSpot version and configuration.

<mark>NMT includes Java Heap reservation and commitment alongside native HotSpot categories.</mark> It does not enumerate individual Java objects. A heap histogram or dump answers questions about objects and retaining paths; NMT answers which tracked subsystem is reserving or committing memory.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable NMT category map"><a href="/images/courses/jvm/nmt-category-map.svg" aria-label="Open NMT category map"><img src="/images/courses/jvm/nmt-category-map.svg" alt="HotSpot NMT groups tracked memory into Java Heap, Class, Thread, Code, GC, Compiler, Internal, Symbol, and NMT categories." width="900" height="450" /></a><figcaption>Categories tell us which part of HotSpot deserves a closer look.</figcaption></figure>

NMT is off by default. Choose a level **when starting the JVM**:

```text
-XX:NativeMemoryTracking=summary
-XX:NativeMemoryTracking=detail
```

If the process started with NMT `off`, `jcmd` cannot turn it on later. `summary` is usually the operational starting point. `detail` adds tracked native allocation call sites and virtual memory information, at additional tracking cost. Both modes add overhead; choose the level deliberately for the environment and incident.

## Read a summary without confusing the units

With NMT enabled, ask the running VM for its current view:

```bash
jcmd <pid> VM.native_memory summary scale=MB
```

An **illustrative** extract might be:

```text
Total:      reserved=8192MB, committed=4096MB
Java Heap:  reserved=6144MB, committed=3072MB
Class:      reserved=1024MB, committed=180MB
Thread:     reserved=600MB,  committed=120MB
Code:       reserved=240MB,  committed=110MB
GC:         reserved=450MB,  committed=300MB
```

These are example figures, not output from a measured application. The category totals need not sum like a budget of physical RAM. `reserved` is virtual address space set aside for possible use; `committed` is storage HotSpot has committed for use. **Resident set size (RSS)**, reported by the OS for a process, measures resident pages under the OS's rules. A committed page may not yet be physically resident; resident mappings can also come from allocations outside NMT.

Compressed Class Space makes the distinction vivid. A `Class` report can contain roughly 1 GB reserved while only tens of MB are committed. The large reservation is address-space capacity; it does not say 1 GB of RAM is occupied.

<aside class="lesson-callout" data-kind="important" aria-label="Important"><p class="callout-label">Important</p><p>Reserved memory is virtual address space, not a measurement of physical RAM. Read committed memory and OS residency separately, then compare their trends within each tool's accounting scope.</p></aside>

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable reserved committed and RSS comparison"><a href="/images/courses/jvm/nmt-reserved-committed-rss.svg" aria-label="Open reserved committed and RSS comparison"><img src="/images/courses/jvm/nmt-reserved-committed-rss.svg" alt="A large virtual reservation contains a smaller committed portion; RSS is an OS measure of resident process pages and does not equal either NMT figure." width="900" height="450" /></a><figcaption>A 1 GB Class reservation can coexist with only a small committed portion; RSS is another measurement.</figcaption></figure>

Container memory is a further accounting layer. Depending on the metric and platform, it can include other processes, charged file cache, and other cgroup charges. Therefore Java heap used, NMT committed, process RSS, and container memory cannot be substituted for one another. <mark>Subtracting NMT committed from RSS or container usage does not precisely measure an untracked leak.</mark> Compare changes over time and inspect mappings or cgroup details before attributing a gap.

## Use a baseline to locate growth

An absolute `Thread committed=800MB` could be normal for one service and extraordinary for another. After startup and warmup, establish a baseline:

```bash
jcmd <pid> VM.native_memory baseline
```

During a later incident, compare against it:

```bash
jcmd <pid> VM.native_memory summary.diff scale=MB
```

Suppose the **illustrative** comparison shows `Thread +550MB`, `Class +4MB`, `Code +2MB`, and `GC +5MB`. The useful observation is the change in `Thread`, especially if platform thread count increased during the same interval. Take a thread dump with `jcmd <pid> Thread.print`, examine the creating executor or library, and compare the configured `-Xss` with the deployment's thread count. `-Xss` affects platform thread stack sizing, but actual committed and resident pages vary by platform and use.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable NMT baseline and diff"><a href="/images/courses/jvm/nmt-baseline-diff.svg" aria-label="Open NMT baseline and diff"><img src="/images/courses/jvm/nmt-baseline-diff.svg" alt="After warmup an NMT baseline is recorded; an incident summary.diff highlights Thread growth while Class, Code, and GC remain nearly flat." width="900" height="450" /></a><figcaption>The diff turns a large process into a question about the subsystem that changed.</figcaption></figure>

The baseline is tied to this process and time. If it was never taken, a current summary still helps, but you cannot recover an earlier NMT diff retrospectively. A restart also resets that comparison. Record the workload phase and container metric alongside the baseline so a later change has context.

## Follow the category into a narrower tool

NMT points to an owner; it rarely explains the owner by itself. If `Class` grows, compare loaded class and class loader counts and revisit [Metaspace](/courses/jvm/metaspace-internals): old loaders remaining reachable can retain metadata. If `Code` grows, inspect `jcmd <pid> Compiler.codecache` and compilation activity described in [Code Cache internals](/courses/jvm/code-cache-internals). If `GC` grows, examine collector configuration, heap sizing, GC logs, and a detailed NMT report if available. `Thread` growth calls for platform thread counts, dumps, and stack configuration from [Lesson 34](/courses/jvm/thread-stacks-stack-walking). `Compiler` and `Internal` are leads for runtime-specific investigation rather than automatic diagnoses.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable category investigation map"><a href="/images/courses/jvm/nmt-category-investigation.svg" aria-label="Open category investigation map"><img src="/images/courses/jvm/nmt-category-investigation.svg" alt="Thread growth leads to thread counts and dumps; Class to class loaders and Metaspace; Code to compilation and codecache; GC to collector logs and structures." width="900" height="450" /></a><figcaption>Choose the next tool from the category that actually grows.</figcaption></figure>

When a category is still too broad, start a JVM with `-XX:NativeMemoryTracking=detail`, then use `jcmd <pid> VM.native_memory detail` or `detail.diff` after a baseline. Detail reports tracked native allocation call sites and virtual memory ranges. It costs more to collect and is not a universal native allocation trace.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable NMT summary versus detail"><a href="/images/courses/jvm/nmt-summary-vs-detail.svg" aria-label="Open NMT summary versus detail"><img src="/images/courses/jvm/nmt-summary-vs-detail.svg" alt="Summary groups HotSpot memory by category with lower overhead; detail adds tracked allocation sites and virtual memory ranges with additional overhead, and must be enabled at startup." width="900" height="450" /></a><figcaption>Start with category changes; use detail when the category cannot answer the question.</figcaption></figure>

## When NMT remains flat while process memory rises

NMT tracks HotSpot's instrumented allocations. It does not profile arbitrary `malloc` calls in third-party JNI libraries, and some native allocations in JDK class libraries also lie outside its coverage. A stable NMT report therefore cannot rule out native growth. OS mappings, allocator behavior, file-backed pages, and the chosen container metric can also make the measurements diverge.

Consider this **illustrative trend**: at 10:00 process RSS is 4.0 GB and NMT committed is 3.2 GB; at 10:30 RSS is 6.5 GB while NMT committed is 3.4 GB. This suggests looking beyond the tracked HotSpot categories, but the 2.3 GB difference in changes is not a proven JNI allocation. Check process mappings and page residency (`/proc/<pid>/smaps` on Linux, `vmmap` on macOS), direct and mapped buffer metrics, the native library's allocator instrumentation, and container file-cache/cgroup metrics. Compare like-for-like trends under the same workload.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable NMT and RSS trend"><a href="/images/courses/jvm/nmt-vs-rss-growth.svg" aria-label="Open NMT and RSS trend"><img src="/images/courses/jvm/nmt-vs-rss-growth.svg" alt="Over four sample times process RSS climbs from 4.0 to 6.5 GB while NMT committed moves from 3.2 to 3.4 GB; the divergence prompts OS and native investigation without proving a particular leak size." width="900" height="450" /></a><figcaption>A diverging trend changes the next diagnostic layer; it does not identify a leak by subtraction.</figcaption></figure>

In the opening Kubernetes example, first confirm which container metric is rising and whether post-GC heap occupancy follows it. If heap occupancy rises, use GC logs and heap tools to investigate Java retention. If the heap is stable, inspect NMT `summary.diff`. Follow a growing `Thread`, `Class`, `Code`, or `GC` category into its subsystem tools. If NMT stays nearly flat, use OS process and mapping data and the native component's own diagnostics. Increasing `-Xmx` can worsen pressure under a fixed container limit because it leaves less room for everything else. A heap dump answers a retention question; it is not the reflexive first step for every large process.

## Check your reasoning

If `Class reserved≈1GB` but `Class committed≈20MB`, has the VM consumed 1 GB of physical RAM for class metadata? No: reservation is virtual capacity. If `Thread committed` rises alongside platform thread count, examine thread lifecycle and stacks. If RSS rises while NMT is stable, investigate OS and native accounting; the exact difference is not proof of a JNI leak.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable complete NMT diagnostic model"><a href="/images/courses/jvm/nmt-diagnostic-complete.svg" aria-label="Open complete NMT diagnostic model"><img src="/images/courses/jvm/nmt-diagnostic-complete.svg" alt="A memory incident is classified by heap, NMT category, process RSS and mappings, and container charges; each domain leads to a fitting diagnostic tool." width="900" height="450" /></a><figcaption>Match the memory domain to the tool that can actually observe it.</figcaption></figure>

The resulting practice is: **classify the rising metric, compare NMT categories from a warmed baseline, then investigate the growing subsystem or move to OS/native evidence.** The next lesson follows a different process-level symptom: [JVM crash anatomy](/courses/jvm/jvm-crash-anatomy) asks what actually terminated the process.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Daily JVM Byte #37 and its reviewed draft are the primary editorial source. Commands and category names describe JDK 25 HotSpot; the figures and numerical reports are illustrative, not measured output. No workload was run for this lesson. OS residency and container accounting depend on the platform and metric.</p><ul><li><a href="https://docs.oracle.com/en/java/javase/25/vm/native-memory-tracking.html">JDK 25 Native Memory Tracking</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html">JDK 25 jcmd commands</a></li><li><a href="https://docs.kernel.org/admin-guide/cgroup-v2.html">Linux cgroup v2 memory accounting</a></li><li><a href="https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/">Kubernetes container resource management</a></li></ul></details>
