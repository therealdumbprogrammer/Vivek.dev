## Daily JVM Byte #23 — Generational GC: young collections, promotion, and remembered sets

Yesterday we established the core GC algorithms: tracing determines what is live, while sweeping, compaction, or evacuation determines how space is reclaimed.

Now we add one of the most important practical observations behind JVM GC:

> Most objects die young.

This motivates **generational collection**: avoid repeatedly scanning long-lived objects when most newly allocated objects will disappear quickly.

### 1. The generational model

Conceptually:
```
Heap
┌───────────────────────┬──────────────────────────┐
│ Young generation      │ Old generation           │
│                       │                          │
│ new / short-lived     │ long-lived objects       │
└───────────────────────┴──────────────────────────┘
```

A typical allocation lifecycle is:
```
allocate
   ↓
young
   ↓ survives collections
young survivor
   ↓ survives long enough
old
```

Moving an object into the old generation is commonly called **promotion**.

The exact physical layout depends on the collector. With G1—the default collector on normal JDK 25 server-class configurations—the heap is region-based rather than one permanently contiguous Eden/Survivor/Old layout, but regions can dynamically take those roles.

---

### 2. Why young collections can be cheap

Suppose the young generation contains:
```
100 MB allocated

95 MB dead
 5 MB live
```

An evacuation-style young collection can copy the surviving 5 MB elsewhere and reclaim the source regions:
```
Before:

[A][dead][dead][B][dead][dead][C]

              ↓ evacuate survivors

[A][B][C]...

old young regions → reusable
```

The collector does not need to preserve the 95 MB of dead objects individually.

This is why a high allocation rate can still perform well when most objects die quickly.

The expensive quantity is often closer to:
```
amount of surviving/live data
```

than simply:
```
amount allocated
```

---

### 3. Why not collect the whole heap every time?

Suppose:
```
Young = 500 MB
Old   = 8 GB
```

and the application rapidly creates temporary request objects.

Scanning all 8.5 GB every time the young area fills would defeat the point of generations.

Instead:
```
Young GC
   ↓
primarily process young objects
   ↓
leave most old objects alone
```

But this creates a correctness problem.

Consider:
```
Old object O
      │
      ▼
Young object Y
```

If GC only started from ordinary roots and inspected young objects, `Y` could appear unreachable even though an old object references it.

So generational GC needs to know about:
```
old → young references
```

without scanning the entire old generation.

---

### 4. Write barriers solve the discovery problem

When application code performs:
```
oldObject.child = youngObject;
```

HotSpot/JIT-generated code can execute additional bookkeeping associated with the reference write.

Conceptually:
```
reference store

oldObject.child = youngObject
          │
          └── write barrier
                  ↓
             record information
             relevant to GC
```

The application threads executing this bookkeeping are called **mutators** because they mutate the object graph.

The barrier lets the collector maintain metadata describing potentially interesting cross-region or cross-generation references.

The fundamental trade-off is:
```
tiny cost on reference writes
             ↓
avoid enormous scanning cost during GC
```

This is a recurring GC design pattern:

> Move a small amount of work onto application execution so the collector can avoid much more expensive work later.

---

### 5. Remembered sets

The information derived from barriers can feed structures commonly called **remembered sets**.

Simplified:
```
Old generation

Region A ────────┐
Region B         │
Region C ────────┼──► Young region
Region D         │
                 │
Remembered Set ◄─┘
```

During a young collection, GC can reason roughly:
```
GC roots
   +
remembered old → young references
   ↓
trace young live objects
```

instead of:
```
scan every object in old generation
```

That is what makes **partial heap collection** practical.

G1 makes particularly heavy use of remembered-set/card-table machinery because its heap is divided into regions and it needs to track references between them.

---

### 6. Card tables make tracking cheaper

Recording every individual reference store in a giant global structure would itself be expensive.

A common technique is to divide heap address space into small logical chunks called **cards**.

Conceptually:
```
Heap memory

| card 0 | card 1 | card 2 | card 3 | card 4 |
                     ↑
              reference modified
```

The barrier can mark the corresponding card as dirty:
```
Card table

0   0   1   0   0
        ↑
      dirty
```

GC then knows:
```
Something interesting changed
in this small memory range.
```

It can inspect that area rather than rescanning the entire heap.

This is much cheaper than storing elaborate metadata for every single reference assignment.

---

### 7. Survival and promotion

After a young collection, survivors need somewhere to go.

Conceptually:
```
Eden
  ↓ survives

Survivor
  ↓ survives again

Survivor
  ↓ survives enough collections

Old
```

Collectors track object age during this process.

But do not interpret promotion as a rigid rule such as:
```
exactly N collections → old
```

Promotion policy can depend on collector heuristics, available survivor capacity, age thresholds, object size, and current heap conditions.

For G1, these concepts exist within its region-based design rather than as permanently fixed physical Eden and Survivor spaces.

---

### 8. The important production trade-off

Consider two applications with identical allocation rates:
```
Application A
1 GB/s allocated
98% dies quickly

Application B
1 GB/s allocated
50% survives
```

Application B creates substantially more GC pressure.

Why?
```
more survivors
   ↓
more tracing
more evacuation
more copying
more remembered-set work
more promotion
   ↓
old generation fills faster
```

This is why:
```
allocation rate alone
```

is insufficient when diagnosing GC.

You also care about:
```
survival rate
promotion rate
live-set size
old-generation growth
```

A workload that allocates heavily but drops almost everything immediately can be easier for a generational collector than a workload with a lower allocation rate but high retention.

---

## Mental model checkpoint

We can now extend our GC model:
```
              Allocation
                  ↓
             Young objects
                  ↓
         ┌────────┴────────┐
         │                 │
        dies            survives
         │                 │
     reclaimed          evacuated
                           ↓
                       ages / promotes
                           ↓
                      Old generation
```

But generations introduce references across collection boundaries:
```
Old ─────────────► Young
```

so HotSpot adds:
```
reference store
      ↓
write barrier
      ↓
card / remembered-set metadata
      ↓
young GC finds cross-generation roots
without scanning all of old
```

This is the deeper reason write barriers exist in generational collectors: **partial collection requires knowledge about references originating outside the part of the heap being collected.**

We now have enough groundwork to stop talking about generic GC algorithms and examine the actual JDK 25 collectors.

**Next byte:** **G1 internals — regions, Eden/Survivor/Old roles, collection sets, evacuation pauses, concurrent marking, mixed collections, and why G1's regional design lets it choose which parts of the old generation to reclaim.**
