Byte #14 is strong. I’d preserve the core flow, but tighten a few points before implementation:

- **C1 vs C2 is not simply “fast compiler vs slow compiler.”** That’s a useful first approximation, but the important distinction is optimization depth, profiling support, and compilation cost.
- Keep the **compilation levels** as a mental model, but avoid implying every important method always follows `0 → 3 → 4`.
- Explicitly introduce **nmethods / compiled method versions** only lightly if at all; the main idea is enough: the same Java method can have different executable forms over time.
- Keep **compiler queues and concurrent compilation** prominent because this explains why compilation activity can show up as CPU usage while application threads continue running.
- The **Code Cache** section is valuable because it reconnects JIT with the process-memory model.

## Draft — Lesson 14: Tiered compilation

```markdown
---
title: Tiered compilation — C1, C2, and why HotSpot compiles a method more than once
summary: See how HotSpot balances startup speed and peak performance by moving code through interpreter and compiled tiers, collecting profiles along the way.
course: jvm
lessonSlug: tiered-compilation
module: Execution and JIT
order: 140
sourceByte: byte-014
draft: false
prerequisites:
  - hotspot-interpreter
jdk: HotSpot · tiered compilation
---

In the previous lesson, we saw why HotSpot does not aggressively compile every method the moment it first runs.

Instead, execution begins cheaply:

```text
bytecode
   │
   ▼
interpreter
   │
   ▼
observe runtime behavior
```

But interpretation is not the final destination for important code.

HotSpot gradually invests more compilation effort where runtime evidence says that investment is worthwhile.

A useful high-level picture is:

```text
Interpreter
    │
    ▼
C1
    │
    ▼
profiling
    │
    ▼
C2
```

This strategy is called **tiered compilation**.

<figure>
<a href="/images/courses/jvm/tiered-compilation-overview.svg" aria-label="Open tiered compilation overview">
<img src="/images/courses/jvm/tiered-compilation-overview.svg"
     alt="Bytecode begins in the interpreter, moves through C1 compilation and profiling, then may reach highly optimized C2 machine code."
     width="840" height="500" />
</a>
<figcaption>HotSpot can increase optimization effort gradually instead of paying the maximum compilation cost up front.</figcaption>
</figure>

## Why have more than one compiler?

Suppose a method has executed enough that HotSpot decides:

```text
This code matters.
```

The JVM could immediately send it to its most aggressive optimizing compiler.

But aggressive optimization costs:

```text
CPU
compiler-thread time
analysis effort
native compiler memory
Code Cache space
```

That cost may be justified for extremely hot code.

It may be wasteful for code that is only moderately important.

HotSpot therefore uses two main JIT compiler families:

```text
C1
│
├── relatively fast compilation
├── lighter optimization
└── can collect profiling information


C2
│
├── more expensive compilation
├── deeper optimization
└── targets high-quality steady-state code
```

The useful first approximation is:

```text
C1 → get reasonably good machine code quickly

C2 → spend more time producing highly optimized code
```

<figure>
<a href="/images/courses/jvm/c1-vs-c2.svg" aria-label="Open C1 versus C2">
<img src="/images/courses/jvm/c1-vs-c2.svg"
     alt="C1 emphasizes lower compilation cost and profiling while C2 spends more compilation effort to produce more aggressively optimized machine code."
     width="820" height="460" />
</a>
<figcaption>C1 and C2 represent different points in the trade-off between compilation cost and generated-code quality.</figcaption>
</figure>

HotSpot is effectively trying to avoid choosing between:

```text
fast startup
```

and:

```text
high peak performance
```

It wants a path toward both.

## Compilation happens in levels

Tiered compilation is often explained using levels.

A useful mental model is:

```text
Level 0
Interpreter


Level 1
C1 compiled
little/no profiling instrumentation


Level 2
C1 compiled
limited profiling


Level 3
C1 compiled
richer profiling


Level 4
C2 optimized code
```

<figure>
<a href="/images/courses/jvm/compilation-levels.svg" aria-label="Open HotSpot compilation-level model">
<img src="/images/courses/jvm/compilation-levels.svg"
     alt="HotSpot tiered compilation levels range from interpreter at level zero through several C1 levels to C2 optimized code at level four."
     width="820" height="520" />
</a>
<figcaption>The levels are best treated as a mental model for different execution and profiling states, not a mandatory fixed staircase.</figcaption>
</figure>

A common conceptual path is:

```text
0
│
▼
3
│
▼
4
```

meaning:

```text
interpret
   │
   ▼
C1 + profiling
   │
   ▼
