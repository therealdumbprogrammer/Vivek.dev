# Daily JVM Byte #56 — Deoptimization in Production: When JIT Assumptions Become Invalid

**Baseline:** JDK 25 LTS  
**Focus:** Speculative optimization, uncommon traps, deoptimization, recompilation, and production diagnostics.

In Byte #55, we examined how HotSpot coordinates safepoints and why JVM pauses are not always caused by garbage collection.

Today, we're returning to the JIT compiler.

Recall that HotSpot optimizes methods using information collected during execution. However, that information represents observed behavior, not necessarily every possible execution path.

This raises an important question:

> **What happens when HotSpot generates highly optimized machine code, but the assumptions behind that code are no longer valid?**

The answer is **deoptimization**.

---

## 1. Why speculative optimization exists

Consider:

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

Initially, suppose every invocation receives `RegularDiscount`.

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

The optimized code is faster because HotSpot specializes it for the behavior observed so far.

**The trade-off:** Better performance for common cases, but additional machinery is required when assumptions fail.

---

## 2. What triggers deoptimization?

There are several important scenarios.

| Trigger | Example | Why optimized code may become invalid |
|---|---|---|
| Unexpected receiver type | A new `DiscountPolicy` implementation appears | Type-profile assumptions no longer hold |
| Uncommon execution path | A previously unseen branch executes | Optimized code may not contain a normal implementation of that path |
| Class hierarchy changes | A newly loaded subclass invalidates an assumption | Previously valid class-hierarchy information changes |
| Runtime invalidation | Class redefinition or other VM changes | Compiled code dependencies may no longer be valid |

Not every unexpected type causes deoptimization.

HotSpot can also generate ordinary fallback paths or polymorphic dispatch sequences.

Deoptimization occurs when the generated code cannot continue correctly under its current optimization assumptions.

---

## 3. How HotSpot reconstructs Java execution

This is the most interesting part.

Consider:

```java
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

If an object was eliminated through scalar replacement, HotSpot may need to **rematerialize** it as a real heap object.

Similarly, an optimized frame containing several inlined Java methods may need to become multiple interpreter frames.

This is implemented in HotSpot's `Deoptimization` machinery, including object rematerialization and frame unpacking. [GitHub](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/runtime/deoptimization.cpp)

### Important connection

This explains why speculative optimization can preserve Java semantics.

The JVM is not simply abandoning optimized execution. It reconstructs the state necessary to continue executing correctly.

---

## 4. Deoptimization does not necessarily mean a global safepoint

This connects directly to Byte #55.

Deoptimization and safepoints are related but distinct mechanisms.

A compiled thread can encounter an uncommon trap and transition through HotSpot's runtime without requiring every application thread to stop.

Other deoptimization-related operations, such as invalidating compiled methods after certain VM changes, may involve broader runtime coordination.

Therefore:

**Deoptimization is not synonymous with a stop-the-world pause.**

Its costs may include:

- Transitioning from optimized execution to interpreter execution.
- Reconstructing Java frames and eliminated objects.
- Losing optimizations such as inlining.
- Additional JIT compilation work later.

These costs can affect application latency even when GC and global safepoint metrics appear normal.

---

## 5. What happens to the compiled method?

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

A **not-entrant** method cannot be entered by new invocations, although existing activations may still need to complete or be deoptimized.

The method's code is not necessarily reclaimed immediately.

Also, an uncommon trap does not automatically mean the entire compiled method must be discarded. HotSpot's response depends on the trap reason, action, and recompilation policy.

This distinction matters when interpreting compilation logs.

---

## 6. Why repeated deoptimization can hurt performance

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

**A small number of deoptimizations is normal. Repeated deoptimization of hot methods during steady-state execution deserves investigation.**

---

## 7. Hands-on: observe deoptimization with JFR

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
  filename=jit-analysis.jfr
```

Exercise the application during the recording, ideally including the workload transition suspected of triggering deoptimization.

### Step 2 — Inspect deoptimization events

```bash
jfr print \
  --events jdk.Deoptimization \
  jit-analysis.jfr
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

---

## 8. Production implications

Imagine a service experiencing periodic throughput degradation.

GC pauses are consistently low, safepoint synchronization is normal, and CPU utilization increases during the slowdown.

JFR shows repeated deoptimization events involving a frequently executed business method.

This suggests investigating whether the workload's receiver-type distribution or branch behavior is changing.

The diagnostic approach is to correlate deoptimization events with compilation activity, application latency, and workload changes.

Avoid immediately disabling tiered compilation, inlining, or speculative optimization.

Those mechanisms are responsible for substantial JVM performance improvements. Disabling them globally can create a much larger performance regression than the original problem.

---

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

### Next byte — #57: JIT Compilation Under CPU Pressure

We'll investigate how HotSpot schedules compilation tasks, how compiler threads compete with application threads, and why JVM warm-up can behave differently inside CPU-constrained Kubernetes containers.

We'll also connect tiered compilation, compiler queues, code-cache pressure, and production startup latency.

**JDK 25 source references:** [Deoptimization implementation](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/runtime/deoptimization.cpp?utm_source=chatgpt.com) · [JFR profiling configuration](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/jdk.jfr/share/conf/jfr/profile.jfc?utm_source=chatgpt.com)