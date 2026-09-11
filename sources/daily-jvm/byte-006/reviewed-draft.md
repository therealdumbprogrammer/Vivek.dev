Lesson 6 is a natural continuation. I would keep the same illustration-first style, but make one framing adjustment:

> **Eden + S0 + S1 is the classic generational model, not a physical layout guaranteed by every modern collector.**

For example, G1 still has Eden and Survivor concepts, but implements them using regions rather than three permanently contiguous heap areas. So we can teach the classic model while making clear that it is the **conceptual model**.

I would also avoid implying that every long-lived object necessarily travels Eden → Survivor → Old; collectors can have special cases such as large/humongous allocations. For the foundation lesson, though, that lifecycle is exactly the right default model.

The main visuals should be:

1. Allocation → Eden → Survivor → Old
2. Young GC copying only survivors
3. S0/S1 role swapping
4. Object age increasing across collections
5. Old → young reference and remembered metadata
6. Allocation vs survival vs promotion rates

## Draft — Lesson 6: Generational GC — Eden, Survivor, and promotion

```markdown
---
title: Generational GC — Eden, Survivor, and promotion
summary: See why JVM heaps separate short-lived and long-lived objects, how young collections work, and why promotion and remembered references make generational GC efficient.
course: jvm
lessonSlug: generational-gc
module: Foundations
order: 60
sourceByte: byte-006
draft: false
prerequisites:
  - gc-reclamation-strategies
jdk: HotSpot · generational GC foundations
---

In the previous lesson, we compared three foundational reclamation strategies:

```text
mark-sweep
mark-compact
copying
```

Copying collection had one particularly useful property:

> **It works especially well when very little data survives.**

If a 1 GB area contains only 50 MB of live objects, the collector has relatively little survivor data to move.

That immediately raises a question:

```text
Do objects in real applications
actually behave that way?
```

Very often, yes.

A large amount of JVM garbage-collection design is built around an observation known as the **weak generational hypothesis**:

> **Most objects die young, and objects that survive for a while are more likely to remain alive longer.**

That observation leads to **generational garbage collection**.

<figure>
<a href="/images/courses/jvm/generational-overview.svg" aria-label="Open the generational GC overview">
<img src="/images/courses/jvm/generational-overview.svg"
     alt="New objects are allocated into young memory. Most die there, while surviving objects move through survivor memory and eventually into the old generation."
     width="820" height="500" />
</a>
<figcaption>Generational GC treats recently allocated and long-lived objects differently because their survival patterns tend to differ.</figcaption>
</figure>

The basic lifecycle is:

```text
Allocation
    │
    ▼
  Eden
    │
    │ survives young GC
    ▼
Survivor
    │
    │ survives repeatedly
    ▼
Old Generation
```

Let's build that model one piece at a time.

## New objects usually begin young

Consider ordinary application code:

```java
void handleRequest() {
    RequestContext context = new RequestContext();
    StringBuilder builder = new StringBuilder();
    List<Result> results = new ArrayList<>();

    ...
}
```

A request may create many temporary objects.

Most of them might only be needed while that request is being processed.

Conceptually:

```text
request starts

[A][B][C][D][E][F][G][H]


request finishes

[x][x][C][x][x][x][G][x]

x = unreachable
```

Generational collectors exploit this behavior by putting new objects into a part of the heap associated with **young objects**.

In the classic generational model, the young generation is divided into:

```text
Young Generation
│
├── Eden
│
├── Survivor 0
│
└── Survivor 1
```

Most ordinary new allocations begin in **Eden**.

```text
allocate
   │
   ▼

Eden

┌───────────────────────────────────────────┐
│ A │ B │ C │ D │ E │ F │                  │
└───────────────────────────────────────────┘
                            ▲
                     allocation frontier
```

Because Eden is normally maintained as contiguous allocation space, allocation can often use the bump-pointer idea from the previous lesson:

```text
address = top
top += objectSize
```

That makes ordinary object allocation extremely cheap.

> Eden, Survivor spaces, and Old Generation are useful conceptual roles. Their exact physical representation depends on the collector. G1, for example, implements these roles using heap regions rather than requiring three permanently contiguous young-generation areas.

## A young collection mostly throws objects away

Eventually the JVM needs to reclaim young memory.

Imagine Eden contains:

```text
Eden before GC

