## Daily JVM Byte #45 — G1 concurrent marking: finding old-generation garbage without a long full-heap pause

Yesterday we traced a **G1 young GC**: stop mutators, evacuate live young objects, reclaim young regions, resume.

But eventually the old generation grows:

```text
G1 Heap

Young       Old
████        █████████████████░░░
                         ↑
                    increasing
```

Young GC cannot solve this indefinitely. G1 needs to determine which old regions contain reclaimable garbage.

Scanning the entire old generation in one stop-the-world operation would hurt latency. G1 therefore performs much of this work **concurrently with the application**.

### 1. What concurrent marking is trying to discover

Suppose old regions contain:

```text
Region A    ██████████   mostly live
Region B    ██░░░░░░░░   mostly garbage
Region C    ████████░░
Region D    ░░░░░░░░░░   garbage
```

G1 wants information roughly equivalent to:

```text
How much live data exists in each old region?
```

That later allows it to prioritize regions such as B and D for reclamation.

This is different from young GC:

```text
Young GC
    → evacuate young regions now

Concurrent marking
    → discover old-generation liveness
      for future collection decisions
```

---

## 2. The cycle begins with Initial Mark

G1 needs an initial set of roots from which to begin tracing.

The **Initial Mark** work is performed as part of a stop-the-world young GC pause.

Conceptually:

```text
mutators running
      ↓
young GC pause
      +
Initial Mark
      ↓
establish starting marking state
      ↓
mutators resume
```

G1 deliberately piggybacks this work onto a young collection rather than requiring an entirely separate large pause.

---

## 3. Most graph traversal happens concurrently

After Initial Mark:

```text
Application threads
████████████████████████████

Concurrent marking
   ███████████████████
```

GC worker threads traverse the reachable object graph while application threads continue modifying that same graph.

This dramatically reduces pause time compared with performing the entire mark phase stop-the-world.

But it creates a correctness problem.

---

## 4. The object graph is moving underneath the collector

Imagine the marker has observed:

```text
Root
 │
 ▼
 A ─────► B
```

While marking proceeds, the application executes:

```java
a.ref = c;
```

The graph becomes:

```text
Root
 │
 ▼
 A ─────► C
```

Meanwhile references elsewhere may disappear.

If GC simply traversed the graph naively while mutators changed it, it could incorrectly miss an object that must be considered live for the marking cycle.

Concurrent GC therefore needs cooperation from application writes.

That cooperation comes from **barriers**.

---

## 5. G1 uses SATB

G1's concurrent marking uses **Snapshot-At-The-Beginning (SATB)**.

The conceptual goal is:

> Mark objects that were reachable according to a logical snapshot near the beginning of the marking cycle.

Consider:

```text
A ─────► B
```

and the application changes:

```java
a.ref = c;
```

The old reference:

```text
A → B
```

is about to disappear.

G1's SATB pre-write barrier can preserve information about that **old reference** for the concurrent marker.

Conceptually:

```text
Before write:

A ───► B


application executes:

A.ref = C


SATB barrier:

old value B
    ↓
record for marking


After write:

A ───► C
```

So even though the mutator removed the edge to `B`, the current marking cycle does not accidentally lose track of `B` if it belonged to the SATB snapshot.

---

## 6. This is different from the remembered-set barrier

We have now encountered two barrier purposes.

For generational/region tracking:

```text
reference write
      ↓
post-write/card barrier
      ↓
remember cross-region references
```

For concurrent marking:

```text
reference overwritten
      ↓
SATB pre-write barrier
      ↓
preserve old reference for marking
```

So “the GC write barrier” is an oversimplification.

Generated Java code can contain barrier machinery serving different collector invariants:

```text
                 reference assignment
                         │
             ┌───────────┴───────────┐
             ▼                       ▼
      remembered-set/card         SATB
          maintenance            marking
```

These barriers add mutator overhead in exchange for reducing GC pause work.

---

## 7. Remark closes the concurrency gap

Eventually concurrent marking has done most of its work.

But because application threads were running simultaneously, G1 needs to reconcile remaining marking state, including buffered SATB information.

This happens during a stop-the-world **Remark** pause.

```text
Initial Mark
     ↓
Concurrent Mark
     ↓
   Remark
     ↓
marking complete
```

