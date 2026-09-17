Byte #15 is strong and follows naturally from tiered compilation. I’d keep nearly all of it, with four refinements:

- Distinguish **speculation guards** from **runtime dependency invalidation**. Not every failed assumption is detected by an inline type check; some optimized code is invalidated because a class-hierarchy or other dependency changes.
- Make clear that deoptimization reconstructs **logical JVM state**, not necessarily the exact old physical frame layout.
- Keep **rematerialization** tied back to scalar replacement; that is one of the best cross-links in the course.
- Treat “too many traps” as implementation behavior, not a fixed user-visible rule.

## Draft — Lesson 15: Speculative optimization and deoptimization

```markdown id="8x81hp"
---
title: Speculative optimization and deoptimization
summary: See how HotSpot optimizes around runtime assumptions, guards those assumptions, and reconstructs Java execution state when optimized code can no longer be trusted.
course: jvm
lessonSlug: speculative-optimization-deoptimization
module: Execution and JIT
order: 150
sourceByte: byte-015
draft: false
prerequisites:
  - tiered-compilation
jdk: HotSpot · speculative optimization
---

In the previous lesson, we saw that C2 does not optimize from bytecode alone.

It also uses runtime evidence.

Suppose profiling tells HotSpot:

```text
99.9% of calls
at this site
use CardPayment
```

That is useful information.

But it is not a Java-language guarantee.

Tomorrow—or one microsecond later—the program may encounter:

```text
BankTransferPayment
```

So how can HotSpot safely optimize aggressively around behavior that might later change?

The answer is one of the most important ideas in a modern JIT:

> **Speculate when the evidence is strong, but keep a way back to correct Java execution if the speculation stops being valid.**

That escape mechanism is **deoptimization**.

<figure>
<a href="/images/courses/jvm/speculation-overview.svg" aria-label="Open speculative optimization overview">
<img src="/images/courses/jvm/speculation-overview.svg"
     alt="Runtime profiling feeds C2 speculative optimization. If assumptions remain valid, optimized execution continues; if an assumption fails, HotSpot deoptimizes and returns to a safe execution state."
     width="850" height="500" />
</a>
<figcaption>Speculation lets HotSpot aggressively optimize common behavior without giving up Java's required semantics.</figcaption>
</figure>

## Start with a polymorphic call

Consider:

```java
interface Payment {
    int fee();
}

int calculate(Payment payment) {
    return payment.fee();
}
```

At the Java-language level:

```text
Payment
├── CardPayment
├── BankTransferPayment
├── CryptoPayment
└── ...
```

Any valid implementation could arrive.

A conservative implementation would preserve generic interface dispatch forever.

Conceptually:

```text
payment.fee()
      │
      ▼
determine receiver type
      │
      ▼
find implementation
      │
      ▼
invoke
```

But suppose runtime profiling observes:

```text
CardPayment            99.9%
BankTransferPayment     0.1%
everything else         0.0%
```

Now C2 has valuable evidence.

## Optimize the common case

C2 may be able to build machine code around:

```text
receiver is probably CardPayment
```

Conceptually:

```text
payment.fee()
      │
      ▼
is receiver CardPayment?
      │
   ┌──┴──┐
  yes    no
   │      │
   ▼      ▼
optimized   uncommon/
CardPayment fallback path
path
```

If `CardPayment.fee()` can be inlined, the hot path may become:

```text
type check
   │
   ▼
inlined fee logic
   │
   ▼
continue
```

rather than a generic virtual/interface dispatch.

<figure>
<a href="/images/courses/jvm/speculative-devirtualization.svg" aria-label="Open speculative devirtualization diagram">
<img src="/images/courses/jvm/speculative-devirtualization.svg"
     alt="A polymorphic Payment call site is profiled as mostly CardPayment. C2 emits a guarded fast path for CardPayment and keeps an uncommon path for unexpected receiver types."
     width="840" height="490" />
</a>
<figcaption>Runtime evidence can turn a generic call into a guarded common-case fast path.</figcaption>
</figure>

That opens the door to further optimizations:

```text
devirtualization
      │
      ▼
inlining
      │
      ▼
larger optimization scope
      │
      ├── constant propagation
      ├── dead-code elimination
      ├── escape analysis
      └── other transformations
```

This is why speculation matters.

It unlocks optimizations that would be impossible if the compiler had to preserve every theoretical possibility equally on every execution.

## But the assumption is not absolute

The compiler has observed:

```text
CardPayment
CardPayment
CardPayment
...
```

It has **not** proved:

```text
No other Payment implementation
will ever appear.
```

So HotSpot must preserve correctness.

There are two useful conceptual mechanisms to distinguish.

### Guarded speculation

Optimized machine code can contain a runtime check.

Conceptually:

```text
if receiver is CardPayment
    execute optimized path
