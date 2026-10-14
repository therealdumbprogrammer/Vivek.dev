---
title: Deoptimization in production — when JIT assumptions become invalid
summary: Follow a guarded C2 fast path through an uncommon trap, logical frame recovery and possible recompilation, then diagnose repeated deoptimization.
course: jvm
lessonSlug: deoptimization-in-production
module: HotSpot Internals
order: 560
sourceByte: byte-056
draft: false
prerequisites:
  - safepoint-diagnostics
jdk: JDK 25 · HotSpot C2 and JFR
---


In [Lesson 55](/courses/jvm/safepoint-diagnostics), we separated safepoint coordination from the work done after threads arrive. Here a single hot request path slows down even when GC and global safepoint metrics are quiet. The [earlier optimization lesson](/courses/jvm/speculative-optimization-deoptimization) introduced speculation; this lesson follows its production evidence and recovery path.

Today, we're returning to the JIT compiler.

Recall that HotSpot optimizes methods using information collected during execution. However, that information represents observed behavior, not necessarily every possible execution path.

This raises an important question:

> **What happens when HotSpot generates highly optimized machine code, but the assumptions behind that code are no longer valid?**

One possible answer is **deoptimization**: HotSpot abandons a compiled execution state it cannot safely continue and reconstructs a valid logical Java state. Some failed fast paths instead take an ordinary fallback, so an unexpected receiver does not guarantee a deoptimization event.


<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable observed receiver types inform a guarded optimization, never a permanent java type guarantee."><a href="/images/courses/jvm/jit-guarded-fast-path.svg" aria-label="Open observed receiver types inform a guarded optimization, never a permanent java type guarantee."><img src="/images/courses/jvm/jit-guarded-fast-path.svg" alt="RegularDiscount dominates an observed type profile; C2 emits a guarded inlined fast path with an alternate fallback or uncommon trap." width="1080" height="520" /></a><figcaption>Observed receiver types inform a guarded optimization, never a permanent Java type guarantee.</figcaption></figure>

## Why speculative optimization exists

Consider this illustrative record and method:

```java
interface DiscountPolicy {
    double apply(double price);
}

class RegularDiscount implements DiscountPolicy {
    public double apply(double price) {
        return price * 0.9;
    }
}

class PremiumDiscount implements DiscountPolicy {
    public double apply(double price) {
        return price * 0.8;
    }
}
```

And a frequently executed method:

```java
double calculate(DiscountPolicy policy, double price) {
    return policy.apply(price);
}
```

Initially, suppose every invocation receives `RegularDiscount`. These are observed calls in this example, not a Java semantic guarantee about future receivers. The profile can be collected in interpreted and profiled compiled execution.

HotSpot's profiling information might indicate:

```text
calculate()
    |
    +-- RegularDiscount: 100%
```

C2 may decide to optimize this call site.

Instead of performing ordinary virtual dispatch every time, it can generate a guarded fast path:

```text
if receiver is RegularDiscount:
    execute optimized RegularDiscount logic
else:
    execute fallback
```

Depending on the optimization, the fallback may be an uncommon trap that transfers execution to HotSpot's deoptimization machinery.

<mark>The runtime type profile is evidence for optimization, not a guarantee that the receiver will never change.</mark> The optimized code can be faster because HotSpot specializes it for behavior observed so far.

**The trade-off:** Better performance for common cases, but additional machinery is required when assumptions fail.


## What triggers deoptimization?

There are several important scenarios.

| Trigger | Example | Why optimized code may become invalid |
|---|---|---|
| Unexpected receiver type | A new `DiscountPolicy` implementation appears | Type-profile assumptions no longer hold |
| Uncommon execution path | A previously unseen branch executes | Optimized code may not contain a normal implementation of that path |
| Class hierarchy changes | A newly loaded subclass invalidates an assumption | Previously valid class-hierarchy information changes |
| Runtime invalidation | Class redefinition or other VM changes | Compiled code dependencies may no longer be valid |

Not every unexpected type causes deoptimization.