┌───┬──────┬───┬──────┬──────┬───┐
│ A │ dead │ B │ dead │ dead │ C │
└───┴──────┴───┴──────┴──────┴───┘
```

Reachability analysis tells us:

```text
LIVE
A
B
C
```

Everything else is garbage.

Instead of individually reclaiming every dead object, a copying-style young collection can preserve the survivors elsewhere.

```text
EDEN                            SURVIVOR

[A][dead][B][dead][dead][C]    [            ]

             GC

               ───────────────►

EDEN                            SURVIVOR

[          reusable         ]  [A][B][C]
```

<figure>
<a href="/images/courses/jvm/young-gc-copy.svg" aria-label="Open the young GC copying diagram">
<img src="/images/courses/jvm/young-gc-copy.svg"
     alt="Eden contains live and dead objects. During young GC only the live objects are copied into survivor memory, leaving Eden available for reuse."
     width="840" height="470" />
</a>
<figcaption>If most young objects are dead, only a small survivor set needs to be preserved.</figcaption>
</figure>

Notice what GC did **not** spend time doing:

```text
move dead object
move dead object
move dead object
...
```

The garbage simply remains behind while the live graph is preserved.

Eden can then be reused for another burst of fast allocation.

This is where the weak generational hypothesis becomes useful engineering rather than just an observation:

```text
lots of allocation
      │
      ▼
most dies quickly
      │
      ▼
little data survives
      │
      ▼
cheap copying collection
```

## Why are there two Survivor spaces?

The classic young-generation layout contains two Survivor spaces:

```text
S0
S1
```

Why not just one?

Because copying collection needs somewhere to copy surviving objects **from** and somewhere to copy them **to**.

Suppose S0 currently contains survivors from an earlier collection.

Before the next young GC:

```text
EDEN                S0                  S1

[new objects]       [old survivors]     [empty]
```

The collector examines Eden plus the current survivor set and copies the live objects into the other Survivor space:

```text
EDEN + S0
    │
    │ live objects
    ▼
   S1
```

After the collection:

```text
EDEN                S0                  S1

[reusable]          [reusable]          [survivors]
```

At the next young collection, the roles reverse:

```text
EDEN + S1
    │
    ▼
   S0
```

<figure>
<a href="/images/courses/jvm/survivor-role-swap.svg" aria-label="Open survivor space role swapping">
<img src="/images/courses/jvm/survivor-role-swap.svg"
     alt="The two survivor spaces alternate roles. One young GC copies live objects from Eden and S0 into S1; the next copies survivors from Eden and S1 into S0."
     width="840" height="500" />
</a>
<figcaption>The survivor spaces alternate source and destination roles across young collections.</figcaption>
</figure>

Conceptually:

```text
GC #1

Eden + S0 ─────► S1


GC #2

Eden + S1 ─────► S0


GC #3

Eden + S0 ─────► S1
```

Because only survivors are copied into the destination, Survivor memory remains compact rather than accumulating holes.

## Surviving objects acquire an age

Suppose object `A` survives its first young GC.

HotSpot can conceptually treat it as:

```text
A
age = 1
```

If it survives another:

```text
A
age = 2
```

And another:

```text
A
age = 3
```

<figure>
<a href="/images/courses/jvm/object-aging.svg" aria-label="Open object aging diagram">
<img src="/images/courses/jvm/object-aging.svg"
     alt="An object begins in Eden and survives successive young collections, with its GC age increasing before eventually being promoted to the old generation."
     width="820" height="460" />
</a>
<figcaption>Surviving young collections provides HotSpot with evidence that an object may be long-lived.</figcaption>
</figure>

Conceptually:

```text
        allocation
            │
            ▼
          Eden
            │
        Young GC
            │
            ▼
         age 1
            │
        Young GC
            │
            ▼
         age 2
            │
        Young GC
            │
            ▼
         age 3
            │
           ...
            │
            ▼
       Old Generation
```

The object's **GC age** is not part of the Java language.

Your application cannot ask:

```java
customer.getGcAge();
```

It is runtime bookkeeping used by the collector.

That distinction matters:

> **Object age is a GC optimization heuristic, not a semantic property of a Java object.**

## Promotion: stop copying objects that keep surviving

Now imagine a cache entry that remains alive for hours.

If every young collection repeatedly copied that object:

```text
S0 → S1 → S0 → S1 → S0 → S1 ...
```

the JVM would keep doing work for an object that clearly does not behave like temporary data.

Generational GC eventually makes a different decision:

```text
This object keeps surviving.

Treat it as long-lived.
```

The object can then be **promoted**, or **tenured**, into the old generation.

```text
Young Generation
       │
       │ repeated survival
       ▼
