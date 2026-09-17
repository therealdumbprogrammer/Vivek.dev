Byte #13 is a good pivot into adaptive execution. I’d preserve the structure, with a few refinements:

- Avoid implying that **all profiling comes only from the interpreter**. In tiered compilation, profiling can also be gathered in compiled tiers.
- Treat invocation/back-edge counters as the **conceptual hotness model**, not a promise that one simple counter directly controls compilation.
- Make clear that the interpreter executes **native interpreter code generated for bytecodes**, while compiled methods get **method-specific native code**.
- Keep the warm-up section prominent because it connects directly to real production behavior.

## Draft — Lesson 13: The HotSpot interpreter

```markdown id="k4x23c"
---
title: The HotSpot interpreter — executing bytecode before JIT compilation
summary: See how HotSpot executes JVM bytecodes immediately, why interpretation is useful despite being slower, and how runtime profiling helps identify code worth compiling.
course: jvm
lessonSlug: hotspot-interpreter
module: Execution and JIT
order: 130
sourceByte: byte-013
draft: false
prerequisites:
  - stack-frames-operand-stack
jdk: HotSpot · interpreter and adaptive execution
---

In the previous lesson, we finally had enough machinery to understand a bytecode sequence such as:

```text
iload_1
iload_2
iadd
ireturn
```

We know where the values live.

We know how the operand stack changes.

We know how the current method frame represents execution state.

But one question remained:

```text
Who actually reads those bytecodes
and performs their operations?
```

One major answer in HotSpot is:

> **The interpreter.**

Before a method has a compiled version available, HotSpot can begin executing its bytecode directly through interpreter machinery.

<figure>
<a href="/images/courses/jvm/interpreter-overview.svg" aria-label="Open the HotSpot interpreter overview">
<img src="/images/courses/jvm/interpreter-overview.svg"
     alt="A loaded method's bytecode enters the HotSpot interpreter, which executes bytecode operations using the current JVM frame and produces runtime profiling information."
     width="840" height="500" />
</a>
<figcaption>The interpreter lets HotSpot begin executing a method before spending time compiling it.</figcaption>
</figure>

## Start with one bytecode at a time

Suppose the current method contains:

```text
iload_1
iload_2
iadd
ireturn
```

Conceptually, interpreted execution looks like:

```text
read current bytecode
        │
        ▼
dispatch to implementation
for that bytecode
        │
        ▼
perform the operation
on current frame state
        │
        ▼
move to next bytecode
        │
        ▼
repeat
```

For example:

```text
OPERAND STACK

before iadd

┌────┐
│ 20 │
├────┤
│ 10 │
└────┘
```

The JVM semantics of `iadd` are essentially:

```text
pop int
pop int
add
push result
```

So after execution:

```text
OPERAND STACK

┌────┐
│ 30 │
└────┘
```

<figure>
<a href="/images/courses/jvm/interpreter-iadd.svg" aria-label="Open interpreted iadd execution">
<img src="/images/courses/jvm/interpreter-iadd.svg"
     alt="The interpreter reaches an iadd bytecode, consumes integer values 10 and 20 from the operand stack, and pushes 30 back onto the stack."
     width="800" height="470" />
</a>
<figcaption>The JVM specification defines what iadd means; HotSpot's interpreter implements those semantics.</figcaption>
</figure>

That separation is important:

```text
JVMS
│
└── defines bytecode behavior


HotSpot
│
└── decides how to implement
    that behavior efficiently
```

## The interpreter is still native machine code

The word **interpreter** can create the wrong picture.

It can sound as though:

```text
Java bytecode
    │
    ▼
some slow Java program
interprets it
```

That is not the right model.

The interpreter itself is part of HotSpot.

For its bytecode operations, HotSpot uses architecture-specific native interpreter code.

Conceptually:

```text
JVM BYTECODE

iadd
  │
  ▼
HotSpot interpreter machinery
  │
  ▼
native CPU instructions
that implement iadd semantics
```

<figure>
<a href="/images/courses/jvm/interpreter-native-template.svg" aria-label="Open interpreter native-code diagram">
<img src="/images/courses/jvm/interpreter-native-template.svg"
     alt="The JVM iadd bytecode dispatches into HotSpot interpreter machinery implemented as native machine instructions for the current CPU architecture."
     width="820" height="460" />
</a>
<figcaption>The CPU always executes native instructions; interpreted execution uses shared interpreter machinery rather than method-specific optimized machine code.</figcaption>
</figure>

This gives us the real distinction.

### Interpreted execution

```text
method bytecode
      │
      ▼
shared interpreter machinery
      │
      ▼
native CPU execution
```

### Compiled execution

```text
method bytecode
      │
      ▼
