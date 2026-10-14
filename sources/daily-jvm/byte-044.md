Next bytes:



## Daily JVM Byte #44 — One G1 young GC cycle, end to end

Yesterday we followed a virtual method call through profiling, speculative inlining, and deoptimization. Today we trace another complete runtime operation: **what actually happens when allocation pressure causes G1 to perform a young GC**.

We'll use OpenJDK 25's G1 collector as the concrete model rather than describing an imaginary “generic GC.”

### 1. Starting state: application threads are allocating

Most objects begin in Eden regions:
```
G1 Heap

Eden     Eden     Eden     Survivor     Old
████     ████     ████       ██        ████
 ↑
TLABs carved from Eden
```

Application threads—**mutators** in GC terminology—usually allocate through their TLABs:
```
JavaThread
    ↓
TLAB
    ↓
Eden region
```

Eventually G1 decides a young collection should occur, typically as Eden fills according to its adaptive young-generation sizing and pause-time goals.

The important point:

> GC is driven by allocation pressure and collector policy, not because every individual `new` directly invokes the collector.

---

## 2. G1 requests a stop-the-world pause

A young G1 collection requires a **safepoint**.

Conceptually:
```
Mutator threads
 T1   T2   T3   T4
 │    │    │    │
 ▼    ▼    ▼    ▼

       safepoint requested

 │    │    │    │
 ▼    ▼    ▼    ▼

       stopped
```

HotSpot can now safely perform operations requiring a consistent view of relevant JVM state.

This connects directly to our earlier safepoint lesson:
```
GC operation
    ↓
safepoint
    ↓
JavaThreads reach safe state
    ↓
GC work begins
```

Safepoint coordination itself and the GC algorithm are distinct mechanisms.

---

## 3. G1 establishes the roots

The collector needs to determine which objects are reachable.

Roots include sources such as:
```
thread stacks
JNI references
static/class-related roots
HotSpot internal roots
```

For compiled frames, remember Byte #34:
```
compiled frame
     ↓
OopMap
     ↓
exact locations containing oops
```

So GC can identify:
```
stack slot 24 ───► Order
RAX ─────────────► Customer
```

without guessing which machine words happen to look like pointers.

---

## 4. But roots alone are insufficient for a young collection

Imagine:
```
Old region                    Eden

Customer ───────────────────► Order
                                ↑
                            young object
```

`Customer` may already be in an old region.

If G1 scanned the entire old generation during every young GC, young collections would become expensive.

This is why we previously learned about **write barriers and remembered sets**.

When application code performs something like:
```
customer.latestOrder = order;
```

HotSpot's generated code includes barrier logic that helps G1 track cross-region references.

Conceptually:
```
old object
    │
    │ reference written
    ▼
young object

        ↓ barrier machinery

card/remembered-set information
```

During young GC, G1 can use remembered-set/card information to find relevant references into the collection set without tracing the entire old generation.

---

## 5. G1 chooses a collection set

G1 divides the heap into regions.

For a young collection, the **collection set (CSet)** contains the young regions selected for evacuation—typically Eden plus Survivor regions involved in that pause.
```
Region 1   Eden       ← CSet
Region 2   Old
Region 3   Eden       ← CSet
Region 4   Survivor   ← CSet
Region 5   Old
```

G1 does not simply say:
```
"collect the first half of the heap"
```

Region-based organization gives it considerably more flexibility.

---

## 6. Live objects are evacuated

Suppose an Eden region contains:
```
A  B  C  D  E  F
```

and only:
```
A, C, F
```

are reachable.

G1 copies the survivors elsewhere:
```
Before

Eden
[A][B][C][D][E][F]


Evacuation

A ─────► Survivor
C ─────► Survivor
F ─────► Survivor
```

The dead objects:
```
B D E
```

do not need to be individually freed.

Once all live objects have been evacuated, the entire source region can be reclaimed.
```
Eden before
████████████████

        ↓ evacuation

Eden after
░░░░░░░░░░░░░░░░
entire region reusable
```

This is why copying/evacuation works particularly well when most young objects die quickly.

---

## 7. Some survivors eventually promote

Objects surviving collections accumulate age.

Conceptually:
```
Eden
  ↓ survives
Survivor
  ↓ survives
Survivor
  ↓ ...
Old
```

Promotion depends on G1's tenuring decisions and available survivor capacity; it is not simply “survive exactly N collections.”

The goal is generational:
```
short-lived objects
        ↓
cheaply disappear during young collections

long-lived objects
        ↓
eventually reside in old regions
```

This exploits the weak generational hypothesis that most objects die young.

---

## 8. References must now point to the new locations

Evacuation moves objects:
```
Before:

reference ───► 0x1000 [Order]


After:

                 0x5000 [Order]
                       ▲
reference ─────────────┘
```

G1 must preserve Java's illusion that the object remains the same object.

References discovered during evacuation are processed so that surviving object graphs refer to their new locations.

The application never observes:
```
"Order moved from address X to Y"
```

It continues observing:
```
the same Order object
```

Physical object location is a JVM implementation detail.

---

## 9. The evacuated regions become immediately reusable

After successful evacuation:
```
old Eden regions
       ↓
contain no required live objects
       ↓
regions reclaimed
       ↓
available for future allocation
```

This gives us the full cycle:
```
TLAB allocation
      ↓
Eden fills
      ↓
young GC
      ↓
live objects evacuated
      ↓
Eden reclaimed
      ↓
new TLABs / allocations
```

Allocation and collection form a continuous pipeline.

---

## 10. Mutator threads resume

Once required pause work finishes:
```
GC workers finish
      ↓
safepoint ends
      ↓
JavaThreads resume
      ↓
allocation continues
```

From the application's perspective:
```
running
   │
   ├──────────┐
              │ STW young GC
   └──────────┘
   │
running
```

The pause duration therefore depends largely on **work required for the collection**, not simply total heap capacity.

Factors include the amount of live data to evacuate and references/cards that must be processed.

---

## Production implications

This explains an important GC observation.

Suppose two applications both allocate:
```
1 GB/sec
```

Application A:
```
98% objects die young
```

Application B:
```
large fraction survives
```

Their GC costs can differ dramatically.

A simplified view:
```
A:

Eden ███████████████
live ██

small evacuation workload


B:

Eden ███████████████
live ███████████

large evacuation workload
```

So high allocation rate alone does not necessarily imply bad GC behavior.

A particularly useful metric is:

> **How much data survives and must be copied/promoted?**

This is one reason post-GC occupancy and live-set behavior are often more informative than merely seeing frequent young collections.

---

## Mental model checkpoint

One G1 young collection now connects many earlier bytes:
```
new Object()
     ↓
TLAB
     ↓
Eden
     ↓
allocation pressure
     ↓
G1 policy
     ↓
safepoint
     ↓
JavaThread stacks
     ↓
OopMaps
     ↓
GC roots
     +
remembered sets / cards
     ↓
collection set
     ↓
evacuation
     ↓
Survivor / Old
     ↓
region reclamation
     ↓
mutators resume
```

The central idea is:

> **A G1 young GC is primarily an evacuation operation. HotSpot stops mutators at a safepoint, discovers roots and cross-region references, copies live objects out of selected young regions, updates the relevant references, reclaims the evacuated regions wholesale, and resumes application execution.**

This also explains why generational GC works: **dead young objects are extremely cheap—the collector mostly pays for the objects that survive.**

**Next byte:** **One G1 concurrent marking cycle end to end — old-generation pressure → Initial Mark → concurrent marking → SATB barriers → Remark → Cleanup → mixed collections, and how G1 performs most old-generation discovery while Java threads continue running.**