HotSpot can also generate ordinary fallback paths or polymorphic dispatch sequences.

A **reason** describes what unexpected condition occurred, while an **action** describes HotSpot’s response, such as interpreting or adjusting recompilation policy. Their values must be read together in diagnostic events; neither field alone proves a permanent invalidation. Deoptimization occurs when compiled execution cannot continue correctly under its current optimization assumptions and recovery is selected.


<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable an optimized physical frame can represent several logical java calls."><a href="/images/courses/jvm/deopt-frame-reconstruction.svg" aria-label="Open an optimized physical frame can represent several logical java calls."><img src="/images/courses/jvm/deopt-frame-reconstruction.svg" alt="One optimized physical frame containing inlined calculate and apply methods expands into logical Java frames with method, bytecode index, locals and operand values." width="1080" height="520" /></a><figcaption>An optimized physical frame can represent several logical Java calls.</figcaption></figure>

## How HotSpot reconstructs Java execution

This is the most interesting part.

Consider:

```java
record Order(int amount) {}

int calculate(int amount) {
    Order order = new Order(amount);
    return order.amount() * 2;
}
```

Suppose escape analysis determines that `order` does not escape.

C2 may eliminate the allocation entirely.

Conceptually, the compiled code becomes:

```text
result = amount * 2
```

But what if execution must deoptimize?

The interpreter expects a valid Java execution state, including the local variables and objects required at that bytecode position.

HotSpot therefore maintains **debug information in compiled methods**.

This information describes how to reconstruct the logical Java state.

```text
Optimized machine code
        |
        | Deoptimization requested
        v
Compiled-frame metadata
        |
        +-- Java method and bytecode position
        +-- Local variables
        +-- Operand stack values
        +-- Inlined method frames
        +-- Eliminated object descriptions
        |
        v
Reconstructed Java frames
        |
        v
Interpreter execution
```

If escape analysis enabled scalar replacement and the allocation was eliminated, HotSpot may need to **rematerialize** `Order` as a real heap object when the interpreter-visible state at the recovery point requires it. The debug information must preserve values, identity and aliases, and monitor state where relevant. Escape analysis itself does not guarantee allocation elimination; the example describes a possible optimization.

Similarly, an optimized frame containing several inlined Java methods may need to become multiple interpreter frames.

