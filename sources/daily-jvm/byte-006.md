6th byte



## Daily JVM Byte #6 — Generational GC: Eden, Survivor, promotion

Yesterday’s key observation was that copying collection works especially well when **most objects are dead**. Generational GC turns that observation into a heap design.

The core assumption is the **weak generational hypothesis**:
```
Most objects die young.
Objects that survive for a while are more likely to survive longer.
```

### Young generation

Traditionally, the young generation is split into:
```
Young Gen
├── Eden
├── Survivor S0
└── Survivor S1
```

Most new objects start in Eden:
```
allocate
   ↓
[Eden.................]
```

When Eden fills, a young collection occurs.

Suppose:
```
Eden before GC

[A][dead][B][dead][dead][C]
```

Only live objects are copied:
```
Eden            Survivor
[A][x][B][x]    [A][B][C]
```

Then Eden becomes available again for fast bump-pointer allocation.

### Why two Survivor spaces?

A copying collector needs a source and destination.

Conceptually:
```
Before GC:
Eden + S0  ─────► live objects copied to S1

Next GC:
Eden + S1  ─────► live objects copied to S0
```

The survivor roles alternate.

This avoids fragmentation inside the survivor area.

### Object age

Each time an object survives a young GC, HotSpot tracks its age.

Conceptually:
```
GC #1 → age 1
GC #2 → age 2
GC #3 → age 3
...
```

After surviving enough collections, the object may be **promoted** to the old generation.
```
Young
  │
  │ survives repeatedly
  ▼
Old
```

The exact promotion decision is more nuanced than simply reaching one fixed age. HotSpot can adjust the effective tenuring threshold based on survivor-space pressure and object-age distribution.

The important point is:

> Object age is a GC optimization heuristic, not a property of the Java object model.

Your program cannot observe that an object is “age 7.”

### Why promotion exists

If an object survives many young collections, repeatedly copying it becomes wasteful.

Consider:
```
long-lived cache entry
```

If it survives hundreds of young GCs, copying it on every collection would be expensive.

Promotion says:
```
This object appears long-lived.
Stop processing it during every young collection.
```

That reduces young-GC work.

### Old generation

The old generation primarily contains objects that survived long enough to be promoted.

Its expected characteristics differ:
```
Young:
high allocation
high mortality

Old:
lower mortality
longer-lived objects
```

That difference allows collectors to apply different strategies.

Historically, this is why a JVM might use:
```
Young → copying
Old   → mark-compact / mark-sweep
```

The optimal strategy differs because survival rates differ.

### The cross-generation reference problem

Here is the difficult part.

Suppose an old object points to a young object:
```
Old object ─────► Young object
```

During a young GC, the JVM cannot simply scan only the young generation and GC roots.

Otherwise it might miss this reference and incorrectly reclaim the young object.

The naive solution would be:
```
scan entire old generation
during every young GC
```

But that would destroy the whole point of having cheap young collections.

So HotSpot uses remembered-set mechanisms, typically supported by **write barriers**.

Conceptually:
```
oldObject.child = youngObject;
```

is not merely:
```
store reference
```

The JVM may also perform bookkeeping:
```
store reference
+
record that this old region/card
may reference young memory
```

Then young GC needs to examine only the relevant parts of old memory.

This is a major GC concept:

> Fast collection requires tracking changes to the object graph while the application runs.

We will later see the same idea in concurrent collectors.

### Why generational GC works well

Imagine:
```
1,000 MB allocated per second
95% dies almost immediately
```

The JVM does not need to repeatedly scan a multi-gigabyte heap.

Instead, it can frequently collect a relatively small young region where most objects are garbage.

That gives two major benefits:
```
cheap allocation
+
cheap reclamation of short-lived objects
```

### Production implication: allocation rate vs promotion rate

High allocation rate is not automatically a problem.

Consider:
```
10 GB/s allocation
99.9% dies young
```

This can sometimes be handled efficiently.

More concerning is:
```
high allocation
+
high survival
+
high promotion
```

because objects flow into old generation:
```
Eden
  ↓
Survivor
  ↓
Old Gen
  ↓
old-generation pressure
```

Eventually that can increase major/mixed collection work and pause or CPU cost.

So when looking at GC behavior, distinguish:
```
allocation rate
survival rate
promotion rate
old-gen occupancy
```

These tell very different stories.

### Mental model

The GC model now becomes:
```
Allocation
   │
   ▼
Eden
   │
   │ Young GC
   ▼
Survivor
   │
   │ repeated survival
   ▼
Old Generation
```

Underneath this is another mechanism:
```
mutator writes reference
        │
        ▼
write barrier
        │
        ▼
remembered-set metadata
        │
        ▼
collector avoids scanning everything
```

That second path is increasingly important as we move toward modern collectors.

**Next byte:** write barriers, card tables, and remembered sets — how HotSpot tracks old-to-young references cheaply enough to make generational collection practical.
