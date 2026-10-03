## Daily JVM Byte #26 — G1 failure modes: humongous objects, evacuation failure, and Full GC

Yesterday we covered how G1 uses SATB to mark concurrently. Today we look at what happens when G1's normal model—**evacuate live objects into available regions**—runs out of room.

The key dependency is:
```
G1 evacuation requires free destination space.
```

If that headroom disappears, G1 can enter increasingly expensive recovery paths.

### 1. Normal G1 operation needs headroom

During evacuation:
```
Collection Set

R1 [live][dead][live]
R2 [dead][live][dead]
          │
          │ copy survivors
          ▼
Free regions

R8 [live][live][live]...
```

Only after survivors have been copied can G1 reclaim the source regions.

So temporarily:
```
old copy still exists
       +
new copy needs space
```

This means:

> A heap that is technically not 100% full can still be too full for G1 to operate efficiently.

G1 deliberately maintains a reserve of heap regions to reduce the probability of evacuation failure.

---

### 2. What is an evacuation failure?

Suppose G1 selects:
```
R1 → 30 MB live
R2 → 25 MB live
R3 → 20 MB live
```

but while evacuating them it cannot obtain enough destination space.

Conceptually:
```
R1 ──► destination ✓
R2 ──► destination ✓
R3 ──► ???

      no suitable free region
```

G1 cannot simply discard `R3`; its objects are live.

The collector therefore has to preserve objects that could not be evacuated. In GC terminology you may see this as an **evacuation failure** or, in newer G1 logging/implementation terminology, regions being **retained** rather than successfully evacuated.

The important production meaning is:
```
evacuation failure
        ↓
G1 did not have enough working space
for its preferred copying strategy
```

This is usually a sign of memory pressure, a large live set, unexpectedly high survival, or marking/reclamation starting too late.

---

### 3. Why this is expensive

G1's efficient path is:
```
copy survivors
      ↓
discard whole source region
```

An evacuation failure breaks that assumption.

Instead of obtaining beautifully compacted regions:
```
[live][live][live] | lots of free space
```

G1 may have to retain regions containing objects that could not move.

That means additional bookkeeping and less space reclaimed than planned.

The vicious cycle can become:
```
less free space
     ↓
harder to evacuate
     ↓
less space reclaimed
     ↓
even less headroom
```

This is why headroom matters disproportionately for a copying/evacuating collector.

---

### 4. Humongous objects create another challenge

G1 has special handling for large objects.

An object whose size is at least **half a G1 region** is classified as a **humongous object**.

Suppose:
```
G1 region = 4 MB
```

Then approximately:
```
object < 2 MB  → normal allocation

object ≥ 2 MB  → humongous
```

A humongous object may occupy one or several contiguous regions:
```
Large byte[]

┌──────┬──────┬──────┐
│ H    │ HC   │ HC   │
└──────┴──────┴──────┘

H  = humongous start
HC = continuation
```

These objects are treated specially and are allocated directly into old-generation regions rather than following the ordinary:
```
Eden → Survivor → Old
```

lifecycle.

---

### 5. Why humongous allocations can hurt

Imagine many arrays around the humongous threshold:
```
2.1 MB
2.3 MB
3.8 MB
5.1 MB
```

They consume whole-region runs and may leave unused space inside their final region.

More importantly, allocation may require suitable **contiguous regions**.

You could therefore have:
```
free   used   free   used   free
 R1     R2     R3     R4     R5
```

with substantial total free heap, but no sufficiently long contiguous region sequence for a particular humongous allocation.

This can put additional pressure on G1's marking and reclamation machinery.

Typical sources include:
```
large byte[]
large char[]
large buffers
large serialized payloads
large caches / blobs
```

Humongous allocations are therefore worth checking when G1 behaves badly despite apparently reasonable average heap occupancy.

---

### 6. Concurrent marking must start early enough