In [`runtime/deoptimization.cpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/runtime/deoptimization.cpp), `fetch_unroll_info` prepares recovery information, `realloc_objects` handles eliminated objects that must exist, and frame-unpack machinery builds the continuation. The result is equivalent logical Java execution at an appropriate bytecode index (BCI), not restoration of the old physical register/stack layout.

### Important connection

This explains why speculative optimization can preserve Java semantics.

The JVM is not simply abandoning optimized execution. It reconstructs the state necessary to continue executing correctly.


<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable rematerialization supplies an object only when the resumed logical state needs one."><a href="/images/courses/jvm/deopt-scalar-rematerialization.svg" aria-label="Open rematerialization supplies an object only when the resumed logical state needs one."><img src="/images/courses/jvm/deopt-scalar-rematerialization.svg" alt="Scalar amount field for an eliminated Order becomes a heap Order and an interpreter local when recovery requires an object." width="1080" height="520" /></a><figcaption>Rematerialization supplies an object only when the resumed logical state needs one.</figcaption></figure>

## Deoptimization does not necessarily mean a global safepoint

This connects directly to Byte #55.

Deoptimization and safepoints are related but distinct mechanisms.

A compiled thread can encounter an uncommon trap and transition through HotSpot's runtime without requiring every application thread to stop.

Other deoptimization-related operations, such as invalidating compiled methods after certain VM changes, may involve broader runtime coordination.

Therefore:

<mark>An individual uncommon trap can deoptimize one thread without a global stop-the-world safepoint.</mark> Compiled-code invalidation after some VM changes may require coordinated work; separate those observations from a trap in one thread.

Its costs may include:

- Transitioning from optimized execution to interpreter execution.
- Reconstructing Java frames and eliminated objects.
- Losing optimizations such as inlining.
- Additional JIT compilation work later.

These costs can affect application latency even when GC and global safepoint metrics appear normal.


## What happens to the compiled method?

Recall our earlier lesson on the Code Cache.

HotSpot stores compiled methods as `nmethod` structures.

An invalidated compiled method may transition through states such as:

```text
Compiled nmethod
       |
       v
     In use
       |
       | Invalidated
       v
   Not entrant
       |
       | No longer needed by active execution
       v
     Zombie
       |
       v
   Reclaimable
```

This in-use → not-entrant → zombie → reclaimable sketch is one simplified lifecycle, not the required outcome of every uncommon trap. A **not-entrant** method cannot be entered by new invocations, although existing activations may still need to complete or be deoptimized.

The method's code is not necessarily reclaimed immediately.

Also, an uncommon trap does not automatically mean the entire compiled method must be discarded. HotSpot's response depends on the trap reason, action, and recompilation policy.

This distinction matters when interpreting compilation logs.


<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable a phase shift can be normal; repeated adaptation of a hot path can become costly."><a href="/images/courses/jvm/jit-recompilation-feedback-loop.svg" aria-label="Open a phase shift can be normal; repeated adaptation of a hot path can become costly."><img src="/images/courses/jvm/jit-recompilation-feedback-loop.svg" alt="Workload alternates regular, premium and mixed receivers; compilation, traps, less optimized execution and recompilation repeat." width="1080" height="520" /></a><figcaption>A phase shift can be normal; repeated adaptation of a hot path can become costly.</figcaption></figure>

## Why repeated deoptimization can hurt performance

Suppose application behavior changes repeatedly:

```text
Phase A
    |
    v
RegularDiscount dominates
    |
    v
C2 optimizes
    |
    v
Phase B: PremiumDiscount dominates
    |
    v
Uncommon traps / deoptimization
    |
    v
Interpreter or less-optimized execution
    |
    v
Recompilation
    |
    v
Phase C: Workload changes again
```

Each adaptation can be legitimate.

However, frequent changes in hot execution paths may produce repeated optimization and invalidation cycles.

Potential consequences include reduced throughput, increased compiler CPU consumption, and transient latency spikes.

<mark>A small number of deoptimizations is normal; repeated recovery on a hot steady-state path deserves investigation.</mark> Compiler CPU, transient slower execution and Code Cache occupancy can all matter, but the event count alone is not a throughput measurement. Newly compiled `nmethod`s occupy Code Cache space; obsolete versions may remain until safe reclamation.


## Hands-on: observe deoptimization with JFR

JDK 25 provides the JFR event:

```text
jdk.Deoptimization
```

It records information about uncommon situations detected in compiled methods that may lead to deoptimization.

The JDK 25 `profile.jfc` configuration enables this event with stack traces. [GitHub](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/jdk.jfr/share/conf/jfr/profile.jfc)

### Step 1 — Record application execution

```bash
jcmd <pid> JFR.start \
  name=jit-analysis \
  settings=profile \
  duration=120s \
  filename=/tmp/jit-analysis.jfr
```

Exercise the application during the recording, ideally including the workload transition suspected of triggering deoptimization.

### Step 2 — Inspect deoptimization events

```bash
jfr summary /tmp/jit-analysis.jfr
jfr print --events jdk.Deoptimization /tmp/jit-analysis.jfr
```

Look for the affected methods, bytecode locations, reasons, and actions.

The distinction between reason and action is useful:

| Field | Meaning |
|---|---|
| Reason | Why the uncommon situation occurred |
| Action | What HotSpot decided to do about it |
| Method / BCI | Where the event occurred in Java execution |
| Timestamp | When the event happened |

The precise fields depend on the event schema in the running JDK.

### Step 3 — Correlate with compilation activity

For a controlled local experiment, start the JVM with:

```bash
java \
  -XX:+UnlockDiagnosticVMOptions \
  -XX:+LogCompilation \
  -XX:LogFile=hotspot.log \
  -jar application.jar
```

Compilation logging provides more detailed information about compilation activity and uncommon traps.

For a simpler console view:

```bash
java -XX:+PrintCompilation -jar application.jar
```

You may see entries indicating that compiled methods were made not entrant.

However, **`made not entrant` does not, by itself, establish why the method was invalidated**.

The detailed compilation log or JFR events provide better context.

These diagnostic options are documented in the [JDK 25 Java command reference](https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html).


## A bounded three-phase lab

The following standalone program makes the receiver distribution change visible to the compiler. Its `volatile` sink prevents the calculated result from being discarded. It is a teaching workload, not a benchmark or a guaranteed deoptimization reproducer.

```java
public class DeoptimizationLab {
    interface DiscountPolicy { double apply(double price); }
    static final class RegularDiscount implements DiscountPolicy {
        public double apply(double price) { return price * 0.9; }
    }
    static final class PremiumDiscount implements DiscountPolicy {
        public double apply(double price) { return price * 0.8; }
    }
    static volatile double sink;
    static double calculate(DiscountPolicy policy, double price) {
        return policy.apply(price);
    }
    static void phase(String name, DiscountPolicy regular,
                      DiscountPolicy premium, int iterations) {
        double total = 0;
        for (int i = 0; i < iterations; i++) {
            DiscountPolicy policy = switch (name) {
                case "regular" -> regular;
                case "premium" -> premium;
                default -> (i & 1) == 0 ? regular : premium;
            };
            total += calculate(policy, 100 + (i & 7));
        }
        sink = total;
        System.out.println(name + " sink=" + sink);
    }
    public static void main(String[] args) {
        DiscountPolicy regular = new RegularDiscount();
        DiscountPolicy premium = new PremiumDiscount();
        phase("regular", regular, premium, 5_000_000);
        phase("premium", regular, premium, 5_000_000);
        phase("mixed", regular, premium, 5_000_000);
    }
}
```

Compile and run on a disposable JDK 25 environment:

```bash
javac DeoptimizationLab.java
java -XX:+PrintCompilation \
  -XX:StartFlightRecording=filename=deoptimization-lab.jfr,settings=profile,dumponexit=true \
  DeoptimizationLab
jfr summary deoptimization-lab.jfr
jfr print --events jdk.Deoptimization deoptimization-lab.jfr
```

Look for compilation near each phase and inspect any JFR event’s method, BCI, reason, action and time. **The program does not guarantee a deoptimization event** on every JDK build, machine, compiler decision or warm-up schedule. An empty event list is evidence only about that recording. In one local macOS run with OpenJDK 25.0.2, the three phases completed and JFR recorded eight total `jdk.Deoptimization` events, including a `class_check` at `DeoptimizationLab.calculate` (BCI 2). Startup methods contributed to the total; the count is not a portable expectation. Use `-XX:+UnlockDiagnosticVMOptions -XX:+LogCompilation -XX:LogFile=hotspot.log` in a controlled rerun if detailed compiler decisions are needed; the resulting log can be large.

## Production implications

Imagine a service experiencing periodic throughput degradation.

GC pauses are consistently low, safepoint synchronization is normal, and CPU utilization increases during the slowdown.

JFR shows repeated deoptimization events involving a frequently executed business method.

This suggests investigating whether the workload's receiver-type distribution or branch behavior is changing.

The diagnostic approach is to correlate deoptimization events with compilation activity, application latency, and workload changes.

Correlate event timestamps with phase changes in traffic, receiver types, CPU, throughput, compiler activity and Code Cache state. A `made not entrant` line by itself does not establish the reason; pair compilation logs with JFR and workload context. Avoid immediately disabling tiered compilation, inlining, or speculative optimization.

Those mechanisms are responsible for substantial JVM performance improvements. Disabling them globally can create a much larger performance regression than the original problem.


<aside class="lesson-callout" data-kind="production" aria-label="Production note"><p class="callout-label">Production note</p><p>Repeated recovery in one hot method is a lead, not a diagnosis. Match event times to receiver mix, compiler work, CPU, throughput and Code Cache evidence before changing JIT flags.</p></aside>

## Read the recovery path in JDK 25

Use the immutable [`jdk-25+36` tag](https://github.com/openjdk/jdk/tree/jdk-25%2B36). In [`src/hotspot/share/runtime/deoptimization.cpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/runtime/deoptimization.cpp), trace `fetch_unroll_info`, `realloc_objects`, and frame unpacking. Ask where the compiled state is decoded, when an eliminated object becomes a heap object, and how inlined logical frames become interpreter continuation frames. This source path describes HotSpot’s implementation; the Java language specifies the behavior that must be preserved, not this recovery layout.

