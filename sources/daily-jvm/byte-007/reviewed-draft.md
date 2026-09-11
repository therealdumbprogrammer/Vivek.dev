Cached originating draft (tool preview truncated at 20,000 characters).

Lesson 7 is strong, but I’d make two technical refinements before turning it into the chapter.

First, this lesson is specifically about the **post-write barrier / remembered-reference problem**. Later, concurrent collectors introduce other barrier types as well, so I would avoid leaving the impression that “barrier” always means “write barrier.”

Second, I would sharpen the distinction between **card table** and **remembered set**:

- A card table is a coarse map over heap address ranges: “something interesting may have happened in this area.”
- A remembered set is collector-specific metadata that helps identify **incoming references into a generation/region**.
- In collectors such as G1, card information contributes to maintaining remembered sets, but they are not simply two names for consecutive stages of the same structure.

I’d keep the visual density similar to Lessons 3–6.

## Draft — Lesson 7: Write barriers, card tables, and remembered sets

```markdown
---
title: Write barriers, card tables, and remembered sets
summary: See how HotSpot tracks cross-generation references while your application runs, allowing garbage collectors to avoid repeatedly scanning the entire heap.
course: jvm
lessonSlug: write-barriers-card-tables
module: Foundations
order: 70
sourceByte: byte-007
draft: false
prerequisites:
  - generational-gc
jdk: HotSpot · GC barriers and remembered references
---

In the previous lesson, generational GC gave us a useful optimization:

```text
collect young memory frequently

instead of

collecting the entire heap every time
```

But that optimization created a problem.

Suppose an object in old memory starts referencing an object in young memory:

```text
OLD                              YOUNG

┌───────────┐                   ┌───────────┐
│ Customer  │──────────────────►│ NewOrder  │
└───────────┘                   └───────────┘
```

A young collection must know about that reference.

Otherwise it might inspect the young generation, see no young-side path to `NewOrder`, and incorrectly conclude that the object is unreachable.

So why not simply scan the old generation?

Because that would destroy much of the benefit of generational GC.

Imagine:

```text
Young generation:   500 MB
Old generation:      20 GB
```

If every 500 MB young collection required scanning 20 GB of old objects, the supposedly cheap young collection would no longer be cheap.

HotSpot therefore needs another strategy:

> **Remember the parts of old memory that may contain references into young memory.**

And the key to doing that efficiently is to record information **when references change**.

<figure>
<a href="/images/courses/jvm/barrier-problem.svg" aria-label="Open the cross-generation reference problem diagram">
<img src="/images/courses/jvm/barrier-problem.svg"
     alt="An old-generation object points to a young-generation object. Young GC must account for this reference without scanning the entire old generation."
     width="820" height="450" />
</a>
<figcaption>The collector needs to discover references entering young memory without repeatedly scanning all old objects.</figcaption>
</figure>

## The application already knows when the graph changes

Suppose your program executes:

```java
customer.latestOrder = order;
```

At that exact moment, the application is changing the heap graph.

Before:

```text
Customer

    X

NewOrder
```

After:

```text
Customer ─────► NewOrder
```

The running application thread—the **mutator**—already knows:

```text
I am writing a reference
into this object.
```

That makes the write itself an excellent place for the JVM to perform a small amount of GC bookkeeping.

Conceptually:

```text
customer.latestOrder = order

             │
             ▼

      perform reference store
             +
      perform GC bookkeeping
```

The extra GC logic associated with a reference store is one form of a **write barrier**.

<figure>
<a href="/images/courses/jvm/write-barrier.svg" aria-label="Open the write barrier diagram">
<img src="/images/courses/jvm/write-barrier.svg"
     alt="A Java reference assignment passes through generated JVM code that performs the reference store and additional garbage-collector bookkeeping."
     width="820" height="450" />
</a>
<figcaption>The mutator pays a small amount of bookkeeping cost when changing the object graph so later collection work can be reduced.</figcaption>
</figure>

The term *barrier* can sound like the JVM is blocking the write.

That is not the useful mental model.

Think of it more like:

```text
reference write
      │
      ├── do the actual store
      │
      └── execute a tiny piece of GC logic