Recall the normal cycle:
```
Old occupancy rises
       ↓
Concurrent Start
       ↓
Concurrent Mark
       ↓
Remark
       ↓
Mixed collections
       ↓
reclaim Old regions
```

But concurrent marking takes time.

Suppose the application promotes objects faster than G1 can complete that process:
```
Application:

Old ████████████░░
        ↓
   marking starts

Old █████████████░
        ↓
   marking continues

Old ██████████████
        ↓
   no useful headroom
```

The collector has lost the race.

This is why G1 tries to predict when concurrent marking should begin rather than waiting until the heap is nearly exhausted.

The Initiating Heap Occupancy Percent (`InitiatingHeapOccupancyPercent`) participates in this policy, with G1 normally using adaptive heuristics rather than treating it as a simple fixed trigger.

---

### 7. The expensive fallback: Full GC

If G1 cannot recover sufficient space through its normal evacuation/concurrent mechanisms, it can eventually fall back to a **Full GC**.

Conceptually:
```
Normal G1

Young evacuation
       +
concurrent marking
       +
mixed evacuation
       ↓
incremental reclamation
```

versus:
```
memory pressure becomes severe
           ↓
normal reclamation insufficient
           ↓
        Full GC
```

A G1 Full GC is stop-the-world and uses full-heap compaction machinery. Modern G1 can perform parts of Full GC using multiple worker threads, but it remains a fundamentally different and much more disruptive path than normal G1 operation.

Production rule:

> Repeated G1 Full GCs are usually a symptom to investigate, not a normal steady-state operating mode.

---

## 8. How to reason about the failure

If logs show G1 struggling, don't immediately increase random GC flags.

Start with:
```
-Xlog:gc*
```

Then determine which pattern exists:
```
Old occupancy continually rising?
        ↓
Possible large live set / leak / insufficient heap


High young survival?
        ↓
Heavy promotion and evacuation


Concurrent marking starts but cannot keep up?
        ↓
Allocation/promotion outrunning reclamation


Many humongous allocations?
        ↓
Large-object / region pressure


Evacuation failures?
        ↓
Insufficient destination headroom


Repeated Full GC?
        ↓
G1 normal operating cycle is failing
to reclaim space fast enough
```

These are very different problems even though all may initially appear as:
```
"GC is slow"
```

---

## Production implication

A useful G1 metric is not merely:
```
heap used = 80%
```

You need to reason about:
```
live set
+
allocation rate
+
survival/promotion rate
+
humongous allocations
+
free evacuation headroom
+
concurrent-marking speed
```

For example, an 8 GB heap with a stable 3 GB live set gives G1 substantial working room:
```
8 GB heap
3 GB live
5 GB operational headroom
```

while:
```
8 GB heap
7.2 GB live
```

leaves very little room for an evacuation-based collector, even if the application has technically not reached `-Xmx`.

### Mental model checkpoint

We can now see G1 as a pipeline that depends on staying ahead of the mutator:
```
                 Application
                     │
                  allocates
                     ↓
                   Eden
                     ↓
                 survivors
                     ↓
                    Old
                     ↓
              occupancy rises
                     ↓
             Concurrent Mark
                     ↓
             identify garbage
                     ↓
            Mixed Collections
                     ↓
              evacuate live
                     ↓
              reclaim regions
                     ↓
                free space
                     │
                     └──────────► allocation
```

Healthy G1 means:
```
reclamation keeps ahead
of memory demand
```

Unhealthy G1 eventually becomes:
```
allocation/promotion
       >
reclamation capacity

       ↓

headroom disappears
       ↓
evacuation becomes difficult
       ↓
recovery mechanisms
       ↓
Full GC / OOM risk
```

That gives us a complete working model of G1. We can now compare it with a collector built around a substantially different idea.

**Next byte:** **ZGC in JDK 25 — how generational ZGC performs concurrent relocation, uses load barriers, and avoids G1-style stop-the-world evacuation as the primary compaction mechanism.**
