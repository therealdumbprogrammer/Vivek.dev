# Daily JVM Byte #46 — When G1 Cannot Keep Up: Evacuation Failure, Humongous Objects, and Full GC

**Baseline:** JDK 25 LTS | **Topic:** G1 GC internals and failure modes

In Byte #44, we followed a successful G1 young collection. In Byte #45, we explored concurrent marking and mixed collections.

Both assumed something important: **G1 has enough free heap space and time to complete its work.**

What happens when that assumption breaks?

Today we'll examine three related failure scenarios:

1. Evacuation failure
2. Humongous-object allocation pressure
3. Full GC as a recovery mechanism

## 1. G1 needs free space to reclaim space

Recall how G1 normally collects a region:

```text
Before collection:

Region A
┌─────────────────────────┐
│ Live │ Dead │ Live │Dead│
└─────────────────────────┘

           ↓ Evacuation

Region B
┌─────────────────────────┐
│ Live │ Live │           │
└─────────────────────────┘

Region A becomes reusable.
```

Notice the dependency.

**To reclaim Region A, G1 first needs somewhere to copy its surviving objects.**

Suppose the heap is nearly full:

```text
G1 Heap

Old      Old      Old      Eden
████     ████     ████     ████

Free regions: 0
```

Even if Region A contains garbage, G1 may be unable to evacuate its surviving objects.

This creates an evacuation failure.

---

## 2. Evacuation failure: insufficient destination space

Imagine G1 selects three regions for collection:

```text
Collection Set

Region A: 30 MB live
Region B: 20 MB live
Region C: 40 MB live

Total live data = 90 MB
```

But only 60 MB of suitable destination space is available.

```text
Required evacuation space: 90 MB
Available space:           60 MB
```

G1 cannot move every surviving object.

### What happens internally?

An evacuation failure does not necessarily cause an immediate Full GC.

G1 can preserve objects that have already moved while leaving other objects in their original locations. It repairs the necessary references and retains regions that could not be completely evacuated.

Those regions cannot yet be reclaimed wholesale.

```text
Evacuation starts
       ↓
Some objects copied successfully
       ↓
Destination allocation fails
       ↓
Remaining objects stay in place
       ↓
References made consistent
       ↓
Application may resume
```

In JDK 25, evacuation failure can also result from **pinned objects**, such as objects that cannot currently move because of JNI critical access.

GC logs distinguish `Allocation` and `Pinned` reasons. [Oracle Documentation](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html?utm_source=chatgpt.com)

### Production implication

An evacuation failure is a warning that G1's normal region-reclamation mechanism has encountered a constraint.

Repeated allocation-related failures suggest that G1 is running out of the free-space headroom needed for evacuation.

---

## 3. Humongous objects: a different allocation path

Ordinary objects generally begin in Eden.

But G1 handles particularly large objects differently.

An object is classified as **humongous when its size is at least half a G1 region**.

For example:

```text
G1 region size = 2 MB

Object size       Classification
---------------------------------
500 KB            Normal
1 MB              Humongous
3 MB              Humongous
```

Humongous objects are allocated directly into old-generation regions.

They occupy one or more contiguous regions.

Consider a 2.1 MB object:

```text
Region size = 2 MB

Humongous object = 2.1 MB

Region 1             Region 2
┌────────────────┐   ┌────────────────┐
│ 2 MB object    │   │ 0.1 MB object  │
│                │   │ 1.9 MB unused  │
└────────────────┘   └────────────────┘
```

The remaining 1.9 MB cannot be used for unrelated allocations while that humongous object occupies the region sequence.

This introduces **internal fragmentation**.

Unlike ordinary objects, humongous objects are generally not moved during normal G1 evacuation pauses. Some unreachable humongous objects can be reclaimed eagerly, while others are reclaimed through marking and cleanup. [Oracle Documentation](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html?utm_source=chatgpt.com)

---

## 4. Why humongous objects can cause unexpected GC pressure

Consider an application processing large payloads:

```java
byte[] payload = new byte[5 * 1024 * 1024];
```

If G1 uses 4 MB regions, this array is humongous.

Now suppose the application repeatedly creates these arrays.

```text
Large array allocations
         ↓
Humongous regions consumed
         ↓
Old occupancy increases
         ↓
Concurrent marking triggered
         ↓
More allocations continue
```

Two problems can emerge.

**First:** Humongous allocations bypass the normal young-generation allocation lifecycle, increasing old-generation pressure directly.

**Second:** G1 needs contiguous free regions for these allocations.

You could have:

```text
Free regions:

[F][O][F][O][F][O][F]
```

where `F` means free and `O` means occupied.

There are four free regions, but no two adjacent free regions.

A humongous allocation requiring two contiguous regions cannot be satisfied from this layout.

This is why an allocation can fail even when aggregate free heap space appears sufficient. [Oracle Documentation](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-garbage-collector-tuning.html?utm_source=chatgpt.com)

---

## 5. Full GC: G1's expensive recovery path

Normally, G1 tries to avoid collecting the entire heap in one pause.

