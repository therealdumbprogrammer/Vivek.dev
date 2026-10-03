---
title: Thread stacks and stack walking — how HotSpot understands executing code
summary: Connect native stack frames to Java calls through OopMaps, safepoints and deoptimization metadata, then distinguish stack activity from stack memory cost.
course: jvm
lessonSlug: thread-stacks-stack-walking
module: Native Memory
order: 340
sourceByte: byte-034
draft: true
prerequisites: [code-cache-internals]
jdk: JDK 25 · HotSpot platform-thread stacks
---

A thread dump reports `Controller.handle → Service.process → Repository.find`, but C2 may have inlined the last two methods into one compiled body. Where did those Java calls go? [Lesson 33](/courses/jvm/code-cache-internals) gave us the key: compiled machine code arrives with metadata that lets HotSpot recover its Java meaning.

This chapter follows a **platform thread**, which runs on an operating-system thread and has a native stack. Its stack can contain compiled Java frames, interpreter frames, JVM runtime frames, and transitions into native code. Each frame is an execution record, but its physical form depends on the kind of code running. [Lesson 12](/courses/jvm/stack-frames-operand-stack) described the Java frame model; [Lesson 19](/courses/jvm/platform-vs-virtual-threads) distinguishes the platform-thread stack from a virtual thread's stack chunks.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable platform-thread native stack"><a href="/images/courses/jvm/platform-thread-native-stack.svg" aria-label="Open platform-thread native stack"><img src="/images/courses/jvm/platform-thread-native-stack.svg" alt="A platform thread uses a native stack containing a mix of compiled Java, interpreted Java, JVM runtime and native-transition frames." width="900" height="450" /></a><figcaption>One native stack can cross several execution modes.</figcaption></figure>

## Execution changes the physical frame

The JVM specification describes a method invocation with local variables and an operand stack. An interpreter frame corresponds relatively closely to that model: HotSpot tracks the method, current bytecode position, locals, operand state and return information while interpreting bytecodes.

Compiled execution is different. Suppose `int y = order.total * 2;` becomes machine instructions. The object reference may be held in a CPU register, the field value may be in another register or a spill slot, and `y` may never exist as a separate stored value because multiplication was folded into later work. Calling the result a neat physical copy of the Java locals and operand stack would give the wrong prediction.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable interpreter and compiled frame comparison"><a href="/images/courses/jvm/interpreted-vs-compiled-frame.svg" aria-label="Open interpreter and compiled frame comparison"><img src="/images/courses/jvm/interpreted-vs-compiled-frame.svg" alt="An interpreter frame tracks locals and operand-stack state near the bytecode model; a compiled frame uses registers, spill slots and optimized-away values plus metadata." width="900" height="450" /></a><figcaption>The two frames support the same Java behavior through different physical representations.</figcaption></figure>

<mark>A compiled frame is not a literal JVM local-variable table and operand stack.</mark> HotSpot needs extra information to interpret its registers, spill slots and optimized-away state.

## Precise GC needs reference locations

Imagine a compiled frame with `RAX` holding a Java object reference, `RBX` holding an integer, stack slot 24 holding another object reference, and stack slot 32 holding a `long`. Raw bits alone do not identify which values the garbage collector must treat as roots. A number can look like an address; an actual object reference can sit in a register rather than an obvious stack location.

HotSpot's compiler supplies **OopMaps**: metadata describing where managed object references (HotSpot's *oops*) live at particular recoverable compiled-code states. Conceptually, one map might mark `RAX` and slot 24 as references, while `RBX` and slot 32 are not. The exact register and slot names below are illustrative. [OpenJDK OopMap implementation](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/compiler/oopMap.hpp)

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable compiled-frame OopMap"><a href="/images/courses/jvm/compiled-frame-oopmap.svg" aria-label="Open compiled-frame OopMap"><img src="/images/courses/jvm/compiled-frame-oopmap.svg" alt="At one recoverable compiled state, an OopMap marks RAX and stack slot 24 as object references and RBX and slot 32 as non-reference values." width="900" height="450" /></a><figcaption>An OopMap supplies the type information that raw machine words cannot.</figcaption></figure>

