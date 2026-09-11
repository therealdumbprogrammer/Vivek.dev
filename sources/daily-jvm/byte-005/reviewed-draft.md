Lesson 5 is a good continuation, but I’d make one framing change up front:

> **Mark-sweep, mark-compact, and copying are foundational strategies, not three mutually exclusive “collector types.”**

Modern collectors often combine these ideas across regions, generations, or different phases. That prevents readers later wondering why G1/ZGC/Shenandoah do not fit neatly into one bucket.

This lesson should remain illustration-heavy. I’d center it around:

1. Same heap before GC → three different outcomes.
2. Fragmentation after mark-sweep.
3. Compaction creating a contiguous free area + bump-pointer allocation.
4. From-space → to-space copying.
5. Low-survival vs high-survival regions.
6. Bridge into generational GC.

## Draft — Lesson 5: Mark-Sweep vs Mark-Compact vs Copying GC

```markdown
---
title: Mark-Sweep vs Mark-Compact vs Copying GC
summary: Compare the three foundational ways garbage collectors reclaim heap memory, and see why fragmentation, object movement, and survival rate shape modern GC design.
course: jvm
lessonSlug: gc-reclamation-strategies
module: Foundations
order: 50
sourceByte: byte-005
draft: false
prerequisites:
  - gc-roots-reachability
jdk: HotSpot · GC foundations
---

In the previous lesson, we answered the first fundamental garbage-collection question:

```text
Which objects are still reachable?
```

Starting from the GC root set, the JVM can discover the live object graph.

But knowing that an object is garbage does not actually reclaim its memory.

The collector still has another problem:

```text
We know what is dead.

Now what do we do with the space?
```

There are three classic strategies worth understanding:

```text
MARK-SWEEP
MARK-COMPACT
COPYING
```

These are not three boxes into which every modern garbage collector fits perfectly.

Modern collectors often combine these ideas across different regions, generations, and collection phases.

But these three strategies explain many of the trade-offs we will encounter later.

<figure>
<a href="/images/courses/jvm/gc-three-strategies.svg" aria-label="Open the three GC reclamation strategies diagram">
<img src="/images/courses/jvm/gc-three-strategies.svg"
     alt="The same heap containing live and dead objects is reclaimed using mark-sweep, mark-compact, or copying collection, producing different arrangements of free space."
     width="820" height="560" />
</a>
<figcaption>The objects considered live can be the same; what differs is how the collector reorganizes the memory around them.</figcaption>
</figure>

Let's start with the simplest idea.

## Mark-Sweep: reclaim the holes

Imagine this heap:

```text
Before GC

┌───┬───┬──────┬───┬──────┬───┐
│ A │ B │ dead │ C │ dead │ D │
└───┴───┴──────┴───┴──────┴───┘
```

After the reachability phase, the collector knows:

```text
LIVE

A
B
C
D
```

and therefore knows which objects are garbage.

A mark-sweep collector conceptually performs two steps:

```text
MARK
 │
 └── identify reachable objects

SWEEP
 │
 └── reclaim space belonging to everything else
```

After sweeping:

```text
┌───┬───┬──────┬───┬──────┬───┐
│ A │ B │ free │ C │ free │ D │
└───┴───┴──────┴───┴──────┴───┘
```

The live objects have not moved.

That is one important advantage.

```text
Before                    After

A @ location 1            A @ location 1
B @ location 2            B @ location 2
C @ location 4            C @ location 4
D @ location 6            D @ location 6
```

The collector reclaimed the dead objects without relocating the survivors.

But look at the free space it created.

```text
used   used   FREE   used   FREE   used
```

The heap now contains holes.

## Fragmentation: free memory can still be awkward memory

After many allocation and collection cycles, a non-compacted heap might begin to resemble:

```text
┌────┬──┬─────┬────┬───┬──────┬──┬────┐
│used│  │used │    │used│      │u │    │
└────┴──┴─────┴────┴───┴──────┴──┴────┘
      ▲          ▲          ▲        ▲
     free       free       free     free
```

There may be plenty of free memory in total.

Suppose:

```text
free block 1 = 2 MB
free block 2 = 3 MB
free block 3 = 4 MB

