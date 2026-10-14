---
title: Native Memory Tracking internals — how HotSpot accounts for memory
summary: Trace HotSpot's malloc, virtual-memory and arena accounting through NMT, then use baselines and native allocation sites without mistaking committed memory for RSS.
course: jvm
lessonSlug: native-memory-tracking-internals
module: HotSpot Internals
order: 540
sourceByte: byte-054
draft: false
prerequisites:
  - jvm-rss-growth-stable-heap
jdk: JDK 25 · HotSpot Native Memory Tracking
---

Lesson 53 began with a Java heap whose post-GC use stayed flat while process resident set size (RSS) kept growing. It showed why a native allocation can be freed while its pages remain resident in an allocator. A new question follows: when HotSpot reports `GC committed=250MB` or `Thread reserved=500MB`, how did it attribute those bytes to a subsystem?

Native Memory Tracking (NMT) records operations at HotSpot allocation boundaries. It can tell us what the VM currently considers allocated, reserved or committed, and detail mode can narrow some growth to native code sites. We will trace those records from a request through its release, then use the same model to interpret a small thread experiment.

## 1. Start with the accounting boundary

HotSpot obtains memory through several mechanisms: C heap allocation, virtual address reservations and commits, and internal arenas that parcel chunks into temporary objects. NMT instruments these paths. It does not hand memory to every JVM component, determine whether an allocation is useful, or reclaim memory on its own. The operating system and native allocator still supply and manage backing memory; HotSpot's subsystem decides when to release what it owns.

<mark>NMT records HotSpot memory operations; it is not a physical allocator or a lifetime manager.</mark> That distinction predicts a Lesson 53 observation: after a tracked `os::free`, NMT's live count can fall even if glibc retains the freed pages and RSS stays high.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable NMT accounting boundary"><a href="/images/courses/jvm/nmt-accounting-vs-allocation.svg" aria-label="Open NMT accounting boundary"><img src="/images/courses/jvm/nmt-accounting-vs-allocation.svg" alt="A HotSpot request branches to native allocation and NMT accounting. Free updates the accounting while the allocator may retain resident pages." width="1080" height="520" /></a><figcaption>NMT observes the tracked path; supplying and retaining pages belong to the allocator and operating system.</figcaption></figure>

## 2. Three paths require different records

| HotSpot path | What changes | Main NMT record |
|---|---|---|
| `os::malloc` and `os::free` | A C heap block becomes live, then is released | Live requested bytes, allocation count, tag; native call site in detail mode |
| Reserve, commit, uncommit, release | An address range is established and parts become usable | Reserved and committed ranges by tag |
| HotSpot `Arena` | A chunk backs many small temporary allocations | Arena/chunk usage rather than an independent system allocation for every object |

These are related layers, not interchangeable totals. In particular, a virtual reservation can be much larger than its commitment, and neither figure is an RSS measurement.

## 3. Follow one GC allocation into `os::malloc`

Suppose a collector needs a 4 KiB bookkeeping buffer and calls the HotSpot interface:

```cpp
void* p = os::malloc(4096, mtGC);
```

`mtGC` is a **memory tag**, an identifier saying which HotSpot subsystem should receive the accounting. In JDK 25, `os::malloc` checks the request, allocates an outer block through the platform's native allocator, and passes that block to `MemTracker::record_malloc`. That function connects the allocation to `MallocTracker`, which records the requested size and tag; detail tracking also associates a native call-site marker. HotSpot returns a pointer to the usable inner payload, not to the start of the outer block.