else
    leave optimized path
```

### Runtime dependency tracking

Some optimizations rely on broader VM facts.

For example, an optimization might depend on the currently known class hierarchy.

Conceptually:

```text
Assumption:
there is currently only one relevant
implementation / subtype relationship
```

If class loading later changes that relationship, HotSpot can invalidate compiled code that depended on the old world.

<figure>
<a href="/images/courses/jvm/guards-vs-dependencies.svg" aria-label="Open guards versus runtime dependencies">
<img src="/images/courses/jvm/guards-vs-dependencies.svg"
     alt="One speculative optimization is protected by an inline runtime type guard, while another compiled method depends on VM-tracked class hierarchy assumptions that can later invalidate the compiled code."
     width="850" height="500" />
</a>
<figcaption>Not every speculation failure is detected by the same mechanism: some are explicit checks, while others rely on tracked runtime dependencies.</figcaption>
</figure>

The common principle is:

```text
optimized code is valid
only while its assumptions remain valid
```

## The uncommon path

Suppose optimized code expects:

```text
CardPayment
```

but execution reaches:

```text
BankTransferPayment
```

The rare path may transfer control through what HotSpot calls an **uncommon trap**.

Conceptually:

```text
optimized common path
        │
        ▼
unexpected condition
        │
        ▼
uncommon trap
        │
        ▼
deoptimization machinery
```

<figure>
<a href="/images/courses/jvm/uncommon-trap.svg" aria-label="Open uncommon trap diagram">
<img src="/images/courses/jvm/uncommon-trap.svg"
     alt="Highly optimized common-path machine code encounters a rare condition and exits through an uncommon trap into HotSpot deoptimization machinery."
     width="820" height="460" />
</a>
<figcaption>An uncommon trap keeps rare behavior out of the hottest optimized path while preserving correctness when that behavior actually occurs.</figcaption>
</figure>

Why do this?

Because if a path occurs:

```text
0.01%
```

of the time, generating equally sophisticated optimized code for it may make the common path:

```text
larger
more complicated
harder to optimize
```

Instead:

```text
common path → heavily optimized

rare path → recover if encountered
```

The trade-off is:

```text
better common-case execution
          vs
cost when speculation fails
```

## What is deoptimization actually doing?

Suppose C2 generated highly optimized machine code.

Then one of its assumptions stops being usable.

HotSpot cannot simply say:

```text
Oops. Restart the Java method.
```

The method may already be halfway through execution.

Java-visible side effects may already have occurred.

Instead, HotSpot must recover an execution state that is logically equivalent to where the Java program currently is.

Conceptually:

```text
optimized machine execution
          │
          ▼
      deoptimization
          │
          ▼
reconstruct JVM-level state
          │
          ▼
continue execution safely
```

<figure>
<a href="/images/courses/jvm/deoptimization-flow.svg" aria-label="Open the deoptimization flow">
<img src="/images/courses/jvm/deoptimization-flow.svg"
     alt="An optimized compiled frame reaches deoptimization. HotSpot reconstructs logical JVM execution state and continues through a safer execution representation."
     width="830" height="490" />
</a>
<figcaption>Deoptimization changes execution representation without changing the program's required observable behavior.</figcaption>
</figure>

This is not necessarily:

```text
restore the exact machine stack
that existed before C2 compilation
```

There may never have been such a physical stack layout.

What HotSpot needs is the **logical Java/JVM state**.

## Why reconstruction is difficult

C2 may have transformed the method dramatically.

Suppose source execution looks like:

```text
method A
   │
   ▼
method B
   │
   ▼
method C
```

But C2 inlined both B and C into A.

The optimized machine-code stack may conceptually look like:

```text
one compiled frame
```

while Java-level execution logically represents:

```text
A frame
B frame
C frame
```

Now deoptimization occurs.

HotSpot may need to reconstruct:

```text
logical frame A
logical frame B
logical frame C
```

with the right:

```text
locals
operand-stack values
program positions
object references
```

<figure>
<a href="/images/courses/jvm/inlined-frame-reconstruction.svg" aria-label="Open inlined-frame reconstruction">
<img src="/images/courses/jvm/inlined-frame-reconstruction.svg"
     alt="C2 has inlined logical methods B and C into one compiled machine frame for A. During deoptimization, HotSpot reconstructs the logical A, B, and C JVM frames."
     width="840" height="520" />
</a>
<figcaption>Inlining removes physical call boundaries from optimized code, but HotSpot retains enough metadata to recover the logical Java call state.</figcaption>
</figure>

This connects directly to Lesson 12.

The JVM-level model still requires coherent:

```text
frames
locals
operand stacks
```

even when the optimized physical representation looked nothing like that model.

## Optimized values may live anywhere

A local variable that conceptually belongs to:

```text
local slot 3
```

may currently exist as:

```text
CPU register
```

or:

```text
machine stack location
```

or may have been:

```text
constant folded
```

or even:

```text
optimized away
```

So compiled code needs metadata that can answer questions such as:

```text
At this machine-code position,
what Java values logically exist?

