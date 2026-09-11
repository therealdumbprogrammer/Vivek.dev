Lesson 4 should continue the **illustration-first style of Lesson 3**. This topic is even more visual because reachability is fundamentally a graph problem.

I’d make one conceptual refinement to the Byte: avoid teaching “GC root” as though it is a special Java object. A GC root is better understood as a **reference starting point known to the JVM from outside the ordinary heap graph**—for example, a live reference in a thread frame/register, static state, JNI references, or VM structures.

I’d structure the lesson around six main visuals:

1. Heap objects become an object graph.
2. GC roots connect the running JVM to that graph.
3. Reachability is transitive.
4. An unreachable cycle is still garbage.
5. Marking = traversal from roots.
6. Memory leak = an unwanted path from a root, leading into retained size/dominators.

## Draft — Lesson 4: GC roots, reachability, and why GC is graph traversal

```markdown
---
title: GC roots, reachability, and why GC is graph traversal
summary: Learn how the JVM decides whether an object is alive, why cycles can still be collected, and why Java memory leaks are usually unwanted reachability rather than failed garbage collection.
course: jvm
lessonSlug: gc-roots-reachability
module: Foundations
order: 40
sourceByte: byte-004
draft: false
prerequisites:
  - object-layout
jdk: HotSpot · GC foundations
---

In the previous lesson, we zoomed into a single object.

We saw that objects contain fields, and some of those fields are **references to other objects**.

Now zoom back out.

Once references connect objects together, the heap begins to look less like a collection of isolated allocations and more like a **graph**.

<figure>
<a href="/images/courses/jvm/object-graph.svg" aria-label="Open heap object graph diagram">
<img src="/images/courses/jvm/object-graph.svg"
     alt="Several heap objects connected to one another through references, forming an object graph."
     width="760" height="430" />
</a>
<figcaption>References turn individual heap objects into a graph.</figcaption>
</figure>

For example:

```java
class Order {
    Customer customer;
}

class Customer {
    Address address;
}
```

might produce:

```text
┌─────────┐       ┌──────────┐       ┌─────────┐
│  Order  │──────►│ Customer │──────►│ Address │
└─────────┘       └──────────┘       └─────────┘
```

Garbage collection operates on this graph.

And its most important question is not:

```text
How old is this object?
```

or:

```text
When was this object allocated?
```

The fundamental question is:

```text
Can this object still be reached
from something the JVM knows is alive?
```

That gives us the central rule for this lesson:

> **An object can be reclaimed when it is no longer reachable from the GC root set.**

## Where does traversal begin?

Consider this heap:

```text
Order ─────► Customer ─────► Address
```

We still have a problem.

How does the JVM know whether `Order` itself is alive?

There needs to be some starting point outside this chain.

That is where **GC roots** enter the picture.

<figure>
<a href="/images/courses/jvm/gc-root-overview.svg" aria-label="Open GC root overview">
<img src="/images/courses/jvm/gc-root-overview.svg"
     alt="A GC root reference leads to an Order object, which references Customer, which references Address."
     width="760" height="420" />
</a>
<figcaption>GC roots provide the starting points from which heap reachability is discovered.</figcaption>
</figure>

Conceptually:

```text
        GC ROOT
           │
           ▼
       ┌─────────┐
       │  Order  │
       └────┬────┘
            │
            ▼
       ┌──────────┐
       │ Customer │
       └────┬─────┘
            │
            ▼
       ┌─────────┐
       │ Address │
       └─────────┘
```

Because the JVM can start at the root and follow references all the way to `Address`, every object in that chain is reachable.

## A GC root is a starting point, not a special heap object

It is easy to hear “GC root” and imagine that the heap contains special objects labelled as roots.

That is not the useful mental model.

Think of a root as:

> **a reference starting point that the JVM already knows must be considered when discovering live objects.**

Typical root sources include references associated with:

```text
running threads
├── stack frames
└── registers / execution state

loaded classes
└── static state

native code
└── JNI references

JVM runtime
└── internal VM structures
```

A simplified picture is:

<figure>
<a href="/images/courses/jvm/gc-root-sources.svg" aria-label="Open GC root sources diagram">
<img src="/images/courses/jvm/gc-root-sources.svg"
     alt="Thread execution state, static state, JNI references, and JVM runtime structures act as root sources leading into the heap object graph."
     width="800" height="500" />
</a>
<figcaption>Different parts of the running JVM can provide entry points into the heap graph.</figcaption>
</figure>

Conceptually:

```text
                    JVM runtime

 Thread             Loaded class          JNI/native
   │                     │                    │
   │ local ref           │ static ref         │ JNI ref
   ▼                     ▼                    ▼

 Object A              Object D             Object F
    │
    ▼
 Object B