The source path is worth reading in that order: [`runtime/os.cpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/runtime/os.cpp) → [`nmt/memTracker.hpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/nmt/memTracker.hpp) → [`nmt/mallocTracker.hpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/nmt/mallocTracker.hpp). Startup and failure paths add details, so this is the ordinary successful tracked path rather than every possible branch.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable NMT malloc lifecycle"><a href="/images/courses/jvm/nmt-malloc-lifecycle.svg" aria-label="Open malloc lifecycle"><img src="/images/courses/jvm/nmt-malloc-lifecycle.svg" alt="GC requests a tagged block, native malloc supplies an outer block, NMT records a header and live counters, and free later reverses the counters." width="1080" height="600" /></a><figcaption>The accounting follows a live tagged request, while the allocator controls backing pages after free.</figcaption></figure>

## 4. Why a tracked block needs a header

To subtract the right bytes when only `p` is passed to `os::free`, HotSpot needs to recover the allocation's size and tag. JDK 25's [`MallocHeader`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/nmt/mallocHeader.hpp) stores metadata adjacent to the payload. Its header is 16 bytes in that implementation, and the tracked layout also uses canary bookkeeping. Alignment, debugging configuration and the platform allocator can add further cost. **Sixteen bytes is the header size, not a fixed total overhead per allocation.**

```text
outer native block
┌────────────────────┬────────────────────────────┬───────────────┐
│ tracked bookkeeping│ caller's requested payload │ bookkeeping   │
└────────────────────┴────────────────────────────┴───────────────┘
                     ▲
                     pointer returned to HotSpot caller
```

This layout explains why the pointer the caller uses and the pointer supplied to the underlying allocator differ. It also explains some of NMT's memory and CPU cost: each tracked C heap operation carries metadata and updates counters.

## 5. Free reverses live accounting

Later, HotSpot calls `os::free(p)`. On the tracked path, `MemTracker::record_free` and `MallocTracker` recover the block's bookkeeping, decrement its tag's live requested bytes and allocation count, and return the outer block to the platform allocator. A 4 KiB allocation followed by a matching free contributes zero **outstanding requested bytes** at the end of the interval. NMT is not a cumulative total of every allocation ever made.

Freeing the outer block does not promise an RSS decrease. The native allocator may retain it for reuse; mapped and resident pages may follow a separate timeline. Nor does NMT decide whether the caller freed at the right time: a missing free appears as continuing live tracked usage, but only within NMT's coverage.

## 6. Tags group allocations by HotSpot owner

The [`memTag.hpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/nmt/memTag.hpp) enum defines tags used at allocation sites. Examples include `mtGC`, `mtClass`, `mtThread`, `mtCode` and `mtCompiler`. Reports group tracked memory under human-readable categories such as GC, Class, Thread, Code and Compiler. A tag is a HotSpot accounting choice made by the allocation path; it is not a Java object reference, thread stack trace or claim about which application feature ultimately triggered the work.

For example, dynamic class generation might make the `Class` category rise. The tag identifies the VM subsystem consuming the memory; finding the class loader or application component requires other evidence. Some report categories combine `malloc`, virtual memory and arena sublines, so read those sublines before assigning one physical mechanism to the whole category.

## 7. Live counts answer a bounded question

Imagine a GC structure grows from 4 KiB to 12 KiB through allocation and replacement. If the original block is freed, NMT's GC malloc count reflects the new outstanding allocation, not 16 KiB of historical traffic. This is useful for detecting sustained growth over comparable windows. It cannot tell us whether a growing cache is intentional or whether the allocator still holds pages after a free.

A positive `summary.diff` is therefore evidence of **more tracked memory at the later snapshot**, not a leak verdict. A baseline compares two instants; it does not encode the ownership policy behind them.

## 8. Reservation is an address-space operation

A large area such as the Java heap often starts by reserving virtual address space. With `-Xms512m -Xmx4g`, think of a possible 4 GiB reserved range with 512 MiB initially committed. The exact reservation and commitment depend on VM flags, collector and platform, but the distinction is stable: reservation sets aside addresses; commitment makes part of that range available under the OS memory model. Pages become resident when touched or faulted in, and may later leave the resident set.

An illustrative report could say:

```text
Java Heap (reserved=4194304KB, committed=524288KB)
```

It does not say that 4 GiB of RAM is in use. It also does not guarantee that all 512 MiB committed is currently resident.

## 9. Commit, uncommit and release change different state

After a reservation, HotSpot may commit more pages as demand grows. It may later uncommit a subset, reducing committed bytes while leaving the wider reservation available for reuse. Finally, release removes the reservation itself. NMT receives these operations through `MemTracker::record_virtual_memory_reserve`, `record_virtual_memory_commit`, `record_virtual_memory_uncommit` and `record_virtual_memory_release`, then maintains range records through [`VirtualMemoryTracker`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/nmt/virtualMemoryTracker.hpp).

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable reservation and commitment lifecycle"><a href="/images/courses/jvm/nmt-virtual-memory-lifecycle.svg" aria-label="Open virtual-memory lifecycle"><img src="/images/courses/jvm/nmt-virtual-memory-lifecycle.svg" alt="A 4 GiB address reservation contains first 512 MiB committed, then 1 GiB committed, then 512 MiB after uncommit, before release removes the reservation." width="1080" height="650" /></a><figcaption>Committed ranges change inside a reservation; RSS is a separate OS observation and is deliberately absent from these bars.</figcaption></figure>