C2
```

But do not memorize:

```text
every method always goes
0 → 3 → 4
```

Real transitions are policy-driven.

HotSpot may choose different paths depending on:

```text
compiler queues
execution activity
profiling state
method characteristics
runtime pressure
tiered policy
```

So think:

```text
multiple available tiers
```

rather than:

```text
one mandatory pipeline
```

## Why compile with profiling still enabled?

Suppose the interpreter discovers:

```text
process(Order)
```

is becoming important.

HotSpot now has a choice.

It could keep interpreting the method while gathering more data.

But interpretation itself is relatively slow.

Instead, C1 can produce machine code that is much faster than interpreted execution while still retaining profiling instrumentation.

Conceptually:

```text
bytecode
   │
   ▼
C1 compilation
   │
   ▼
native machine code
   +
profiling hooks
```

<figure>
<a href="/images/courses/jvm/c1-profiled-code.svg" aria-label="Open C1 profiling diagram">
<img src="/images/courses/jvm/c1-profiled-code.svg"
     alt="C1 converts bytecode into native machine code while retaining profiling instrumentation that records runtime behavior."
     width="820" height="470" />
</a>
<figcaption>HotSpot can collect useful runtime profiles without forcing important methods to remain interpreted.</figcaption>
</figure>

Now the method can execute faster while still producing information such as:

```text
branch behavior
receiver types
loop activity
execution frequency
```

This is one of the most important ideas in tiered compilation:

> **Profiling and faster execution do not have to be mutually exclusive.**

## Runtime profiles give C2 evidence

Consider:

```java
service.process(request);
```

Suppose the declared type allows many implementations:

```text
Service
├── DefaultService
├── PremiumService
└── ExperimentalService
```

But runtime profiling observes:

```text
DefaultService       99.9%
PremiumService        0.1%
ExperimentalService   0.0%
```

At the source level:

```text
service.process(...)
```

is polymorphic.

At runtime, however, the call site looks almost monomorphic.

That profile gives C2 evidence it can potentially exploit.

```text
virtual call
     │
     ▼
runtime type profile
     │
     ▼
one dominant receiver type
     │
     ▼
optimization opportunity
```

<figure>
<a href="/images/courses/jvm/profile-to-c2.svg" aria-label="Open profile-to-C2 optimization flow">
<img src="/images/courses/jvm/profile-to-c2.svg"
     alt="A virtual call site records overwhelmingly one receiver type, and C2 uses that profile as an optimization opportunity."
     width="820" height="470" />
</a>
<figcaption>C2 does not optimize from bytecode alone; runtime evidence can heavily influence the generated machine code.</figcaption>
</figure>

## Devirtualization can expose inlining opportunities

Suppose C2 can safely optimize around the observed receiver shape.

The conceptual transformation may be:

```text
virtual call
     │
     ▼
devirtualized call
     │
     ▼
inline target
```

Why does inlining matter so much?

Consider:

```java
int total(Order order) {
    return order.price() + order.tax();
}
```

Without inlining, the compiler sees:

```text
call price()
call tax()
add results
```

If the methods can be inlined:

```text
total()
│
├── price implementation
└── tax implementation
```

the compiler now sees a much larger body of code at once.

<figure>
<a href="/images/courses/jvm/inlining-expands-scope.svg" aria-label="Open inlining optimization scope">
<img src="/images/courses/jvm/inlining-expands-scope.svg"
     alt="Before inlining, total calls price and tax as separate methods. After inlining, the compiler sees the implementations together and can optimize across the former call boundaries."
     width="840" height="490" />
</a>
<figcaption>Inlining matters not just because it removes call overhead, but because it exposes more code to further optimization.</figcaption>
</figure>

That larger optimization scope can enable:

```text
constant propagation
dead-code elimination
escape analysis
scalar replacement
loop optimization
common subexpression elimination
other compiler transformations
```

This connects directly back to Lesson 9.

Escape analysis became more effective when:

```text
inlining expanded what the compiler could see
```

Now we know where that larger optimization context often comes from.

## One Java method can have several execution forms over time

A Java method is not necessarily associated with one permanent executable representation.

Conceptually:

```text
METHOD foo()

bytecode
   │
   ▼
interpreted
   │
   ▼
C1 version
   │
   ▼