total free   = 9 MB
```

Now imagine the JVM needs one contiguous 6 MB area.

Conceptually:

```text
Total free memory: 9 MB

Largest free block: 4 MB

Requested allocation: 6 MB
```

The total is large enough.

No individual hole is.

That is **external fragmentation**.

<figure>
<a href="/images/courses/jvm/gc-fragmentation.svg" aria-label="Open the heap fragmentation diagram">
<img src="/images/courses/jvm/gc-fragmentation.svg"
     alt="A heap contains several separated free blocks whose combined capacity exceeds an allocation request, but no single free block is large enough."
     width="800" height="430" />
</a>
<figcaption>Free memory and conveniently usable free memory are not always the same thing.</figcaption>
</figure>

Fragmentation also affects allocation mechanics.

If free space is scattered, allocation may require data structures such as:

```text
free lists
size classes
search structures
other bookkeeping
```

rather than always using one simple allocation pointer.

Mark-sweep therefore gives us a trade-off:

```text
Advantage
└── live objects do not need to move

Cost
├── fragmented free space
└── more complicated allocation management
```

Can we keep the reclaimed memory together instead?

## Mark-Compact: move the survivors together

Start with:

```text
Before

┌───┬──────┬───┬──────┬───┬──────┐
│ A │ dead │ B │ dead │ C │ dead │
└───┴──────┴───┴──────┴───┴──────┘
```

A mark-compact collector first identifies the live objects:

```text
A
B
C
```

But instead of simply turning dead objects into holes, it moves the survivors toward one side.

```text
After

┌───┬───┬───┬─────────────────────┐
│ A │ B │ C │      FREE           │
└───┴───┴───┴─────────────────────┘
```

<figure>
<a href="/images/courses/jvm/gc-compaction.svg" aria-label="Open the mark-compact diagram">
<img src="/images/courses/jvm/gc-compaction.svg"
     alt="Live objects separated by dead objects before collection are moved together during compaction, leaving one large contiguous free area."
     width="820" height="440" />
</a>
<figcaption>Compaction trades object movement for contiguous free space.</figcaption>
</figure>

Conceptually, the work is:

```text
1. Discover live objects

2. Determine where survivors should move

3. Move those objects

4. Ensure references now identify the new locations

5. Leave the remaining space contiguous
```

The result has a very useful property:

```text
allocated objects                 free space
██████████████████████│.........................
                      ▲
                     top
```

Now allocating another object can often look approximately like:

```text
address = top
top = top + objectSize
```

That is the basic idea behind **bump-pointer allocation**.

No search through scattered holes.

No need to find an appropriately sized free block.

Just advance the allocation frontier.

```text
Before allocation

used                free
████████████████│..............
                ▲
               top


Allocate 24 bytes


After allocation

used                     free
████████████████████│..........
                    ▲
                   top
```

This can make allocation extremely cheap.

But we paid for that simplicity during GC.

The collector moved objects.

## Moving an object means its references must still work

Suppose the heap contains:

```text
A ─────► B
```

and `B` currently lives at some location:

```text
A ─────► [ B @ old location ]
```

Compaction moves `B`:

```text
old location                 new location

[ B ]        ─────────────►      [ B ]
```

The program must still behave as:

```text
A ─────► B
```

not:

```text
A ─────► old memory
```

So every relevant reference must continue to identify the relocated object correctly.

Conceptually:

```text
BEFORE

A
│
└────────────► B @ address X


GC moves B


AFTER

A
│
└────────────► B @ address Y
```

<figure>
<a href="/images/courses/jvm/gc-reference-fixup.svg" aria-label="Open the relocated reference diagram">
<img src="/images/courses/jvm/gc-reference-fixup.svg"
     alt="Object A references B before compaction. B moves to a new location and the runtime preserves the logical reference from A to B."
     width="760" height="430" />
</a>
<figcaption>Object movement is invisible to Java code only because the JVM preserves the reference relationships.</figcaption>
</figure>

This makes compaction more expensive than simply declaring holes free.

The trade-off becomes:

```text
Mark-Sweep

less movement
     │
     ▼
fragmented free space


Mark-Compact

more movement
     │
     ▼
contiguous free space
     │
     ▼
cheap allocation
```

## Copying collection: don't reclaim garbage at all

Copying collection takes the movement idea in a different direction.

Imagine memory divided conceptually into two spaces:

```text
FROM-SPACE                      TO-SPACE

