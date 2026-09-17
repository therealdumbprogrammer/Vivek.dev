---
title: Escape analysis and scalar replacement
summary: See how HotSpot can prove that some Java objects need no heap allocation, preserve their fields as scalar values, and remove unobservable locking.
course: jvm
lessonSlug: escape-analysis-scalar-replacement
module: Foundations
order: 90
sourceByte: byte-009
draft: false
prerequisites: [tlabs-allocation]
jdk: HotSpot · JDK 25 JIT optimization foundations
---

You create a short-lived `Point`, read its fields, and immediately discard it. [Lesson 8](/courses/jvm/tlabs-allocation) showed that a real allocation is often cheap because HotSpot can advance a pointer inside a TLAB. But must the optimized program allocate this object at all?

```java
int distance() {
    Point p = new Point(10, 20);
    return p.x() + p.y();
}
```

Java source defines the behavior the program must preserve. It does not require every source-level object to survive as a physical heap object in optimized machine code.

<figure>
<a href="/images/courses/jvm/escape-analysis-overview.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/escape-analysis-overview.svg" alt="A source-level new expression reaches JIT analysis. One path creates a real heap object while another keeps only the values required by optimized code." width="480" height="420" /></a>
<figcaption>A source-level allocation may become a real heap object or disappear before the allocation path is needed. <a href="/images/courses/jvm/escape-analysis-overview.svg">Open full-size diagram</a>.</figcaption>
</figure>

The analysis that creates this opportunity is **escape analysis**. HotSpot asks how the object can be observed within and beyond the compilation scope. If no external observer needs the `Point` or its identity, <mark>the optimizer may preserve only the values the computation uses</mark>.

## Scalar replacement preserves values without the object

At source level, `Point` has an identity, header, and fields. For this computation, the useful state is only `x = 10` and `y = 20`. **Scalar replacement** decomposes the aggregate into those separate scalar values.

<figure>
<a href="/images/courses/jvm/scalar-replacement.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/scalar-replacement.svg" alt="A Point object with a header, x, and y is decomposed into independent x and y values; the aggregate allocation is removed." width="480" height="420" /></a>
<figcaption>Scalar replacement keeps the program state that matters while removing the aggregate object representation when possible. <a href="/images/courses/jvm/scalar-replacement.svg">Open full-size diagram</a>.</figcaption>
</figure>

Conceptually, the compiler can move from:

```text
allocate Point
write x and y
read x and y
return x + y
```

to:

```text
x = 10
y = 20
return x + y
```

Those values might live in registers, stack slots, or compiler intermediate values. Further optimization may reduce the whole example to `return 30`.

Escape analysis and scalar replacement are distinct. Escape analysis supplies facts about observability. Scalar replacement is an optimization that may use those facts. Proving sufficient confinement creates an opportunity; it does not guarantee that every `NoEscape` allocation disappears. Control flow, failed inlining, object identity use, compiler limits, and interactions with other phases can prevent the transformation.

## Escape states describe what the compiler can prove

HotSpot uses three useful escape-state categories. They are compiler concepts, not Java-language annotations or promises.

<figure>
<a href="/images/courses/jvm/escape-states.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/escape-states.svg" alt="NoEscape remains confined, ArgEscape flows through a call without global exposure, and GlobalEscape becomes reachable from outside the analyzed scope." width="480" height="455" /></a>
<figcaption>The states summarize increasing observability. They do not say that every confined object will be scalar-replaced. <a href="/images/courses/jvm/escape-states.svg">Open full-size diagram</a>.</figcaption>
</figure>

### NoEscape: the object stays inside the analyzed work

Our running example creates and consumes the `Point` locally:

```java
int sum() {
    Point p = new Point(10, 20);
    return p.x() + p.y();
}
```

If HotSpot sees every use and no operation needs the object's identity, its conceptual optimized form can be:

```java
int x = 10;
int y = 20;
return x + y;
```

The second block is an illustration of the compiler's view, not Java code produced by the JIT. `NoEscape` makes the allocation a scalar-replacement candidate; it does not guarantee that C2 will remove it.

### ArgEscape: the reference passes through a call

Now pass the same temporary to a helper:

```java
int sum() {
    Point p = new Point(10, 20);
    return readX(p);
}

int readX(Point point) {
    return point.x();
}
```

The reference crosses a method boundary as an argument, but `readX` does not store or return it. If HotSpot can inspect the call, especially by inlining it, the larger compiler view becomes:

```java
int sum() {
    Point p = new Point(10, 20);
    return p.x();
}
```

That may expose a `NoEscape` shape and another scalar-replacement opportunity. If the helper cannot be analyzed or inlined, HotSpot may have to keep the allocation. `ArgEscape` says where the reference flows; it does not promise either outcome.

### GlobalEscape: another scope can keep the reference

Finally, add a write to static state:

```java
static Point current;

int publish() {
    Point p = new Point(10, 20);
    current = p;
    return p.x();
}
```

The externally visible behavior now includes:

```text
allocate Point
store reference in static current
Point remains available
after publish() returns
```

Replacing the object with a local `x` value would lose the object stored in `current`, so this straightforward allocation cannot disappear. Storing into an already escaping object can create the same effect.

These categories are conservative analysis results. When the compiler cannot prove that an object stays confined, it preserves the full Java object semantics.

## Inlining expands the scope of escape analysis

Returning an object from a Java method does not always mean it escapes the optimized compilation. Consider a factory call:

```java
Point createPoint() {
    return new Point(10, 20);
}

int calculate() {
    Point p = createPoint();
    return p.x();
}
```

Analyzed in isolation, `createPoint()` returns the object. If the JIT inlines that method into `calculate()`, allocation and consumption become visible in one larger scope.

<figure>
<a href="/images/courses/jvm/inlining-escape-analysis.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/inlining-escape-analysis.svg" alt="Before inlining, a factory returns a Point across a method boundary. After inlining, allocation and field use appear inside one optimization scope." width="480" height="440" /></a>
<figcaption>Inlining can reveal that a returned temporary has no observer outside the compiled operation. <a href="/images/courses/jvm/inlining-escape-analysis.svg">Open full-size diagram</a>.</figcaption>
</figure>

Inlining therefore improves the opportunity for escape analysis by giving it more code to inspect. It still does not guarantee scalar replacement: the compiler must support the resulting object and control-flow shape.

## Scalar replacement does not move the object to the stack

It is tempting to picture escape analysis like this:

```text
the Point does not escape
        ↓
put the Point on the stack
```

But HotSpot usually takes a different route. If scalar replacement succeeds, there is no `Point` object to move. The compiler keeps only the values that the calculation needs.

Start with the source:

```java
Point p = new Point(10, 20);
return p.x() + p.y();
```

The optimized computation may be closer to:

```java
int x = 10;
int y = 20;
return x + y;
```

<aside class="lesson-callout" data-kind="misconception" aria-label="Common misconception">
<p class="callout-label">Common misconception</p>
<p>The object header, the reference <code>p</code>, and the <code>Point</code> container are absent. This is allocation <strong>elimination</strong>, rather than moving an intact object to another memory area.</p>
</aside>

<figure>
<a href="/images/courses/jvm/not-stack-allocation.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/not-stack-allocation.svg" alt="The misleading model moves an intact object from heap to stack. The HotSpot model eliminates the aggregate and retains only required scalar values." width="480" height="420" /></a>
<figcaption>Think object-to-values, rather than heap-object-to-stack-object. <a href="/images/courses/jvm/not-stack-allocation.svg">Open full-size diagram</a>.</figcaption>
</figure>

The scalar values `x` and `y` may later occupy CPU registers or stack slots. That only describes where individual machine-code values are stored. It does not mean a complete `Point`, with an object header and identity, was allocated on the stack.

## A private lock may become unnecessary

Escape analysis can also enable **lock elimination**. Suppose a method creates a fresh lock and synchronizes on it:

```java
void calculate() {
    Object lock = new Object();
    synchronized (lock) {
        doWork();
    }
}
```

If HotSpot proves that no other thread can observe `lock`, no other thread can contend on its monitor. The monitor enter and exit are then unobservable coordination, so the compiler may remove them while preserving the work.

<figure>
<a href="/images/courses/jvm/lock-elimination.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/lock-elimination.svg" alt="A private lock object and its monitor enter and exit operations are removed when no other thread can observe the monitor." width="480" height="440" /></a>
<figcaption>When contention is provably impossible, synchronization on the private object may add no observable behavior. <a href="/images/courses/jvm/lock-elimination.svg">Open full-size diagram</a>.</figcaption>
</figure>

This is a compiler optimization, not a relaxation of Java synchronization rules. If another thread could observe the monitor, the required ordering and mutual exclusion must remain.

## Deoptimization can materialize Java-level state

An eliminated object raises a natural question: what happens if HotSpot later invalidates an assumption and deoptimizes the compiled code?

Optimized code retains metadata describing the Java-level state needed at deoptimization points. If execution returns to a less optimized form, HotSpot can reconstruct, or **materialize**, a scalar-replaced object from its saved field values when that object is required.

<figure>
<a href="/images/courses/jvm/scalar-materialization.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/scalar-materialization.svg" alt="Optimized execution stores x and y without a Point object. During deoptimization, HotSpot reconstructs a Point when Java-level state requires it." width="480" height="440" /></a>
<figcaption>Eliminating the runtime representation does not discard the information needed to preserve Java behavior. <a href="/images/courses/jvm/scalar-materialization.svg">Open full-size diagram</a>.</figcaption>
</figure>