```

The application continues normally.

The barrier simply ensures that the collector learns something important about the mutation.

## Don't record every individual reference

Now we have another design problem.

Suppose a large application performs millions of reference writes:

```text
A.x = B
C.y = D
E.z = F
...
```

The JVM could theoretically remember every individual assignment.

But maintaining an enormous exact list would itself be expensive.

HotSpot can instead track changes at a coarser granularity.

One common mechanism is a **card table**.

## Divide the heap into cards

Imagine a section of old memory:

```text
Old generation

┌────────┬────────┬────────┬────────┬────────┐
│ Card 0 │ Card 1 │ Card 2 │ Card 3 │ Card 4 │
└────────┴────────┴────────┴────────┴────────┘
```

Each card represents a small fixed-size range of heap memory.

Conceptually:

```text
Heap memory
──────────────────────────────────────────────►

| card | card | card | card | card | card |
```

HotSpot maintains a small metadata entry associated with each card.

Now suppose an object inside Card 2 performs a reference write:

```text
Card 2

┌─────────────────────────────┐
│ OldObject                   │
│                             │
│ child ─────────► YoungObject│
└─────────────────────────────┘
```

Rather than storing:

```text
OldObject.child points to YoungObject
```

as an exact remembered reference, the JVM can record something coarser:

```text
Card 2 may contain
an interesting reference.
```

The card becomes **dirty**.

<figure>
<a href="/images/courses/jvm/card-table.svg" aria-label="Open the card table diagram">
<img src="/images/courses/jvm/card-table.svg"
     alt="Old-generation memory is divided into cards. A reference write inside one card causes the corresponding card-table entry to be marked dirty."
     width="840" height="480" />
</a>
<figcaption>The card table records interesting heap areas rather than every individual reference assignment.</figcaption>
</figure>

Conceptually, the barrier may perform something resembling:

```text
reference store

     │
     ▼

find card containing
the modified object

     │
     ▼

mark card DIRTY
```

A simplified mental model is:

```text
cardTable[cardOf(oldObject)] = DIRTY
```

The real implementation is more optimized, but this is enough to understand the mechanism.

## What does "dirty" actually mean?

A dirty card does **not** necessarily mean:

```text
This card definitely contains
an old → young reference.
```

It means something closer to:

```text
A relevant reference write occurred
in this memory area.

The collector should inspect it.
```

That distinction is important.

Card tables deliberately trade precision for cheap updates.

Instead of doing expensive analysis on every reference assignment:

```text
mutation time:
figure out exact graph meaning
```

the JVM can do something much cheaper:

```text
mutation time:
mark this small area interesting
```

Then collection or background refinement can determine what actually matters.

This gives us a recurring JVM design pattern:

> **Do the cheapest possible bookkeeping on a hot execution path, and defer more expensive interpretation until later.**

## Young GC can now scan selected areas

Without remembered metadata:

```text
Young GC
   │
   ▼
scan entire old generation
   │
   ▼
find every old → young reference
```

With card information:

```text
Mutator changes reference
          │
          ▼
       barrier
          │
          ▼
     dirty card
          │
          ▼
      Young GC
          │
          ▼
inspect relevant old-memory areas
```

<figure>
<a href="/images/courses/jvm/card-scan-comparison.svg" aria-label="Open full heap scan versus dirty card scan">
<img src="/images/courses/jvm/card-scan-comparison.svg"
     alt="Without card metadata, young GC scans all old memory. With dirty cards, it inspects selected old-memory ranges instead."
     width="860" height="500" />
</a>
<figcaption>A small cost during mutations can prevent a much larger scan during collection.</figcaption>
</figure>

Suppose:

```text
Old generation = 20 GB
```

but only a small fraction of its cards have potentially relevant references.

Instead of conceptually scanning:

```text
20 GB
```

the collector can focus on:

```text
interesting card
interesting card
interesting card
...
```

This is how the cost of a young collection can remain much less dependent on total old-generation size.

## The trade-off: mutator work versus collector work

Nothing here is free.

Without barriers:

```text
Application execution
        │
        ▼
reference stores are simpler

but

GC
 │
 ▼
must rediscover more information
```

With barriers:

```text
Application execution
        │
        ▼
reference store
+
small bookkeeping cost

but

GC
 │
 ▼
already has useful metadata
```

So the trade-off is:

```text
more continuous bookkeeping
              ↕