```

GC starts from these root references and discovers what remains reachable.

## Stack references connect execution to the heap

Suppose a platform thread is currently executing:

```java
void process() {
    Customer customer = loadCustomer();
    use(customer);
}
```

During the portion of execution where the `customer` reference is considered live, the JVM needs to know that it points to a heap object.

Conceptually:

```text
Thread
  │
  ▼
Stack / execution state
  │
  └── customer ──────────────► Customer object
```

That `Customer` object may itself reference more objects:

```text
Thread
  │
  ▼
customer
  │
  ▼
Customer ─────► Address ─────► String
```

So a reference originating from executing code can keep an entire object graph alive.

There is an important subtlety here.

The JVM does not simply assume that every slot in a stack frame is always an object reference.

At a particular execution point, it needs to know things such as:

```text
this location contains an object reference
this location contains an int
this register contains an object reference
this other register contains a numeric value
```

For JIT-compiled code, HotSpot generates metadata that allows the runtime to identify these object-reference locations precisely.

We will revisit that machinery when we study **compiled frames, OopMaps, safepoints, and JIT internals**.

For now, keep the connection:

```text
GC
 │
 ▼
needs roots
 │
 ▼
some roots come from executing threads
 │
 ▼
JVM must understand thread state
```

This is one reason GC cannot be understood completely independently of execution.

## Reachability is transitive

An object does not need to be referenced directly by a GC root.

Suppose:

```text
ROOT ─────► A ─────► B ─────► C
```

The JVM starts at the root.

It discovers `A`.

From `A`, it discovers `B`.

From `B`, it discovers `C`.

So:

```text
ROOT
 │
 ▼
 A       reachable
 │
 ▼
 B       reachable
 │
 ▼
 C       reachable
```

All three objects are alive from the collector's perspective.

<figure>
<a href="/images/courses/jvm/transitive-reachability.svg" aria-label="Open transitive reachability diagram">
<img src="/images/courses/jvm/transitive-reachability.svg"
     alt="A GC root reaches object A, which reaches B, which reaches C. Removing the root-to-A reference makes the entire A-B-C subgraph unreachable."
     width="800" height="440" />
</a>
<figcaption>Reachability follows paths, not just direct root references.</figcaption>
</figure>

Now remove the root's reference to `A`:

```text
ROOT


        A ─────► B ─────► C
```

The objects still reference each other.

Nothing about `B` or `C` has changed internally.

But there is no longer a path:

```text
ROOT → ... → A
```

Therefore there is also no path to `B` or `C`.

The entire chain can become unreachable together.

That gives us a useful rule:

```text
reachable object
=
there exists a path from some GC root to that object
```

## Cycles do not keep themselves alive

This graph-based model explains an important property of tracing garbage collectors.

Suppose two objects reference each other:

```text
┌─────┐          ┌─────┐
│  A  │─────────►│  B  │
└──▲──┘          └──┬──┘
   │                │
   └────────────────┘
```

Both objects have references pointing at them.

Does that automatically mean they are alive?

No.

Now include the root set:

```text
GC ROOTS


       no path
          X


      ┌─────┐
      │  A  │◄─────┐
      └──┬──┘      │
         │         │
         ▼         │
      ┌─────┐      │
      │  B  │──────┘
      └─────┘
```

There is no path from any root to either object.

So both are unreachable.

<figure>
<a href="/images/courses/jvm/unreachable-cycle.svg" aria-label="Open unreachable cycle diagram">
<img src="/images/courses/jvm/unreachable-cycle.svg"
     alt="Objects A and B reference each other but have no path from any GC root, so both are garbage."
     width="720" height="420" />
</a>
<figcaption>A cycle can be internally connected and still be unreachable from the running application.</figcaption>
</figure>

This is an important distinction from simple reference-counting models.

A tracing collector asks:

```text
Can I reach this object from the roots?
```

not:

```text
Does anything point to this object?
```

That is why ordinary cyclic Java object structures do not inherently cause memory leaks.

## Marking is graph traversal

Now we can describe the core idea behind tracing garbage collection.

Imagine the heap contains:

```text
             ┌────► B
             │
ROOT ─────► A
             │
             └────► C


D ─────► E
```

The collector can conceptually perform:

```text
1. Start with the GC roots

2. Follow each root reference

3. Mark each discovered object as reachable

