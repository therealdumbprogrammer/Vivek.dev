next byte:



# Daily JVM Byte #24 — G1 internals: regions, evacuation, concurrent marking, and mixed collections

Yesterday we saw why generational collectors need write barriers and remembered sets. Now we can apply those ideas to the default collector on JDK 25 server-class machines: **G1 (Garbage-First)**. [Oracle Docs](https://docs.oracle.com/en/java/javase/25/gctuning/ergonomics.html?utm_source=chatgpt.com)

The central G1 idea is:

> Divide the heap into regions, discover which regions contain the most reclaimable space, and incrementally evacuate selected regions rather than compacting the entire heap at once.

## 1. G1's heap is region-based

Instead of thinking physically:
```
|------- Eden -------|-- Survivor --|--------- Old ---------|
```

think:
```
G1 Heap

┌────┬────┬────┬────┬────┬────┬────┬────┐
│ E  │ O  │ E  │ S  │ O  │ O  │ E  │ O  │
└────┴────┴────┴────┴────┴────┴────┴────┘
```

where:
```
E = Eden
S = Survivor
O = Old
```

The regions are equally sized contiguous pieces of virtual memory. Eden, Survivor, and Old are **logical sets of regions**, not necessarily contiguous address ranges. [Oracle Docs](https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/g1_gc_tuning.html?utm_source=chatgpt.com)

This gives G1 flexibility:
```
free region
    ↓
can become Eden

later
    ↓
can be reused for another role
```

The heap can therefore adapt without maintaining rigid physical generation boundaries.

## 2. Young GC is evacuation

Applications primarily allocate into Eden regions.

Eventually:
```
Eden regions fill
       ↓
Young GC
```

G1 chooses a **Collection Set (CSet)** containing the young regions to collect.

Suppose:
```
Region 1 — Eden

[A][dead][dead][B][dead]

Region 2 — Eden

[dead][C][dead][dead]
```

During the stop-the-world evacuation pause:
```
A ──┐
B ──┼──► Survivor / Old regions
C ──┘
```

Then:
```
Region 1 → completely reusable
Region 2 → completely reusable
```

G1 therefore combines:
```
garbage collection
+
compaction
```

because surviving objects are copied together while the source regions become free. [Oracle Docs](https://docs.oracle.com/en/java/javase/25/gctuning/hotspot-virtual-machine-garbage-collection-tuning-guide.pdf?utm_source=chatgpt.com)

This avoids the fragmented result of classic mark-sweep.

## 3. Why the Collection Set matters

G1 does not generally say:
```
"collect the heap"
```

It says:
```
"collect these regions"
```

Hence the core abstraction:
```
Heap
 │
 ├── Region 1
 ├── Region 2  ─┐
 ├── Region 3   │
 ├── Region 4  ─┼── Collection Set
 ├── Region 5   │
 └── Region 6  ─┘
```

During an evacuation pause, G1 processes the selected CSet.

This is fundamental to G1's pause-time strategy because it can control **how much work is attempted in one pause**.

## 4. But eventually Old fills

Young GC handles short-lived objects well:
```
allocate
   ↓
Eden
   ↓
Young GC
   ↓
dead → reclaimed

or

survives
   ↓
Survivor
   ↓
eventually Old
```

Over time:
```
Old regions
████████████████░░░
```

contain both live objects and garbage.

But G1 cannot simply reclaim an old region because some objects inside it may still be reachable.

It first needs information about **old-generation liveness**.

That is where concurrent marking enters.

## 5. Concurrent marking

G1 performs a marking cycle across the heap to discover live objects.

A simplified lifecycle is:
```
Initial Mark
     ↓
Concurrent Mark
     ↓
Remark
     ↓
Cleanup
```

Most of the expensive graph traversal occurs **concurrently with application threads**.
```
Application threads ───────────────►

GC marking        ───────────────►
```

There are still stop-the-world portions, notably initial-mark work associated with a young collection and Remark. G1 uses a snapshot-at-the-beginning (SATB) marking algorithm and associated barriers to maintain a logically consistent view while the object graph is changing. [Oracle Docs](https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/g1_gc_tuning.html?utm_source=chatgpt.com)

After marking, G1 knows approximately:
```
Region A → 95% live
Region B → 20% live
Region C → 80% live
Region D → 10% live
```

Now the name **Garbage-First** starts to make sense.

## 6. Garbage first

Compare:
```
Region A
██████████████████░░
95% live

Region D
██░░░░░░░░░░░░░░░░░
10% live
```

Evacuating A means:
```
copy lots of objects
reclaim little space
```

Evacuating D means:
```
copy few objects
reclaim lots of space
```

Region D therefore gives a much better:
```
reclaimed space
───────────────
evacuation cost
```

ratio.

G1 identifies old-region candidates with useful reclaimable space and prioritizes efficient candidates for subsequent reclamation. [Oracle Docs](https://docs.oracle.com/en/java/javase/17/gctuning/garbage-first-g1-garbage-collector1.html?utm_source=chatgpt.com)

## 7. Mixed collections

After concurrent marking, G1 can perform **mixed collections**.

A young collection contains roughly:
```
Eden + Survivor
```

A mixed collection contains:
```
Eden
+
Survivor
+
selected Old regions
```

For example:
```
Heap

[E][O][S][O][E][O][O][E]
    ↑     ↑       ↑
          selected old candidates

CSet:

E + S + E + E
      +
selected O regions
```

Live objects are evacuated:
```
selected Old region

[A][dead][dead][B][dead]
       ↓

A,B → another Old region

source region → free
```

G1 spreads old-generation reclamation across multiple mixed collections instead of necessarily doing one giant whole-heap compaction pause. [Oracle Docs](https://docs.oracle.com/en/java/javase/24/gctuning/garbage-first-g1-garbage-collector1.html?utm_source=chatgpt.com)

## 8. Pause-time targeting

G1 has another important mechanism: a **pause prediction model**.

Suppose the pause target is conceptually:
```
200 ms
```

G1 estimates costs such as:
```
young evacuation
+
root processing
+
remembered-set processing
+
old-region evacuation
```

and chooses a CSet that it predicts can fit within its target.

Conceptually:
```
candidate regions

R1 → predicted 15 ms
R2 → predicted 22 ms
R3 → predicted 50 ms
R4 → predicted 35 ms

           ↓

choose collection set
that provides useful reclamation
while respecting predicted budget
```

The target is a **goal, not a hard real-time guarantee**. [Oracle Docs](https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/g1_gc.html?utm_source=chatgpt.com)

## 9. Where yesterday's remembered sets fit

Suppose G1 collects:
```
Region 7
```

but another region contains:
```
Region 2 object
       │
       ▼
Region 7 object
```

G1 cannot scan every other region looking for references into Region 7.

Instead, G1 tracks cross-region references using remembered-set/card metadata maintained with write barriers.

Conceptually:
```
Region 7

Remembered Set
      ↓
"Region 2 contains references into me"
```

Therefore:
```
GC roots
+
remembered cross-region references
        ↓
trace objects needed for CSet evacuation
```

This is what makes **independent region collection** practical. [Oracle Docs](https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/g1_gc_tuning.html?utm_source=chatgpt.com)

## Production implications

The most important G1 pause cost is often the amount of **live data that must be evacuated**, not simply how much garbage exists.

Consider:
```
Region A: 5% live
Region B: 90% live
```

Both occupy one region, but B is much more expensive to evacuate.

This is why sudden changes in survival rate can produce pause spikes:
```
more surviving objects
       ↓
more copying
       ↓
longer evacuation
```

G1's tuning guidance explicitly calls out increased survivor volume as a cause of unexpectedly longer evacuation pauses. [Oracle Docs](https://docs.oracle.com/en/java/javase/18/gctuning/garbage-first-garbage-collector-tuning.html?utm_source=chatgpt.com)

For diagnosis, start with GC logging rather than immediately changing collector flags:
```
-Xlog:gc*
```

Then ask:
```
Is the problem:

allocation rate?
survival rate?
old-gen growth?
remembered-set/root scanning?
evacuation cost?
concurrent marking not keeping up?
```

## Mental model checkpoint

Our GC model has now evolved from textbook algorithms into an actual HotSpot collector:
```
                    G1 Heap
                       │
                fixed-size regions
                       │
          ┌────────────┴────────────┐
          │                         │
       Young                     Old
          │                         │
     Young GC               Concurrent Mark
          │                         │
     evacuation              liveness data
          │                         │
          └────────────┬────────────┘
                       ↓
                Mixed collections
                       ↓
            evacuate selected regions
                       ↓
               reclaim whole regions
```

And several earlier JVM concepts now converge:
```
write barriers ─────┐
remembered sets ────┤
GC roots ───────────┤
safepoints ─────────┼──► G1
object movement ────┤
reference updates ──┤
concurrent work ────┘
```

The central G1 idea is therefore not simply "a low-pause GC." It is **incremental, region-based compaction guided by liveness and predicted collection cost**.

**Next byte:** **G1 concurrent marking and SATB in detail — how G1 can trace a heap while application threads are simultaneously changing the object graph, why a pre-write barrier is needed, and what the Remark pause actually finishes.**
