---
title: Stack frames, local variables, and the operand stack
summary: Follow a method's values through indexed local slots, its operand stack, and the calls that build a thread's logical JVM stack.
course: jvm
lessonSlug: stack-frames-operand-stack
module: Foundations
order: 120
sourceByte: byte-012
draft: false
prerequisites: [constant-pool-symbolic-references]
jdk: JVM execution model · JDK 25 / HotSpot boundaries
---

You can now read `invokevirtual #17` and explain how its constant-pool entry identifies a method. But the instruction still needs an actual receiver and arguments. Where are those values while the method executes?

[Lesson 11](/courses/jvm/constant-pool-symbolic-references) connected symbolic references to runtime entities. This lesson follows the working state that makes those entities useful. **Each method invocation gets its own JVM frame**, containing a local-variable array, an operand stack, and a reference to the runtime constant pool of the class containing the current method.

<figure>
<a href="/images/courses/jvm/jvm-frame-overview.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/jvm-frame-overview.svg" alt="An add invocation contains indexed locals, its own operand stack, and a runtime constant-pool reference." width="480" height="470" /></a>
<figcaption>The frame belongs to this invocation; the method definition can be reused. <a href="/images/courses/jvm/jvm-frame-overview.svg">Open full-size diagram</a>.</figcaption>
</figure>

The method definition can serve many invocations. Each invocation has separate execution state, even when recursion invokes the same method again before the first invocation finishes. A frame is discarded when its invocation completes, normally or exceptionally. These are JVM execution semantics; we will distinguish them from physical machine frames before the end of the lesson.

## Why the JVM is called a stack machine

Before following loads and stores, name the execution model they belong to. JVM bytecode describes a **stack machine**: most instructions receive inputs from a last-in, first-out operand stack and leave results on that same stack. The top value is the next one an instruction consumes.

This is different from an instruction that names all of its inputs directly. An imaginary register-style addition might say `add r1, r2`. JVM `iadd` does not name local slots or CPU registers. It means: take the top two integer values from the current frame's operand stack, add them, and push the result.

<figure>
<a href="/images/courses/jvm/stack-machine-model.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/stack-machine-model.svg" alt="Load instructions copy values from indexed local slots to the operand stack. Operations such as iadd consume values from the top and push their result for the next instruction." width="480" height="480" /></a>
<figcaption>Loads move values into the working stack; operations consume and produce values there; stores move results back to indexed locals. <a href="/images/courses/jvm/stack-machine-model.svg">Open full-size diagram</a>.</figcaption>
</figure>

The operand stack belongs to one method frame. It is not the thread's call stack, which contains the frames of nested method invocations. We will use “operand stack” and “call stack” explicitly whenever both are in view.

## Local variables are indexed JVM slots

We will use one instance method throughout the walkthrough:

```java
int add(int a, int b) {
    int result = a + b;
    return result;
}
```

For `add(10, 20)`, slot 0 holds the receiver reference, `this`. Slots 1 and 2 receive the integer arguments. Our compiled example uses slot 3 for the result once the addition has happened. Before that store, slot 3 does not contain an initialized result that bytecode is allowed to read.

<figure>
<a href="/images/courses/jvm/local-variable-slots.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/local-variable-slots.svg" alt="Instance add uses slots zero through three. Static add has no receiver, so arguments begin at zero." width="480" height="480" /></a>
<figcaption>The result slot is written later; source names here are explanatory. <a href="/images/courses/jvm/local-variable-slots.svg">Open full-size diagram</a>.</figcaption>
</figure>

`iload_1` reads an integer from slot 1; `istore_3` writes an integer into slot 3. `aload_0` loads a reference from slot 0, which is the receiver in this instance method. The instructions address indexes, not the names `a`, `b`, or `result`. Optional debugging metadata can associate source names with slots over particular bytecode ranges, but execution does not require those names.

A static method has no receiver and no `this`. Its parameters begin at slot 0. If our method were static with the same body, `a` and `b` would occupy slots 0 and 1, and this compilation could use slot 2 for `result`.