┌───┬──────┬───┬──────┐       ┌───────────────┐
│ A │ dead │ B │ dead │       │     empty     │
└───┴──────┴───┴──────┘       └───────────────┘
```

Instead of sweeping dead objects individually, copy the live objects into the other space.

```text
FROM-SPACE                      TO-SPACE

┌───┬──────┬───┬──────┐       ┌───┬───┬────────┐
│ A │ dead │ B │ dead │ ─────► │ A │ B │  free  │
└───┴──────┴───┴──────┘       └───┴───┴────────┘
```

Now the old from-space can conceptually be treated as empty.

<figure>
<a href="/images/courses/jvm/gc-copying.svg" aria-label="Open the copying collection diagram">
<img src="/images/courses/jvm/gc-copying.svg"
     alt="Live objects A and B are copied from a space containing garbage into an empty destination space, leaving the destination compact."
     width="820" height="450" />
</a>
<figcaption>Copy the survivors, then reuse the old space instead of individually reclaiming every dead object.</figcaption>
</figure>

Notice what happened to the dead objects:

```text
dead object 1
dead object 2
```

The collector never needed to move them anywhere.

It simply did not copy them.

When the destination becomes the new active space, everything left behind can be forgotten as a group.

That gives copying collection an important performance property:

> **The amount of object data copied depends primarily on how much survives.**

There is still other GC work—root discovery, traversal, bookkeeping, and so on—but the actual copying work grows with the live data that must move.

That makes survival rate extremely important.

## Two regions with the same size can have very different collection costs

Consider two 1 GB memory areas.

### Region A

```text
1 GB total

█████...........................................

50 MB live
950 MB dead
```

Only 50 MB needs to survive.

A copying-style collection has relatively little data to move:

```text
copy ≈ 50 MB of survivors
```

### Region B

```text
1 GB total

██████████████████████████████████████████████..

950 MB live
50 MB dead
```

Now almost everything survives:

```text
copy ≈ 950 MB of survivors
```

<figure>
<a href="/images/courses/jvm/gc-survival-cost.svg" aria-label="Open survival-rate comparison">
<img src="/images/courses/jvm/gc-survival-cost.svg"
     alt="Two equally sized regions are compared: one contains mostly garbage and little live data, while the other contains mostly live data, producing very different copying costs."
     width="820" height="480" />
</a>
<figcaption>For a copying strategy, a region full of garbage can be much cheaper than a region full of survivors.</figcaption>
</figure>

This is an important shift in how to think about allocation.

High allocation does not automatically mean expensive GC.

Suppose an application allocates:

```text
1 GB / second
```

but nearly everything becomes unreachable almost immediately.

The collector may repeatedly encounter:

```text
huge amount allocated
       │
       ▼
tiny amount survives
```

That workload can be surprisingly friendly to a copying strategy.

Compare it with:

```text
huge amount allocated
       │
       ▼
most objects survive
       │
       ▼
large amount must be preserved / moved
```

That is much more expensive.

So:

```text
allocation rate
```

and:

```text
survival rate
```

answer different questions.

## Why can Java objects move at all?

Object movement raises a deeper question.

How can HotSpot move objects without breaking our program?

Java code normally deals with **references**, not application-visible raw memory addresses.

You write:

```java
Customer customer;
```

You do not normally write:

```text
customer lives permanently at address 0x12345678
```

That abstraction gives the JVM room to relocate objects.

Conceptually:

```text
Java code

customer
   │
   ▼

logical reference to Customer
```

During GC:

```text
Customer

old heap location
      │
      ▼
   moved
      │
      ▼
new heap location
```

After the move:

```text
customer
   │
   ▼
same logical Customer
```

The JVM handles the physical location change.

That freedom enables strategies such as:

```text
compaction
copying
generational evacuation
region-based relocation
```

We will see this idea repeatedly in modern collectors.

## Compare the three strategies directly

We can now put them side by side.

```text
MARK-SWEEP

Before
[A][dead][B][dead][C]

After
[A][free][B][free][C]

Moves survivors?
No

Free space?
Fragmented
```

```text
MARK-COMPACT

Before
[A][dead][B][dead][C]

