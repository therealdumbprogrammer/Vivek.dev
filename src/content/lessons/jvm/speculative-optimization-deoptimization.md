---
title: Speculative optimization and deoptimization
summary: Follow one optimized Java call as HotSpot bets on common behavior, detects when reality changes, and safely continues execution.
course: jvm
lessonSlug: speculative-optimization-deoptimization
module: Execution and JIT
order: 150
sourceByte: byte-015
draft: false
prerequisites: [tiered-compilation]
jdk: HotSpot · JDK 25 speculative optimization
---

A payment service has been running for hours. Most requests use card payments, and its busiest method has become fast. Then traffic shifts toward bank transfers. The Java code has not changed, every payment must still produce the correct fee, yet the method may temporarily run more slowly while HotSpot changes its executable form.

Why would working compiled code need to change?

In [Lesson 14](/courses/jvm/tiered-compilation), we saw C2 use runtime profiles to optimize hot methods. A profile is a summary of behavior already observed, such as which concrete object type usually receives a method call. It is evidence about the past, not a Java rule about the future.

HotSpot can still use that evidence. It may optimize for the behavior that happens most often, provided that it keeps a correct route for every behavior Java allows. This is **speculative optimization**: optimize around a likely condition while treating that condition as something that may later prove false.

If the optimized form can no longer be used safely, HotSpot can leave it, rebuild the Java-level execution state, and continue in a safer form. That transition is **deoptimization**. <mark>It does not undo the application's work or restart the request.</mark>

Keep three layers separate throughout the lesson:

```text
Java behavior
what the program is
required to do

optimized representation
how C2 currently makes
the common case fast

recovery information
how HotSpot can return
to correct Java execution
```

<figure>
<a href="/images/courses/jvm/speculation-overview.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/speculation-overview.svg" alt="Runtime profiles; Evidence about this call site. C2 specializes common behavior; Guards or tracked dependencies. Assumptions valid → fast execution; Failure → recover correct JVM state" width="480" height="476" /></a>
<figcaption>Speculation changes how the program executes, never which Java behavior is required. <a href="/images/courses/jvm/speculation-overview.svg">Open full-size diagram</a>.</figcaption>
</figure>

The first layer never changes. The other two are implementation choices. This lesson follows JDK 25 HotSpot with C2; another JVM may preserve the same Java behavior with different machinery. The examples and percentages are illustrative, not measured output or promises about which optimization a particular run will choose.

## A common receiver creates an opportunity

We will follow one method call through the whole lesson:

```java
interface Payment {
    int fee();
}

final class CardPayment
        implements Payment {
    public int fee() { return 2; }
}

final class BankTransferPayment
        implements Payment {
    public int fee() { return 1; }
}

int calculate(Payment payment) {
    return payment.fee();
}
```

The expression `payment.fee()` is a **call site**: one particular place in the bytecode where a method is called. The object stored in `payment` is the **receiver**. Its concrete class determines which `fee()` implementation Java must run.

The declared type is `Payment`, so both implementations are legal. Without using a runtime observation, the generated code must preserve a general way to choose the correct implementation. Suppose, however, that the profile for this exact call site records `CardPayment` in 99.9% of calls. C2 may generate a fast path for that dominant receiver type.

That path can first check whether the current receiver really is a `CardPayment`. When the check succeeds, C2 can use the known target and may **inline** it, meaning that the useful operations from `CardPayment.fee()` become part of the compiled `calculate` code instead of remaining a separate method call.

<figure>
<a href="/images/courses/jvm/speculative-devirtualization.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/speculative-devirtualization.svg" alt="Payment.fee(); Profile: mostly CardPayment. Guard: receiver is CardPayment?; Yes → inline CardPayment.fee(). No → correct fallback; May use an uncommon trap" width="480" height="476" /></a>
<figcaption>A guarded fast path can inline a likely target while retaining a correct route for other receiver types. <a href="/images/courses/jvm/speculative-devirtualization.svg">Open full-size diagram</a>.</figcaption>
</figure>