C2 version
```

<figure>
<a href="/images/courses/jvm/method-version-lifecycle.svg" aria-label="Open method execution-version lifecycle">
<img src="/images/courses/jvm/method-version-lifecycle.svg"
     alt="One Java method begins as bytecode interpreted by HotSpot, later receives a C1 compiled version, and may eventually receive a C2 optimized version."
     width="820" height="480" />
</a>
<figcaption>The executable representation of a method can evolve while the JVM process remains alive.</figcaption>
</figure>

During the JVM lifetime, HotSpot can potentially:

```text
compile
replace an older compiled version
invalidate optimized code
recompile
```

So:

```text
foo()
```

at minute 1 may not execute the same machine code as:

```text
foo()
```

at minute 20.

This is the adaptive runtime idea becoming concrete.

> **Execution changes while the application runs.**

## Why not send everything directly to C2?

Imagine startup touches:

```text
50,000 methods
```

If all 50,000 immediately received expensive C2 optimization:

```text
large CPU spike
+
large compiler queues
+
more generated machine code
+
more Code Cache use
+
longer startup path
```

But perhaps only:

```text
500
```

of those methods become truly hot.

Spending maximum optimization effort on the other:

```text
49,500
```

would produce little return.

The tiered model is therefore an allocation-of-resources problem:

```text
runtime evidence
      │
      ▼
Which code deserves
expensive optimization?
```

<figure>
<a href="/images/courses/jvm/compilation-investment.svg" aria-label="Open compilation investment diagram">
<img src="/images/courses/jvm/compilation-investment.svg"
     alt="Many methods execute during startup, but only a small hot subset receives the runtime's most expensive optimization effort."
     width="820" height="470" />
</a>
<figcaption>HotSpot tries to spend the most compiler effort where repeated future execution is likely to repay the cost.</figcaption>
</figure>

This trade-off is central:

```text
more compilation effort
        │
        ▼
potentially better machine code
```

but:

```text
too much compilation
        │
        ▼
startup cost
CPU pressure
native memory pressure
Code Cache pressure
```

## Compilation usually happens on compiler threads

Another important detail is that the application thread does not usually stop and perform the entire optimizing compilation itself.

Conceptually:

```text
Application thread
      │
      ▼
method becomes compilation candidate
      │
      ▼
compilation request
      │
      ▼
compiler queue
      │
      ├──► C1 compiler thread
      │
      └──► C2 compiler thread
```

<figure>
<a href="/images/courses/jvm/compiler-queue.svg" aria-label="Open JIT compiler queue">
<img src="/images/courses/jvm/compiler-queue.svg"
     alt="Application execution identifies compilation candidates that enter compiler queues serviced by C1 and C2 compiler threads."
     width="840" height="500" />
</a>
<figcaption>JIT compilation is runtime work performed concurrently with the application's ongoing execution.</figcaption>
</figure>

While compilation happens, the application may continue using:

```text
interpreter
```

or:

```text
an older compiled version
```

When the new compiled version becomes available, future execution can transition to it.

This means JVM CPU usage can include:

```text
application work
+
GC work
+
JIT compiler work
```

A CPU profile of a warming JVM can therefore look different from a mature steady-state JVM.

## Compiler queues matter

Suppose a large application suddenly becomes busy.

Many methods become hot at once:

```text
Method A
Method B
Method C
Method D
...
```

The JIT compilers cannot necessarily compile everything simultaneously.

Requests can accumulate:

```text
hot methods
     │
     ▼
compilation queue
     │
     ▼
compiler threads
```

So the time between:

```text
method becomes interesting
```

and:

```text
optimized version available
```

can depend on compiler availability and queue pressure.

This is one reason the simplistic model:

```text
counter reaches threshold
→ instantly becomes C2
```

is incomplete.

There is a runtime system between those two events.

## Where does generated machine code live?

The JIT produces native machine code.

That code does **not** live inside the Java heap.

Recall our process-memory model:

```text
JVM process

├── Java Heap
├── Metaspace
├── thread stacks
├── Code Cache
└── other native memory
```

The JIT stores generated machine code in the **Code Cache**.

```text
Java Heap
    │
    └── Java objects


Metaspace
    │
    └── class metadata


Code Cache
    │
    └── generated machine code
```

<figure>
<a href="/images/courses/jvm/code-cache-placement.svg" aria-label="Open Code Cache memory placement">
<img src="/images/courses/jvm/code-cache-placement.svg"
     alt="Within the JVM process, Java objects occupy heap memory, class metadata uses Metaspace, and JIT-generated native machine code occupies the Code Cache."
     width="820" height="470" />
</a>
<figcaption>JIT compilation has a native-memory footprint because generated machine code must be stored somewhere executable.</figcaption>
</figure>

This reconnects JIT compilation to Lesson 2.

More compilation can mean:

```text
more compiler CPU
+
more compiler data structures
+
more generated code
+
more Code Cache usage
```

Optimization is never free.

## The Code Cache is itself organized

Modern HotSpot can use a segmented Code Cache.

Conceptually, separate areas can hold categories such as:

```text
profiled compiled code
non-profiled compiled code
non-method JVM code
```

We do not need the exact sizing policy yet.

The useful model is:

```text
Code Cache
├── profiled code
├── optimized/non-profiled code
└── runtime/non-method code
```

This organization exists because different kinds of generated code have different lifecycle and management characteristics.

We will return to Code Cache diagnostics separately.

## Warm-up now has more structure

In Lesson 13, warm-up looked like:

```text
startup
   │
   ▼