## 10. Virtual tracking is a range problem

A C heap block can carry a header beside its payload. A virtual reservation needs a different representation: one range can have multiple committed subranges, and later operations can split or remove them. NMT's virtual tracker accounts for these address intervals and their tags. Detail output can show a virtual memory map and call sites for reservation and commitment operations. A `reserved` delta without a matching `committed` delta is thus a meaningful finding, not an arithmetic mistake.

At the OS boundary, mapped, committed and resident have platform-specific rules. NMT uses HotSpot's tracked operations; `/proc/<pid>/smaps` on Linux observes mappings and resident pages. Do not treat NMT's word “committed” as a portable synonym for physically occupied RAM.

## 11. HotSpot arenas allocate many objects from chunks

A HotSpot `Arena` is an internal region allocator useful for temporary VM work, including compiler and runtime structures. It obtains backing chunks, then advances within a chunk to satisfy many small requests. Clearing or destroying the arena can retire a group of temporary objects together. The individual objects are not each independent native `malloc` calls, so NMT accounts for the arena and its backing chunks rather than attaching a separate native allocation record to every tiny object. [`memory/arena.cpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/memory/arena.cpp) is the source entry point.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable HotSpot arena comparison"><a href="/images/courses/jvm/nmt-hotspot-arena-chunks.svg" aria-label="Open arena comparison"><img src="/images/courses/jvm/nmt-hotspot-arena-chunks.svg" alt="HotSpot arena chunks contain several temporary VM objects, whereas glibc arenas manage malloc chunks and Java FFM Arena scopes manage foreign-memory lifetimes." width="1080" height="600" /></a><figcaption>The shared word “arena” names three different layers; only the HotSpot column describes internal temporary VM object grouping.</figcaption></figure>

## 12. Three arena names, three owners

| Name | Who uses it | What it controls |
|---|---|---|
| HotSpot `Arena` | VM implementation code | Temporary objects within backing chunks |
| glibc malloc arena | Linux native allocator | Allocation concurrency and reusable native chunks, as in Lesson 53 |
| Java FFM `Arena` | Java Foreign Function and Memory API code | Lifetime and access of foreign memory segments |

A HotSpot arena's chunk can ultimately use a lower allocator layer, but the three abstractions must not be collapsed into one. Changing glibc arena settings does not change the meaning of a HotSpot `Arena` object, and closing a Java FFM arena does not directly manage HotSpot's internal compiler arenas.

## 13. Choose the tracking level at startup

NMT offers `off`, `summary` and `detail` through `-XX:NativeMemoryTracking=...`. `off` is the default. `summary` collects subsystem totals. `detail` adds native allocation-site information and a virtual memory map. A detail report can answer which native HotSpot location contributed to a category, but it does **not** give Java application stack traces. Use Java profiling, class-loading data or thread evidence when the question concerns application causes.

You must enable NMT when the JVM starts. `jcmd` can shut tracking down, but it cannot start or restart NMT in a process launched with it off. A later `jcmd ... detail` cannot manufacture allocation sites that summary mode never recorded.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable NMT tracking-level comparison"><a href="/images/courses/jvm/nmt-summary-vs-detail-internals.svg" aria-label="Open tracking-level comparison"><img src="/images/courses/jvm/nmt-summary-vs-detail-internals.svg" alt="Summary groups live memory by GC, Class, Thread and Code; detail adds native call sites and a virtual memory map, with neither column providing Java stack traces." width="1080" height="550" /></a><figcaption>Pick the evidence level before launch; detail identifies VM native sites, not the Java request path.</figcaption></figure>

## 14. Tracking has a cost

Each tracked malloc path does more work and maintains bookkeeping. Detail mode also retains information needed to report native sites and ranges. Oracle's [JDK 25 NMT guide](https://docs.oracle.com/en/java/javase/25/vm/native-memory-tracking.html) estimates **5–10% performance overhead** from enabling NMT. Treat that as a planning estimate, not a universal benchmark; cost depends on allocation rate, tracking level and workload. Tracking metadata also consumes memory, so a diagnostic run changes the system being measured to some degree.

This trade-off favors summary when category trends answer the immediate question and detail when native site evidence is needed. For a production investigation, choose the level before a controlled restart and compare performance under representative load.

## 15. Take a baseline after warm-up

Start a disposable or approved application process with detail tracking and a bounded heap:

```bash
java -XX:NativeMemoryTracking=detail -Xms512m -Xmx2g -jar application.jar
```

After the application reaches a representative steady phase, find its process ID and establish a reference snapshot:

```bash
jcmd <pid> VM.native_memory baseline
```

A baseline taken during class loading and JIT warm-up can produce large expected changes. Record the workload, timestamp, thread count and Java heap commitment beside the baseline so a later difference has context.

## 16. Compare subsystem changes first

Run comparable load, then inspect:

```bash
jcmd <pid> VM.native_memory summary.diff scale=MB
```

An illustrative interpretation table is more useful than pretending the exact output is predictable:

| Category with positive delta | First question |
|---|---|
| `Class` | Were more classes or class loaders retained? |
| `Code` | Was JIT compilation still filling the Code Cache? |
| `GC` | Did collector metadata grow with heap commitment or region activity? |
| `Thread` | Did platform-thread count or stack use rise? |
| `Compiler` | Were compiler structures active or retained during the interval? |

Read each category's `malloc`, arena and virtual memory sublines. A positive delta is a lead; repeated growth under comparable load and an ownership explanation are needed before calling it a leak.

## 17. Narrow with native sites

Because this process started in detail mode, follow the summary with:

```bash
jcmd <pid> VM.native_memory detail.diff scale=KB
```

The smaller unit keeps modest site changes visible. Detail output can show aggregated native allocation sites and a virtual memory map, but it is still a snapshot comparison. A site in HotSpot source is where memory was recorded, not necessarily the Java request, library call or business feature that indirectly caused it. Connect the native site to workload timing and other runtime evidence before changing code.

## 18. A reproducible platform-thread lab

This bounded program creates 100 **platform threads** after a 20-second baseline window, holds them for another 20 seconds, then releases and joins them. The latches make the observation windows deterministic enough for a manual `jcmd` comparison. The worker threads wait rather than recurse, so they do not deliberately touch their full stack reservations.

Save it as `NmtThreadLab.java`:

```java
import java.util.concurrent.CountDownLatch;

public class NmtThreadLab {
    private static final int THREADS = 100;

    public static void main(String[] args) throws Exception {
        CountDownLatch ready = new CountDownLatch(THREADS);
        CountDownLatch release = new CountDownLatch(1);
        System.out.println("PID " + ProcessHandle.current().pid());
        System.out.println("Baseline window: 20 seconds before creating workers");
        Thread.sleep(20_000);

        Thread[] workers = new Thread[THREADS];
        for (int i = 0; i < THREADS; i++) {
            workers[i] = Thread.ofPlatform().name("nmt-worker-" + i).start(() -> {
                ready.countDown();
                try {
                    release.await();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
        }
        ready.await();
        System.out.println("Workers alive: inspect NMT for 20 seconds");
        Thread.sleep(20_000);
        release.countDown();
        for (Thread worker : workers) worker.join();
        System.out.println("Workers joined");
    }
}
```

In one terminal:

```bash
javac NmtThreadLab.java
java -XX:NativeMemoryTracking=detail -Xms512m -Xmx2g NmtThreadLab
```

In another, use the printed PID during the first window, then again after `Workers alive`:

```bash
jcmd <pid> VM.native_memory baseline
jcmd <pid> VM.native_memory summary.diff scale=MB
jcmd <pid> VM.native_memory detail.diff scale=KB
```

If you miss a window, rerun rather than interpreting a baseline taken after worker creation. Thread creation can fail under local process or memory limits; use a disposable environment with room for 100 threads. The program has no deliberate native-memory leak and ends after joining all workers.

## 19. Predict what the thread lab should show

The `Thread` category should generally show more threads and stack **reservation** while the workers are alive. A platform thread receives native stack address space, but waiting at a latch does not touch every reserved stack page. Commitment and RSS need not rise by the full reservation. The exact stack size, commitment and category sublines vary by operating system, `-Xss`, guard pages and HotSpot build. Other categories can shift because starting threads also triggers runtime work.

In one disposable macOS run with OpenJDK 25.0.2, the 100-worker interval showed `Thread reserved=252MB (+216MB)` and `committed=9MB (+8MB)` in `summary.diff`. The much larger reservation delta supports the prediction, but these values are observations from one run, not portable stack-size constants.

On Linux, correlate with process observations during both windows:

```bash
grep -E '^(VmRSS|VmSize|Threads):' /proc/<pid>/status
```

`VmSize` concerns virtual address space, `VmRSS` resident pages, and `Threads` the process count. For mapping detail, inspect `/proc/<pid>/smaps` or `smaps_rollup` with appropriate permission. `/proc` is Linux-specific; on macOS or Windows, use the platform's process and mapping tools and do not expect identical fields or stack commitment behavior. If you compare after the workers join, allow for allocator and OS retention before expecting RSS to fall.

## 20. NMT coverage stops at HotSpot's tracked paths

Oracle describes NMT as tracking HotSpot internal usage. It does not cover arbitrary third-party native code or all JDK class-library allocations; its class-data-sharing view also has limits. A JNI library that directly calls its own `malloc`, for example, may grow without a corresponding NMT category increase. Conversely, tracked HotSpot commitment can be stable while already committed pages become resident.

<mark>NMT committed and process RSS have different coverage and different meanings.</mark> Subtracting `NMT committed` from `RSS` does not produce “leaked bytes.” One is HotSpot's tracked allocation and virtual-memory accounting; the other is an OS resident-page observation with mapping, sharing and paging rules.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable NMT and RSS coverage diagram"><a href="/images/courses/jvm/nmt-vs-rss-coverage.svg" aria-label="Open NMT and RSS coverage"><img src="/images/courses/jvm/nmt-vs-rss-coverage.svg" alt="NMT covers tracked HotSpot malloc and virtual regions; third-party and some JDK native allocations may sit outside it, while RSS measures resident pages across process mappings." width="1080" height="590" /></a><figcaption>Coverage overlaps, but the two measurements are not parts of one subtraction equation.</figcaption></figure>

## 21. Production case: GC grows with RSS

Suppose a service's post-GC heap use stays steady, but NMT's `GC` committed line and RSS both rise over comparable traffic windows. First inspect whether heap **commitment**, collector region counts or remembered-set work also changed. A collector can legitimately need more metadata after a traffic or heap-capacity shift. Detail sites may identify the native allocation path, while GC logs and workload history explain why it was exercised.

If the GC category keeps growing after a return to comparable load and stable heap commitment, investigate the relevant structures and release paths. The paired rise is a strong lead about ownership; it is still not proof that every RSS byte belongs to GC or that the growth is a leak.

## 22. Production case: NMT is flat while RSS grows

Suppose NMT's tracked commitment stays nearly flat while RSS rises. Continue at the OS layer: compare anonymous and file-backed mappings, page residency within existing committed ranges, allocator retention and third-party native allocations. On Linux, `/proc/<pid>/smaps` or `smaps_rollup` helps locate resident growth; in a container, inspect the correct cgroup's `memory.current` and `memory.stat` as a further accounting boundary. Cgroup usage can include file cache, kernel charges and other processes, so it need not equal this JVM's RSS.

This is the Lesson 53 diagnostic loop in reverse: NMT narrows what HotSpot currently owns, while mapping and allocator evidence explain physical residency. A flat NMT graph does not clear all native code.

## 23. Read JDK 25 source in three short traces

Use the immutable OpenJDK [`jdk-25+36` tag](https://github.com/openjdk/jdk/tree/jdk-25%2B36), rather than the changing `master` branch, when checking the implementation described here.

1. **Malloc trace:** in [`runtime/os.cpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/runtime/os.cpp), find `os::malloc` and `os::free`; follow `MemTracker::record_malloc` and `record_free` in [`memTracker.hpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/nmt/memTracker.hpp); then inspect [`mallocTracker.hpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/nmt/mallocTracker.hpp), [`mallocHeader.hpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/nmt/mallocHeader.hpp) and [`memTag.hpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/nmt/memTag.hpp). Ask where the outer pointer becomes the caller's inner pointer and where the live tag counter changes.
2. **Virtual trace:** search `os.cpp` for reserve, commit, uncommit and release calls to `MemTracker`; follow the range bookkeeping in [`virtualMemoryTracker.hpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/nmt/virtualMemoryTracker.hpp). Ask which operation changes reserved bytes and which changes committed bytes.
3. **Arena trace:** inspect chunk acquisition and arena allocation in [`memory/arena.cpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/memory/arena.cpp). Ask which requests obtain backing chunks and why every small arena object is not a separate native `malloc` record.

This is an implementation reading path for JDK 25 HotSpot, not a Java language guarantee. Platform-specific source files and VM configuration can alter details around the shared path.

## 24. Check your reasoning

<details class="lesson-check"><summary>HotSpot frees a tracked GC buffer. NMT falls but RSS stays flat. Is that inconsistent?</summary><p>No. NMT decrements outstanding tracked bytes; the native allocator may retain freed pages, so process residency can remain unchanged.</p></details>
<details class="lesson-check"><summary>A report shows 4 GiB Java Heap reserved and 512 MiB committed. How much of that heap must be resident?</summary><p>Neither number determines residency. Reservation is address space and commitment is available backing under OS rules. Measure touched resident pages at the OS layer.</p></details>
<details class="lesson-check"><summary>Why can detail mode show a native allocation site but not the Java method that triggered it?</summary><p>NMT records HotSpot native call sites at its tracking boundary. It does not capture a Java application stack for every native allocation.</p></details>
<details class="lesson-check"><summary>Can you enable NMT detail after launching with tracking off?</summary><p>No. Choose the tracking level at JVM startup. A later command cannot recover records that were never collected.</p></details>
<details class="lesson-check"><summary>Why should 100 waiting platform threads increase reservation more than RSS?</summary><p>Native stacks reserve address ranges, while waiting threads usually touch only part of their stack. Commitment and resident pages are platform and workload dependent.</p></details>
<details class="lesson-check"><summary>NMT is flat and RSS rises by 300 MB. Is 300 MB an untracked leak?</summary><p>No. Existing committed pages may have become resident, an allocator may retain freed pages, or untracked mappings may grow. Inspect OS mappings and allocation lifetimes before diagnosing a leak.</p></details>

## The complete memory model

A useful investigation now has three linked questions. **Java heap evidence** asks how object use and heap capacity changed. **NMT** asks what tracked HotSpot subsystems currently allocate, reserve and commit. **OS and cgroup evidence** asks which pages are resident or charged. The answers overlap but are not a single balance sheet. Follow a change from the owner, through the allocation path and its accounting, to the process mapping before deciding whether the memory is live, reusable or physically resident.

<mark>A rising category is a starting point for tracing ownership and lifetime, not a leak diagnosis.</mark> Detail sites refine that starting point; comparable snapshots and the OS view complete it.

Continue with [Lesson 55, *Safepoint diagnostics*](/courses/jvm/safepoint-diagnostics) to distinguish time spent coordinating Java threads from time spent in a non-GC VM operation.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on the approved Daily JVM Byte #54 review and the supplied Byte. Diagrams, figures and production cases are illustrative. The commands and source paths target JDK 25 HotSpot; the 100-thread lab compiled and ran on macOS with OpenJDK 25.0.2 and its reported Thread deltas are measured from that run. The other scenarios and reports remain illustrative. Platform-specific virtual-memory and stack behavior can differ.</p><ul><li><a href="https://docs.oracle.com/en/java/javase/25/vm/native-memory-tracking.html">Oracle JDK 25 Native Memory Tracking guide</a></li><li><a href="https://github.com/openjdk/jdk/tree/jdk-25%2B36/src/hotspot/share/nmt">OpenJDK jdk-25+36 NMT source directory</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/runtime/os.cpp">OpenJDK jdk-25+36 runtime/os.cpp</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/memory/arena.cpp">OpenJDK jdk-25+36 memory/arena.cpp</a></li><li><a href="https://www.kernel.org/doc/html/latest/filesystems/proc.html">Linux procfs memory fields</a></li><li><a href="https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html">Linux cgroup v2 memory accounting</a></li></ul></details>
