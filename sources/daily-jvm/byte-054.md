## JVM Mastery — Pulse Check

We are at **Daily JVM Byte #53**.

### Coverage so far

| Area | Status |
|---|---|
| JVM runtime model & memory layout | ✅ |
| Object layout, references, TLAB allocation | ✅ |
| GC roots, reachability & barriers | ✅ |
| Class loading, constant pool & linking | ✅ |
| Stack frames, bytecode & interpreter | ✅ |
| C1/C2, tiered compilation & profiling | ✅ |
| Inlining, escape analysis & scalar replacement | ✅ |
| Deoptimization, OSR & code cache | ✅ |
| Safepoints, OopMaps & VM operations | ✅ |
| Threads, synchronization & locking internals | ✅ |
| G1 architecture & young GC | ✅ |
| G1 concurrent marking, mixed GC & failure modes | ✅ |
| Generational ZGC & concurrent relocation | ✅ |
| GC barriers + JIT integration | ✅ |
| GC ergonomics & performance measurement | ✅ |
| Containers / heap vs native memory | ✅ |
| RSS & native allocator behaviour | ✅ |
| NMT internals | **Next** |
| Deeper diagnostics + HotSpot internals | ⏳ |

### Where we are

I'd estimate **~75–80% of the planned mastery horizon is complete**.

We originally expected roughly **60–75 bytes**. Given the depth we've developed, a sensible finish now looks like approximately **65–70 bytes** rather than stretching topics artificially.

So:

**53 completed → ~12–17 remaining days.**

The remaining section should increasingly become **integration-oriented**: NMT internals → JVM/OS diagnostics → reading HotSpot structures/source → connecting GC/JIT/threads/memory into production failure scenarios.

That should give the course an actual endpoint rather than turning Daily JVM Byte into an indefinitely expanding JVM encyclopedia.

# Daily JVM Byte #54 — Native Memory Tracking Internals: How HotSpot Accounts for Memory

**Baseline:** JDK 25 LTS  
**Focus:** NMT implementation, allocation tracking, memory categories, and diagnostic limitations.

In Byte #53, we examined why process RSS can remain elevated even after native memory has been freed.

That raises another question:

> **How does HotSpot know how much native memory it has allocated, where that memory belongs, and which subsystem is responsible?**

The answer is Native Memory Tracking (NMT).

Today we'll go one level below the `jcmd` commands and examine how NMT works internally.

---

## 1. NMT is accounting, not memory management

NMT does not allocate memory on behalf of every JVM subsystem, nor does it decide when memory should be released.

Instead, it instruments HotSpot's existing allocation mechanisms.

Conceptually:

```text
HotSpot subsystem
       │
       ▼
Request native memory
       │
       ▼
HotSpot allocation interface
       │
       ├── NMT records allocation
       │
       ▼
Operating-system allocator
       │
       ▼
Native memory
```

When memory is released, HotSpot updates the corresponding NMT accounting.

This distinction is important:

**NMT observes memory-management operations. It does not independently determine which native allocations are still useful.**

---

## 2. HotSpot tracks different allocation mechanisms

HotSpot uses several approaches to native memory allocation.

NMT distinguishes these mechanisms because they have different ownership and accounting semantics.

| Mechanism | Typical purpose | NMT accounting |
|---|---|---|
| `malloc` | Small and medium native allocations | Allocation size, category, count |
| Virtual memory reservation | Heap, code cache, metaspace | Reserved address space |
| Virtual memory commitment | Backing portions of reserved regions | Committed memory |
| HotSpot arenas | Groups of temporary allocations | Arena/chunk memory usage |

Let's examine them.

### A. Tracking `malloc`

Consider a simplified HotSpot allocation:

```cpp
void* p = os::malloc(size, mtGC);
```

The `mtGC` argument identifies the allocation's memory category.

Internally, NMT can associate the allocation with metadata such as:

```text
Allocation:
    Size:      4096 bytes
    Category:  GC
    Call site: allocation origin
```

The exact metadata retained depends on the NMT tracking level.

When HotSpot calls:

```cpp
os::free(p);
```

the allocation is removed from NMT's live accounting.

Consequently, NMT reports memory that HotSpot still considers allocated, rather than every allocation that has occurred since startup.

### B. Tracking virtual memory

Large JVM memory areas frequently use virtual memory reservation and commitment.

For example:

```text
Reserve 4 GB
     │
     ▼
Virtual address space exists
     │
     ▼
Commit 512 MB
     │
     ▼
Additional memory becomes available
     │
     ▼
Commit another 512 MB
```