Do not give each source variable a permanent box in your mental model. A compiler can reuse a local slot for variables with non-overlapping lifetimes. Conversely, the historical two-slot convention for `long` and `double` **still applies in the current JVMS**: each occupies two consecutive local-variable slots. This is a logical storage convention, not a claim about two physical CPU registers or a fixed native frame layout. See [JVMS 2.6.1](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-2.html#jvms-2.6.1).

## Follow the operand stack through addition

The local-variable array keeps values available by index. The operand stack holds values that instructions consume and produce. Each frame has its own operand stack; it is not the thread's overall stack of method calls.

For the assignment `int result = a + b`, follow these four instructions. We write stacks from bottom to top, so the rightmost value is the top.

```text
iload_1
iload_2
iadd
istore_3
```

<figure>
<a href="/images/courses/jvm/operand-stack-addition.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/operand-stack-addition.svg" alt="The stack changes from empty to 10, then 10 and 20, then 30, then empty as 30 is stored into slot three." width="480" height="530" /></a>
<figcaption>Top is at the right. Loads copy values; the store consumes the result. <a href="/images/courses/jvm/operand-stack-addition.svg">Open full-size diagram</a>.</figcaption>
</figure>

1. **`iload_1`:** Copy 10 from local slot 1 onto the empty operand stack. The stack becomes `[10]`; slot 1 still contains 10.
2. **`iload_2`:** Copy 20 from slot 2 onto the stack. It becomes `[10, 20]`.
3. **`iadd`:** Pop the two integers, add them, and push 30. The stack becomes `[30]`. The original local slots are unchanged.
4. **`istore_3`:** Pop 30 and store it into slot 3. The stack is empty again, and slot 3 now contains the result.

`iadd` does not encode “add local slot 1 to local slot 2.” Its inputs come from the operand stack. That is why the two loads are necessary in this bytecode sequence. The final `return result` then uses `iload_3` to put 30 back on the stack and `ireturn` to return it.

This model extends beyond arithmetic. `iconst_1` pushes an integer constant. A `getfield` instruction consumes an object reference and pushes the selected field's value. Loads, stores, field accesses, and calls compose because their stack inputs and outputs fit together. The individual instruction contracts are defined in [JVMS 6](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-6.html).

## Symbols identify the member; operands supply the values

Suppose a caller evaluates `customer.getName()`. An illustrative sequence is:

```text
aload_1
invokevirtual #17
astore_2
```

The constant-pool entry at `#17` identifies the referenced method through its class, name, and descriptor. The receiver reference loaded from local slot 1 supplies the actual `customer` object. These answer different parts of the operation: **what member or type is involved, and what runtime values are involved?** As Lesson 11 explained, virtual method selection can also depend on that receiver's runtime class.

For our running example, an instance invocation consumes a receiver and two integer arguments from the caller's operand stack. Those values initialize the callee's local slots; the callee begins with an empty operand stack. Older values underneath the invocation operands remain in the caller's stack.

<figure>
<a href="/images/courses/jvm/invocation-operand-stack.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/invocation-operand-stack.svg" alt="Caller operands receiver 10 and 20 initialize callee locals. The callee returns 30 to the caller operand stack." width="480" height="475" /></a>
<figcaption>Receiver and arguments become callee locals; a result returns to the caller stack. <a href="/images/courses/jvm/invocation-operand-stack.svg">Open full-size diagram</a>.</figcaption>
</figure>

When `add` executes `ireturn`, its result is transferred to the invoking frame's operand stack and the caller resumes. A void return supplies no result. If an exception escapes the invocation, completion is abrupt rather than a normal value return. The JVM looks for an applicable handler, unwinding frames as necessary; a selected handler begins with the exception reference on its operand stack. See [JVMS invocation and return instructions](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-6.html#jvms-6.5.invokevirtual).

## Why use a stack machine for bytecode?

Because the operands are usually implicit, bytecode can describe the same logical work without choosing the physical registers of a particular CPU. Instructions such as `iadd` are compact, and the verifier can reason about types and stack shapes along control-flow paths.

<figure>
<a href="/images/courses/jvm/stack-vs-register-ir.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/stack-vs-register-ir.svg" alt="Portable stack bytecode can be compiled to native register instructions, with optimization between the representations." width="480" height="475" /></a>
<figcaption>The native instruction is illustrative; actual code depends on optimization. <a href="/images/courses/jvm/stack-vs-register-ir.svg">Open full-size diagram</a>.</figcaption>
</figure>

A stack machine is one way to build a portable intermediate representation; register-based virtual machines can also be portable. Portability does not require a stack. The useful distinction here is that JVM bytecode is not the final native instruction stream.

HotSpot can interpret bytecode, collect execution profiles, and compile hot code into machine instructions for the current processor. The JIT may keep values in registers, fold operations into constants, or remove computations entirely. A sequence of bytecode loads and stores therefore does not imply the same number of hardware memory accesses. The register instruction in the diagram is pseudocode, not a prediction of a particular CPU's disassembly.

## Inspect max_locals and max_stack yourself

A method with bytecode has a class-file `Code` attribute that declares `max_locals` and `max_stack`. For our instance `add` method, four local slots are sufficient, and the maximum operand-stack depth is two units, reached just after `iload_2`.

<figure>
<a href="/images/courses/jvm/max-stack-locals.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/max-stack-locals.svg" alt="Four local slots and a peak of two operand stack depth units suffice for the instance add method." width="480" height="490" /></a>
<figcaption>Code declares logical capacities, not physical frame bytes. <a href="/images/courses/jvm/max-stack-locals.svg">Open full-size diagram</a>.</figcaption>
</figure>

These are capacities for the bytecode execution model, not the current occupancy and not native frame sizes in bytes. An operand-stack `long` or `double` contributes two depth units, while an `int` or reference contributes one. The declaration must cover every valid execution path, not only the path used in a single run. Verification checks the instruction types and stack behavior against class-file constraints. See the [Code attribute](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-4.html#jvms-4.7.3) and [bytecode verification](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-4.html#jvms-4.10).

To see the declaration, save this small standalone example as `FrameDemo.java` in a scratch directory:

```java
public class FrameDemo {
    int add(int a, int b) {
        int result = a + b;
        return result;
    }

    public static void main(
            String[] args) {
        int sum = new FrameDemo()
            .add(10, 20);
        System.out.println(sum);
    }
}
```

Compile, run, and inspect it:

```sh
javac -g FrameDemo.java
java FrameDemo
javap -c -v FrameDemo
```

Verified with Homebrew OpenJDK HotSpot 25.0.2: the program prints `30`, and the relevant disassembly is:

```text
int add(int, int);
  descriptor: (II)I
  flags: (0x0000)
  Code:
    stack=2, locals=4, args_size=3
       0: iload_1
       1: iload_2
       2: iadd
       3: istore_3
       4: iload_3
       5: ireturn
```

`javap` displays `max_stack` as `stack` and `max_locals` as `locals`. Here `args_size=3` accounts for the receiver plus two one-slot arguments. It does not mean there are three parameters in the Java declaration. The optional local-variable table supplies familiar names; the bytecode itself still uses indexes.

## Nested calls build the thread's logical stack

Imagine `a()` calls `b()`, and `b()` calls `c()`. While `c()` runs, the caller frames remain suspended. Each retains its own locals and operand stack so its execution can resume after its callee returns.

<figure>
<a href="/images/courses/jvm/frame-call-stack.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/frame-call-stack.svg" alt="The thread stack contains c b and a frames. Each contains its own locals and operand stack." width="480" height="480" /></a>
<figcaption>c is current. After c returns, b resumes with its own execution state. <a href="/images/courses/jvm/frame-call-stack.svg">Open full-size diagram</a>.</figcaption>
</figure>

There are two nested structures: the thread's call stack contains frames, and each frame contains an operand stack. Pushing an integer onto an operand stack does not invoke a method or create a frame. Calling a method creates another logical frame rather than giving the caller a larger operand stack.

When `c()` completes, its frame disappears and `b()` becomes current again. A stack trace records an invocation chain at a particular point; it is not a history of every method that has run. Returned calls generally no longer appear in that chain.

## Private execution state can reference shared objects

Two threads can execute the same `process(customer)` method simultaneously. Their local slots and operand stacks are separate. However, their references can point to the very same heap object.

<figure>
<a href="/images/courses/jvm/thread-frames-shared-heap.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/thread-frames-shared-heap.svg" alt="Thread A and Thread B have separate process frames whose local references point to one heap Customer." width="480" height="495" /></a>
<figcaption>Copying a reference does not copy the object. <a href="/images/courses/jvm/thread-frames-shared-heap.svg">Open full-size diagram</a>.</figcaption>
</figure>

Reassigning one thread's local reference does not reassign the other thread's local reference. Mutating a field of the shared object is different: both references lead to that object, so synchronization and visibility rules matter. Thread-confined frame state does not make the referenced object thread-confined.

## Frames connect execution to GC roots

In the [GC-root lesson](/courses/jvm/gc-roots-reachability), we followed references from roots into the object graph. A live reference held in a frame can be one of those starting points. The reference may occur in locals or temporary operand state; compiled execution may keep it in a register or a stack location.

<figure>
<a href="/images/courses/jvm/frame-gc-root.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/frame-gc-root.svg" alt="Metadata distinguishes a live customer reference from an integer; the reference leads to a heap Customer and its reachable Address." width="480" height="485" /></a>
<figcaption>GC needs reference locations, not every word that happens to be in a frame. <a href="/images/courses/jvm/frame-gc-root.svg">Open full-size diagram</a>.</figcaption>
</figure>

HotSpot must distinguish reference locations from integers and other machine state when scanning roots. Interpreted execution has metadata describing references in its frame representation. Compiled execution uses JIT-generated metadata, including OopMaps at relevant execution points, to locate object references in registers and stack locations.

This is not a promise that a Java variable keeps its object alive until the closing brace of its source scope. Liveness and optimized execution matter; an object with no other retaining path can become collectible after its last relevant use. Likewise, discarding a frame does not immediately collect every object it once referenced. Other roots may still retain them.

[HotSpot's OopMap definitions](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/compiler/oopMap.hpp) connect machine locations with reference information. Later lessons on safepoints and OopMaps will explain when and how that information is consumed. For now, connect the two requirements: execute the method correctly, and keep the collector informed about its live references.

## Logical JVM frames and compiled machine frames

The frame model tells us what bytecode means. It does not require HotSpot to allocate a literal local array and manipulate a literal operand array for every instruction after JIT compilation.

<figure>
<a href="/images/courses/jvm/logical-vs-compiled-frame.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/logical-vs-compiled-frame.svg" alt="Logical frames a b and c can become one compiled frame with registers and spill slots after inlining. Metadata preserves logical views." width="480" height="500" /></a>
<figcaption>Several logical calls may share one compiled machine frame. <a href="/images/courses/jvm/logical-vs-compiled-frame.svg">Open full-size diagram</a>.</figcaption>
</figure>

HotSpot interpreter frames map closely to the bytecode model. Compiled frames have a different physical layout: values can reside in registers or spill slots, and some values no longer need storage. Inlining can put several logical Java invocations inside one compiled machine frame. There is no general one-to-one mapping from Java calls to native stack frames.

The runtime retains metadata needed for tasks such as stack walking and deoptimization, which can reconstruct logical Java state when optimized execution must fall back. This continues the distinction from [escape analysis and scalar replacement](/courses/jvm/escape-analysis-scalar-replacement): a semantic object or local value need not have the naive physical representation drawn in a source-level diagram. OpenJDK's [compiled-frame walking implementation](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/runtime/vframe.cpp) exposes these logical views.

## Recognize frames in production evidence

Deep recursion keeps creating nested invocations before earlier ones return. If execution requires more stack than is permitted, the JVM throws `StackOverflowError`. That is different from filling the per-frame operand stack with too many values in valid bytecode.

<figure>
<a href="/images/courses/jvm/stack-overflow.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/stack-overflow.svg" alt="Repeated recursive invocations accumulate frames until required stack exceeds what is permitted, causing StackOverflowError." width="480" height="500" /></a>
<figcaption>This concerns nested invocations, not operand-stack overflow in valid bytecode. <a href="/images/courses/jvm/stack-overflow.svg">Open full-size diagram</a>.</figcaption>
</figure>

A missing recursion base case is one cause; a legitimate but excessively deep traversal is another. Start by examining the repeated call pattern and the input depth. Increasing stack size can change the limit but does not repair an unbounded recursion. The depth at failure is not a portable constant because physical frame sizes and runtime configuration differ. We do not deliberately exhaust a stack in the example.

Thread dumps show where threads are executing or waiting. Exception traces show the chain associated with the captured failure. JFR events and profilers such as async-profiler can associate observations with stack traces, helping identify costly or frequently sampled call paths. These views expose method chains, not a complete dump of every local slot or operand value. Sampling, inlining reconstruction, configured depth, and missing debugging information affect what you see.

Platform-thread stacks also contribute to aggregate memory use. Virtual threads change the storage and scheduling arrangement: their stacks can be represented in heap stack chunks while unmounted. Keep the logical per-thread frame model without assuming one permanently reserved native stack per virtual thread. We will return to that distinction in the threading material; [JEP 444](https://openjdk.org/jeps/444) describes the HotSpot implementation.

## Check your reasoning

Pause just after `iadd`, before `istore_3`, in `add(10, 20)`. Where is 30? Have slots 1 and 2 changed? Has another method frame been created?

<details class="lesson-check">
<summary>Pause here, then check your reasoning</summary>
<p>30 is on the current frame's operand stack. Slots 1 and 2 still hold 10 and 20 because the loads copied their values. Slot 3 has not received the result yet. No new frame was created: these instructions all execute within the same invocation.</p>
</details>

Now two threads hold references to the same customer in separate frames. Does that make field updates private? And if a profiler reconstructs three inlined Java calls, must there be three physical machine frames?

<details class="lesson-check">
<summary>Check the ownership and representation boundaries</summary>
<p>No to both. Separate local references can point to one shared heap object. Logical Java calls also need not map one-to-one to physical frames after compilation; inlining can combine them while runtime metadata preserves the logical view.</p>
</details>

## From frame state to the HotSpot interpreter

We can now connect the class file to execution: bytecode specifies operations, the runtime constant pool connects symbolic dependencies, and each invocation supplies frame state for actual values. Instructions transform that state until a call transfers control or a return completes the invocation.

<figure>
<a href="/images/courses/jvm/frame-execution-complete.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/frame-execution-complete.svg" alt="Class bytecode and runtime constant-pool information feed an invocation frame. Instructions change its state until a call or completion." width="480" height="475" /></a>
<figcaption>Next: how the HotSpot interpreter dispatches those instructions. <a href="/images/courses/jvm/frame-execution-complete.svg">Open full-size diagram</a>.</figcaption>
</figure>

The [HotSpot interpreter lesson](/courses/jvm/hotspot-interpreter) follows how HotSpot dispatches bytecodes, operates on interpreted frame state, and collects profiling information that helps the JIT choose and optimize hot code.

<details class="lesson-sources">
<summary>Sources and implementation boundaries</summary>
<p>Adapted from Daily JVM Byte #12 and the available reviewed draft. Diagrams describe logical state, not measured native layouts. The small javap exercise was executed on Homebrew OpenJDK HotSpot 25.0.2. Historical two-slot wording is clarified as a continuing specification rule; max_stack counts depth units, not necessarily the number of values.</p>
<ul>
<li><a href="https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-2.html#jvms-2.6">JVMS 2.6: frames, locals, operand stacks, and completion</a></li>
<li><a href="https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-4.html#jvms-4.7.3">JVMS 4.7.3: Code attribute capacities</a></li>
<li><a href="https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-6.html">JVMS 6: instruction contracts</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/javap.html">JDK 25 javap</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/23/troubleshoot/diagnostic-tools.html">JFR events and stack traces</a></li>
</ul>
</details>