Where are they?

How can they be reconstructed?
```

Conceptually:

```text
machine state
+
compiler metadata
      │
      ▼
logical JVM state
```

<figure>
<a href="/images/courses/jvm/machine-to-jvm-state.svg" aria-label="Open machine-to-JVM-state mapping">
<img src="/images/courses/jvm/machine-to-jvm-state.svg"
     alt="Optimized values distributed across CPU registers, stack locations, constants, and eliminated values are mapped through compiler metadata back into logical JVM locals and operand-stack state."
     width="850" height="500" />
</a>
<figcaption>Deoptimization is possible because HotSpot preserves metadata describing the relationship between optimized machine state and Java execution state.</figcaption>
</figure>

This is part of the deeper JIT/runtime contract.

## Scalar replacement makes this even more interesting

Recall Lesson 9:

```java
Point p = new Point(10, 20);
return p.x + p.y;
```

Escape analysis may determine:

```text
Point object not required
```

and scalar replacement may keep only:

```text
x = 10
y = 20
```

Perhaps the values now live in registers.

So optimized execution conceptually contains:

```text
register A → 10
register B → 20

NO Point object
```

Now suppose the method deoptimizes at a point where Java-level execution logically expects:

```text
Point p
```

What does HotSpot do?

It can **rematerialize** the eliminated object.

```text
scalar state

x = 10
y = 20
      │
      ▼
deoptimization
      │
      ▼
materialize Point
      │
      ├── x = 10
      └── y = 20
```

<figure>
<a href="/images/courses/jvm/deopt-rematerialization.svg" aria-label="Open object rematerialization during deoptimization">
<img src="/images/courses/jvm/deopt-rematerialization.svg"
     alt="An optimized execution contains only scalar x and y values for an eliminated Point object. During deoptimization, HotSpot materializes a Point and restores its field values."
     width="830" height="500" />
</a>
<figcaption>An object eliminated by escape analysis can be reconstructed if later execution needs a real Java-level object representation.</figcaption>
</figure>

This is a remarkable property.

The object:

```text
did not physically exist
```

during optimized execution.

Yet HotSpot maintained enough semantic information to recreate it when needed.

That is why Lesson 9 emphasized:

> Optimized representation may differ radically from source representation as long as Java semantics remain recoverable.

Deoptimization is where that principle becomes operational.

## Eliminated locks can also matter

Escape analysis may have enabled:

```text
lock elimination
```

Suppose optimized execution removed synchronization that was proven unnecessary.

If deoptimization must reconstruct Java state, HotSpot also needs to maintain correctness around eliminated synchronization state.

The details become complex quickly, so we will not go deeper here.

The important point is:

```text
C2 can remove structures
that Java source appears to require
```

because HotSpot retains enough information to preserve or reconstruct the required semantics.

## Deoptimization does not necessarily mean "back to square one"

A useful simplified picture is:

```text
C2
 │
 ▼
deopt
 │
 ▼
Interpreter
```

But do not interpret that as a permanent reset.

HotSpot remains adaptive.

Conceptually:

```text
profile
   │
   ▼
compile
   │
   ▼
speculation
   │
   ▼
assumption fails
   │
   ▼
deoptimize
   │
   ▼
observe new behavior
   │
   ▼
compile again
```

<figure>
<a href="/images/courses/jvm/deopt-recompile-loop.svg" aria-label="Open deoptimization and recompilation loop">
<img src="/images/courses/jvm/deopt-recompile-loop.svg"
     alt="Runtime profiling leads to compilation and speculation. A failed assumption triggers deoptimization, new behavior is observed, and the method may later be recompiled with a revised optimization strategy."
     width="820" height="490" />
</a>
<figcaption>Adaptive optimization is iterative rather than a one-time bytecode-to-machine-code conversion.</figcaption>
</figure>

The next optimized version may use a broader assumption.

For example:

```text
BEFORE

CardPayment only
```

might become:

```text
AFTER