less expensive collection-time discovery
```

This is one of the central engineering tensions in garbage collection.

The collector wants rich metadata.

The application wants reference operations to be extremely cheap.

HotSpot spends considerable engineering effort making barriers efficient because these instructions can execute on extremely hot paths.

## Card tables are deliberately coarse

Suppose one card contains several objects:

```text
CARD 17

┌─────────┐
│   A     │
└─────────┘

┌─────────┐
│   B     │────────────► Young
└─────────┘

┌─────────┐
│   C     │
└─────────┘
```

Only object `B` actually contains the interesting reference.

But the metadata may simply say:

```text
CARD 17 = DIRTY
```

Later, the collector inspects that memory area to discover the actual references.

This creates another useful trade-off:

```text
Fine-grained metadata

more precise
but
more expensive to maintain


Coarse card metadata

less precise
but
very cheap to update
```

Card tables choose a useful middle ground.

## From card tables to remembered sets

Card tables solve part of the problem.

But modern collectors often need richer information about **where incoming references originate**.

That leads to the idea of a **remembered set**.

At a high level, a remembered set records information that helps a collector answer:

```text
What memory outside this collection area
may contain references into it?
```

Consider:

```text
Old Region A ─────► Young

Old Region C ─────► Young
```

The young collector needs to know about those incoming edges.

Conceptually:

```text
Remembered information for Young

├── references may come from Region A
└── references may come from Region C
```

<figure>
<a href="/images/courses/jvm/remembered-set.svg" aria-label="Open the remembered-set diagram">
<img src="/images/courses/jvm/remembered-set.svg"
     alt="Several source heap regions contain references into a target region. Remembered metadata identifies the source areas that need inspection when collecting the target."
     width="840" height="500" />
</a>
<figcaption>A remembered set summarizes incoming references so the collector can process one area without examining the entire heap.</figcaption>
</figure>

A useful distinction is:

```text
CARD TABLE

maps heap address ranges
to coarse mutation state
```

whereas:

```text
REMEMBERED SET

collector-specific metadata
describing where relevant incoming
references may originate
```

The two concepts are related, but they are not interchangeable.

Card-table information can be used to build or maintain remembered-set information.

## G1 makes remembered sets easier to understand

Generational GC originally gave us a simple problem:

```text
Old ─────► Young
```

But G1 divides the heap into many regions.

Conceptually:

```text
┌──────────┐
│ Region A │─────┐
└──────────┘     │
                 ▼
             ┌──────────┐
             │ Region B │
             └──────────┘
                 ▲
                 │
┌──────────┐     │
│ Region C │─────┘
└──────────┘
```

Suppose G1 wants to collect Region B.

It does not want to scan every other region simply to discover who references B.

Instead, it maintains metadata that helps answer:

```text
Which other regions/cards may
contain references into Region B?
```

Conceptually:

```text
Remembered Set for Region B

Region A → B
Region C → B
```

Then collecting B can focus on those relevant sources.

<figure>
<a href="/images/courses/jvm/g1-remembered-set.svg" aria-label="Open the G1 remembered-set intuition diagram">
<img src="/images/courses/jvm/g1-remembered-set.svg"
     alt="G1 regions A and C contain references into region B. B's remembered information allows the collector to identify those incoming-reference sources without scanning all regions."
     width="840" height="480" />
</a>
<figcaption>Region-based collection makes incoming-reference tracking useful beyond the simple old-to-young case.</figcaption>
</figure>

This is why remembered sets become especially important in region-based collectors.

The collector can operate on a subset of the heap because it maintains information about references crossing the boundaries of that subset.

## Why put the barrier on the write?

Suppose the program executes:

```java
a.child = b;
```

There are two possible strategies.

### Strategy 1 — discover it later

```text
application changes millions
of references

        │
        ▼

GC later scans the heap
to reconstruct what changed
```

That is expensive.

### Strategy 2 — record it when it happens

At mutation time:

```text
a.child = b

   │
   ├── store b
   │
   └── record cheap metadata
```

The mutator already knows:

```text
which object changed
```

and:

```text
where the change happened
```

That makes the write path an efficient place to leave a breadcrumb for the collector.

Conceptually:

```text
object graph mutation
       │
       ▼
 JVM observes mutation
       │
       ▼
 records small hint
       │
       ▼
 GC consumes hint later