Old Generation
```

Promotion reduces young-GC work because the object no longer needs to participate in every ordinary young-generation evacuation.

<figure>
<a href="/images/courses/jvm/promotion.svg" aria-label="Open object promotion diagram">
<img src="/images/courses/jvm/promotion.svg"
     alt="A long-lived object begins in Eden, survives multiple young collections, and is eventually promoted into old-generation memory."
     width="800" height="450" />
</a>
<figcaption>Promotion moves repeatedly surviving objects out of the frequently collected young area.</figcaption>
</figure>

The decision is more nuanced than:

```text
if age == fixedNumber
    promote
```

HotSpot has a maximum tenuring threshold, but effective promotion behavior can also depend on factors such as survivor-space capacity and the current distribution of object ages.

So the useful mental model is:

```text
repeated survival
       │
       ▼
increasing evidence
that object is long-lived
       │
       ▼
promotion
```

rather than memorizing one universal age.

## Young and old memory have different expected behavior

Generational collection works because the collector expects different survival patterns.

### Young memory

Typically:

```text
high allocation rate
+
high mortality
+
small survivor set
```

### Old memory

Typically:

```text
lower mortality
+
larger long-lived set
```

Visually:

```text
YOUNG

allocate allocate allocate allocate
   │       │       │       │
   ▼       ▼       ▼       ▼
 [A] [B] [C] [D] [E] [F] [G]

           │
           ▼

       most die


OLD

[cache][session][model][long-lived graph]
   │       │       │
   └──── survive for much longer ────
```

<figure>
<a href="/images/courses/jvm/young-vs-old.svg" aria-label="Open young versus old generation diagram">
<img src="/images/courses/jvm/young-vs-old.svg"
     alt="Young memory contains rapidly allocated objects with high mortality, while old memory contains a larger proportion of long-lived objects."
     width="820" height="470" />
</a>
<figcaption>Different survival behavior makes different collection strategies attractive in different parts of the heap.</figcaption>
</figure>

Historically, this led naturally to designs such as:

```text
Young
└── copying / evacuation

Old
└── marking + compaction or sweeping
```

Modern collectors are more sophisticated, but the underlying reason remains the same:

> **Do not treat every part of the heap as though its objects have identical lifetimes.**

## Promotion is not always a simple Eden → Survivor → Old journey

The flow:

```text
Eden
  ↓
Survivor
  ↓
Old
```

is the right foundational model.

But it is not an absolute rule for every allocation.

Depending on the collector and situation, some objects may be handled specially.

Large objects, for example, may not follow the ordinary young-object path in exactly the same way.

We will encounter collector-specific cases later.

For now, treat:

```text
Eden → Survivor → Old
```

as the normal generational lifecycle rather than a JVM specification guarantee.

## There is a problem: generations still reference each other

Suppose an old object contains a reference to a newly allocated young object:

```text
OLD                              YOUNG

┌───────────┐                   ┌───────────┐
│ Customer  │──────────────────►│ NewOrder  │
└───────────┘                   └───────────┘
```

Now a young GC occurs.

Can the JVM just inspect:

```text
GC roots
+
young generation
```

and ignore old memory completely?

No.

If it did, it could miss:

```text
Old object ─────► Young object
```

and incorrectly conclude that the young object was unreachable.

<figure>
<a href="/images/courses/jvm/old-to-young-reference.svg" aria-label="Open the old-to-young reference problem">
<img src="/images/courses/jvm/old-to-young-reference.svg"
     alt="An old-generation object points to a young-generation object, creating a reference that a young collection must account for even though it does not want to scan all old memory."
     width="820" height="430" />
</a>
<figcaption>Young collection cannot ignore references that enter young memory from the old generation.</figcaption>
</figure>

One possible solution would be:

```text
Every young GC:

scan the entire old generation
```

But imagine:

```text
Young = 500 MB
Old   = 20 GB
```

Scanning 20 GB of old memory during every young collection would largely defeat the purpose of having a cheap young collection.

We need another mechanism.

## Remember the interesting old-to-young writes

Suppose application code performs:

```java
oldCustomer.latestOrder = youngOrder;
```

At the Java level, this looks like an ordinary field assignment.

But from the collector's perspective, something important has happened:

```text
Old
 │
 └────────────► Young
```

HotSpot can arrange for reference writes to perform additional GC bookkeeping.

Conceptually:

```text
oldCustomer.latestOrder = youngOrder

             │
             ▼

       store reference
             +
       GC bookkeeping