JIT compiler
      │
      ▼
native code specialized
for this method
      │
      ▼
CPU execution
```

Both ultimately reach the CPU as native instructions.

What differs is **how much specialization happened beforehand**.

## Why not compile immediately?

Suppose an application starts and touches:

```text
20,000 methods
```

Some may execute:

```text
once
```

Some:

```text
five times
```

Some:

```text
millions of times
```

If HotSpot aggressively optimized every touched method immediately, it would spend:

```text
compiler CPU
+
compiler-thread time
+
Code Cache space
+
startup latency
```

on code that may never matter again.

Imagine:

```text
application starts

Method A → called once
Method B → called twice
Method C → called once
Method D → called 50 million times
```

Which method deserves expensive optimization?

Clearly:

```text
Method D
```

But at startup, HotSpot does not yet know that.

Interpretation gives the JVM a useful strategy:

```text
execute now
measure behavior
optimize later
```

<figure>
<a href="/images/courses/jvm/interpret-first.svg" aria-label="Open interpret-first strategy">
<img src="/images/courses/jvm/interpret-first.svg"
     alt="Several methods begin execution without expensive optimization. Runtime observations later reveal one method as hot, causing compilation resources to focus on that method."
     width="840" height="490" />
</a>
<figcaption>Interpretation avoids paying heavy compilation costs before HotSpot knows which code is worth optimizing.</figcaption>
</figure>

## Interpretation trades steady-state speed for immediate execution

Consider two approaches.

### Compile everything first

```text
method requested
      │
      ▼
wait for optimization
      │
      ▼
execute optimized code
```

Benefit:

```text
fast execution afterward
```

Cost:

```text
execution cannot begin immediately
+
compiler resources spent upfront
```

### Interpret first

```text
method requested
      │
      ▼
execute immediately
      │
      ▼
observe runtime behavior
      │
      ▼
compile if worthwhile
```

Benefit:

```text
fast startup path
+
avoid compiling cold methods
```

Cost:

```text
interpreted execution
is slower per operation
```

So HotSpot does not ask:

```text
Interpreter OR JIT?
```

It uses both.

```text
Interpreter
      │
      ▼
learn which code matters
      │
      ▼
JIT
```

This is the beginning of **adaptive execution**.

## Interpretation also creates useful runtime evidence

Now consider:

```java
int size(List<?> values) {
    return values.size();
}
```

At compile time, `values` might be:

```text
ArrayList
LinkedList
CopyOnWriteArrayList
custom implementation
...
```

Static source inspection does not necessarily tell the JVM which one dominates at runtime.

But suppose actual execution looks like:

```text
10,000 calls

9,800 → ArrayList
  200 → LinkedList
```

HotSpot now has runtime information that looks conceptually like:

```text
receiver type profile

ArrayList    98%
LinkedList    2%
```

That is much stronger information than:

```text
values is some List
```

<figure>
<a href="/images/courses/jvm/runtime-type-profile.svg" aria-label="Open runtime type profiling diagram">
<img src="/images/courses/jvm/runtime-type-profile.svg"
     alt="A List call site observes mostly ArrayList receivers and a small number of LinkedList receivers, producing runtime type profile information."
     width="820" height="470" />
</a>
<figcaption>Runtime execution can reveal which concrete types actually appear at a polymorphic call site.</figcaption>
</figure>

That information can later support optimizations such as:

```text
devirtualization
inlining
speculative optimization
specialized machine code
```

This is one reason HotSpot can make decisions unavailable to a purely ahead-of-time static compiler.

It sees what the program **actually does**.

## Profiling is broader than just the interpreter

There is one nuance worth keeping clear.

A simple mental model is:

```text
interpreter
   │
   ▼
profiling
   │
   ▼
JIT
```

That is useful, but slightly incomplete.

With tiered compilation, HotSpot can also execute methods in **compiled tiers that continue collecting profiling information**.

So the more accurate model is:

```text
execution
   │
   ├── interpreter
   │
   └── profiling compiled tiers
   │
   ▼
runtime profile data
   │
   ▼
higher optimization tiers
```

We will make those tiers concrete in the next lesson.

For now, remember:

> HotSpot's execution system is adaptive; profiling is gathered while code runs and feeds later compilation decisions.

## What does HotSpot profile?

The exact data structures and policies are implementation details, but useful examples include:

```text
method invocation activity
loop activity
branch behavior
receiver types
other execution frequencies
```

Suppose:

```java
if (premiumCustomer) {
    expensivePremiumPath();
} else {
    normalPath();
}
```

and runtime behavior shows:

```text
normalPath         99.9%
premium path        0.1%
```

The compiler can potentially organize machine code around the common path.

Likewise, if a virtual call sees only one receiver type during profiling:

```text
CustomerService
100%
```

the JIT may have opportunities that would not exist if the site regularly observed many implementations.

The important principle is:

```text
static possibilities
      │
      ▼
