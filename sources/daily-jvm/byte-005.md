Source: chatgpt-conversation://6a996dbd-f8b0-83ee-a26a-3b05f1d7e4a3

onto the next byte



## Daily JVM Byte #5 — Mark-Sweep vs Mark-Compact vs Copying GC

Yesterday we established that GC is fundamentally a reachability problem. Today’s question is: **once the JVM knows which objects are live, how does it reclaim memory efficiently?**

Three classic strategies explain most modern collector designs.

### 1. Mark-Sweep

Conceptually:
```
Heap before GC:

[A][B][dead][C][dead][D]

Mark live:
 A  B       C       D

Sweep dead:
[A][B][free][C][free][D]
```

The collector:

1. marks reachable objects
2. scans the heap
3. reclaims unmarked regions

The major advantage is that live objects do not need to move.

The major problem is **fragmentation**.

After repeated cycles:
```
[used][free][used][free][used][free]
```

you may have plenty of total free memory but not enough contiguous space for a large allocation.

Allocation also becomes more expensive because the JVM may need free lists or more complex bookkeeping instead of simply advancing a pointer.

---

### 2. Mark-Compact

Mark-compact solves fragmentation by moving live objects together.
```
Before:

[A][dead][B][dead][C][dead]

After compaction:

[A][B][C][free][free][free]
```

The collector:

1. marks live objects
2. computes new locations
3. moves live objects
4. updates references
5. leaves free space contiguous

Now allocation can often become extremely cheap:
```
allocated objects | free space
                  ^
             allocation pointer
```

Creating an object can become roughly:
```
newAddress = top
top += objectSize
```

This is commonly called **bump-pointer allocation**.

The trade-off is obvious: moving objects costs CPU and requires every reference to the moved object to remain logically correct.

---

### 3. Copying collection

Copying GC takes the movement idea further.

Split memory conceptually into two spaces:
```
From-space        To-space
[A][dead][B]      [empty]
```

During collection, copy only live objects:
```
From-space        To-space
[A][dead][B]  ->  [A][B]
```

Then the old space can simply be discarded.

There is no need to individually reclaim dead objects.

This is particularly effective when **most objects are dead**.

That observation is crucial.

Suppose 100 MB was allocated but only 5 MB survived.

A copying collector processes roughly the 5 MB of live data rather than spending equal effort manipulating the 95 MB of garbage.

---

## Why this leads directly to generational GC

Real JVM workloads commonly exhibit the **weak generational hypothesis**:

> Most objects die young.

For example:
```
void handleRequest() {
    StringBuilder sb = new StringBuilder();
    List<Result> results = new ArrayList<>();
    ...
}
```

Request processing may create thousands of temporary objects.

Most disappear almost immediately after the request completes.

That makes young-generation collection a natural fit for copying:
```
Young generation

allocation
   ↓
[Eden.................]

GC happens

most objects die
few survivors copied elsewhere
```

Instead of compacting a huge heap, the JVM can collect a small allocation-heavy region cheaply.

This is one of the architectural ideas behind traditional generational collectors and still influences modern designs.

---

## The deeper trade-off: dead-object cost vs live-object cost

A useful way to compare algorithms is to ask:
```
What determines collection cost?
```

Mark-sweep tends to involve scanning/reclaiming heap structures.

Compaction costs are strongly related to moving live objects.

Copying collection is especially dependent on:
```
amount of surviving data
```

So consider two 1 GB regions.

Region A:
```
950 MB dead
50 MB live
```

Region B:
```
50 MB dead
950 MB live
```

A copying strategy is excellent for Region A and much less attractive for Region B.

This is one reason JVMs treat young and long-lived objects differently.

---

## Why moving objects is possible at all

Java exposes references, not raw object addresses.

You write:
```
Customer customer;
```

not:
```
customer = memory address 0x12345678
```

HotSpot therefore has freedom to relocate objects, provided all references are fixed up correctly.

This abstraction enables:

- compacting collectors
- copying collectors
- generational GC
- region-based movement

It is an important JVM design advantage over environments where arbitrary application code can freely retain raw memory addresses.

---

## Production implications

Fragmentation matters because:
```
free memory != usable contiguous memory
```

Object movement matters because it introduces GC work and potentially pause-time costs.

Survival rate matters because copying becomes more expensive when many objects remain live.

This gives you a useful diagnostic principle:
```
High allocation rate alone is not necessarily bad.

High allocation rate
+ low survival
can be cheap.

High allocation rate
+ high survival
is much more expensive.
```

That distinction becomes important when reading GC logs.

---

## Mental model so far

We can now connect the first five bytes:
```
JVM process
   │
   └── Heap
        │
        └── Objects + references
               │
               ▼
          Reachability graph
               │
               ▼
            GC roots
               │
               ▼
        determine live objects
               │
               ▼
     reclaim / compact / copy
```

The next major design question is therefore:

> If most objects die young, why scan and collect the whole heap every time?

**Next byte:** generational garbage collection — Eden, Survivor spaces, old generation, promotion, and why object age is really an optimization heuristic rather than a semantic property.