Inlining does more than save one call. It lets C2 analyze the caller and the inlined method body together. That larger view can expose constants, remove work whose result is unused, and sometimes enable escape analysis across the former call boundary. A useful observation can therefore unlock transformations that a fully general interface call would prevent.

The illustrative 99.9% does not force this code shape. C2 can keep general dispatch, inline more than one target, or add a compiled fallback for other types. A receiver mismatch therefore does not always cause deoptimization; the result depends on the code C2 generated. A null receiver must still produce the Java-required `NullPointerException`, and every legal receiver must still reach the correct implementation.

## Guards and runtime dependencies protect different facts

HotSpot can protect an optimization in two related but different ways. A beginner-friendly distinction is to ask where the condition is checked.

An inline **guard** is a check inside the generated machine code. For our running example, it asks whether the receiver in this particular call is a `CardPayment`. If the answer is yes, the specialized path runs. If the answer is no, execution takes a correct fallback or leaves this optimized form. The compiler has not claimed that every future receiver will be a card payment.

A VM-tracked **dependency** records that compiled code relies on a fact known by the runtime, such as there currently being only one relevant implementation in a loaded class hierarchy. HotSpot knows which compiled methods depend on that fact. If class loading changes the hierarchy, the VM can invalidate the affected code without waiting for a mismatching object to reach the call site.

The comparison looks like this:

**Inline guard**

- The generated code checks the receiver during a call.
- A different receiver reveals that the fast-path condition is false.
- Execution uses a fallback or leaves the optimized code.

**VM dependency**

- HotSpot tracks a runtime fact used by the compiled code.
- Class loading or another VM change can overturn that fact.
- HotSpot invalidates the compiled code that depended on it.

<figure>
<a href="/images/courses/jvm/guards-vs-dependencies.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/guards-vs-dependencies.svg" alt="INLINE GUARD; Checks this execution’s receiver; Mismatch leaves the specialized path. VM-TRACKED DEPENDENCY; Records a class-hierarchy fact; VM change can invalidate dependent code" width="480" height="344" /></a>
<figcaption>An execution-time check and a VM-tracked dependency are distinct mechanisms; compiled code may rely on both. <a href="/images/courses/jvm/guards-vs-dependencies.svg">Open full-size diagram</a>.</figcaption>
</figure>

Here, **invalidate** means that HotSpot stops treating the compiled version as safe for new execution. If a thread is already running inside affected code, the VM may also need to move that active execution to a valid state. Invalidation, deoptimization, and later recompilation are connected events, but they need not happen as one indivisible operation.

The [HotSpot dependency definitions](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/code/dependencies.hpp) describe assumptions about unique implementations and class hierarchies. A profile describes behavior observed at a program location; a dependency records a fact that compiled code needs the VM to keep checking. Both let HotSpot optimize conditionally without weakening Java's contract.

## An uncommon trap exits a rarely needed path

If C2 decides that a path is unlikely, it does not always generate a fully optimized version of that path. It can keep the common machine-code path small and arrange an **uncommon trap** when the rare path is actually reached.

The name sounds more alarming than the event. **Uncommon** means that profiling suggested the path would be rare. **Trap** means an internal exit from the current optimized code into HotSpot's runtime machinery. It is not an operating-system crash, and it is not a Java exception delivered to the application.

<figure>
<a href="/images/courses/jvm/uncommon-trap.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/uncommon-trap.svg" alt="Common case → optimized code; Rare condition encountered ↓. Uncommon trap; Exit with reason and action. Deoptimization machinery; Continue the required Java behavior" width="480" height="476" /></a>
<figcaption>The uncommon path pays for recovery when needed; the common path can remain smaller and easier to optimize. <a href="/images/courses/jvm/uncommon-trap.svg">Open full-size diagram</a>.</figcaption>
</figure>