```text
Normal G1 operation

Young GC
    +
Concurrent Marking
    +
Mixed GC
```

But if allocation pressure becomes severe and incremental reclamation cannot recover enough space, G1 may perform a **Full GC**.

In JDK 25, G1's Full GC performs stop-the-world, whole-heap compaction.

```text
Normal G1

Collect selected regions
       ↓
Evacuate live objects
       ↓
Reclaim selected regions


Full GC

Stop application threads
       ↓
Analyze whole-heap liveness
       ↓
Compact live objects
       ↓
Reclaim available space
       ↓
Resume application
```

The difference is significant.

A normal G1 pause processes a selected collection set.

A Full GC can involve the entire heap.

Consequently, Full GC pauses can be substantially longer.

However, **a Full GC does not necessarily indicate a memory leak**. It indicates that the collector needed a recovery operation; the underlying cause still requires investigation.

---

## 6. Allocation pressure versus live-set pressure

This is the most important diagnostic distinction.

### Scenario A: Allocation pressure

```text
Heap capacity:       8 GB
Live objects:        3 GB
Temporary garbage:   4 GB
```

The application creates temporary objects faster than G1 can reclaim space.

Potential causes include:

- High allocation or promotion rates.
- Concurrent marking completing too late.
- Insufficient free-space headroom.
- Humongous-object allocation bursts.

There is substantial reclaimable garbage, but G1 struggles to recover it quickly enough.

### Scenario B: Live-set pressure

```text
Heap capacity:       8 GB
Live objects:        7.7 GB
Garbage:             0.3 GB
```

Here the problem is fundamentally different.

Even a successful Full GC can reclaim only about 300 MB.

```text
Full GC
   ↓
Most objects still reachable
   ↓
Heap remains nearly full
   ↓
Allocation pressure returns
```

No GC algorithm can reclaim objects that remain strongly reachable.

The application may need a larger heap or a smaller live set.

**This is why post-GC heap occupancy matters more than pre-GC occupancy when investigating retention.**

---

## 7. Diagnosing these failures in JDK 25

Start with GC logging:

```bash
java \
  -Xms2g \
  -Xmx2g \
  -XX:+UseG1GC \
  -Xlog:gc*,gc+heap=info:file=gc.log:time,uptime,level,tags \
  -jar application.jar
```

Look for these indicators:

| GC log indicator | What to investigate |
|---|---|
| `Evacuation Failure: Allocation` | Insufficient evacuation destination space |
| `Evacuation Failure: Pinned` | Objects prevented from moving |
| `Humongous regions: X->Y` | Humongous-region occupancy |
| `Pause Full (G1 Compaction Pause)` | Expensive whole-heap recovery |
| High occupancy after Full GC | Large retained live set |

Also examine whether concurrent marking completes before old-generation pressure becomes critical.

G1 uses adaptive IHOP (*Initiating Heap Occupancy Percent*) to predict when marking should begin. If workload behavior changes suddenly, the prediction can be inaccurate.

Potential remedies depend on the evidence: reducing object retention, reducing humongous allocations, increasing heap headroom, or adjusting concurrent marking capacity. Avoid changing GC flags before establishing the cause. [Oracle Documentation](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-garbage-collector-tuning.html?utm_source=chatgpt.com)

---

## 8. Mental model checkpoint

Our G1 lifecycle now includes both normal operation and recovery:

```text
                Java allocation
                       │
                       ▼
                 Eden / TLAB
                       │
                       ▼
                    Young GC
                       │
                 Evacuation
                       │
              ┌────────┴─────────┐
              │                  │
           Success             Failure
              │                  │
              ▼                  ▼
        Survivor / Old     Objects remain
              │            in failed regions
              ▼                  │
       Old occupancy             │
              │                  │
              ▼                  │
       Concurrent Marking        │
              │                  │
              ▼                  │
          Mixed GCs              │
              │                  │
              └────────┬─────────┘
                       │
             Insufficient progress?
                       │
                       ▼
                 Possible Full GC
                       │
                       ▼
                Heap compaction
                       │
                       ▼
             Enough space recovered?
                  /          \
                Yes           No
                 │             │
              Resume       Possible OOME
```

Humongous objects add another source of old-generation pressure because they bypass ordinary Eden allocation and require contiguous regions.

### Key takeaway

**G1's region-based design depends on having enough space to move surviving objects and enough time to identify reclaimable old-generation garbage.**

When either condition breaks, G1 may encounter evacuation failures or require a Full GC.

The diagnostic distinction is whether the heap contains substantial garbage that G1 cannot reclaim quickly enough, or whether the application genuinely retains too much live data.

### Next byte — #47: ZGC versus G1: why concurrent relocation changes the architecture

We'll move from G1's stop-the-world evacuation model to **Generational ZGC in JDK 25**, examining load barriers, colored pointers, concurrent relocation, and how ZGC maintains correct object references while application threads continue executing.

**JDK 25 references:** [G1 collector internals](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html?utm_source=chatgpt.com) · [G1 tuning and failure diagnosis](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-garbage-collector-tuning.html?utm_source=chatgpt.com)