NMT records reservation and commitment changes separately.

An illustrative report might show:

```text
Java Heap:
    reserved = 4194304 KB
    committed = 1048576 KB
```

This means HotSpot has reserved 4 GiB of address space and committed 1 GiB.

It does not mean the entire 4 GiB is physically resident.

### C. Tracking HotSpot arenas

HotSpot also uses arena-based allocation for temporary VM data structures.

An arena obtains larger chunks and satisfies multiple smaller allocation requests from those chunks.

```text
HotSpot Arena
     │
     ├── Chunk 1
     │    ├── Object A
     │    ├── Object B
     │    └── Object C
     │
     └── Chunk 2
          ├── Object D
          └── Object E
```

Rather than independently tracking every small arena allocation, NMT accounts for the arena's underlying memory.

This reduces tracking overhead.

**Important distinction:** HotSpot's internal arenas are not the same thing as glibc malloc arenas discussed in Byte #53, or the Java Foreign Function and Memory API's `Arena`.

They represent different abstraction layers.

---

## 3. NMT memory categories: where the allocation belongs

HotSpot associates tracked allocations with memory tags.

For example:

```cpp
os::malloc(size, mtGC);
```

identifies memory associated with GC infrastructure.

Other allocations may belong to compiler, class metadata, code, or internal runtime categories.

An illustrative NMT summary:

```text
Total:
    reserved=6200MB
    committed=1800MB

- Java Heap
    reserved=4096MB
    committed=1024MB

- Class
    reserved=1050MB
    committed=120MB

- Thread
    reserved=500MB
    committed=100MB

- Code
    reserved=250MB
    committed=80MB

- GC
    reserved=300MB
    committed=250MB
```

These categories answer:

**Which HotSpot subsystem owns the tracked memory?**

They do not necessarily answer:

**Which Java application component caused that subsystem to consume more memory?**

For example, increased class metadata consumption might result from dynamic class generation, but NMT does not directly identify the Java code responsible for generating those classes.

---

## 4. Summary versus detail: what changes internally?

NMT supports three tracking levels:

```text
off
summary
detail
```

### Summary mode

```bash
-XX:NativeMemoryTracking=summary
```

NMT maintains aggregated allocation information.

Conceptually:

```text
GC:
    malloc bytes
    malloc allocation count
    reserved virtual memory
    committed virtual memory
```

This is useful for answering:

> Which memory category is growing?

### Detail mode

```bash
-XX:NativeMemoryTracking=detail
```

Detail mode additionally records allocation-site information and detailed virtual-memory regions.

Conceptually:

```text
GC
 │
 ├── Allocation site A: 40 MB
 ├── Allocation site B: 15 MB
 └── Allocation site C: 10 MB
```

This helps answer:

> Where inside HotSpot is that memory being allocated?

The allocation sites refer to native HotSpot code, not Java application stack traces.