For our payment call, a `BankTransferPayment` might take such an exit if C2 did not generate a compiled fallback for it. Other rare conditions can use uncommon traps too. The trap carries a reason and a requested action so HotSpot knows why optimized execution stopped and how recovery should proceed.

The trade-off is a faster or smaller common path against extra recovery work when the uncommon case occurs. Rare does not mean impossible, and no specific observed percentage guarantees that C2 will choose a trap. HotSpot's [C2 graph machinery](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/opto/graphKit.cpp) builds uncommon traps and considers earlier trap behavior when selecting later optimizations.

Before going deeper, follow one possible event from beginning to end:

```text
1. The call site mostly sees CardPayment.
2. C2 compiles a guarded
   CardPayment fast path.
3. A BankTransferPayment
   reaches the guard.
4. The generated code has no
   compiled fallback for this case.
5. An uncommon trap transfers
   control to HotSpot.
6. HotSpot reconstructs valid
   JVM execution state.
7. Execution continues through
   the interpreter.
8. Later profiling and compilation
   may adapt to both types.
```

Steps 1–4 explain why recovery is needed. The next sections explain how steps 5–7 remain correct even after C2 has inlined methods, moved values, and removed objects or locks.

## Deoptimization continues the computation

Imagine that `calculate` runs halfway through a request handler that has already updated a counter and written part of a response object. Restarting the handler could repeat those visible effects. HotSpot instead needs to continue from a point that represents the work already completed.

<figure>
<a href="/images/courses/jvm/deoptimization-flow.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/deoptimization-flow.svg" alt="Optimized execution at a supported point; Earlier side effects have already happened. Compiler metadata + machine state; Reconstruct logical JVM state. Resume interpreter execution; Do not restart the whole method" width="480" height="476" /></a>
<figcaption>Recovery reconstructs a logically equivalent execution state at a supported program position, preserving earlier effects. <a href="/images/courses/jvm/deoptimization-flow.svg">Open full-size diagram</a>.</figcaption>
</figure>

For a normal deoptimization, HotSpot replaces the affected running compiled frame with one or more interpreter frames. Execution resumes at the appropriate bytecode position. Recovery rules can require a particular bytecode operation to be executed again, but the metadata and chosen position must preserve Java-visible behavior rather than repeating arbitrary earlier work. Later calls and later compilations are separate decisions.

This is not restoration of an exact physical stack that existed before C2 compilation. There may never have been an interpreter-shaped stack for this invocation. The target is **logical JVM state**: enough information for Java execution to continue correctly. That includes the active methods, each method's next relevant bytecode position, live local variables, operand-stack values, object references, and required synchronization state.

## One compiled frame can contain several Java calls

Suppose Java method A calls B, and B calls C. Without inlining, these calls would normally create three logical method frames. C2 may instead inline B and C into the compiled form of A. While the program is logically executing C, the native thread stack can contain one physical compiled frame representing work from all three Java methods.

<figure>
<a href="/images/courses/jvm/inlined-frame-reconstruction.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/inlined-frame-reconstruction.svg" alt="One compiled frame for A; Contains inlined B and C. Scope metadata records logical callers; And each suspended program position. Reconstructed frames: A → B → C; Each has locals and operand state" width="480" height="476" /></a>
<figcaption>Inlining removes physical call boundaries, while compiler scope metadata preserves the logical nesting needed for recovery. <a href="/images/courses/jvm/inlined-frame-reconstruction.svg">Open full-size diagram</a>.</figcaption>
</figure>

Deoptimization may expand that one compiled frame into interpreter frames for A, B, and C. Each reconstructed frame needs the bytecode position at which its method is paused, plus the locals and operand-stack values needed when that method resumes. These are the same logical frame components introduced in [Lesson 12](/courses/jvm/stack-frames-operand-stack).

