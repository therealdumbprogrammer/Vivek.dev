---
title: Why JVM RSS keeps growing while heap usage stays flat
summary: Trace rising process RSS through heap commitment, native allocation lifetimes, glibc retention and page residency before diagnosing a leak.
course: jvm
lessonSlug: jvm-rss-growth-stable-heap
module: HotSpot Internals
order: 530
sourceByte: byte-053
draft: true
prerequisites:
  - jvm-memory-ergonomics-containers
jdk: JDK 25 · HotSpot and Linux/glibc
---

[Lesson 52](/courses/jvm/jvm-memory-ergonomics-containers) established that `-Xmx` limits Java heap capacity while the operating system and container account for a broader footprint. Now imagine a Spring Boot service approaching its Kubernetes memory limit even though each garbage collection leaves roughly the same amount of Java data behind.

| Time | Post-GC heap used | Process RSS |
|---|---:|---:|
| 10:00 | 800 MB | 1.4 GB |
| 11:00 | 810 MB | 1.8 GB |
| 12:00 | 805 MB | 2.2 GB |
| 13:00 | 815 MB | 2.6 GB |

The post-GC heap has varied by only 15 MB, while resident set size (RSS), the process's resident physical pages, has risen about 1.2 GB. Those numbers do not identify a native leak. Heap capacity may have expanded; native code may own more live allocations; an allocator may retain freed chunks; or existing mappings may have become resident. We need to identify which boundary changed.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable stable heap and rising RSS chart"><a href="/images/courses/jvm/jvm-rss-growth-symptom.svg" aria-label="Open heap and RSS chart"><img src="/images/courses/jvm/jvm-rss-growth-symptom.svg" alt="Four time points show post-GC heap near 800 MB while process RSS rises from 1.4 to 2.6 GB; possible causes branch beneath the gap." width="1080" height="540" /></a><figcaption>The gap is an investigation target, not a measurement of leaked native memory. Values are illustrative.</figcaption></figure>

## First separate heap use from heap capacity

**Used heap** describes space occupied by allocated objects at the measurement instant. Post-GC used heap is a useful retention trend, though it is not always an exact live-set measurement. **Committed heap** is capacity HotSpot has obtained backing for and can use. **Reserved heap** is virtual address space set aside for possible growth. `-Xmx` caps the heap's configured maximum; it does not report current use, commitment or residency.

Suppose a JVM starts with `-Xms512m -Xmx4g`. It initially uses 400 MB of a 512 MB committed heap. A traffic burst raises used heap to 3.0 GB and causes commitment to reach 3.5 GB. After traffic subsides and GC reclaims short-lived objects, used heap returns to 400 MB while commitment may remain 3.5 GB. A collector can later uncommit unused capacity subject to its policy and minimum-heap constraints, but that need not happen immediately.

| Phase | Heap used | Heap committed |
|---|---:|---:|
| Before burst | 400 MB | 512 MB |
| During burst | 3.0 GB | 3.5 GB |
| After GC | 400 MB | 3.5 GB |

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable heap use and commitment timeline"><a href="/images/courses/jvm/jvm-heap-used-vs-committed.svg" aria-label="Open heap timeline"><img src="/images/courses/jvm/jvm-heap-used-vs-committed.svg" alt="Three stages show used heap rising during a burst then falling to 400 MB, while committed capacity remains at 3.5 GB after GC." width="1080" height="500" /></a><figcaption>GC can reclaim objects while HotSpot retains expanded heap capacity for future allocations.</figcaption></figure>

<mark>Stable post-GC heap use does not imply stable heap commitment or stable heap RSS.</mark> Check committed capacity before attributing a rise in RSS to native memory. A heap expansion can account for much of the symptom, although commitment by itself does not say how many pages are physically resident.

## Commitment and residency answer different questions

A virtual reservation identifies an address range. Commitment makes backing available for part of that range under the operating system's memory rules. RSS counts pages currently resident for this process. These are related stages, not interchangeable totals. A committed page might not yet have been touched; later access can make it resident without changing commitment. Conversely, a page can leave the resident set without changing the virtual range.

For example, NMT might show 2.0 GB committed at both measurements while RSS rises from 1.3 to 1.8 GB. More of the existing committed memory may have been touched. The mapping type, sharing and paging behavior matter, so inspect process maps before inferring newly live allocations. NMT committed and RSS also use different coverage rules; subtracting one from the other does not yield an exact leak size.

