---
title: One virtual method call, end to end
summary: Trace an interface call from symbolic reference and receiver class through dispatch, type profiles, compiled call sites, speculative inlining, and deoptimization.
course: jvm
lessonSlug: virtual-method-call-end-to-end
module: HotSpot Internals
order: 430
sourceByte: byte-043
draft: true
prerequisites:
  - object-allocation-end-to-end
jdk: JDK 25 · HotSpot Internals
---

[Lesson 42](/courses/jvm/object-allocation-end-to-end) followed an `Order` from `new` to a usable object. Now suppose a service chooses a payment implementation at runtime:

```java
public class PaymentDemo {
    interface Payment { void process(); }
    static final class CardPayment implements Payment {
        public void process() { /* authorize card */ }
    }
    static final class UpiPayment implements Payment {
        public void process() { /* initiate UPI */ }
    }
    static void submit(Payment payment) { payment.process(); }
}
```

The local variable's declared type is `Payment`, but the receiver may be a `CardPayment` or `UpiPayment`. The VM must execute the correct implementation for the object it actually receives. This is **dynamic dispatch**. It preserves polymorphism while leaving room for the JIT compiler to specialize the common case.

## Start with the actual invocation instruction

Compile a complete class containing the example with JDK 25 `javac`, then inspect it with `javap -c -p`. For `submit(Payment)`, the call is normally `invokeinterface Payment.process:()V`. The original Byte's wording called it `invokevirtual`; that would describe an ordinary overridable class-method call, not this interface-typed source call. Both require a receiver and can select an implementation according to its runtime type, but they have different linkage and lookup rules in the JVMS.

| Instruction | Typical source shape | Main role |
|---|---|---|
| `invokeinterface` | `payment.process()` where `payment` has interface type | Invoke an interface method on the receiver. |
| `invokevirtual` | `base.process()` for an overridable class method | Invoke a class method selected using the receiver. |
| `invokespecial` | `super.process()` or `<init>` | Direct special invocation with its own selection rules. |
| `invokestatic` | `Utility.process()` | Invoke a static method, with no receiver dispatch. |
| `invokedynamic` | A language or library supplied dynamic call site | Link a call site through a bootstrap method; it is not ordinary virtual lookup. |

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable interface and class invocation bytecodes"><a href="/images/courses/jvm/virtual-vs-interface-bytecode.svg" aria-label="Open invocation bytecode comparison"><img src="/images/courses/jvm/virtual-vs-interface-bytecode.svg" alt="Payment interface variable normally produces invokeinterface; an ordinary BasePayment class variable produces invokevirtual; both use a receiver at runtime." width="1080" height="400" /></a><figcaption>The declared call-site type determines the bytecode form; the receiver's class still matters for method selection.</figcaption></figure>

## Resolve the name, then select for the receiver

The instruction refers to a symbolic method entry in the caller's runtime constant pool: interface name, method name, and descriptor. Resolution checks and identifies the method relationship required by the instruction. The actual receiver still supplies the runtime class for dispatch. Resolving `Payment.process:()V` once does not mean every future receiver will run the same implementation.

HotSpot's `oop` reference reaches an object's type metadata, a `Klass` or, for ordinary classes, `InstanceKlass`. That metadata supports supertype/interface checks and method dispatch. A class virtual call can use **vtable** information: an indexed table of virtual method targets associated with class metadata. Interface dispatch can use **itable** information connecting implemented interfaces to targets. These are useful source-level models. Interpreted entry points, compiled inline caches, direct calls after optimization, and other runtime paths mean an executed call does not necessarily read a table on every invocation.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable receiver class dispatch"><a href="/images/courses/jvm/receiver-klass-dispatch.svg" aria-label="Open receiver class dispatch"><img src="/images/courses/jvm/receiver-klass-dispatch.svg" alt="The call site resolves Payment.process while the actual CardPayment or UpiPayment receiver supplies Klass metadata used to select its own process method." width="1080" height="470" /></a><figcaption>Symbolic resolution identifies what is being called; the receiver determines the implementation for a dispatching call.</figcaption></figure>

Try a prediction: `submit(new CardPayment())` and `submit(new UpiPayment())` execute different method bodies even though the bytecode inside `submit` is unchanged. That is precisely the job of receiver-based selection.

## Profiles tell the compiler what has been common