4. Follow references from those objects

5. Repeat until no new reachable objects remain

6. Objects never discovered are unreachable
```

Let's walk through that visually.

### Step 1 — start from the root

```text
ROOT ─────► A

A ─────► B
│
└──────► C

D ─────► E
```

Discover:

```text
A
```

### Step 2 — follow A's references

```text
ROOT ─────► [A]
             │
             ├────► [B]
             │
             └────► [C]

D ─────► E
```

Discover:

```text
A
B
C
```

### Step 3 — traversal finishes

There are no additional references leading to `D` or `E`.

So:

```text
REACHABLE             UNREACHABLE

A                     D
B                     E
C
```

<figure>
<a href="/images/courses/jvm/gc-mark-traversal.svg" aria-label="Open GC graph traversal diagram">
<img src="/images/courses/jvm/gc-mark-traversal.svg"
     alt="GC traversal begins at a root, discovers A, then follows A to B and C. Separate objects D and E are never discovered and remain unreachable."
     width="820" height="500" />
</a>
<figcaption>Tracing collection discovers the live graph by walking outward from the root set.</figcaption>
</figure>

This is the conceptual foundation of **marking**.

Different collectors perform this work in very different ways and under very different concurrency constraints, but the graph problem remains:

```text
roots
  │
  ▼
discover reachable nodes
  │
  ▼
everything else is garbage
```

## Why root discovery is harder than the diagram suggests

Our diagrams make roots look obvious:

```text
customer ─────► Customer object
```

Real execution is not that clean.

Suppose JIT-compiled machine code is currently executing.

A CPU register might contain:

```text
0x0000000701234560
```

Is that:

```text
an object reference?
an integer?
part of another value?
temporary machine state?
```

The collector cannot safely guess.

It needs precise runtime metadata describing where object references can be found at relevant execution points.

Conceptually:

```text
Compiled method
      │
      ├── machine code
      │
      └── GC metadata
            │
            ├── register R3 = oop
            ├── stack slot 24 = oop
            └── stack slot 40 = non-reference
```

Here `oop` is HotSpot terminology historically used for an ordinary object pointer/reference.

That metadata connects several topics we have already encountered:

```text
JIT compilation
      │
      ▼
compiled machine code
      │
      ▼
thread executes compiled frame
      │
      ▼
GC needs object references
      │
      ▼
HotSpot uses metadata describing that frame
```

Later, **safepoints and OopMaps** will make this much more concrete.

For now, the important conclusion is:

> GC is graph traversal, but building the correct starting root set requires cooperation from the execution engine.

## A Java memory leak usually contains live objects

Now we can correct one of the most common misconceptions about Java memory leaks.

People sometimes imagine a leak like this:

```text
object becomes garbage
       │
       ▼
GC somehow fails
       │
       ▼
memory leak
```

That is usually not what happens.

A much more common Java leak looks like:

```text
application accidentally
keeps a reference
       │
       ▼
object remains reachable
       │
       ▼
GC discovers it from a root
       │
       ▼
GC correctly preserves it
       │
       ▼
heap keeps growing
```

The collector is doing exactly what it should.

Consider:

```java
static Map<String, Object> cache = new HashMap<>();
```

Suppose the application continually inserts entries but never removes them.

The graph might become:

<figure>
<a href="/images/courses/jvm/reachable-leak.svg" aria-label="Open reachable memory leak diagram">
<img src="/images/courses/jvm/reachable-leak.svg"
     alt="A static root reaches a cache map, which continues to reference an increasing number of objects, keeping all of them alive."
     width="800" height="460" />
</a>
<figcaption>A Java memory leak often consists of objects that are still perfectly reachable.</figcaption>
</figure>

Conceptually:

```text
Static state
    │
    ▼
┌───────────┐
│   cache   │
└─────┬─────┘
      │
      ├────────► Object
      │
      ├────────► Object
      │
      ├────────► Object
      │
      ├────────► Object
      │
      └────────► Object ...
```

Every GC cycle asks:

```text
Can I reach these objects?
```

The answer is:

```text
Yes.
```

Therefore they survive.

So the better leak-analysis question is not:

```text
Why didn't GC delete this object?
```

It is:

```text
What path from a GC root
is keeping this object alive?
```

That question will become extremely important when we use heap-analysis tools.

## Paths to GC roots explain survival

Suppose a heap analyzer shows an unexpectedly large `Customer` object graph.

Knowing that the object exists is not enough.

You want to understand **why it remains reachable**.

For example:

```text
GC Root
   │
   ▼