## Follow the lifetime of a native buffer

GC finds unreachable Java objects and makes their heap space reusable. Native code often uses an allocator through `malloc()` and `free()`. After `free()`, the application no longer owns that allocation, but the allocator may keep its backing pages for later requests. The Java collector cannot compact arbitrary glibc allocations or force the allocator to release them.

For a representative retention exercise, think of **many smaller buffers**, allocated, touched and freed over several threads. Some chunks may remain in allocator-managed arenas. A single `malloc(100 * 1024 * 1024)` is a poor general example of arena retention: glibc may service a sufficiently large allocation with a dedicated `mmap()` mapping, and freeing it can unmap that range. The size decision depends on thresholds and configuration, including a threshold glibc can adjust dynamically.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable arena and dedicated mapping comparison"><a href="/images/courses/jvm/glibc-arena-vs-mmap-allocation.svg" aria-label="Open allocator path comparison"><img src="/images/courses/jvm/glibc-arena-vs-mmap-allocation.svg" alt="Small arena-managed chunks can remain in reusable arena space after free, while a large dedicated mmap allocation can be unmapped when freed; branch depends on glibc policy." width="1080" height="540" /></a><figcaption>`free()` ends application ownership; the path chosen by glibc determines whether backing storage can be released immediately.</figcaption></figure>

A native buffer can occupy three different ownership states over its lifetime. The application owns it only in the first; what happens to backing space after release depends on the allocation path.

| State after an allocation | Who can reuse it? | What RSS can show |
|---|---|---|
| Still live in native code | Its current owner | Touched pages may remain resident |
| Freed within allocator-managed space | The allocator, for a future request | Freed pages may still be resident |
| Dedicated mapping released | The operating system | Its pages leave this process's mapping |

The middle row is the subtle one. A `free()` call changes the allocator's bookkeeping; it does not promise a matching drop in process RSS. The final row explains why a large allocation can behave differently without contradicting that rule.

### glibc arenas: concurrency with a footprint cost

On many Linux systems, glibc uses multiple **arenas**, separate allocation structures that reduce contention when threads allocate concurrently. A thread is not permanently paired with exactly one arena; arenas can be reused and shared. Imagine three arenas that each held 100 MB, with 80, 70 and 90 MB respectively freed. Arena A still has 20 MB live, B has 30 MB, and C has 10 MB: **60 MB of live allocations in total**. The allocator may retain some of the other 240 MB as reusable space. This is an illustrative capacity example, not a prediction that all 300 MB remains resident. How many pages stay resident depends on which chunks were touched, where the free chunks lie, and glibc's release policy.

A later request can reuse freed space in an appropriate arena, avoiding a fresh system allocation. But free space in separate arenas is not one universally interchangeable pool at every instant. Under a repeatable traffic pattern, RSS may climb during warm-up and then level off as requests reuse retained chunks. Under changed traffic or continued outstanding allocations, it may climb again. The throughput benefit therefore has a footprint cost that matters especially under a container limit.

### Fragmentation constrains page release

Fragmentation adds another constraint. An arena might contain `[AAAA][BBBB][CCCC][DDDD][EEEE]`; after B and D are freed it contains `[AAAA][FREE][CCCC][FREE][EEEE]`. The free chunks are reusable, yet their pages can share space with live chunks or sit where a larger releasable range cannot be formed. Native allocator fragmentation and Java heap fragmentation belong to different managers. Moving Java objects during GC does not rearrange these native chunks. A free chunk can be logically reusable even when its page still contains a live neighbor. The allocator cannot simply discard that whole page. A wholly free page or releasable range may be returned when its policy allows.

### What trimming can establish

glibc's `malloc_trim(0)` asks its allocator to return suitable free pages. It may release some, none or an amount too small to explain the whole RSS change. It is not equivalent to `System.gc()`: one acts on glibc-managed free space, the other requests Java garbage collection, whose behavior is JVM dependent. Repeated trimming can also increase future allocation work. Use it only as a controlled allocator experiment after identifying the allocation path. glibc documents its [allocation tunables](https://sourceware.org/glibc/manual/latest/html_node/Memory-Allocation-Tunables.html); the exact behavior varies with version and workload.