The [HotSpot deoptimization implementation](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/runtime/deoptimization.cpp) builds virtual-frame information and unpacks recovered frames. The compiler and runtime cooperate; the runtime does not infer the original Java call tree by guessing from machine instructions.

## Compiler metadata maps machine values back to JVM state

Reconstructing the method frames raises a harder question: where do their values come from?

Optimized execution does not keep one fixed memory slot for every Java local variable. At the recovery point, a needed value might be in a CPU register, stored in the compiled frame, known as a constant, or represented indirectly. A value that is no longer needed may have disappeared entirely. An object can even exist only as separate field values after scalar replacement.

<figure>
<a href="/images/courses/jvm/machine-to-jvm-state.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/machine-to-jvm-state.svg" alt="Registers · stack slots · constants; Scalar fields of eliminated objects. Compiler metadata at recovery points; Maps values and inlined scopes. JVM locals · operands · references; Dead values need not be recreated" width="480" height="476" /></a>
<figcaption>Metadata describes recoverable values at supported recovery points; it is not a recording of every earlier machine state. <a href="/images/courses/jvm/machine-to-jvm-state.svg">Open full-size diagram</a>.</figcaption>
</figure>

When C2 creates optimized code, it also emits metadata for places where HotSpot may need to inspect or recover execution. Think of this metadata as a translation map. It can say, conceptually, “local 1 is now in this register,” “the top operand is this constant,” and “these two scalar values describe the fields of one eliminated object.”

HotSpot uses that map to build the required logical locals and operands. Values that the continued program cannot observe do not need to be recreated. Values required for correct execution must remain recoverable, which constrains the transformations C2 can make. The source-level variables shown by a debugger are therefore a logical view, not a complete picture of the physical machine layout.

## Scalar-replaced objects can be rematerialized

In [Lesson 9](/courses/jvm/escape-analysis-scalar-replacement), we saw how escape analysis can enable scalar replacement:

```java
Point p = new Point(10, 20);
// Continue using p within this method.
return p.x + p.y;
```

C2 may eliminate the allocation and work with the field values instead. It might even fold the sum to a constant. During optimized execution there may be no physical `Point` object anywhere, only enough information to preserve what the program can observe.

<figure>
<a href="/images/courses/jvm/deopt-rematerialization.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/deopt-rematerialization.svg" alt="Optimized representation; Point fields: x = 10, y = 20. Deoptimization needs a live Point; Allocate object and restore fields. Reconstructed reference p → Point; Preserve identity and required lock state" width="480" height="476" /></a>
<figcaption>If resumed execution needs a live object, HotSpot can allocate it and restore fields from the recorded scalar state. <a href="/images/courses/jvm/deopt-rematerialization.svg">Open full-size diagram</a>.</figcaption>
</figure>

If deoptimization occurs at a point where continued execution needs the reference `p`, interpreter execution now expects a real object. HotSpot may **rematerialize** it: allocate a `Point`, restore `x` and `y`, and place the resulting reference in the reconstructed state.

This is conditional. An object that the program can no longer observe does not need to be recreated merely because its variable appeared in source code. Object identity and aliases must remain correct: if two Java references logically point to the same object, recovery cannot silently create two unrelated objects.

Synchronization adds another requirement. Escape analysis may have proved that a lock cannot be observed by another thread and allowed C2 to eliminate its physical locking work. If deoptimization reconstructs execution inside a synchronized region, HotSpot must also reconstruct the required **monitor state**, which is the JVM's record of which locks this execution logically owns. That can include relocking a rematerialized object.

Recovery reconstructs state; it does not rerun arbitrary constructor calls or synchronized-block side effects. Object reallocation, field restoration, and eliminated-lock handling appear in the deoptimization implementation linked above.

## Deoptimization feeds another optimization decision

Moving the current execution to interpreter frames does not permanently ban the method from optimization, and it does not erase everything HotSpot learned. The interpreter or a profiling compiled tier can observe the newly encountered behavior. Compilation policy may later request another version.