At a suitable safepoint state, HotSpot identifies the compiled location, finds its map, and scans the marked references as roots. This is **precise** stack-root discovery: the collector uses known locations instead of guessing from pointer-looking bit patterns. [HotSpot safepoint notes](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/runtime/safepoint.hpp)

<aside class="lesson-callout" data-kind="key-idea" aria-label="Key idea"><p class="callout-label">Key idea</p><p>OopMaps connect compiled machine locations to managed references. A raw value that resembles a pointer is not enough evidence for precise GC.</p></aside>

## A safepoint is a walkable state

HotSpot does not maintain equally complete GC and deoptimization information for every arbitrary machine instruction. Compiled code has particular states where the runtime can reason precisely about managed execution; safepoint polling and metadata help coordinate arrival at such states. This builds on [Lesson 17](/courses/jvm/safepoints).

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable safepoint and OopMap relationship"><a href="/images/courses/jvm/stack-safepoint-oopmap.svg" aria-label="Open safepoint and OopMap relationship"><img src="/images/courses/jvm/stack-safepoint-oopmap.svg" alt="Compiled instructions lead to selected safepoint states with associated OopMaps, where HotSpot can walk the frame and find managed roots." width="900" height="450" /></a><figcaption>A well-described execution state lets HotSpot connect the program counter to roots and Java frames.</figcaption></figure>

<aside class="lesson-callout" data-kind="important" aria-label="Important"><p class="callout-label">Important</p><p>A safepoint is more than a location where a thread may stop. It is a state in which HotSpot can safely understand and walk managed execution. This does not mean an operating system can never interrupt the CPU between safepoints.</p></aside>

## One physical frame can describe several Java calls

Now return to `Controller.handle → Service.process → Repository.find`. If C2 inlines `process` and `find`, one compiled physical frame may represent all three Java method activations. HotSpot's scope/debug metadata describes the **logical** or **virtual frames** (often called *vframes*) represented by that machine frame. The names and bytecode positions can be reported even though separate machine call frames were not created for each inlined method. [OpenJDK virtual frame definition](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/runtime/vframe.hpp)

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable physical versus logical frames"><a href="/images/courses/jvm/physical-vs-logical-frames.svg" aria-label="Open physical versus logical frames"><img src="/images/courses/jvm/physical-vs-logical-frames.svg" alt="One physical compiled frame can map through inlining scope metadata to three logical Java frames for Controller, Service and Repository methods." width="900" height="450" /></a><figcaption>Inlining changes machine calls; metadata preserves the Java call story.</figcaption></figure>

<mark>One physical compiled frame can correspond to several logical Java frames.</mark> Thus a Java stack trace is a reconstruction of managed calls, not a direct list of one native frame per Java source method.

To walk a mixed stack, HotSpot starts at the current frame, identifies whether it is interpreted, compiled, runtime or native-transition state, uses the relevant frame rules and metadata to find the sender, then repeats. The same architectural need to translate machine execution back to Java meaning appears in stack traces, profilers, precise GC root scanning, exception handling, JFR, debuggers and deoptimization. Their concrete paths and timing differ.

## Deoptimization must rebuild executable state

Suppose optimized code assumed one receiver type and that assumption fails. HotSpot may need to resume in the interpreter. Scope data records the logical methods and bytecode positions; value descriptions let the runtime recover locals and operand values from registers, stack slots, constants or other descriptions. Objects removed through scalar replacement may need to be materialized, and monitor state may need to be restored into an interpreter-compatible form. [OpenJDK deoptimization implementation](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/runtime/deoptimization.cpp)

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable deoptimization frame reconstruction"><a href="/images/courses/jvm/deoptimization-frame-reconstruction.svg" aria-label="Open deoptimization frame reconstruction"><img src="/images/courses/jvm/deoptimization-frame-reconstruction.svg" alt="A single optimized compiled frame and its scope data expand into logical Controller, Service and Repository interpreter frames, with values and any eliminated objects reconstructed." width="900" height="450" /></a><figcaption>Recovery uses metadata to build a valid interpreter view from optimized machine state.</figcaption></figure>