static cache
   │
   ▼
HashMap
   │
   ▼
Entry
   │
   ▼
Customer
   │
   ▼
Orders...
```

That chain is commonly described as a **path to a GC root**.

<figure>
<a href="/images/courses/jvm/path-to-gc-root.svg" aria-label="Open path to GC root diagram">
<img src="/images/courses/jvm/path-to-gc-root.svg"
     alt="A GC root reaches a static cache, which reaches a map entry, which reaches a Customer and its associated objects."
     width="780" height="500" />
</a>
<figcaption>The path to a GC root explains why an apparently unwanted object cannot yet be collected.</figcaption>
</figure>

A heap dump therefore becomes much more useful when we stop asking only:

```text
Which classes use the most memory?
```

and begin asking:

```text
Why are these objects still reachable?
```

## From reachability to retained size

The previous lesson separated **shallow size** from the object graph.

Now we can take the next step.

Suppose:

```text
ROOT ─────► A ─────► B ─────► C
```

and the only path from the root set to `B` and `C` goes through `A`.

Conceptually:

```text
       ROOT
        │
        ▼
     ┌─────┐
     │  A  │
     └──┬──┘
        │
        ▼
     ┌─────┐
     │  B  │
     └──┬──┘
        │
        ▼
     ┌─────┐
     │  C  │
     └─────┘
```

If the reference keeping `A` reachable disappeared:

```text
ROOT


A ─────► B ─────► C
```

then the whole subgraph could become collectible.

This leads toward the idea of **retained size**.

Very roughly:

> The retained size associated with an object reflects memory that would become eligible for collection if that object were no longer keeping the corresponding subgraph reachable.

But there is an important condition:

```text
A must actually control the relevant paths
from the roots to that subgraph.
```

Suppose instead:

```text
ROOT ───► A ───► B
  │             ▲
  └─────────────┘
```

Removing `A` does **not** make `B` unreachable.

`B` has another path from the root.

That distinction leads to **dominators**.

<figure>
<a href="/images/courses/jvm/dominator-intuition.svg" aria-label="Open dominator intuition diagram">
<img src="/images/courses/jvm/dominator-intuition.svg"
     alt="In one graph A is the only route from the root to B and C, so A dominates them. In another graph B has an alternate root path and is not retained solely through A."
     width="820" height="480" />
</a>
<figcaption>Retained memory depends on which root paths an object actually controls.</figcaption>
</figure>

We do not need to learn dominator-tree algorithms yet.

For now, connect the concepts:

```text
reachability
     │
     ▼
paths from GC roots
     │
     ▼
which objects control those paths?
     │
     ▼
dominators
     │
     ▼
retained size
```

This is why heap analyzers such as MAT can identify objects that retain far more memory than their own shallow size suggests.

## Check your reasoning

Consider this graph:

```text
        ROOT
         │
         ▼
         A ─────► B
                  │
                  ▼
                  C

         D ◄────► E
```

Which objects can the collector reclaim?

<details class="lesson-check">
<summary>Pause here, then check your reasoning</summary>
<p><code>A</code>, <code>B</code>, and <code>C</code> are reachable because there is a path from the root through <code>A</code>. <code>D</code> and <code>E</code> form a cycle, but nothing from the root set reaches that cycle. Both are therefore unreachable and can be reclaimed.</p>
</details>

The existence of references is not enough.

The existence of a **root path** is what matters.

## Keep the graph model

We have now built several layers of the JVM memory model.

First:

```text
JVM process
│
├── Java heap
└── native memory
```

Then:

```text
Java heap
└── objects
    ├── headers
    ├── fields
    └── references
```

And now:

```text
                    GC ROOTS
                       │
                       ▼

Java heap        object graph

                A ─────► B
                │        │
                ▼        ▼
                C        D
```

Garbage collection fundamentally asks:

```text
Which heap nodes are reachable
from the root set?
```

Everything reachable forms the **live graph**.

Everything outside that graph is a candidate for reclamation.

Different collectors make very different engineering choices about how to discover, track, move, and reclaim those objects.

But they all have to deal with this underlying problem:

```text
roots
  │
  ▼
reachability
  │
  ▼
live objects vs garbage
```

Now that we understand **what counts as garbage**, the next lesson can finally ask:

**What should a collector do with it?**

We will compare the three foundational strategies:

**mark-sweep, mark-compact, and copying collection — and see how fragmentation and allocation speed shaped modern garbage collectors.**
```

### Technical choices I’d preserve

A few details in this version are intentionally more precise than the original Byt