## Three mechanisms that can look alike

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable comparison of leak, retention and page touching"><a href="/images/courses/jvm/native-leak-vs-allocator-retention.svg" aria-label="Open three-mechanism comparison"><img src="/images/courses/jvm/native-leak-vs-allocator-retention.svg" alt="Three panels distinguish growing live native allocations, freed chunks kept resident for allocator reuse, and existing committed pages becoming resident when touched." width="1080" height="570" /></a><figcaption>Similar RSS curves can come from different ownership and residency changes; more than one mechanism can occur at once.</figcaption></figure>

A **genuine live native allocation leak** means ownership persists unintentionally: allocation volume grows and corresponding frees do not occur. **Allocator retention** means allocations were freed, yet reusable space remains held and possibly resident. **Page touching** means an existing committed range becomes resident as activity reaches it. These mechanisms can coexist. A plateau under repeatable load suggests reuse, but it does not prove the absence of a slow leak or a later workload change.

## Correlate HotSpot and Linux evidence

Start Native Memory Tracking (NMT) when launching the JVM. It cannot be enabled retroactively for an already running process. After warm-up, take a baseline and compare a later interval with similar traffic:

```bash
java -XX:NativeMemoryTracking=summary -Xms512m -Xmx4g -jar application.jar
jcmd <pid> VM.native_memory baseline
# After a comparable workload interval:
jcmd <pid> VM.native_memory summary.diff scale=MB
```

Look at **committed deltas** in `Java Heap`, `Class`, `Thread`, `Code`, `GC`, `Internal` and any other reported category. If `Java Heap` commitment grows, revisit heap expansion. A growing `Thread` category suggests examining thread count and stacks; `Class` points toward class loading and loader lifetime; `Code` toward compilation and Code Cache; `GC` toward collector structures. These are directions for investigation, not one-to-one RSS explanations.

Oracle's [JDK 25 NMT guide](https://docs.oracle.com/en/java/javase/25/vm/native-memory-tracking.html) says NMT covers HotSpot's internal usage and does not track third-party native code or all JDK class-library allocations. It reports tracked reservation and commitment, not process residency. A flat NMT diff alongside rising RSS therefore leaves untracked live allocations, allocator retention, and page touching open. A falling tracked commitment can also coexist with allocator-held resident pages. For example, HotSpot may stop accounting for a freed allocation while glibc retains the underlying arena pages. That makes a trend comparison useful, but not an exact balance sheet. Avoid `RSS - NMT committed = leaked memory`: the operands have different coverage, residency and sharing rules.

On Linux, compare process measurements from the same time window:

```bash
PID=<pid>
grep -E '^(VmRSS|VmSize|RssAnon|Threads):' /proc/$PID/status
grep -E '^(Rss|Pss|Anonymous|Private_Dirty):' /proc/$PID/smaps_rollup
# If a mapping needs closer inspection:
less /proc/$PID/smaps
pmap -x "$PID"
```