<figure>
<a href="/images/courses/jvm/deopt-recompile-loop.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/deopt-recompile-loop.svg" alt="Observe → compile → execute; Specialize using current evidence. Assumption fails → deoptimize; Observe changed behavior. May compile a revised version; Trap history informs the next decision" width="480" height="476" /></a>
<figcaption>A failed assumption can change the next compilation; recompilation is possible rather than guaranteed after each trap. <a href="/images/courses/jvm/deopt-recompile-loop.svg">Open full-size diagram</a>.</figcaption>
</figure>

The next version might inline both `CardPayment` and `BankTransferPayment`, use generic dispatch, or avoid a speculation that repeatedly failed. HotSpot tracks trap history at relevant methods and bytecode locations. That history influences later decisions, alongside profiles and compilation policy.

There is no beginner-safe rule such as “exactly N traps permanently disable this optimization.” HotSpot records trap reasons and history at relevant locations, and later compilation policy can respond differently depending on the method and situation. One deoptimization event also does not imply that every compiled version was immediately discarded or that replacement code already exists.

## Dynamic class loading can change the type world

Now return to the VM dependency from earlier. Suppose only `CardPayment` is loaded when C2 compiles `calculate`, and the generated code depends on there being one relevant `Payment` implementation. A plugin later loads `BankTransferPayment`. The new class can overturn that recorded class-hierarchy fact before any bank-transfer object reaches the hot call site.

<figure>
<a href="/images/courses/jvm/class-loading-invalidation.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/class-loading-invalidation.svg" alt="Initial world: CardPayment; Compiled code records a dependency. Load BankTransferPayment; Does it overturn the recorded fact?. If yes: invalidate dependent code; Arrange safe recovery for affected frames" width="480" height="476" /></a>
<figcaption>Only code whose recorded assumptions are invalidated needs this response; loading a class does not deoptimize the whole JVM. <a href="/images/courses/jvm/class-loading-invalidation.svg">Open full-size diagram</a>.</figcaption>
</figure>

HotSpot checks the dependencies affected by the newly loaded class. It stops new calls from entering compiled code whose required fact is no longer true, and it arranges safe recovery for affected active frames when needed. It does not deoptimize every compiled method in the process.

This trigger is different from an inline type guard seeing a new receiver. Dependency invalidation can happen when the class is loaded, before an instance is used. A guard mismatch happens when execution reaches the check with a receiver that does not match. Conversely, a class may have been loaded for a long time before one of its objects first reaches this call site.

That distinction connects [class loading](/courses/jvm/class-loading-lifecycle) with compilation. The set of runtime classes is part of the optimizer's environment, not just a startup concern.

## Watch instability rather than individual events

Occasional deoptimization is normal. A runtime willing to make reversible bets can produce faster common-case code than one that refuses every assumption. The operational concern is sustained or concentrated instability that costs enough work to affect the service.

A changing request mix can make a formerly stable call site **polymorphic**, meaning that several receiver types now appear there regularly. Previously warmed code can lose an optimization or be invalidated long after startup. Recovery itself costs work on affected executions. Running temporarily through the interpreter or less optimized code can reduce throughput. If replacement compilation occurs, compiler threads consume CPU and temporary memory, while the generated native code consumes Code Cache space.

For a latency-sensitive service, those costs may contribute to a transient tail-latency increase, especially when CPU capacity is already constrained. A latency spike alone does not establish this cause. Correlate the timing with traffic or plugin changes and available compilation/deoptimization evidence from your actual JDK, while also checking GC, CPU contention, and application behavior. A compiled method becoming non-entrant alone is not proof of repeated speculation failure; version replacement can also be normal.

A useful investigation compares stable traffic with the changed period and asks four questions:

1. Did the request mix or set of loaded classes change?
2. Are the same hot methods repeatedly trapping, becoming invalid, or recompiling?
3. Did compiler CPU or Code Cache activity rise at the same time?
4. Do GC, CPU contention, or application-level changes explain the latency more directly?