runtime observations
      │
      ▼
more informed optimization
```

## How does a method become "hot"?

HotSpot needs some way to distinguish:

```text
cold method
```

from:

```text
hot method
```

Conceptually, execution activity contributes to counters.

Imagine:

```text
foo() called
     │
     ▼
invocation activity increases
     │
     ▼
more execution
     │
     ▼
method becomes interesting
for compilation
```

<figure>
<a href="/images/courses/jvm/method-hotness.svg" aria-label="Open method hotness diagram">
<img src="/images/courses/jvm/method-hotness.svg"
     alt="Repeated method execution increases runtime activity counters until the method becomes a compilation candidate."
     width="800" height="440" />
</a>
<figcaption>Repeated execution provides evidence that spending compilation resources on a method may pay off.</figcaption>
</figure>

It is tempting to reduce this to:

```text
counter == magic threshold
→ compile
```

but real HotSpot policy is more nuanced.

Compilation decisions can depend on:

```text
execution tier
counter state
compiler availability
queue pressure
method characteristics
runtime policy
```

So treat counters as the **hotness model**, not as one universal trigger formula.

## A method can be cold while one loop is hot

Invocation count alone would miss an important case.

Consider:

```java
void process() {
    for (int i = 0; i < 100_000_000; i++) {
        work(i);
    }
}
```

Suppose:

```text
process()
```

is called only once.

Invocation count:

```text
1
```

Does that mean the method is unimportant?

Obviously not.

The loop body may execute:

```text
100,000,000 times
```

This is why loop activity matters.

At the bytecode level, a loop contains a branch that jumps backward.

Conceptually:

```text
loop body
   │
   ▼
branch back
   │
   └────────► earlier bytecode
```

Repeated backward branches provide evidence that the loop is hot.

```text
back-edge
   │
   ▼
activity increases
   │
   ▼
hot loop detected
```

<figure>
<a href="/images/courses/jvm/backedge-hot-loop.svg" aria-label="Open loop back-edge hotness diagram">
<img src="/images/courses/jvm/backedge-hot-loop.svg"
     alt="A method invoked once contains a loop whose backward branch executes repeatedly, creating enough runtime activity to identify the loop as hot."
     width="820" height="470" />
</a>
<figcaption>HotSpot can detect repeated loop execution even when the enclosing method has few invocations.</figcaption>
</figure>

This becomes important later when we introduce:

```text
OSR
On-Stack Replacement
```

because HotSpot can compile a hot loop while the method invocation is already running.

We do not need OSR mechanics yet.

Just retain the idea:

```text
method invocation hotness
```

and:

```text
loop hotness
```

are both relevant.

## Why compiled code is faster

Return to:

```text
iload_1
iload_2
iadd
ireturn
```

Under interpretation, execution conceptually involves:

```text
dispatch iload_1
execute interpreter implementation

dispatch iload_2
execute interpreter implementation

dispatch iadd
execute interpreter implementation

dispatch ireturn
execute interpreter implementation
```

That repeated dispatch has overhead.

Compiled code can instead turn the entire method into a machine-code sequence specialized for:

```text
this method
+
this architecture
+
runtime knowledge
```

Conceptually:

```text
BYTECODE

iload_1
iload_2
iadd
ireturn

       │
       ▼
      JIT

       │
       ▼

NATIVE MACHINE CODE

load/add/return
using CPU registers
```

<figure>
<a href="/images/courses/jvm/interpreter-vs-compiled.svg" aria-label="Open interpreter versus compiled execution">
<img src="/images/courses/jvm/interpreter-vs-compiled.svg"
     alt="Interpreted execution repeatedly dispatches individual bytecodes through interpreter machinery, while JIT compilation turns the whole hot method into specialized native machine code."
     width="850" height="500" />
</a>
<figcaption>Compiled execution removes repeated bytecode-dispatch overhead and enables method-wide optimization.</figcaption>
</figure>

But avoiding dispatch is only part of the benefit.

The JIT can also perform transformations such as:

```text
inlining
constant folding
dead-code elimination
escape analysis
scalar replacement
devirtualization
loop optimization
```

Many of these require reasoning across multiple bytecode instructions or method boundaries.

That is where the major steady-state performance gains come from.

## The JVM deliberately spends resources only after evidence appears

Now we can see HotSpot's strategy more clearly.

Suppose compiling a method costs:

```text
5 ms of CPU
```

but the method executes:

```text
once for 20 microseconds
```

Compilation would be a terrible investment.

But if another method executes:

```text
500 million times
```

spending compiler CPU upfront can save enormous execution cost later.

The adaptive runtime is effectively making an investment decision:

```text
How much will this code execute?

        │
        ▼