The interpreter and profiling compiled tiers can record receiver types at a call site in HotSpot method profile data, including `MethodData`. A **monomorphic** site has predominantly one observed receiver type; a **bimorphic** site has two common types; a **megamorphic** site has many and is harder to specialize with a small set of targets. These are conceptual patterns, not a promise that HotSpot stores an unbounded, exact histogram for every site. Profiles are partial observations collected under runtime policy, not language guarantees or proof that a new type cannot appear.

If production traffic overwhelmingly passes `CardPayment`, a compiler may generate a path optimized for that case while preserving a correct route for `UpiPayment` and any future implementation. If types vary frequently, a general dispatch may be cheaper than many guards and duplicated code. This is why “interfaces are slow” is poor advice. The cost depends on the call site's types, target size, compiler decisions, and what optimization an inline target enables.

## Compiled inline caches and inlining solve different problems

HotSpot's **compiled inline cache** specializes a compiled call site. It can remember a receiver class and a destination or use a broader dispatch state. A mismatch can enter a runtime resolver or a general lookup path, and the call site may be updated. The cache is about directing a **call** efficiently. Its implementation is visible around `code/compiledIC.*` and `runtime/sharedRuntime.*` in the JDK 25 source.

**Inlining** instead copies the callee's operations into the caller's compiled body. C2 may use a receiver-type profile to create a guarded fast path for `CardPayment.process`. If the guard matches, the body runs without a separate method call. Inlining can expose constants, remove redundant checks, combine allocations, and permit escape analysis and scalar replacement across what was a call boundary. Saving call overhead is only one possible benefit. <mark>An inline cache that directs a call is not the same operation as copying a callee into the caller.</mark>

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable inline cache and inlining comparison"><a href="/images/courses/jvm/inline-cache-vs-inlining.svg" aria-label="Open inline cache versus inlining"><img src="/images/courses/jvm/inline-cache-vs-inlining.svg" alt="A compiled inline cache keeps a call and routes a receiver to a target; speculative inlining puts the common callee body inside the caller behind a receiver guard." width="1080" height="470" /></a><figcaption>Both can specialize a call site, but they have different machine-code shapes and optimization opportunities.</figcaption></figure>

For a concrete consequence, imagine `CardPayment.process()` reads a final policy field and creates a tiny temporary request object. Inlining can expose the field value and temporary object to the caller's optimizer. Constant propagation might simplify a branch; escape analysis might eliminate the temporary allocation when valid. Whether HotSpot actually applies those transformations must be checked in the compiled code or controlled diagnostics, not inferred from the source program alone.

## When a new type appears

There are two distinct reasons an optimized path can need repair. First, an explicit receiver guard may fail because `UpiPayment` arrives at a site previously dominated by `CardPayment`. The compiled code may take a general fallback, resolve a call, or deoptimize, according to the chosen path. <mark>A receiver mismatch does not automatically mean deoptimization.</mark>

Second, an optimization can depend on a class hierarchy assumption, such as “there is currently no overriding implementation that invalidates this direct target.” HotSpot tracks such dependencies. Loading a new class may invalidate dependent compiled `nmethod`s, causing future calls or current frames to move to correct execution paths. This is different from a single call-site guard mismatch: the assumption about the available class hierarchy changed.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable receiver guard and dependency failure"><a href="/images/courses/jvm/receiver-guard-fallback.svg" aria-label="Open guard fallback and dependency failure"><img src="/images/courses/jvm/receiver-guard-fallback.svg" alt="A receiver guard match follows inlined CardPayment code; mismatch may use general dispatch or deopt; separately, a new class can invalidate an nmethod's class-hierarchy dependency." width="1080" height="500" /></a><figcaption>A local type mismatch and invalidation of a global hierarchy assumption have different triggers and recovery paths.</figcaption></figure>

If deoptimization is required, HotSpot must preserve the program's logical state. An `nmethod` contains metadata that relates compiled machine positions to Java methods, bytecode positions, and values needed to reconstruct logical frames. The VM can continue in the interpreter or another valid form with the correct local variables, operand stacks, and call chain. Optimized code can omit physical frames or scalar-replace objects; its recovery metadata must account for those elisions at deoptimization points. “The speculative path was wrong” never permits a wrong Java-visible result.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable deoptimization reconstruction"><a href="/images/courses/jvm/deoptimization-state-reconstruction.svg" aria-label="Open deoptimization reconstruction"><img src="/images/courses/jvm/deoptimization-state-reconstruction.svg" alt="An nmethod has machine code plus metadata describing logical Java frames and values; deoptimization reconstructs valid interpreter state when optimized execution cannot continue." width="1080" height="420" /></a><figcaption>Logical Java frames can be reconstructed even when compiled execution used a different physical frame shape.</figcaption></figure>