This is only the intuition; a later JIT lesson can follow speculative assumptions and deoptimization in detail. The useful principle here is that optimized representation may differ sharply from source representation while observable semantics stay intact.

## Source-level `new` is not an allocation counter

Consider a loop containing one million `new Point(...)` expressions. The source describes one million object constructions, but some optimized executions may need fewer real heap allocations.

```java
int count = 1_000_000;
int i = 0;
while (i < count) {
    Point p = new Point(
        i, i + 1
    );
    result +=
        p.x() + p.y();
    i++;
}
```

The actual outcome depends on compilation and runtime context. Before warmup, interpreted or less optimized code may allocate. Later compiled code may eliminate an allocation. A profiler observing real allocation activity therefore reports runtime behavior, not a count of source-level `new` expressions.

This also makes allocation microbenchmarks easy to misread. If a hand-written benchmark creates a value whose result is unused, dead-code elimination may remove the intended work. JMH provides warmup, measurement structure, state controls, and mechanisms such as consuming results, but using JMH alone does not make a benchmark valid. The benchmark must still ensure that it measures the behavior in question and inspect generated or profiled evidence when the distinction matters.

## Write clear code, then measure the optimized program

Escape-analysis outcomes can change with inlining, call structure, polymorphism, control flow, identity-sensitive operations, compiler visibility, and optimization budgets. There is no dependable source-level recipe that forces scalar replacement.

Write the clearest correct code first. When allocation or locking appears important in production, profile the warmed-up workload, compare allocation and GC evidence, and change application structure only when measurements justify it. Manually avoiding every temporary object can make code harder to maintain while targeting an optimization the compiler may already perform.

## Check your reasoning

Suppose C2 fully analyzes this method, proves that `Point` does not escape, and determines that its identity is irrelevant:

```java
int value() {
    Point p = new Point(10, 20);
    return p.x();
}
```

Does HotSpot need to create an intact `Point` on the stack?

<details class="lesson-check">
<summary>Pause here, then check your reasoning</summary>
<p>No. Scalar replacement can eliminate the aggregate allocation and retain only the values required by the computation. Those values may occupy registers or stack slots, or disappear through further optimization. NoEscape creates this opportunity; it does not promise that C2 will always perform the transformation.</p>
</details>

Now change the method so it stores `p` in a static field. What changes?

<details class="lesson-check">
<summary>Check the observability boundary</summary>
<p>The reference becomes globally observable, so HotSpot must preserve the Java object semantics. That blocks this straightforward scalar-replacement case. A real allocation can still take the cheap TLAB path when it fits; escape analysis and TLAB allocation answer different stages of the decision.</p>
</details>

## Put the allocation decision together

The allocation story now begins before the TLAB fast path. The JIT first decides whether a separately allocated object is required. If scalar replacement is possible, the values continue without a normal heap allocation. Otherwise, ordinary allocation proceeds through a TLAB when suitable, or through collector-specific outside-TLAB machinery. The resulting heap object enters the collector's lifecycle and may later contribute to GC work.

<figure>
<a href="/images/courses/jvm/allocation-optimization-tree.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/allocation-optimization-tree.svg" alt="A source-level new reaches JIT analysis. Eliminated allocations become scalar values; real allocations use a TLAB when suitable or collector-specific outside-TLAB machinery, then enter heap and GC lifecycle." width="480" height="560" /></a>
<figcaption>Escape analysis can remove the need for allocation; TLABs optimize the common path after a real allocation is still required. <a href="/images/courses/jvm/allocation-optimization-tree.svg">Open full-size diagram</a>.</figcaption>
</figure>

The [next lesson](/courses/jvm/class-loading-lifecycle) follows the class-loading lifecycle, from class-file bytes through loading, linking, verification, preparation, resolution, and initialization.

<details class="lesson-sources">
<summary>Sources and implementation boundaries</summary>
<p>Adapted from Daily JVM Byte #9 and its reviewed draft. Transformations and diagrams are conceptual rather than measured output. Claims describe HotSpot C2 behavior and limitations, not requirements imposed on every JVM implementation.</p>
<ul>
<li><a href="https://docs.oracle.com/en/java/javase/25/vm/java-hotspot-virtual-machine-performance-enhancements.html">Oracle JDK 25: escape states, scalar replacement, no general stack allocation, lock elimination, and inlining example</a></li>
<li><a href="https://cr.openjdk.org/~cslucas/escape-analysis/EscapeAnalysis.html">OpenJDK: HotSpot escape-analysis and scalar-replacement limitations</a></li>
<li><a href="https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/runtime/deoptimization.cpp">OpenJDK JDK 25: reconstructing scalar-replaced objects during deoptimization</a></li>
<li><a href="https://github.com/openjdk/jmh/tree/master/jmh-samples/src/main/java/org/openjdk/jmh/samples">OpenJDK JMH samples: dead-code, blackhole, state, and compiler-control examples</a></li>
</ul>
</details>