CardPayment
or
BankTransferPayment
```

Or HotSpot may decide that a particular speculative optimization is no longer worthwhile.

## Repeated traps change optimization decisions

Suppose HotSpot repeatedly assumes:

```text
receiver = CardPayment
```

but reality keeps producing:

```text
BankTransferPayment
CryptoPayment
GiftCardPayment
...
```

Repeatedly doing:

```text
optimize
→ fail
→ deopt
→ optimize same assumption
→ fail
```

would be wasteful.

HotSpot tracks trap history and uses that information when making later compilation decisions.

Conceptually:

```text
speculation fails once
        │
        ▼
maybe recompile


speculation keeps failing
        │
        ▼
become less aggressive
about that assumption
```

Treat this as adaptive policy rather than a fixed public rule such as:

```text
after exactly N traps,
optimization X is disabled
```

The implementation is more nuanced.

## Class loading can invalidate assumptions too

Speculation is not only about receiver values encountered in an existing call.

Suppose C2 optimizes under the runtime observation:

```text
Only one relevant subclass exists.
```

Later, dynamic class loading introduces another implementation.

Conceptually:

```text
initial class hierarchy

Payment
   │
   └── CardPayment
```

C2 optimizes around that world.

Then:

```text
new class loaded
```

and the hierarchy becomes:

```text
Payment
├── CardPayment
└── BankTransferPayment
```

If compiled code depended on the old hierarchy, HotSpot can mark that dependency invalid.

<figure>
<a href="/images/courses/jvm/class-loading-invalidation.svg" aria-label="Open class-loading dependency invalidation">
<img src="/images/courses/jvm/class-loading-invalidation.svg"
     alt="C2 compiles code based on a class hierarchy containing only CardPayment. Later loading BankTransferPayment changes the hierarchy and invalidates compiled code that depended on the earlier assumption."
     width="840" height="500" />
</a>
<figcaption>Dynamic class loading can change facts that optimized machine code previously relied upon.</figcaption>
</figure>

This connects our JIT section directly back to:

```text
class loading
class hierarchy
runtime linking
```

The JVM subsystems are no longer isolated concepts.

## Why uncommon traps help performance

Imagine a branch:

```java
if (rareCondition) {
    unusualPath();
} else {
    commonPath();
}
```

Profiling shows:

```text
commonPath     99.99%
unusualPath     0.01%
```

One approach is to fully optimize both paths.

Another is:

```text
common path
     │
     ▼
dense optimized machine code


rare path
     │
     ▼
uncommon trap
     │
     ▼
recover when actually needed
```

This can make the common machine-code path:

```text
smaller
simpler
friendlier to optimization
```

The runtime is effectively betting:

```text
Pay almost nothing for this rare case
until the rare case actually happens.
```

That is the same broad strategy we have seen elsewhere:

```text
lazy class resolution
lazy class initialization
compile only hot methods
optimize likely execution paths
```

HotSpot repeatedly chooses:

> **Defer expensive or uncommon work until runtime evidence says it is needed.**

## Is deoptimization bad?

No.

Occasional deoptimization is a normal consequence of speculative optimization.

If speculation never existed, many powerful optimizations would disappear.

So:

```text
deoptimization occurred
```

does not automatically mean:

```text
JVM has a performance problem
```

The concern is excessive instability.

Conceptually:

```text
stable profile
      │
      ▼
stable optimized code
```

versus:

```text
changing profile
      │
      ▼
speculation fails
      │
      ▼
deoptimization
      │
      ▼
recompilation
      │
      ▼
new behavior
      │
      ▼
repeat
```

That second pattern can consume extra CPU and create less predictable performance.

## Production implications

### Changing type profiles

A service may initially receive one request subtype almost exclusively.

Later, traffic changes.

A call site that was nearly monomorphic may become highly polymorphic.

That can invalidate or reduce the effectiveness of previous optimizations.

### Warmed code can regress

Warm-up does not mean:

```text
performance now permanently fixed
```

Runtime conditions can change.

Optimized code can be invalidated, deoptimized, and replaced.

So a JVM can experience performance transitions even long after startup.

### Recompilation costs CPU

When optimized code is discarded and replacement code is compiled, the JVM again spends:

```text
compiler CPU
compiler-thread time
compiler memory
Code Cache activity
```

### Latency-sensitive systems

A concentrated burst of deoptimization and recompilation can contribute to transient latency changes.

That does not mean deoptimization is always the cause of a latency spike, but it is one mechanism worth understanding when investigating unstable JIT behavior.

## Check your reasoning

Suppose C2 has optimized:

```java


<!-- Retrieved preview ends here; originating tool marked this message truncated. -->