Representative warm-up can exercise important paths, but it cannot freeze future profiles or class loading. The goal is to explain a measured transition, not to eliminate all deoptimization.

## Check your reasoning

Suppose `calculate(Payment)` has a guarded, inlined `CardPayment` path, and a `BankTransferPayment` arrives. Must the JVM run the wrong fee calculation or restart the request?

<details class="lesson-check">
<summary>Follow the guard and the continuation</summary>
<p>Neither. The guard routes the receiver away from the specialized path. A compiled fallback may handle it directly, or an uncommon trap may trigger deoptimization. Recovery resumes logically correct execution without restarting the whole request or duplicating prior side effects.</p>
</details>

A plugin loads a new implementation, but no object of that type has reached the call site. Could that still affect optimized code?

<details class="lesson-check">
<summary>Separate the two kinds of assumption</summary>
<p>Yes, if the new class invalidates a VM-tracked hierarchy dependency. An inline receiver guard would need an execution to encounter a mismatch. Loading an unrelated class does not automatically invalidate this code.</p>
</details>

C2 inlined three Java calls and removed a temporary `Point`. How can the interpreter continue after deoptimization?

<details class="lesson-check">
<summary>Recover logical state from metadata</summary>
<p>Scope metadata identifies the logical calls and bytecode positions. Value metadata maps registers, stack slots, constants, and scalar fields to required locals and operands. HotSpot reconstructs frames and may rematerialize the Point if it is still needed, preserving references and required monitor semantics. It does not restore some historical physical stack.</p>
</details>

A method traps repeatedly after traffic changes. Does that prove it can never be optimized again?

<details class="lesson-check">
<summary>Apply the adaptive model</summary>
<p>No. Trap history and new profiles can lead to a broader specialization or a less speculative strategy. Recompilation depends on policy; there is no fixed public trap count that describes every case. Investigate sustained cost rather than treating one event as a failure.</p>
</details>

## The complete loop leads to the Code Cache

We can now connect profiling, compilation, and recovery. The interpreter and profiling compiled tiers provide evidence. C2 produces optimized code with guards, dependencies, and metadata that preserve a route back to correct execution. Valid assumptions allow fast execution; changed facts can trigger recovery and another round of learning.

<figure>
<a href="/images/courses/jvm/speculation-deoptimization-complete.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/speculation-deoptimization-complete.svg" alt="Interpreter / profiled compiled execution; Runtime evidence guides C2. Optimized code + recovery metadata; Installed in the native Code Cache. Valid assumptions → keep executing; Failure → reconstruct → learn again" width="480" height="476" /></a>
<figcaption>HotSpot changes execution representations while maintaining one set of Java semantics. <a href="/images/courses/jvm/speculation-deoptimization-complete.svg">Open full-size diagram</a>.</figcaption>
</figure>

Those compiled versions and their supporting metadata need a home. The next [Code Cache preview](/courses/jvm/code-cache) follows the native memory that holds generated code, how HotSpot organizes it, and why capacity and code lifetime can affect performance.

<details class="lesson-sources">
<summary>Sources and implementation boundaries</summary>
<p>Adapted from Daily JVM Byte #15 and the available reviewed draft. Diagrams, percentages, and Java fragments are conceptual examples, not executed benchmarks. JDK 25 HotSpot anchors implementation details; exact code shapes and policy vary by build and workload.</p>
<ul>
<li><a href="https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/runtime/deoptimization.cpp">Frame reconstruction, object reallocation, field restoration, and relocking</a></li>
<li><a href="https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/code/dependencies.hpp">VM-tracked dependencies and class-hierarchy changes</a></li>
<li><a href="https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/opto/graphKit.cpp">Uncommon traps and trap-history decisions</a></li>
<li><a href="https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/code/debugInfo.hpp">Scope values, locations, constants, objects, and monitor metadata</a></li>
</ul>
</details>