## Use evidence before changing the design

In production, start with latency and CPU evidence. JFR can show execution samples and compilation activity over the same interval; it does not record every call or prove an inline decision from one sample. For a **controlled lab**, JDK 25 HotSpot can print compilation and inlining decisions:

```bash
java -XX:+UnlockDiagnosticVMOptions -XX:+PrintCompilation -XX:+PrintInlining Demo
```

Interpret these as one run under one workload. Warmup, type mix, thresholds, compiler availability, and JVM flags can change the result. Avoid turning one lab printout into a universal performance rule.

The source map is similarly targeted:

```bash
rg -n 'class CompiledIC|CompiledIC::' src/hotspot/share/code/compiledIC.*
rg -n 'doCall|inline' src/hotspot/share/opto/doCall.cpp
rg -n 'resolve_virtual|ic_miss' src/hotspot/share/runtime/sharedRuntime.*
rg -n 'klassVtable|klassItable' src/hotspot/share/oops/klassVtable.*
```

Those files are touchpoints, not one complete call stack. Verify filenames and implementation in the same JDK 25 tag as the runtime being studied. The call you observe could be interpreted, compiled through C1, compiled through C2, inlined, or routed through a runtime stub.

## Connect the three lessons

Lesson 42's allocation produced a heap object whose receiver class can be inspected through HotSpot metadata. This lesson used that class to choose a method. Repeated calls produce type profiles that can guide C1 and C2. The resulting optimized code resides in an `nmethod` in the Code Cache, with enough metadata to remain correct if a class-hierarchy dependency or speculative assumption fails. The path is object → receiver type → dispatch → profile → compiled code → possible recovery, with different implementation details at each step.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable complete virtual call path"><a href="/images/courses/jvm/virtual-call-complete.svg" aria-label="Open complete virtual call path"><img src="/images/courses/jvm/virtual-call-complete.svg" alt="An allocated receiver supplies its Klass; interface dispatch selects process; observed types feed profiling; C2 may inline a guarded target into an nmethod with fallback and recovery metadata." width="1120" height="490" /></a><figcaption>Profiling and compilation are conditional. Correct dispatch remains required whether or not optimization occurs.</figcaption></figure>

<details class="lesson-check"><summary>After resolving Payment.process, can HotSpot always call CardPayment.process directly?</summary><p>No. Resolution identifies the symbolic method relationship. The actual receiver still matters. A compiler can optimize a common type only while preserving a correct route for other valid receivers.</p></details>

<details class="lesson-check"><summary>Does an inline-cache miss necessarily reconstruct interpreter frames?</summary><p>No. The miss can be handled through runtime resolution or general dispatch. Reconstruction occurs when deoptimization is needed for the particular compiled path or invalidated dependency.</p></details>

**Next:** [One G1 young GC cycle, end to end](/courses/jvm/g1-young-gc-end-to-end) follows allocated objects through root discovery, evacuation, and region reclamation.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on Daily JVM Byte #43 and its approved review, including the correction from `invokevirtual` to `invokeinterface` for the interface-typed example. OpenJDK 25.0.2 `javac` and `javap` confirmed `invokeinterface` for `PaymentDemo.submit`; diagrams and type-mix examples are conceptual, not measured call profiles. Invocation rules are from JVMS 25; inline caches, `MethodData`, C2 inlining and deoptimization describe OpenJDK HotSpot at tag `jdk-25+36`, with behavior dependent on tier, profile, workload, and build. The diagnostic command is for controlled local runs; no production recording is implied.</p><ul><li><a href="https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-6.html#jvms-6.5.invokeinterface">JVMS 25, invokeinterface</a></li><li><a href="https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-6.html#jvms-6.5.invokevirtual">JVMS 25, invokevirtual</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/code/compiledIC.cpp">OpenJDK JDK 25 compiled inline cache</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/opto/doCall.cpp">OpenJDK JDK 25 C2 call and inlining decisions</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/oops/klassVtable.cpp">OpenJDK JDK 25 vtable and itable support</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/runtime/sharedRuntime.cpp">OpenJDK JDK 25 shared runtime call support</a></li></ul></details>