Remark is therefore not “mark the entire heap again.”

It completes and finalizes the concurrent marking cycle so G1 has a consistent liveness result.

---

## 8. Cleanup turns marking information into region knowledge

After marking completes, G1 can determine liveness information for heap regions.

Conceptually:

```text
Region A
live = 95%

Region B
live = 20%

Region C
live = 75%

Region D
live = 5%
```

Now G1 has something extremely valuable:

```text
garbage percentage by region
```

Regions with large amounts of reclaimable space become attractive candidates for later evacuation.

This is where the name **Garbage-First** becomes intuitive:

```text
Which old regions provide
the most useful garbage reclamation
for the evacuation cost?
```

G1 can prioritize profitable regions while trying to satisfy its pause-time goals.

---

## 9. Mixed collections reclaim old regions

After the marking cycle, G1 can perform **mixed collections**.

A mixed collection contains:

```text
young regions
      +
selected old regions
```

Conceptually:

```text
Collection Set

Eden       ████
Survivor   ██
Old B      ██░░░░░░
Old D      █░░░░░░░
```

Live objects from selected old regions are evacuated:

```text
Old B

[Live][dead][dead][Live][dead]
   │                 │
   └──── evacuate ───┘

             ↓

entire old region reclaimable
```

So concurrent marking itself does not generally reclaim arbitrary old objects individually.

It provides the liveness information that lets later evacuation collections reclaim selected old regions efficiently.

---

## 10. The complete cycle

We can now connect the phases:

```text
Old occupancy grows
       ↓
marking cycle initiated
       ↓
Young GC + Initial Mark
       ↓
Concurrent Mark
       │
       │ mutators continue running
       │ SATB barriers preserve snapshot semantics
       ↓
Remark
       ↓
Cleanup / liveness information
       ↓
Mixed GCs
       ↓
young + selected old regions evacuated
       ↓
old space reclaimed
```

This is the fundamental G1 old-generation lifecycle.

---

## Trade-off: pause time becomes concurrent CPU work

G1 does not make marking free.

It transforms:

```text
large STW marking operation
```

toward:

```text
shorter STW phases
      +
concurrent GC CPU
      +
barrier overhead on mutators
```

That is a recurring low-latency GC design trade-off:

> Move work out of pauses, but pay for coordination while the application runs.

This also means concurrent GC can compete with application threads for CPU.

If CPU is already saturated, concurrent work does not magically have spare processors available.

---

## Production implications

Suppose GC logs repeatedly show:

```text
concurrent marking begins
        ↓
old generation continues growing rapidly
        ↓
collector struggles to reclaim space
```

The useful questions are not merely:

```text
"How long was GC?"
```

but:

```text
How quickly is old occupancy increasing?

How much survives young collections?

Is concurrent marking starting early enough?

Is the application retaining a genuinely large live set?

Does GC have enough CPU to keep up?

Are mixed collections reclaiming useful amounts of old space?
```

If the live set itself approaches heap capacity:

```text
Heap = 16 GB
Live reachable objects ≈ 15 GB
```

no collector tuning can create meaningful free space.

GC can reclaim only **unreachable** objects.

---

## Mental model checkpoint

We can now see the two major G1 flows together:

```text
                    Allocation
                        │
                        ▼
                      Eden
                        │
                        ▼
                   Young GC
                        │
                ┌───────┴────────┐
                ▼                ▼
              dead           survivors
                                 │
                                 ▼
                              Old
                                 │
                                 ▼
                       old occupancy grows
                                 │
                                 ▼
                    Concurrent Marking Cycle
                                 │
                  Initial Mark → Concurrent Mark
                                 │
                              Remark
                                 │
                                 ▼
                       region liveness data
                                 │
                                 ▼
                          Mixed GCs
                                 │
                                 ▼
                      old regions reclaimed
```

The central idea:

> **G1 separates discovering old-generation garbage from reclaiming it. Concurrent marking discovers which old regions contain garbage while mutators continue running; SATB barriers preserve marking correctness; later mixed collections evacuate selected high-value old regions and reclaim them wholesale.**

**Next byte:** **When G1 cannot keep up — evacuation failure, humongous objects, Full GC, allocation pressure versus live-set pressure, and how to read the failure modes that turn normally concurrent/region-based G1 behavior into expensive recovery paths.**