`VmRSS` is process resident memory; `VmSize` is virtual address size; `RssAnon` narrows the resident anonymous portion; `Threads` provides a stack-growth clue. In `smaps_rollup`, `Rss` totals resident mapped pages, `Pss` apportions shared pages, `Anonymous` identifies anonymous resident pages, and `Private_Dirty` measures private dirty pages. `smaps` and `pmap -x` help locate mapping-level changes; availability and field detail vary by system and permissions. The [Linux procfs documentation](https://www.kernel.org/doc/html/latest/filesystems/proc.html) defines these fields.

If the service runs in a cgroup v2 container, also read the relevant cgroup's `memory.current` and `memory.stat`. `memory.current` includes charges such as file cache and kernel memory and can include more than one process, so it can differ from this JVM's RSS. Find the actual cgroup mount/path rather than assuming the host's `/sys/fs/cgroup` root is the service's cgroup. For a container where that is the correct cgroup v2 mount, sample it alongside the process:

```bash
cat /sys/fs/cgroup/memory.current
cat /sys/fs/cgroup/memory.stat
```

Align timestamps across heap, NMT, procfs and cgroup measurements.

## An investigation from the production graph

Return to the service whose RSS rose from 1.4 to 2.6 GB. First ask whether post-GC used heap is rising over comparable cycles. If it is, investigate Java retention and allocation behavior. If it stays near 800–815 MB, inspect committed heap: a rise after a burst can explain more resident heap pages without a Java-object leak. Next compare NMT committed categories. If a category grows, investigate its owner and workload. If heap and NMT commitment are flat, examine anonymous and file-backed mappings, native allocation ownership, allocator reuse and touched pages.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable JVM RSS investigation decision tree"><a href="/images/courses/jvm/jvm-memory-investigation-flow.svg" aria-label="Open RSS investigation flowchart"><img src="/images/courses/jvm/jvm-memory-investigation-flow.svg" alt="Decision tree starts with rising RSS, checks post-GC heap used, heap committed and NMT committed in order, then branches to mapping, live native allocation, allocator retention and residency investigation." width="1080" height="760" /></a><figcaption>Each branch selects the next measurement. No branch diagnoses a leak from RSS alone.</figcaption></figure>

Suppose the interval shows **1.2 GB more RSS with both committed heap and NMT committed essentially stable**. This narrows the search but does not prove that all 1.2 GB belongs to an untracked allocator. If `smaps` shows growing anonymous mappings, inspect native libraries, direct or other off-heap buffers and allocation/free histories. If mapping sizes are stable but resident pages grow, test the page-touching explanation. If repeated load warms the process and RSS then plateaus while allocation/free counts balance, allocator reuse becomes plausible. If live outstanding native allocations keep rising, pursue a native leak. File-backed mapping changes or cgroup charges may instead lead elsewhere.

Two other incidents show why the branch order matters.

**Case: NMT's `Thread` commitment and thread count both rise.** A service creates platform threads faster than it retires them. The heap's post-GC use can stay flat while stack reservations, touched stack pages and related native structures increase. Compare `Threads` in `/proc/$PID/status`, NMT's `Thread` category, thread dumps and the application's executor configuration. Reducing glibc arenas would not resolve a thread lifecycle problem. Remember that a stack reservation is not necessarily fully resident from thread creation; RSS follows touched pages.

**Case: process RSS is flat but `memory.current` rises.** The container approaches its limit while the JVM process has not added resident pages. Inspect `memory.stat`, other processes in the cgroup and file/cache or kernel charges. Treating the cgroup delta as a native leak in the JVM would send the investigation to the wrong owner. This case extends Lesson 52's container boundary rather than changing the process RSS diagnosis.

The response should follow the measured owner:

| Evidence points to | Next action to evaluate |
|---|---|
| More live Java objects or persistent heap commitment | Examine object retention, collector behavior and the peak heap budget |
| Growing live native allocations | Find the allocating library and missing release or unbounded cache |
| Freed chunks retained by the allocator | Compare repeatable-load reuse, trimming and allocator settings with latency/CPU |
| Existing pages becoming resident or broader cgroup charge | Budget the working set; inspect mappings, file cache and cgroup components |

`-Xmx` changes and allocator flags should follow diagnosis, because either can add GC pressure or allocation contention without addressing the source.

For **glibc arena retention specifically**, a controlled comparison can try:

```bash
MALLOC_ARENA_MAX=2 java -jar application.jar
```

The environment variable limits glibc malloc arena creation, which can lower retention for some workloads and increase lock contention for others. Compare RSS, allocation throughput and request latency under the same traffic. This is glibc-specific and is not a portable knob for musl/Alpine, macOS, jemalloc or other allocators. It is not a general JVM leak fix.

## A bounded exercise to test the model

On a disposable Linux/glibc machine, this bounded program allocates 4,096 blocks of 4 KiB (16 MiB total), writes to each, frees seven of every eight, then frees the rest. It reads its own `VmRSS` after each stage. Keep it outside production; the small limit is deliberate.

```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define BLOCKS 4096
#define BYTES 4096

static void rss(const char *stage) {
    char line[256];
    FILE *file = fopen("/proc/self/status", "r");
    if (!file) return;
    while (fgets(line, sizeof line, file)) {
        if (strncmp(line, "VmRSS:", 6) == 0) {
            printf("%s: %s", stage, line);
            break;
        }
    }
    fclose(file);
}

int main(void) {
    void *blocks[BLOCKS] = {0};
    for (size_t i = 0; i < BLOCKS; ++i) {
        blocks[i] = malloc(BYTES);
        if (!blocks[i]) return 1;
        memset(blocks[i], 1, BYTES);  /* touch backing pages */
    }
    rss("after touch");
    for (size_t i = 0; i < BLOCKS; ++i)
        if (i % 8 != 0) { free(blocks[i]); blocks[i] = NULL; }
    rss("after freeing most");
    for (size_t i = 0; i < BLOCKS; ++i) free(blocks[i]);
    rss("after freeing all");
    return 0;
}
```

Save it as `rss_probe.c` and run `cc -O0 -Wall -Wextra rss_probe.c -o rss_probe && ./rss_probe`. Repeat the same process under the same conditions; compare RSS after the first and later passes if you extend the program. A sufficiently large allocation may follow a dedicated mapping path instead of the arena path. A `malloc_trim(0)` comparison can test whether suitable free pages are releasable. Neither a plateau nor trimming proves the absence of a leak. Results vary with glibc version, allocator thresholds, arena layout, transparent huge pages and OS behavior. These are instructions for a controlled exercise; no native workload was run for this lesson.

## Check your reasoning

<details class="lesson-check"><summary>Post-GC used heap returns to 400 MB, but committed heap stays at 3.5 GB. Where should you look first?</summary><p>At heap commitment and collector policy. The retained committed capacity may affect RSS after the burst; native allocator tuning is premature.</p></details>
<details class="lesson-check"><summary>Why might freeing one 100 MiB glibc allocation lower RSS promptly?</summary><p>glibc may have used a dedicated mmap mapping for a sufficiently large allocation; free can unmap it. The threshold and path are configuration dependent.</p></details>
<details class="lesson-check"><summary>Can freed native chunks remain resident while no application owner holds them?</summary><p>Yes. An arena may retain reusable chunks, especially where live chunks and free chunks share pages or prevent a releasable range.</p></details>
<details class="lesson-check"><summary>NMT commitment is flat while RSS grows. Does that prove an untracked native leak?</summary><p>No. Third-party allocation is one possibility, but already committed pages can become resident and allocator-held freed pages can persist. Inspect mappings and allocation lifetimes.</p></details>
<details class="lesson-check"><summary>RSS plateaus after repeated identical traffic. Has a leak been ruled out?</summary><p>No. Reuse is plausible, but a slower leak, changing request mix or later phase can still grow. Compare outstanding allocations and longer comparable intervals.</p></details>
<details class="lesson-check"><summary>Why can cgroup memory.current exceed the JVM's process RSS?</summary><p>A cgroup can charge file cache, kernel memory and other processes. It uses a different accounting boundary from one process's resident pages.</p></details>

## Mental model checkpoint

Trace the full path from an application's lifetime decisions to the container limit:

| Layer | Decision it makes | Evidence to compare |
|---|---|---|
| Java reachability and GC | Which Java objects still occupy heap space | Comparable post-GC used-heap samples |
| HotSpot heap and native managers | What capacity is reserved or committed | Heap commitment and NMT category diffs |
| Native allocator | Which chunks are live, freed for reuse, or unmapped | Allocation/free traces and controlled reuse tests |
| Operating system | Which pages of each mapping are resident | `/proc/$PID/status`, `smaps_rollup`, mapping-level `smaps` |
| Container memory controller | What is charged against the cgroup limit | `memory.current`, `memory.stat`, events |

GC can reclaim Java objects while HotSpot keeps heap capacity committed. Native code can call `free()` while glibc keeps arena pages available. The operating system can make previously committed pages resident when touched. Those changes cross different boundaries at different times. NMT describes HotSpot's tracked reservation and commitment; procfs describes process mappings and residency; the cgroup reports its own charge. <mark>Ownership, commitment and residency must be measured separately.</mark>

Continue with [Lesson 54: Native Memory Tracking internals](/courses/jvm/native-memory-tracking-internals) to trace how HotSpot accounts for `malloc`, virtual reservations and arena chunks, and how NMT reports native call sites and coverage limits.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on the approved Daily JVM Byte #53 review, with the original byte as supplementary source. Tables, diagrams and the production case are illustrative, not measured output. The commands were reviewed for JDK 25 HotSpot and Linux/glibc syntax; no JVM or native allocation workload was run. glibc behavior depends on version and configuration, and NMT covers HotSpot internals rather than all native memory.</p><ul><li><a href="https://docs.oracle.com/en/java/javase/25/vm/native-memory-tracking.html">Oracle JDK 25 Native Memory Tracking</a></li><li><a href="https://sourceware.org/glibc/manual/latest/html_node/Memory-Allocation-Tunables.html">GNU C Library memory allocation tunables</a></li><li><a href="https://www.kernel.org/doc/html/latest/filesystems/proc.html">Linux procfs process memory fields</a></li><li><a href="https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html">Linux cgroup v2 memory accounting</a></li></ul></details>