## Check your reasoning

<details class="lesson-check"><summary>Only RegularDiscount has appeared so far. May C2 assume PremiumDiscount can never appear?</summary><p>No. The profile supports a speculative fast path, guarded or backed by VM dependencies, while Java still permits later receiver changes.</p></details>
<details class="lesson-check"><summary>A PremiumDiscount arrives at a guarded call. Must that call deoptimize?</summary><p>No. C2 may provide an ordinary fallback or polymorphic dispatch. An uncommon trap is one possible outcome.</p></details>
<details class="lesson-check"><summary>An inlined apply method deoptimizes. How can the interpreter resume a call that had no separate physical frame?</summary><p>Compiled metadata describes the logical method and BCI, locals and operand stack so HotSpot can reconstruct the required Java frames.</p></details>
<details class="lesson-check"><summary>Could a scalar-replaced Order become a heap object during recovery?</summary><p>Yes, when the interpreter-visible state requires an object, HotSpot can rematerialize it from saved field values while preserving relevant identity and alias relationships.</p></details>
<details class="lesson-check"><summary>Do repeated jdk.Deoptimization events prove a stop-the-world pause?</summary><p>No. An individual uncommon trap can recover one thread. Look separately for global safepoint evidence and correlate each event with latency.</p></details>
<details class="lesson-check"><summary>A PrintCompilation line says made not entrant. Does that identify a failed type guard?</summary><p>No. The line shows a compiled method state change, not its cause. Inspect detailed compilation and JFR evidence plus the workload phase.</p></details>

