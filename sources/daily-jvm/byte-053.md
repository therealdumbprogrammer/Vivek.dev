# Daily JVM Byte #53 — Why JVM RSS Keeps Growing While Heap Usage Stays Flat

**Baseline:** JDK 25 LTS  
**Focus:** Native memory retention, glibc arenas, RSS, and diagnosing apparent memory leaks.

In Byte #52, we established that `-Xmx` limits Java heap capacity, not total process memory.

Today we'll investigate a common production scenario:

> **Java heap usage remains stable, but the JVM process RSS keeps increasing. Is this a memory leak?**

Not necessarily. Understanding why requires looking below HotSpot, at the operating system's memory allocator.

## 1. The problem: stable heap, growing RSS

Imagine monitoring a Spring Boot application:

| Time | Post-GC heap used | Process RSS |
|---|---:|---:|
| 10:00 | 800 MB | 1.4 GB |
| 11:00 | 810 MB | 1.8 GB |
| 12:00 | 805 MB | 2.2 GB |
| 13:00 | 815 MB | 2.6 GB |

The heap's live set is relatively stable.

Yet process RSS has increased by 1.2 GB.

Where is the additional memory?

Several explanations are possible:

- Java heap capacity has expanded, even though live heap usage remains stable.
- Native allocations are growing.
- Previously freed native memory remains resident and available for reuse.
- Thread stacks, direct buffers, or other memory mappings have grown.

**Increasing RSS alone does not prove a memory leak.**

---

## 2. Freeing memory doesn't necessarily return it to the OS

Consider a native library:

```c
void* buffer = malloc(100 * 1024 * 1024);

/* use buffer */

free(buffer);
```

We might expect:

```text
malloc(100 MB)
      ↓
RSS increases by 100 MB
      ↓
free(buffer)
      ↓
RSS decreases by 100 MB
```

But that isn't guaranteed.

Instead:

```text
malloc()
    ↓
Allocator obtains memory
    ↓
Application uses memory
    ↓
free()
    ↓
Allocator retains memory for reuse
    ↓
RSS may remain elevated
```

The critical distinction:

**`free()` releases memory to the allocator. It does not necessarily release the underlying physical pages to the operating system.**

Whether RSS decreases depends on the allocator, allocation size, memory layout, and whether pages can be returned.

---

## 3. glibc arenas: why memory can remain resident

On many Linux systems, native allocations use glibc's `malloc` implementation.

To support concurrent allocations, glibc maintains multiple allocation arenas.

Conceptually:

```text
                 Native allocations
                         │
                  glibc malloc
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼
         Arena A      Arena B      Arena C
            │            │            │
         Chunks       Chunks       Chunks
```

Multiple arenas can reduce allocator contention.

However, they can also increase memory consumption because memory retained in one arena may not be immediately available to satisfy allocations through another.

Suppose:

```text
Arena A: 100 MB allocated, 80 MB freed
Arena B: 100 MB allocated, 70 MB freed
Arena C: 100 MB allocated, 90 MB freed
```

The application currently needs only 60 MB of those allocations.

But the allocator may still retain considerably more memory in its arenas.

The result:

```text
Application's live native allocations: 60 MB

Allocator-managed resident memory:    potentially much higher
```

The exact behavior depends on glibc's allocation and trimming policies. [man7.org](https://man7.org/linux/man-pages/man3/mallopt.3.html?utm_source=chatgpt.com)

### Why not immediately return everything?

Returning pages to the OS and obtaining them again has a cost.

Retaining reusable memory can improve allocation performance.

This creates a trade-off:

| Retain freed memory | Return freed memory |
|---|---|
| Faster potential reuse | Lower resident footprint |
| Fewer OS allocation operations | More allocator/OS coordination |
| Potentially higher RSS | Potentially more allocation overhead |

Memory retention can therefore be intentional allocator behavior rather than a leak.

---

## 4. Fragmentation complicates memory reclamation

Consider an allocator-managed memory area:

```text
Before:

[AAAA][BBBB][CCCC][DDDD][EEEE]

After freeing B and D:

[AAAA][FREE][CCCC][FREE][EEEE]
```

There are free chunks, but they are separated by live allocations.

The allocator may reuse those chunks for future requests, but it cannot necessarily return all their underlying pages to the OS.

This is **allocator fragmentation**.

It differs from Java heap fragmentation because it occurs within native allocation infrastructure.

