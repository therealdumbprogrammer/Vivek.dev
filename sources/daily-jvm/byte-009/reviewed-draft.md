Byte #9 is a good transition from **memory/GC mechanics into JIT optimization**. I’d keep the same visual tone, but make three refinements.

- **Escape analysis is analysis, scalar replacement is an optimization enabled by that analysis.** A non-escaping object is not a guarantee that C2 will eliminate it; other compiler constraints can prevent scalar replacement. OpenJDK explicitly documents such limitations. citeturn995896search0
- Keep the correction that **HotSpot does not generally turn these into stack-allocated objects**. C2 can eliminate scalar-replaceable allocations instead. Oracle’s JVM documentation states this explicitly. citeturn995896search1turn995896search27
- I’d introduce **deoptimization/materialization very lightly**. It answers the natural question: “If the object disappeared, what happens if optimized code must deoptimize?” This also plants a useful seed for the later JIT/deoptimization lessons.

The visuals I’d prioritize are:

1. `new` in source → real allocation **or** eliminated allocation.
2. `Point` object → `x` and `y` scalar values.
3. NoEscape / ArgEscape / GlobalEscape intuition.
4. Inlining expanding the optimization scope.
5. Lock object + monitor → both potentially disappearing.
6. Source allocations ≠ runtime allocations.
7. Scalar-replaced state → materialized object during deoptimization.

## Draft — Lesson 9: Escape analysis and scalar replacement

```markdown
---
title: Escape analysis and scalar replacement
summary: See how HotSpot can prove that some Java objects never need a real heap allocation, turning object fields into scalar values and even eliminating unnecessary synchronization.
course: jvm
lessonSlug: escape-analysis-scalar-replacement
module: Foundations
order: 90
sourceByte: byte-009
draft: false
prerequisites:
  - tlabs-allocation
jdk: HotSpot · JIT optimization foundations
---

In the previous lesson, we saw just how cheap an ordinary object allocation can be.

For many small objects, HotSpot can allocate through a TLAB:

```text
new Object()
     │
     ▼
bounds check
     │
     ▼
advance thread-local pointer
     │
     ▼
object exists in Eden
```

That's already fast.

But HotSpot has an even cheaper possibility:

```text
Don't allocate the object at all.
```

Consider:

```java
int distance() {
    Point p = new Point(10, 20);
    return p.x() + p.y();
}
```

At the Java-source level, there is clearly a `Point`.

```text
Point
├── x = 10
└── y = 20
```

And from everything we have learned so far, we might imagine:

```text
new Point(...)
     │
     ▼
TLAB allocation
     │
     ▼
object header
+
x
+
y
+
alignment
```

But Java source describes the **semantics** the program must preserve.

It does not require HotSpot to preserve every source-level object as a physical heap object.

<figure>
<a href="/images/courses/jvm/escape-analysis-overview.svg" aria-label="Open the escape-analysis overview">
<img src="/images/courses/jvm/escape-analysis-overview.svg"
     alt="A source-level new expression reaches JIT analysis. One path produces a normal heap allocation while another eliminates the allocation and keeps only the values needed by the optimized code."
     width="840" height="500" />
</a>
<figcaption>A source-level allocation does not necessarily survive into optimized machine code as a real heap allocation.</figcaption>
</figure>

The analysis that makes this possible is called **escape analysis**.

## First ask: who can observe this object?

Return to:

```java
int distance() {
    Point p = new Point(10, 20);
    return p.x() + p.y();
}
```

Inside this method, HotSpot can reason about how `p` is used.

Conceptually:

```text
create Point
     │
     ▼
store x = 10
store y = 20
     │
     ▼
read x
read y
     │
     ▼
return x + y
```

Now ask:

```text
Does anything outside the optimized code
actually need to observe this Point object?
```

In this example:

```text
p is not stored globally
p is not stored into another escaping object
p is not returned
its identity is not otherwise required
```

That gives the optimizing compiler an opportunity.

Instead of preserving:

```text
┌─────────────────┐
│ Point object    │
│                 │
│ header          │
│ x = 10          │
│ y = 20          │
└─────────────────┘
```

HotSpot may be able to preserve only:

```text
x = 10
y = 20
```

and eventually:

```text
return 30
```

The object representation itself is unnecessary.

## Scalar replacement: break the object into values

The optimization that removes the aggregate object representation is called **scalar replacement**.

Start with the conceptual object:

```text
Point