After
[A][B][C][free][free]

Moves survivors?
Yes

Free space?
Contiguous
```

```text
COPYING

From
[A][dead][B][dead]

To
[A][B][free][free]

Moves survivors?
Yes

Dead objects individually reclaimed?
No — they are simply left behind
```

A compact comparison:

| Strategy | Moves live objects? | Fragmentation after collection | Key cost |
|---|---:|---:|---|
| Mark-Sweep | Usually no | Possible | reclaiming/managing scattered space |
| Mark-Compact | Yes | Low | relocating live objects |
| Copying | Yes | Low | copying surviving objects |

The details of real collectors are considerably more sophisticated, but this table gives us the vocabulary needed to reason about them.

## Check your reasoning

Suppose two young-memory regions each contain 1 GB of allocated objects.

Region A:

```text
Live: 50 MB
Dead: 950 MB
```

Region B:

```text
Live: 900 MB
Dead: 100 MB
```

Which one is more attractive for a copying collection?

<details class="lesson-check">
<summary>Pause here, then check your reasoning</summary>
<p>Region A. A copying collector only needs to relocate the surviving objects, so moving roughly 50 MB is much cheaper than moving roughly 900 MB. This is why survival rate matters so much to copying-style collection.</p>
</details>

## This leads directly to generational GC

Now consider what happens in a typical application request:

```java
void handleRequest() {
    StringBuilder builder = new StringBuilder();
    List<Result> results = new ArrayList<>();
    RequestContext context = new RequestContext();

    ...
}
```

The application may allocate many temporary objects while processing the request.

When the request finishes, a large fraction may immediately become unreachable.

Conceptually:

```text
Allocation burst

[A][B][C][D][E][F][G][H][I][J]


short time later


[dead][dead][C][dead][dead][dead][G][dead][dead][dead]
```

This common observation is summarized by the **weak generational hypothesis**:

> Most objects die young.

Now look again at what copying collection likes:

```text
many dead objects
+
few survivors
```

The two ideas fit together naturally.

<figure>
<a href="/images/courses/jvm/gc-generational-bridge.svg" aria-label="Open the bridge to generational GC diagram">
<img src="/images/courses/jvm/gc-generational-bridge.svg"
     alt="A young allocation area fills rapidly with objects. Most become dead, while a small number of survivors are copied elsewhere."
     width="820" height="480" />
</a>
<figcaption>If young objects usually die quickly, collecting a small allocation-heavy area by copying only its survivors can be efficient.</figcaption>
</figure>

Instead of repeatedly processing the entire heap as though every area behaves the same way, the JVM can exploit differences in object lifetime.

Conceptually:

```text
new objects
    │
    ▼
young memory
    │
    ├── most die
    │
    └── few survive
            │
            ▼
        copied / promoted
```

This observation leads directly to one of the most influential ideas in JVM garbage collection:

**generational collection**.

## The mental model so far

We started with:

```text
JVM process
   │
   ▼
Java heap
```

Then:

```text
heap
 │
 ▼
objects + references
 │
 ▼
object graph
```

Then:

```text
GC roots
   │
   ▼
reachability
   │
   ▼
live vs unreachable objects
```

Now we have added:

```text
live vs garbage
      │
      ▼
how should memory be reclaimed?
      │
      ├── sweep holes
      │
      ├── compact survivors
      │
      └── copy survivors
```

The next question almost asks itself.

If newly allocated objects usually die quickly:

```text
Why collect the entire heap
as though every object has
the same lifetime?
```

The next lesson introduces **generational garbage collection**:

**Eden, Survivor spaces, the old generation, object age, promotion, and why generations are a performance optimization rather than a property of Java objects.**
```

### Two technical refinements from the Byte

I would preserve these in the final lesson:

- Instead of saying a copying collector “processes only 5 MB rather than 95 MB of garbage,” say that its **copying/movement work is proportional to surviving data**. It still has root scanning, graph traversal, and other collector work.
- I’d explicitly establish that these are **algorithmic building blocks**. Later, when we introduce G1, ZGC, Shenandoah, etc., readers won't expect each collector to be simply “a mark-compact collector” or “a copying collector.”

This keeps the tone and visual density of Lessons 3–4 while creating a clean bridge into generations.