Is expensive optimization
likely to pay for itself?
```

This is why execution frequency matters.

The JIT is not merely:

```text
bytecode → machine code
```

It is:

```text
runtime evidence
      +
bytecode
      +
compiler analysis
      │
      ▼
machine code chosen
because HotSpot expects
the optimization to pay off
```

## Warm-up is the visible consequence

This adaptive process creates a familiar JVM behavior:

```text
STARTUP
   │
   ▼
classes load
   │
   ▼
methods begin executing
   │
   ▼
interpretation / lower-tier execution
   │
   ▼
profiles accumulate
   │
   ▼
hot code discovered
   │
   ▼
more compilation
   │
   ▼
optimized code
   │
   ▼
STEADIER STATE
```

<figure>
<a href="/images/courses/jvm/jvm-warmup.svg" aria-label="Open JVM warm-up diagram">
<img src="/images/courses/jvm/jvm-warmup.svg"
     alt="Application startup begins with loading and initial execution, runtime profiles accumulate, hot methods are compiled, and execution gradually reaches a more optimized steady state."
     width="840" height="500" />
</a>
<figcaption>JVM performance changes over time because the runtime learns which code deserves optimization.</figcaption>
</figure>

So:

```text
performance at second 1
```

can differ substantially from:

```text
performance at minute 5
```

even with:

```text
same Java source
same workload
same JVM process
```

The runtime itself has changed.

This is the idea we introduced all the way back in Lesson 1:

> **Execution changes while the application runs.**

Now we can finally see how that begins.

## Why warm-up matters operationally

This is not just a benchmarking curiosity.

### Microbenchmarks

If you measure:

```text
first 100 invocations
```

you may largely measure:

```text
startup
interpretation
compilation activity
class loading
```

instead of steady-state execution.

This is one reason JMH includes warm-up phases.

### Short-lived command-line applications

A CLI tool may terminate before aggressive optimization would ever repay its compilation cost.

Startup behavior matters more than long-term peak throughput.

### Serverless workloads

A function may experience:

```text
cold start
execute request
terminate
```

with little opportunity to reach mature steady state.

### Autoscaling

New instances entering a service pool may initially have:

```text
different latency / throughput characteristics
```

from instances that have been serving traffic for minutes.

### Deployment

Immediately after a restart:

```text
latency profile
```

may differ from the warmed service.

So capacity and latency testing need to distinguish:

```text
cold behavior
```

from:

```text
warmed behavior
```

## Compilation itself also consumes resources

JIT optimization is not free.

It consumes:

```text
CPU
compiler threads
native compiler memory
Code Cache space
```

This connects back to Lesson 2.

The JVM process contains:

```text
Java heap
+
Metaspace
+
thread stacks
+
Code Cache
+
compiler structures
+
other native memory
```

The adaptive execution system contributes to those native costs.

So optimization is always a trade:

```text
spend CPU + memory now
        │
        ▼
generate better machine code
        │
        ▼
save execution cost later
```

This is another reason HotSpot does not simply optimize everything maximally at startup.

## Check your reasoning

Consider two methods.

Method A:

```text
called once
does 100 simple operations
```

Method B:

```text
called 10 million times
does 100 simple operations each time
```

Which one is the better candidate for expensive JIT optimization?

<details class="lesson-check">
<summary>Pause here, then check your reasoning</summary>
<p>Method B. Compilation consumes CPU and other runtime resources, so the optimization needs enough future execution to repay that upfront cost. A method that executes once may be cheaper to interpret or compile lightly, while repeatedly executed code can benefit substantially from optimized native code.</p>
</details>

Now consider:

```java
void process() {
    for (int i = 0; i < 500_000_000; i++) {
        work(i);
    }
}
```

If `process()` is invoked only once, can it still become hot?

Yes.

The repeated loop back edge provides strong evidence that the executing code matters.

## Put adaptive execution together

We can now extend the execution model:

```text
.class
  │
  ▼
bytecode
  │
  ▼
method invoked
  │
  ▼
JVM frame
  │
  ▼
execution begins
  │
  ├── interpreter
  │
  └── lower compiled tiers
  │
  ▼
runtime activity observed
  │
  ├── invocations
  ├── loops
  ├── branches
  └── receiver types
  │
  ▼
hotness / profile information
  │
  ▼
compil

Retrieval note: the available conversation response ends mid-draft. The final sections were completed from the explicit user brief and source byte.