## Mental model checkpoint

We can now connect the entire JIT execution lifecycle:

```text
Java bytecode
      |
      v
Interpreter execution
      |
      v
Runtime profiling
      |
      v
C1 / C2 compilation
      |
      v
Optimized machine code
      |
      +----------------------+
      |                      |
      v                      v
Assumptions valid      Assumption invalid
      |                      |
      v                      v
Fast execution         Deoptimization
                             |
                             v
                    Reconstruct Java state
                             |
                             v
                    Interpreter execution
                             |
                             v
                    Possible recompilation
```

This connects several earlier concepts: profiling, inlining, escape analysis, scalar replacement, compiled-frame metadata, safepoints, and the Code Cache.

### Key takeaway

**Deoptimization is the mechanism that makes aggressive speculative JIT optimization practical.**

HotSpot can optimize for observed behavior because it retains enough information to recover when its assumptions become invalid.

The performance concern is not deoptimization itself, but excessive or repeated deoptimization in hot execution paths.

Next, [Lesson 57 — JIT compilation under CPU pressure](/courses/jvm/jit-compilation-under-cpu-pressure) connects compilation queues, compiler threads, container CPU limits and Code Cache pressure.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on Daily JVM Byte #56 and its approved technical review. Diagrams, workload phase shifts and production cases are illustrative. The standalone lab compiled and ran once on macOS with OpenJDK 25.0.2; its observed eight JFR deoptimization events are not a portable frequency or performance result. C2, JFR configuration and recovery paths describe JDK 25 HotSpot rather than a Java language guarantee.</p><ul><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/runtime/deoptimization.cpp">OpenJDK jdk-25+36 deoptimization.cpp</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/jdk.jfr/share/conf/jfr/profile.jfc">OpenJDK jdk-25+36 profile.jfc</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html">JDK 25 java launcher diagnostics</a></li></ul></details>