┌──────────────────┐
│ Object header    │
├──────────────────┤
│ x                │
├──────────────────┤
│ y                │
└──────────────────┘
```

But the optimized computation only needs:

```text
x
y
```

So HotSpot can conceptually transform:

```text
Point p = new Point(10, 20);

return p.x + p.y;
```

into something closer to:

```text
x = 10
y = 20

return x + y
```

<figure>
<a href="/images/courses/jvm/scalar-replacement.svg" aria-label="Open the scalar-replacement diagram">
<img src="/images/courses/jvm/scalar-replacement.svg"
     alt="A Point heap object containing header, x, and y is decomposed by scalar replacement into independent x and y values, removing the physical object allocation."
     width="820" height="470" />
</a>
<figcaption>Scalar replacement keeps the values required by the program while removing the aggregate object representation when possible.</figcaption>
</figure>

Those scalar values might ultimately live in:

```text
CPU registers
stack slots
compiler intermediate values
```

or disappear entirely through further optimization.

For our constant example:

```text
10 + 20
```

may itself become:

```text
30
```

So a surprisingly large source-level sequence:

```text
allocate object
initialize object
read fields
add fields
```

can eventually become something tiny in machine code.

## Escape analysis and scalar replacement are not the same thing

It is useful to separate two steps.

### Escape analysis asks

```text
How is this object observable?

Can it escape the scope the compiler
is currently reasoning about?
```

### Scalar replacement asks

```text
Given what we know,
can the aggregate object representation
be replaced with its individual values?
```

So conceptually:

```text
Object allocation
      │
      ▼
Escape analysis
      │
      ▼
Is sufficient confinement proven?
      │
      ├──── NO ────► preserve normal object semantics
      │
      └──── YES
              │
              ▼
      optimization candidate
              │
              ▼
       scalar replacement
         if profitable/
          supported
```

That final qualification matters.

A compiler proving that an object does not meaningfully escape creates an **optimization opportunity**.

It does not mean every such object must always disappear.

Compiler limitations, control flow, inlining decisions, optimization phase interactions, and other constraints can prevent scalar replacement.

> Escape analysis provides information. Scalar replacement is one optimization HotSpot may perform using that information.

## What does "escape" mean?

HotSpot's escape-analysis terminology includes categories such as:

```text
NoEscape
ArgEscape
GlobalEscape
```

You do not need to memorize these as Java-language concepts.

They describe what the compiler has been able to prove.

### NoEscape

Conceptually:

```text
method
│
├── create object
├── use object
└── object remains confined enough
    for aggressive optimization
```

For example:

```java
int calculate() {
    Point p = new Point(10, 20);
    return p.x + p.y;
}
```

This is the kind of shape that may become scalar-replaceable.

### GlobalEscape

Now consider:

```java
static Point current;

void create() {
    Point p = new Point(10, 20);
    current = p;
}
```

The graph becomes:

```text
static state
     │
     ▼
   Point
```

The object is now observable beyond this local execution.

Conceptually:

```text
Point
  │
  ▼
GLOBAL ESCAPE
```

Another example:

```java
class Holder {
    Object value;
}

void save(Holder holder) {
    Object obj = new Object();
    holder.value = obj;
}
```

If `holder` itself is externally visible, storing `obj` into it can expose `obj` as well.

### ArgEscape

There is also an intermediate situation where an object flows through method arguments without necessarily becoming globally exposed.

Conceptually:

```text
caller
  │
  ▼
temporary object
  │
  ▼
callee argument
```

HotSpot can sometimes reason about such flows, depending on what it can see and analyze.

<figure>
<a href="/images/courses/jvm/escape-states.svg" aria-label="Open escape-state intuition">
<img src="/images/courses/jvm/escape-states.svg"
     alt="Three conceptual cases show a confined object, an object passed through a call, and an object stored into globally reachable state."
     width="850" height="500" />
</a>
<figcaption>Escape analysis is about what other code can observe, not simply whether the source contains a new expression.</figcaption>
</figure>

## Escape does not simply mean "returned"

Suppose:

```java
Point createPoint() {
    return new Point(10, 20);
}

int calculate() {
    Point p = createPoint();
    return p.x();
}
```

Looking at `createPoint()` alone:

```text
new Point
    │
    ▼
 return it
```

seems to expose the object beyond that method.

But the JIT does not necessarily optimize each source method in isolation.

Suppose `createPoint()` is **inlined** into `calculate()`.

The compiler can now reason about something conceptually closer to:

```java
int calculate() {
    Point p = new Point(10, 20);
    return p.x();
}
```

Suddenly the larger optimized scope reveals:

```text
create Point
     │
     ▼