```

Instead of trying to reconstruct every graph change from scratch.

## Barriers live on extremely hot paths

Reference assignments occur constantly.

For example:

```java
node.next = next;
list.elementData[i] = value;
customer.address = address;
mapEntry.value = value;
```

If every store required expensive GC logic, application throughput would suffer badly.

So barrier implementations need to be extremely cheap.

Conceptually, a post-write barrier might need work such as:

```text
store reference
      │
      ▼
calculate card
      │
      ▼
check/update card metadata
```

But real implementations optimize heavily.

For example, unnecessary work may sometimes be avoided when the JVM already knows that a store cannot create an interesting reference relationship.

The exact generated instruction sequences depend on the collector and JVM implementation.

The important point is the trade-off:

```text
tiny cost
×
huge number of writes
```

can still become meaningful.

So barrier design matters enormously.

## Barriers become even more important during concurrent GC

So far our problem has been:

```text
How do we remember
old → young references?
```

Concurrent collectors face a harder problem.

Imagine the collector is traversing the object graph:

```text
Collector

A ─────► B ─────► C
```

while application threads continue modifying that graph:

```text
Mutator

A.child = D;
B.child = null;
C.other = E;
```

Now the graph is changing **while the collector is reasoning about reachability**.

The problem becomes:

```text
How can GC maintain a correct
view of the graph while
the graph keeps changing?
```

Barriers are one of the mechanisms used to solve that problem.

Different collectors use different barrier designs for different purposes, including:

```text
tracking mutations
preserving marking invariants
maintaining remembered information
supporting relocation
```

One important distinction for later:

> **Not every GC barrier is a write barrier.**

Some collectors also use mechanisms such as load/read barriers.

So think of:

```text
write barrier
```

as one member of the broader family:

```text
GC barriers
```

Our focus in this lesson is specifically the kind of barrier that helps track reference mutations.

Collectors such as G1, ZGC, and Shenandoah make different barrier trade-offs.

We will explore those designs when we study the collectors themselves.

## Some GC cost happens while your application runs

Suppose your monitoring dashboard shows:

```text
GC pauses are short.
```

Does that mean GC is costing almost nothing?

Not necessarily.

Some collector work may be deliberately shifted into concurrent runtime activity:

```text
mutator barriers
background refinement
concurrent marking
concurrent relocation work
other GC bookkeeping
```

So total GC cost can conceptually be split across:

```text
Application-visible pauses

        +

Concurrent GC threads

        +

Mutator-side barrier work
```

This is why pause time alone is not a complete measure of collector overhead.

A collector may achieve:

```text
shorter pauses
```

partly by paying:

```text
more concurrent CPU
+
more mutator bookkeeping
```

That can be the correct trade-off, especially for latency-sensitive workloads.

## When can barrier overhead matter?

For most applications, you do not manually optimize card-table writes.

But the mechanism becomes useful when reasoning about collector behavior.

Barrier overhead becomes more relevant when workloads have combinations such as:

```text
very high reference-update rate
+
large heap
+
large connected object graph
+
low-latency requirements
```

A workload that continuously modifies pointers can exercise barriers much more heavily than one that mostly reads immutable structures.

Compare:

```text
Workload A

build object graph
then mostly read it
```

with:

```text
Workload B

continuously replace references
across millions of objects
```

The second workload gives the collector much more mutation information to track.

This is one reason application behavior can interact differently with different collector designs.

## Check your reasoning

Suppose:

```text
Young generation = 500 MB
Old generation   = 30 GB
```

Only a tiny portion of old memory currently contains references into the young generation.

Why is a card-table/remembered-set mechanism useful?

<details class="lesson-check">
<summary>Pause here, then check your reasoning</summary>
<p>Without remembered metadata, a young collection might need to inspect a huge amount of old memory just to discover the few old-to-young references that matter. Write barriers record cheap mutation information while the application runs, allowing the collector to focus on relevant cards or remembered-reference sources instead.</p>
</details>

The important optimization is not:

```text
GC somehow avoids understanding
cross-generation references
```

It is:

```text
GC knows where it is useful to look.
```

## Put the mechanism together

Our generational model previously looked like:

```text
Allocation
    │
    ▼
  Eden
    │
    ▼
Survivor
    │
    ▼
  Old
```

Now add the running application:

```text
                MUTATOR

        allocates objects
              │
              ▼
             Heap

        changes references
              │
              ▼
        write barrier
              │