Linux glibc provides `malloc_trim()` to attempt to release free pages, but success depends on the allocation layout. It is not a universal memory-reclamation guarantee. [man7.org](https://man7.org/linux/man-pages/man3/malloc_trim.3.html?utm_source=chatgpt.com)

---

## 5. A crucial distinction: heap used versus heap committed

Before blaming glibc, investigate the Java heap itself.

Suppose:

```text
-Xms512m
-Xmx4g
```

Initially:

```text
Heap used:       400 MB
Heap committed:  512 MB
```

After an allocation burst:

```text
Heap used:       3 GB
Heap committed:  3.5 GB
```

After GC:

```text
Heap used:       400 MB
Heap committed:  3.5 GB
```

The live heap returned to 400 MB.

However, the JVM may retain the larger committed heap capacity for subsequent allocations.

Some collectors can uncommit unused heap memory, subject to collector policy and minimum heap constraints. The timing is not necessarily immediate.

Therefore:

> **Stable post-GC heap usage does not imply stable heap commitment or stable heap RSS.**

Always examine both used and committed heap memory before investigating native allocators.

---

## 6. How to distinguish retention from a native memory leak

Consider three diagnostic scenarios.

| Observation | Likely direction |
|---|---|
| RSS grows, heap committed grows | Investigate heap expansion |
| RSS grows, NMT committed grows | Investigate HotSpot native categories |
| RSS grows, heap and NMT remain stable | Investigate untracked allocations, allocator retention, and memory mappings |

These are investigative clues, not definitive diagnoses.

### Scenario A: Genuine native leak

```text
Native allocations
      ↓
Memory never released
      ↓
Live allocation footprint grows
      ↓
RSS continues increasing
```

### Scenario B: Allocator retention

```text
Native allocations
      ↓
Memory freed
      ↓
Allocator retains pages
      ↓
RSS remains elevated
      ↓
Future allocations reuse memory
```

A useful experimental distinction is whether memory consumption eventually stabilizes under a repeatable workload.

However, even a plateau doesn't conclusively rule out a leak, particularly when allocation behavior changes over time.

---

## 7. Hands-on: investigate with NMT and Linux

### Step 1 — Enable Native Memory Tracking

Start the JVM:

```bash
java \
  -XX:NativeMemoryTracking=summary \
  -Xms512m \
  -Xmx4g \
  -jar application.jar
```

After warm-up:

```bash
jcmd <pid> VM.native_memory baseline
```

Later:

```bash
jcmd <pid> VM.native_memory summary.diff scale=MB
```

Look for growth in committed memory under categories such as:

```text
Java Heap
Class
Thread
Code
GC
Internal
Other
```

Remember that NMT primarily tracks HotSpot-managed memory. It does not account for every allocation performed by external native libraries. [Oracle Docs](https://docs.oracle.com/en/java/javase/25/troubleshoot/diagnostic-tools.html?utm_source=chatgpt.com)

### Step 2 — Inspect actual process memory

On Linux:

```bash
cat /proc/<pid>/status | grep -E 'VmRSS|VmSize|RssAnon'
```

For more detailed accounting:

```bash
cat /proc/<pid>/smaps_rollup
```

Important fields include:

| Field | Meaning |
|---|---|
| `Rss` | Total resident memory |
| `Pss` | Proportional share of resident pages |
| `Anonymous` | Resident anonymous memory |
| `Private_Dirty` | Private resident pages marked dirty |

`smaps_rollup` aggregates memory-mapping statistics and helps distinguish anonymous memory from file-backed mappings. [Linux Kernel Archives](https://cdn.kernel.org/doc/html/latest/filesystems/proc.html?utm_source=chatgpt.com)

### Step 3 — Correlate measurements

Capture these metrics over the same interval:

```text
Time
 │
 ├── Post-GC heap used
 ├── Heap committed
 ├── NMT committed
 ├── Process RSS
 └── Container memory.current
```

An especially useful pattern is:

```text
Heap committed: stable
NMT committed:  stable
Process RSS:    increasing
```

This suggests investigating memory outside NMT's coverage, changes in page residency, and allocator behavior.

Do not calculate `RSS - NMT committed` and treat the result as an exact amount of leaked native memory. These metrics have different accounting semantics.

---

## 8. Production implications

Suppose a Kubernetes application experiences rising RSS but stable heap occupancy.

Before changing JVM flags, establish whether the growth comes from heap commitment, HotSpot native allocations, or memory outside NMT's coverage.

If glibc arena retention is confirmed, `MALLOC_ARENA_MAX` can be evaluated as a tuning option:

```bash
MALLOC_ARENA_MAX=2 java -jar application.jar
```

This limits the number of glibc malloc arenas, potentially reducing memory retention.

However, fewer arenas can increase allocator contention. The appropriate value depends on the workload, libc implementation, and native allocation patterns. It is not a general JVM memory-leak fix. [man7.org](https://www.man7.org/linux/man-pages/man3/mallopt.3.html?utm_source=chatgpt.com)

Also, these glibc-specific mechanisms do not necessarily apply to containers using musl libc or alternative native allocators.

---

## Mental model checkpoint

We now have a more complete view of JVM process memory:

```text
Java Application
       │
       ├── Java objects
       │       ↓
       │    Java Heap
       │       ↓
       │    GC manages object lifetime
       │
       └── Native allocations
               ↓
          Native allocator
               ↓
          malloc / mmap
               ↓
          Allocator may retain memory
               │
               ▼
       Operating-system memory mappings
               │
               ▼
        Resident physical pages
               │
               ▼
            Process RSS
```

Three independent mechanisms influence memory consumption:

1. **GC** determines which Java objects remain reachable.
2. **Native allocators** manage native allocation lifetimes and memory reuse.
3. **The operating system** determines which virtual memory pages are resident.

### Key takeaway

**Memory being logically freed does not guarantee an immediate reduction in RSS.**

A JVM process can retain substantial resident memory even when its Java heap live set is stable and native allocations have been freed.

The correct diagnostic approach is to correlate heap commitment, NMT, RSS, and operating-system memory accounting before concluding that a leak exists.

### Next byte — #54: Native Memory Tracking Internals

We'll examine how HotSpot accounts for native allocations, how NMT distinguishes `malloc`, `mmap`, and arena allocations, what `summary` versus `detail` actually records, and why NMT cannot explain every byte of process RSS.

**References:** [JDK 25 Native Memory Tracking documentation](https://docs.oracle.com/en/java/javase/25/troubleshoot/diagnostic-tools.html?utm_source=chatgpt.com) · [Linux malloc allocator parameters](https://man7.org/linux/man-pages/man3/mallopt.3.html?utm_source=chatgpt.com) · [Linux process memory accounting](https://cdn.kernel.org/doc/html/latest/filesystems/proc.html?utm_source=chatgpt.com)