read x
     │
     ▼
return
```

No external observer may actually require the object.

<figure>
<a href="/images/courses/jvm/inlining-escape-analysis.svg" aria-label="Open the inlining and escape-analysis diagram">
<img src="/images/courses/jvm/inlining-escape-analysis.svg"
     alt="Before inlining, createPoint appears to return a Point to another method. After inlining, the optimizer sees allocation and consumption together and may determine the object need not escape."
     width="840" height="500" />
</a>
<figcaption>Inlining expands the region of code over which other optimizations can reason.</figcaption>
</figure>

This gives us an important compiler relationship:

```text
Inlining
   │
   ▼
larger optimization scope
   │
   ▼
better visibility
   │
   ▼
escape analysis
   │
   ▼
possible scalar replacement
```

This is one reason JIT optimizations should not be thought of as isolated features.

They reinforce one another.

## This is not ordinary stack allocation

A very common explanation of escape analysis is:

```text
Object doesn't escape
       │
       ▼
JVM puts it on the stack
instead of the heap
```

That is not the right mental model for HotSpot's C2 optimization.

Prefer:

```text
Source says:
new Point(...)
       │
       ▼
escape analysis
       │
       ▼
scalar replacement
       │
       ▼
heap allocation eliminated
```

rather than:

```text
heap object
    │
    ▼
stack object
```

<figure>
<a href="/images/courses/jvm/not-stack-allocation.svg" aria-label="Open the allocation-elimination diagram">
<img src="/images/courses/jvm/not-stack-allocation.svg"
     alt="The incorrect model moves a heap object onto the stack. The HotSpot scalar-replacement model instead eliminates the object allocation and represents only the required scalar values."
     width="840" height="470" />
</a>
<figcaption>For HotSpot scalar replacement, think allocation elimination rather than moving an intact Java object from heap to stack.</figcaption>
</figure>

Values resulting from scalar replacement may of course eventually occupy registers or stack locations as machine code executes.

But that is different from saying:

```text
HotSpot created the same Java object
as a normal stack-allocated object.
```

The aggregate object may simply not exist.

## Escape analysis can also remove locking

Now connect this to synchronization.

Consider:

```java
void calculate() {
    Object lock = new Object();

    synchronized (lock) {
        doWork();
    }
}
```

What would another thread need in order to contend on this monitor?

It would need access to:

```text
lock
```

But suppose HotSpot proves:

```text
lock never becomes visible
to another thread
```

Then logically:

```text
another thread can acquire this monitor?
                  │
                  ▼
                 NO
```

The synchronization cannot experience real contention.

That can make the monitor operations unnecessary.

Conceptually:

```text
new lock object

monitorenter
     │
  doWork()
     │
monitorexit
```

may be optimized toward:

```text
doWork()
```

when the required conditions are satisfied.

<figure>
<a href="/images/courses/jvm/lock-elimination.svg" aria-label="Open lock-elimination diagram">
<img src="/images/courses/jvm/lock-elimination.svg"
     alt="A synchronization block uses a newly created private lock object. Escape analysis proves that no other thread can observe it, allowing monitor enter and exit operations to be eliminated."
     width="820" height="500" />
</a>
<figcaption>If no other thread can ever observe the lock object, synchronization on that object may provide no useful coordination.</figcaption>
</figure>

Potentially we began with:

```text
allocation
+
monitor enter
+
work
+
monitor exit
```

and optimization removed:

```text
allocation
+
locking machinery
```

This is called **lock elimination**.

Again, this is not a Java-language transformation.

It is an optimization performed only when HotSpot can prove that observable behavior remains unchanged.

## But if the object disappeared, can HotSpot ever need it again?

This creates an interesting question.

Suppose optimized code has scalar-replaced:

```text
Point p
```

into:

```text
x
y
```

Then something happens that invalidates one of the assumptions behind the optimized machine code.

Later we will learn that HotSpot can **deoptimize** compiled code and return execution to a less optimized state.

Now it may need to reconstruct Java-level execution state.

Conceptually:

```text
Optimized execution

x = 10
y = 20

no physical Point object
        │
        ▼
    deoptimization
        │
        ▼
HotSpot reconstructs
required Java state
        │
        ▼
