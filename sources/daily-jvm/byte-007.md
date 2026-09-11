Source ID: byte-007
Source conversation: 6a996dbd-f8b0-83ee-a26a-3b05f1d7e4a3

7th byte



## Daily JVM Byte #7 — Write barriers, card tables, and remembered sets

Yesterday we reached the cross-generation reference problem:
```
Old object ─────► Young object
```

A young GC cannot scan the entire old generation every time. The JVM therefore tracks potentially relevant old-to-young references as the application mutates the object graph.

The key mechanism is a **write barrier**.
```
oldObject.child = youngObject;
```

Conceptually becomes:
```
store reference
+
record metadata for GC
```

That extra bookkeeping is inserted into generated/interpreted execution paths by the JVM.

### Card tables

A common HotSpot technique divides heap memory into small fixed-size regions called **cards**.

Conceptually:
```
Old generation

[ card 0 ][ card 1 ][ card 2 ][ card 3 ] ...
              ^
              |
        contains a write
        that may point young
```

Instead of remembering every individual reference assignment, the JVM marks the corresponding card as **dirty**.

So:
```
oldObject.child = youngObject;
```

may cause something conceptually like:
```
cardTable[index(oldObject)] = DIRTY
```

Later, during young GC, HotSpot scans only dirty/relevant cards rather than the whole old generation.

### Why this is cheaper

Without remembered metadata:
```
Young GC
   ↓
scan all old objects
   ↓
find old → young references
```

That scales badly as old generation grows.

With barriers and cards:
```
application writes
   ↓
mark affected cards
   ↓
Young GC
   ↓
scan selected cards only
```

You trade a small cost on reference writes for much cheaper collection.

This is a recurring JVM design pattern:

> Move some work from GC time into application execution so collection can stay bounded.

### Remembered sets

A **remembered set** is the collector-side structure that records references or regions relevant to another region/generation.

The exact implementation depends on the collector.

At a high level:
```
Card table
    ↓
coarse "something changed here"

Remembered set
    ↓
collector-specific knowledge of
cross-region references
```

For a traditional generational collector, the main concern is often:
```
Old ─► Young
```

For region-based collectors such as G1, remembered sets become more general because any region may contain references into another region.
```
Region A ─► Region B
Region C ─► Region B
```

G1 needs enough metadata to collect Region B without scanning the entire heap.

### Why the barrier is on writes

The JVM cannot efficiently rediscover all reference changes after the fact.

Suppose:
```
a.child = b;
```

The mutator has exact knowledge of the change at the moment it occurs.

That makes the write path the cheapest place to record:
```
"memory around object a may now contain
a reference relevant to the collector"
```

The collector then consumes this metadata later.

### Barrier cost matters

Write barriers are not free.

Every reference store can involve additional instructions, for example:
```
normal write
+
address calculation
+
card-table update
```

Modern JVMs spend considerable engineering effort making barriers very cheap because they sit on extremely hot execution paths.

This produces a core GC trade-off:
```
more runtime bookkeeping
        ↕
less collection-time scanning
```

Different collectors choose different points on that spectrum.

### Connection to concurrent GC

Write barriers become even more important once collection runs concurrently with application threads.

Now the problem is no longer only:
```
Which old objects reference young objects?
```

It becomes:
```
How do we maintain a correct view of reachability
while application threads keep changing references?
```

Concurrent collectors therefore use barriers for tasks such as:

- tracking modified references
- preserving marking invariants
- maintaining remembered sets
- supporting relocation

This is why barrier design is central to G1, ZGC, and Shenandoah.

### Production implications

Barrier overhead usually appears as application CPU cost rather than an obvious GC pause.

The relevant trade-off is therefore:
```
shorter / more scalable GC work
vs
continuous mutation overhead
```

This matters most in workloads with:

- very high pointer-update rates
- large heaps
- highly connected object graphs
- low-latency collector requirements

It also explains why GC performance cannot be understood only by looking at pause durations. Some collector cost is intentionally paid while the application is running.

### Mental model

We now have two cooperating systems:
```
Mutator
   │
   ├── allocates objects
   └── changes references
          │
          ▼
     write barriers
          │
          ▼
    GC metadata
   /           \
card tables   remembered sets
          │
          ▼
Collector scans less memory
```

The larger point is that modern GC is not simply "stop the application and inspect the heap."

The JVM is continuously maintaining metadata so future collections can be efficient.

**Next byte:** allocation internals — TLABs, bump-pointer allocation, and how HotSpot lets many threads allocate objects cheaply without contending on one global heap pointer.