```

That bookkeeping allows the collector to remember:

```text
some part of old memory
may now contain a reference
into young memory
```

So instead of scanning:

```text
ALL OLD MEMORY
```

the young collection can examine the relevant recorded portions.

<figure>
<a href="/images/courses/jvm/remembered-reference.svg" aria-label="Open remembered reference diagram">
<img src="/images/courses/jvm/remembered-reference.svg"
     alt="A mutator writes an old-to-young reference. A write barrier records metadata identifying the relevant area of old memory, allowing young GC to inspect it without scanning all old objects."
     width="840" height="500" />
</a>
<figcaption>Bookkeeping performed when references change allows later GC work to avoid scanning the entire heap.</figcaption>
</figure>

The mechanism looks roughly like:

```text
Application changes reference
          │
          ▼
      write barrier
          │
          ▼
  remembered metadata
          │
          ▼
Young GC knows where
old-to-young references
may exist
```

The executing application threads are often called **mutators** because they mutate the object graph while GC is trying to manage it.

This introduces one of the most important ideas in modern GC:

> **Efficient collection depends not only on examining the graph during GC, but also on tracking important changes to that graph while the application runs.**

We will spend the entire next lesson making this mechanism concrete through:

```text
write barriers
card tables
remembered sets
```

## Why all of this is worth doing

Suppose an application allocates:

```text
1,000 MB / second
```

That sounds alarming.

But now suppose:

```text
95% dies almost immediately
```

The collector may repeatedly encounter:

```text
Young generation

950 MB garbage
 50 MB survivors
```

A copying-style young collection only needs to preserve a relatively small survivor set.

Meanwhile, old objects do not need to be reconsidered in full during every young collection.

The generational design therefore gives us:

```text
fast young allocation
        +
cheap reclamation of temporary objects
        +
less frequent processing of long-lived objects
```

That is why very high Java allocation rates are not automatically pathological.

## Allocation rate and promotion rate tell different stories

Consider two applications.

### Application A

```text
Allocation: 10 GB/s

99.9% dies young
```

Conceptually:

```text
Eden
 │
 │ huge allocation
 ▼
[objects objects objects objects]

Young GC
 │
 ▼

tiny survivor set
```

Despite enormous allocation throughput, relatively little data flows into old memory.

Now consider Application B:

```text
Allocation: 10 GB/s

large percentage survives
```

The flow becomes:

```text
Eden
  │
  ▼
Survivor
  │
  ▼
Survivor
  │
  ▼
Old
  │
  ▼
Old
  │
  ▼
Old...
```

Old-generation occupancy rises much faster.

<figure>
<a href="/images/courses/jvm/allocation-vs-promotion.svg" aria-label="Open allocation versus promotion diagram">
<img src="/images/courses/jvm/allocation-vs-promotion.svg"
     alt="Two applications have the same high allocation rate. In one nearly everything dies young; in the other many objects survive and are promoted, putting pressure on old memory."
     width="840" height="500" />
</a>
<figcaption>Allocation throughput alone does not tell you how much long-lived heap pressure the application is creating.</figcaption>
</figure>

This gives us four different measurements to think about:

```text
ALLOCATION RATE
How quickly are new objects created?


SURVIVAL RATE
How much young data survives collection?


PROMOTION RATE
How quickly is data flowing into old memory?


OLD-GEN OCCUPANCY
How much long-lived data is accumulating?
```

These tell different stories.

A useful production heuristic is:

```text
high allocation
+
low survival
        │
        ▼
can be relatively manageable
```

whereas:

```text
high allocation
+
high survival
+
high promotion
        │
        ▼
old-generation pressure
        │
        ▼
more expensive GC work
```

## Check your reasoning

Suppose two services both allocate:

```text
5 GB / second
```

Service A:

```text
99% becomes unreachable in young memory
```

Service B:

```text
40% survives repeatedly and reaches old memory
```

Which application is likely to create greater long-term heap pressure?

<details class="lesson-check">
<summary>Pause here, then check your reasoning</summary>
<p>Service B. Allocation rate is identical, but far more of its allocated data survives and flows toward old memory. Service A creates enormous allocation traffic, but if almost everything dies young, copying-style young collections may reclaim most of it cheaply.</p>
</details>

So when GC logs later show a high allocation rate, our first response should not automatically be:

```text
Allocation is too high.
```

We need to ask:

```text
How much survives?
How much is promoted?
What is happening to old-generation occupancy?
```

## Put the generational model together

Our heap model has now evolved from:

```text
Java He