Oracle documents both tracking levels in its [JDK 25 Native Memory Tracking guide](https://docs.oracle.com/en/java/javase/25/vm/native-memory-tracking.html?utm_source=chatgpt.com).

---

## 5. Why NMT has performance overhead

Tracking allocations requires additional work.

For malloc-backed allocations, HotSpot must maintain allocation metadata and update accounting structures.

Detail mode additionally records allocation origins.

Conceptually:

```text
Without NMT:

malloc()
   ↓
Return memory


With NMT:

malloc()
   ↓
Record metadata
   ↓
Update accounting
   ↓
Return memory
```

This introduces CPU and memory overhead.

Oracle documents approximately **5–10% performance overhead** from enabling NMT, although actual overhead depends on workload and allocation behavior.

This creates a practical trade-off:

| Mode | Diagnostic value | Cost |
|---|---|---|
| Off | No NMT visibility | Lowest |
| Summary | Subsystem-level accounting | Additional overhead |
| Detail | Native allocation-site investigation | Greater tracking cost |

NMT must be enabled when the JVM starts. You cannot turn it on for an already-running JVM that started with NMT disabled.

---

## 6. Hands-on: follow a native memory increase

Start an application with detail tracking:

```bash
java \
  -XX:NativeMemoryTracking=detail \
  -Xmx2g \
  -jar application.jar
```

### Step 1 — Establish a baseline

After application startup and warm-up:

```bash
jcmd <pid> VM.native_memory baseline
```

This establishes a reference point for subsequent comparisons.

### Step 2 — Generate application load

Run a representative workload that exercises allocations, class loading, compilation, or other JVM activities.

### Step 3 — Compare memory consumption

```bash
jcmd <pid> VM.native_memory summary.diff scale=MB
```

Illustrative output:

```text
Total:
    reserved=6200MB +100MB
    committed=1800MB +85MB

- Class
    reserved=1050MB +0MB
    committed=120MB +60MB

- Code
    reserved=250MB +0MB
    committed=80MB +20MB
```

This suggests class metadata and code-cache commitment increased during the observation interval.

It does not establish that either category is leaking.

### Step 4 — Inspect allocation sites

Because the JVM started with detail tracking:

```bash
jcmd <pid> VM.native_memory detail.diff scale=KB
```

The detail report provides native allocation-site and virtual-memory information.

Use it to narrow the investigation from:

```text
Which subsystem grew?
```

to:

```text
Which HotSpot allocation sites contributed?
```

**Practical distinction:** A positive difference shows growth since the baseline, not necessarily a leak. Warm-up, class loading, JIT compilation, and cache expansion can all produce legitimate growth.

---

## 7. Why NMT cannot explain every byte of RSS

Recall Byte #53.

Suppose:

```text
NMT committed:  1.8 GB
Process RSS:    2.6 GB
```

Why the difference?

NMT tracks HotSpot's internal allocations, but its coverage is not universal.

It does not fully account for allocations performed by third-party native libraries or JDK class libraries.

Additionally, NMT's committed-memory accounting differs fundamentally from resident-memory accounting.

Consider:

```text
HotSpot
   │
   ├── Tracked native allocations
   │       └── NMT
   │
   └── JVM-managed virtual memory
           └── NMT

Native libraries / other allocations
   │
   └── May not be tracked by NMT

Operating system
   │
   └── Tracks resident memory
```

Two important consequences follow.

First, memory can remain resident inside a native allocator even after HotSpot has freed an allocation and NMT has reduced its accounting.

Second, an allocation can be committed without every page being resident.

Therefore:

**`RSS - NMT committed` is not a reliable calculation of untracked native memory.**

The measurements describe different properties of memory.

---

## 8. Connecting NMT to HotSpot source

For source-code exploration, the relevant OpenJDK implementation areas include:

| Source area | Responsibility |
|---|---|
| `src/hotspot/share/nmt/memTracker.hpp` | Central NMT tracking interface |
| `src/hotspot/share/nmt/mallocTracker.*` | Native malloc accounting |
| `src/hotspot/share/nmt/virtualMemoryTracker.*` | Virtual memory reservation and commitment tracking |
| `src/hotspot/share/nmt/memTag.hpp` | Memory category definitions |
| `src/hotspot/share/runtime/os.cpp` | OS allocation interfaces |
| `src/hotspot/share/memory/arena.cpp` | HotSpot arena allocation infrastructure |

These provide a useful source-reading path:

```text
HotSpot subsystem
       │
       ▼
os::malloc()
       │
       ▼
MemTracker
       │
       ▼
MallocTracker
       │
       ▼
Native allocator
```

For virtual memory, the tracking path instead involves reservation, commitment, and release operations recorded through NMT's virtual-memory tracking infrastructure.

You can explore the implementation in the [OpenJDK source repository](https://github.com/openjdk/jdk/tree/master/src/hotspot/share/nmt?utm_source=chatgpt.com). Use the JDK 25 source tag when comparing exact implementation details.

---

## Mental model checkpoint

We have now connected three distinct layers:

```text
             Java Application
                    │
                    ▼
               HotSpot JVM
                    │
          ┌─────────┴─────────┐
          │                   │
          ▼                   ▼
     Java Heap          Native Memory
          │                   │
          ▼                   ▼
      GC Metrics              NMT
          │                   │
          └─────────┬─────────┘
                    │
                    ▼
             Operating System
                    │
                    ▼
              RSS / cgroups
```

Each layer answers a different question.

GC metrics explain Java object retention and heap behavior.

NMT explains tracked HotSpot memory allocations and commitments.

OS metrics explain physical memory residency and container memory accounting.

### Key takeaway

**NMT is HotSpot's internal memory-accounting system, not a complete process-memory profiler.**

Its primary value is identifying which JVM subsystems are consuming native memory and, in detail mode, which native allocation sites contribute to that consumption.

Its limitations become especially important when investigating RSS growth or Kubernetes OOM kills.

### Next byte — #55: Safepoint Diagnostics — When the JVM Stops the World Without GC

We'll return to HotSpot execution internals and investigate why application threads sometimes stop even when no garbage collection occurs.

We'll connect safepoint polling, VM operations, thread synchronization, and JFR events to explain pauses that GC logs alone may not reveal.