Point can be materialized
if necessary
```

<figure>
<a href="/images/courses/jvm/scalar-materialization.svg" aria-label="Open scalar materialization diagram">
<img src="/images/courses/jvm/scalar-materialization.svg"
     alt="Optimized code contains only scalar x and y values for a source-level Point. During deoptimization, HotSpot can reconstruct the required Java object state."
     width="820" height="500" />
</a>
<figcaption>Optimization can remove physical representation while still preserving enough information to recover correct Java semantics when necessary.</figcaption>
</figure>

We do not need the implementation details yet.

The deeper lesson is:

> **Optimized machine code can use a representation very different from the source, as long as HotSpot can preserve Java-visible behavior.**

This idea will become central when we study speculative optimization and deoptimization.

## Source allocations are not runtime allocations

Now consider:

```java
for (int i = 0; i < 1_000_000; i++) {
    Point p = new Point(i, i + 1);
    result += p.x + p.y;
}
```

Reading the source suggests:

```text
1,000,000 iterations

=

1,000,000 Point allocations
```

But after optimization:

```text
source-level allocations
        │
        ▼
JIT analysis
        │
        ├── some real allocations
        │
        └── some potentially eliminated
```

Therefore:

```text
source `new` count
      ≠
actual heap-allocation count
```

This is particularly important for microbenchmarks.

Suppose we write:

```java
void benchmark() {
    new Point(10, 20);
}
```

and never use the result.

The optimizer may conclude:

```text
allocation has no observable effect
```

and eliminate much more work than the benchmark author intended to measure.

The benchmark may then report:

```text
extremely fast object creation!
```

when it actually measured:

```text
almost nothing
```

This is one reason reliable Java microbenchmarking requires tools and patterns such as JMH rather than hand-written timing loops.

## Allocation profiling observes what survives optimization

The same distinction helps when reading allocation profiles.

Imagine source code contains:

```text
10 million `new` expressions
```

but optimized execution eliminates some of them.

An allocation profiler measuring actual heap allocations does not need to report source-level objects that were never allocated.

Conceptually:

```text
SOURCE

new A
new B
new C
new D


JIT

A → eliminated
B → real allocation
C → eliminated
D → real allocation


HEAP / ALLOCATION PROFILE

B
D
```

That is another reason allocation behavior can change as code warms up and moves through interpreter/JIT compilation tiers.

The source did not change.

The runtime representation did.

## Do not program around escape analysis

Once developers learn about scalar replacement, there is a temptation to start writing code like:

```text
How do I force HotSpot
to scalar replace this?
```

That is usually the wrong level of abstraction.

Escape-analysis effectiveness depends on many compiler decisions:

```text
inlining
call structure
control flow
polymorphism
object identity
compiler visibility
optimization budget
other compiler phases
```

Small changes can alter optimization decisions.

So the practical model should be:

```text
write clear code
      │
      ▼
allow HotSpot to optimize
      │
      ▼
profile real behavior
      │
      ▼
optimize application structure
only when evidence requires it
```

Not:

```text
manually remove every temporary object
because allocation must be expensive
```

The last two lessons should have changed that intuition considerably.

First we learned:

```text
Real allocation required?

TLAB makes it cheap.
```

Now:

```text
Real allocation not required?

JIT may remove it entirely.
```

## Check your reasoning

Consider:

```java
int value() {
    Point p = new Point(10, 20);
    return p.x;
}
```

Suppose C2 can fully analyze this code, proves that the `Point` does not escape, and determines that its identity is irrelevant.

Does HotSpot need to create a `Point` object on the stack?

<details class="lesson-check">
<summary>Pause here, then check your reasoning</summary>
<p>No. HotSpot does not need to replace the heap allocation with an intact stack-allocated Point. Scalar replacement can eliminate the aggregate allocation and retain only the values needed by the computation. Those values may eventually live in registers, stack slots, or disappear through further optimization.</p>
</details>

The important transformation is:

```text
object
  │
  ▼
values
```

not:

```text
heap object
  │
  ▼
stack object
```

## Put the allocation story together

Over the last several lessons, `new` has become much more interesting.

Start with:

```java
new SomeObject()
```

At source level:

```text
Java object semantics
```

Then the optimizing compiler asks:

```text
Does this allocation
need to physically exist?
```

The resulting model is:

```text
                  new SomeObject()
                         │
                         ▼
                    JIT analysis
                         │
               ┌─────────┴─────────┐
               │                   │
       allocation can       real allocation
       be eliminated          required
               │                   │
               ▼                   ▼
      scalar replacement          TLAB
               │                   │
               ▼