execution
   │
   ▼
profiling
   │
   ▼
JIT
   │
   ▼
steady state
```

Now we can make it more precise:

```text
startup
   │
   ▼
interpreter
   │
   ▼
C1 / profiled execution
   │
   ▼
runtime profile matures
   │
   ▼
C2
   │
   ▼
optimized steady-state code
```

<figure>
<a href="/images/courses/jvm/tiered-warmup.svg" aria-label="Open tiered warm-up diagram">
<img src="/images/courses/jvm/tiered-warmup.svg"
     alt="A JVM service progresses from startup through interpreted and C1 profiled execution toward C2 optimized steady-state machine code."
     width="840" height="500" />
</a>
<figcaption>Warm-up is not a binary transition from slow to fast; methods can move through several execution states.</figcaption>
</figure>

So after a restart:

```text
same request
same Java code
```

can still experience different execution characteristics depending on whether its important methods are currently:

```text
interpreted
C1 compiled
C2 compiled
```

## Production implications

### New deployments

After deployment:

```text
new process
   │
   ▼
cold runtime
   │
   ▼
profiling + compilation
```

Latency can temporarily differ from the mature service.

### Autoscaling

A newly created instance may receive production traffic before its important paths are fully optimized.

So a fleet can temporarily contain:

```text
Instance A → warm
Instance B → warm
Instance C → newly started
```

with different performance characteristics.

### Benchmarks

A five-second benchmark may measure:

```text
interpreter
+
C1
+
compilation work
```

rather than:

```text
mature C2 execution
```

### CPU diagnostics

During warm-up, some process CPU can belong to:

```text
compiler threads
```

rather than application request threads.

### Native memory

Compiled code contributes to:

```text
Code Cache
```

not Java heap.

That is another example of why:

```text
-Xmx
```

does not define total JVM process memory.

## Check your reasoning

Suppose two methods become active.

Method A:

```text
called 100 times
then never again
```

Method B:

```text
called continuously
for the next several hours
```

Why might HotSpot avoid spending maximum C2 optimization effort immediately on both?

<details class="lesson-check">
<summary>Pause here, then check your reasoning</summary>
<p>Because aggressive compilation has a real CPU, memory, compiler-thread, and Code Cache cost. Runtime profiling lets HotSpot discover that Method B is much more likely to repay expensive optimization. Tiered compilation delays or avoids maximum optimization when the evidence does not justify it.</p>
</details>

Now another question.

Suppose profiling shows:

```text
99.9% of receivers
at a call site
are DefaultService
```

Does that mean Java's type system has changed so that only `DefaultService` is legal?

No.

The source-level semantics still permit other valid implementations.

The profile tells HotSpot:

```text
what has happened so far
```

not:

```text
what can never happen
```

That distinction leads directly to our next topic.

## Put tiered compilation together

Our execution model now looks like:

```text
.class bytecode
      │
      ▼
Interpreter
      │
      ▼
runtime activity
      │
      ▼
C1
      │
      ├── native execution
      └── profiling
      │
      ▼
richer runtime evidence
      │
      ▼
C2
      │
      ├── aggressive optimization
      ├── inlining
      ├── devirtualization
      ├── escape analysis
      └── other transformations
      │
      ▼
optimized native code
      │
      ▼
Code Cache
```

<figure>
<a href="/images/courses/jvm/tiered-compilation-complete.svg" aria-label="Open complete tiered compilation model">
<img src="/images/courses/jvm/tiered-compilation-complete.svg"
     alt="Bytecode begins in the interpreter, progresses through C1 compiled and profiling states, provides runtime evidence to C2, and results in optimized native code stored in the Code Cache."
     width="860" height="650" />
</a>
<figcaption>Tiered compilation lets HotSpot increase optimization effort as the runtime gains confidence that the code matters.</figcaption>
</figure>

The central principle is:

> **HotSpot optimizes using both program structure and observed runtime behavior.**

That makes extremely aggressive optimizations possible.

But it introduces an obvious problem.

Suppose