<mark>Compiler-generated metadata lets HotSpot recover managed Java meaning from machine execution state.</mark> The `nmethod` from Lesson 33 joins machine code with OopMaps, scope/debug descriptions and deoptimization information; neither the instructions nor the stack bytes alone tell the full story.

## Diagnose stack cost and thread activity separately

`-Xss` influences the native stack size of a platform thread. A larger stack gives more call-depth headroom and can require more virtual address space per platform thread. A smaller stack can lower that potential footprint but reaches `StackOverflowError` sooner with deep recursion or stack-heavy native work. The actual depth depends on frame sizes and platform details. Do not calculate `thread count × Xss` and call it RSS: reserved, committed and resident stack pages differ.

If process memory grows with platform-thread count, NMT's `Thread` category can show HotSpot-tracked stack reservation and commitment when tracking was enabled at startup. `jcmd <pid> Thread.print` answers what the threads are doing and where they are executing. Compare those views with OS process memory, because NMT is not a complete RSS meter. [JDK 25 `jcmd`](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html), [JDK 25 NMT guide](https://docs.oracle.com/en/java/javase/25/vm/java-virtual-machine-guide.pdf)

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable thread-stack diagnostics"><a href="/images/courses/jvm/thread-stack-diagnostics.svg" aria-label="Open thread-stack diagnostics"><img src="/images/courses/jvm/thread-stack-diagnostics.svg" alt="NMT Thread accounting answers stack memory cost, Thread.print answers thread count and activity, and OS metrics answer overall process residency." width="900" height="450" /></a><figcaption>Memory accounting and a thread dump answer complementary questions.</figcaption></figure>

<aside class="lesson-callout" data-kind="production" aria-label="Production note"><p class="callout-label">Production note</p><p>Use NMT <code>Thread</code> to investigate native stack cost and <code>Thread.print</code> to understand the threads themselves. Interpret both alongside OS measurements rather than equating stack reservation with RSS.</p></aside>

## Check your reasoning

Could one native frame yield several Java frames in a stack trace? Yes, if it represents inlined methods and the relevant scope metadata is available. Can the collector mark every word that looks like an address as a precise root? No; OopMaps identify managed references at the relevant execution state.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable complete stack runtime model"><a href="/images/courses/jvm/stack-runtime-complete.svg" aria-label="Open complete stack runtime model"><img src="/images/courses/jvm/stack-runtime-complete.svg" alt="Interpreter and JIT execution create different frames; nmethod OopMaps and scope or deoptimization metadata let GC, stack walking and deoptimization understand compiled frames." width="900" height="450" /></a><figcaption>Execution mode determines the frame; metadata recovers the managed view when HotSpot needs it.</figcaption></figure>

The model is `Interpreter/JIT → frames → nmethod metadata → OopMaps and scopes → GC, stack walking and deoptimization`. Next, Lesson 35 will follow **direct and mapped memory**: `ByteBuffer.allocateDirect`, cleaners, `MaxDirectMemorySize`, mapped files, and RSS growth a heap dump barely explains.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Daily JVM Byte #34 and its reviewed draft inform this lesson. The register, slot, inlining and deoptimization examples and diagrams are illustrative; no live JVM stack or memory measurements were performed. The frame and OopMap details describe JDK 25 HotSpot platform threads; stack layout and sampling behavior can vary by architecture, JDK and execution state.</p><ul><li><a href="https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-2.html#jvms-2.6">JVMS 25 frames</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/compiler/oopMap.hpp">OpenJDK JDK 25 OopMaps</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/runtime/vframe.hpp">OpenJDK JDK 25 virtual frames</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/runtime/deoptimization.cpp">OpenJDK JDK 25 deoptimization</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html">JDK 25 jcmd</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/vm/java-virtual-machine-guide.pdf">JDK 25 NMT guide</a></li></ul></details>
