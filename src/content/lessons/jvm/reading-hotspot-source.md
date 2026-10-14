---
title: Reading HotSpot source without getting lost
summary: Locate a JVM mechanism in the JDK 25 HotSpot tree, follow its owning structures across subsystems, and check an explanation against runtime evidence.
course: jvm
lessonSlug: reading-hotspot-source
module: HotSpot Internals
order: 410
sourceByte: byte-041
draft: true
prerequisites:
  - hotspot-internal-object-model
jdk: JDK 25 · HotSpot Internals
---

You know from [Lesson 40](/courses/jvm/hotspot-internal-object-model) that a Java object, its `InstanceKlass`, a `Method`, a running `JavaThread`, and compiled `nmethod` are related but different things. Suppose a production observation now raises a sharper question: *where does HotSpot implement the behavior I am seeing?* Searching the entire JDK for “object” or “method” produces too much code. A useful source investigation starts with the JVM mechanism and then narrows to the structure that owns it.

This lesson uses the **`jdk-25+36` OpenJDK source tag**. Check out that tag for the commands below; a moving `master` branch can answer a different version's question. The Java Virtual Machine Specification (JVMS) describes required behavior, while these directories describe one HotSpot implementation of it. <mark>Use the mental model as an index into source, then use the source to correct the model.</mark>

## Fix the version and identify the boundary

In an OpenJDK checkout, `src/hotspot/share/` holds code shared across supported platforms. It is a starting point, not the entire implementation. CPU-specific instruction generation lives under `src/hotspot/cpu/`; operating-system integration under `src/hotspot/os/`; and combined ports under `src/hotspot/os_cpu/`. A call from shared C++ may end in a platform-specific assembler or OS operation.

```bash
git switch --detach jdk-25+36
rg --files src/hotspot/share/oops | rg '(instanceKlass|method|constantPool)\.'
rg --files src/hotspot/cpu | rg 'templateTable|macroAssembler' | head
```

These are navigation commands, not a claim that every platform has the same files. `rg --files` finds candidate owners; then read a declaration and the matching implementation. When a diagram crosses a directory boundary, follow only the edge relevant to your question.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable HotSpot source ownership map"><a href="/images/courses/jvm/hotspot-source-tree-map.svg" aria-label="Open HotSpot source ownership map"><img src="/images/courses/jvm/hotspot-source-tree-map.svg" alt="HotSpot share directories grouped by metadata, execution, compilation, and observability, with CPU and OS port directories alongside them." width="1120" height="580" /></a><figcaption>Start with the subsystem that owns the behavior; then follow the few boundaries the behavior actually crosses.</figcaption></figure>

## Class data begins in `classfile/` and becomes `oops/` metadata

`oops/` is HotSpot's object and type metadata area. An `oop` is an ordinary object pointer: HotSpot's internal reference to a managed heap object. `Klass*` points to VM class metadata, typically in Metaspace. It is not the `java.lang.Class` mirror on the heap. For an ordinary class, `InstanceKlass` describes type and instance-layout information, connects its `Method` metadata and runtime `ConstantPool`, and participates in method lookup. The exact links and fields are implementation details; these names tell you which questions each structure can answer.

The input side lives in `classfile/`. `ClassFileParser` interprets class-file bytes and constructs class metadata. `ClassLoaderData`, found in the class-loading and memory machinery, associates metadata with a loader lifetime. A compact trace is `.class` bytes → parser → `InstanceKlass` with methods and constant pool → loader-data lifetime. Verification, linking, and initialization add further steps; this arrow is an ownership map, not a complete class-loading call graph.

```bash
rg -n 'class InstanceKlass|class Method|class ConstantPool' src/hotspot/share/oops
rg -n 'class ClassFileParser|class ClassLoaderData' src/hotspot/share/classfile
```

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable class loading source path"><a href="/images/courses/jvm/hotspot-class-loading-source-path.svg" aria-label="Open class loading source path"><img src="/images/courses/jvm/hotspot-class-loading-source-path.svg" alt="Class file bytes enter ClassFileParser, which constructs InstanceKlass, Method, and ConstantPool metadata; ClassLoaderData governs associated metadata lifetime." width="1080" height="410" /></a><figcaption>The arrows name roles in the loading path; they are not a literal list of every constructor call.</figcaption></figure>

If your question is “where is an instance's size known?”, start at `InstanceKlass` and layout code. If it is “how is a symbolic class name read from a file?”, start at `ClassFileParser`. This choice keeps the investigation bounded.

## Threads and safepoints begin in `runtime/`

For executing threads, VM operations, locks, safepoints, and transitions between Java and VM code, inspect `runtime/`. A Java heap `Thread` object is distinct from the native `JavaThread` that carries platform-thread execution. Safepoint coordination asks running Java threads to reach states where the VM can safely perform certain global work; thread-local handshakes can target selected threads. The full mechanism also reaches generated polling code and platform code, so `runtime/` is the center of the question rather than its only directory.

```bash
rg -n 'class JavaThread|class SafepointSynchronize' src/hotspot/share/runtime
rg --files src/hotspot/share/runtime | rg 'safepoint|vmOperations|javaThread'
```

Ask which observable event started the investigation: a time-to-safepoint log, a thread dump, or a VM operation. That evidence tells you which part of `runtime/` deserves attention.

## The interpreter crosses from shared rules to CPU instructions

HotSpot's normal bytecode interpreter uses generated machine-code templates. Shared `interpreter/` code describes bytecode templates, state, and dispatch machinery; a CPU port supplies the instruction sequences that realize operations such as `iadd`. Do not picture the normal interpreter solely as a C++ `switch` that executes each bytecode. Equally, do not mistake one CPU port's assembly for a JVMS rule.

```bash
rg -n 'iadd|TemplateTable::' src/hotspot/share/interpreter src/hotspot/cpu
rg --files src/hotspot/cpu | rg 'templateTable_'
```

For one bytecode, locate the shared template declaration, find the matching port implementation, then compare its effect with the operand-stack semantics in the JVMS. This is a useful moment to separate **what must happen** from **which machine instructions implement it**.

## Compilation spans `compiler/`, `ci/`, `c1/`, and `opto/`

Execution profiles can cause a method to be compiled. `compiler/` coordinates shared compilation infrastructure and policy. `ci/` supplies a compiler-facing view of VM entities so compilers can reason about classes and methods. `c1/` implements the client compiler, including fast compilation and profiling tiers. `opto/` contains C2's optimizing compiler, whose directory name reflects its optimizer architecture. These are boundaries, not a promise that every method travels through both compilers.

The compiler **generates** machine code. `code/` manages the resulting compiled artifacts, including `nmethod` and Code Cache storage, relocation, installation, invalidation, and eventual reclamation. An `nmethod` can become non-entrant while the class and `Method` still exist. `memory/` contains wider memory infrastructure; `nmt/` tracks allocations attributable to HotSpot; `services/` and `jfr/` expose diagnostic and recording views; `prims/` covers interfaces such as JNI and JVM entry points. These areas are useful when source behavior must be tied to a tool's measurement.

```bash
rg --files src/hotspot/share/{compiler,ci,c1,opto,code} | rg '(compileBroker|ciMethod|c1_Compilation|compile|nmethod|codeCache)'
rg -n 'class nmethod|class CodeCache' src/hotspot/share/code
```

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable compiler to Code Cache source map"><a href="/images/courses/jvm/hotspot-compiler-code-source-map.svg" aria-label="Open compiler and Code Cache source map"><img src="/images/courses/jvm/hotspot-compiler-code-source-map.svg" alt="Compilation policy and compiler interface feed C1 or C2; generated code is installed as nmethod in the Code Cache, where it can execute, invalidate, and be reclaimed." width="1080" height="480" /></a><figcaption>Creation and lifetime management are separate questions. Follow `c1/` or `opto/` for the former, `code/` for the latter.</figcaption></figure>

## GC has shared paths and collector-specific paths

The `gc/` tree contains `shared/` infrastructure and collector directories such as `g1/`, `z/`, `parallel/`, and `serial/` in this JDK 25 tree. Allocation support in `gc/shared/` can call collector-specific heap implementations. Root discovery, barriers, region layouts, and concurrent phases must be read with the relevant collector in mind. A G1 remembered-set detail is not a universal GC rule; a ZGC barrier is not the default behavior of every heap.

```bash
rg --files src/hotspot/share/gc | rg '(memAllocator|collectedHeap|g1CollectedHeap|zCollectedHeap)'
```

Before claiming that “HotSpot allocates this way,” ask which collector, which fast path, and which JDK tag the code describes. [Lesson 42](/courses/jvm/object-allocation-end-to-end) uses this distinction to trace a single `new` expression.

## Trace one method across the tree

Use a small method as a thread through the map:

```java
class Arithmetic {
    int add(int a, int b) { return a + b; }
}
```

`javac` places a method and its bytecodes in `Arithmetic.class`. A representative disassembly of `add` contains `iload_1`, `iload_2`, `iadd`, and `ireturn`; exact constant-pool indexes depend on the class file. `classfile/` parses the file; `oops/` holds the resulting `Method`, bytecodes, and associated constant pool. `interpreter/` can execute `iadd` and gather execution information. If compilation becomes worthwhile, `compiler/` and `ci/` connect the VM state to `c1/` or `opto/`. `code/` installs a compiled `nmethod` in the Code Cache. The CPU runs either generated interpreter code or compiled method code. <mark>One Java method can have a stable metadata identity while its execution form changes.</mark>

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable one method across HotSpot"><a href="/images/courses/jvm/hotspot-source-complete.svg" aria-label="Open complete one-method source path"><img src="/images/courses/jvm/hotspot-source-complete.svg" alt="Arithmetic.add travels from class file parsing to Method metadata, interpreter execution and profiling, C1 or C2 compilation, then nmethod installation in the Code Cache." width="1120" height="520" /></a><figcaption>This lifecycle shows likely owners of each stage; compilation is conditional, not guaranteed for every call.</figcaption></figure>

## Investigate a question without following everything

Suppose JFR shows more compiler activity during a latency spike. Begin with the question “which methods compiled, and did Code Cache state change?” Check JFR compiler events or `jcmd <pid> Compiler.codecache` first. Then locate compilation policy in `compiler/`, the relevant compiler in `c1/` or `opto/`, and `nmethod` state in `code/`. Read declarations to learn the objects involved; follow only the implementation path needed to interpret the event. Cross-check the resulting explanation against a second observation, such as compilation logs or Code Cache occupancy over the same interval.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable source investigation workflow"><a href="/images/courses/jvm/hotspot-source-investigation-workflow.svg" aria-label="Open source investigation workflow"><img src="/images/courses/jvm/hotspot-source-investigation-workflow.svg" alt="A bounded investigation moves from a concrete question to subsystem, owning structure, declaration, implementation, and matching runtime evidence." width="1080" height="370" /></a><figcaption>Runtime evidence frames the source question and then checks the answer.</figcaption></figure>

<details class="lesson-check"><summary>You find `Klass*` in `oops/` while investigating an `Order` instance. Is it a Java reference to another heap object?</summary><p>No. `Klass*` denotes HotSpot type metadata. The heap object is represented through oop machinery; a Java `Class` mirror is a separate heap object related to that metadata.</p></details>

<details class="lesson-check"><summary>A source search finds an `iadd` implementation under one CPU port. Can you generalize its instructions to every JVM?</summary><p>No. JVMS operand-stack effects generalize; the particular generated machine instructions belong to that HotSpot CPU port and JDK build.</p></details>

Next, [Lesson 42](/courses/jvm/object-allocation-end-to-end) uses this map to follow `new Order()` from a symbolic class reference to an object, its constructor, optimized code, and eventual GC reachability.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on Daily JVM Byte #41 and its approved review. Directory diagrams and the `Arithmetic.add` lifecycle are conceptual; source-search examples describe a JDK 25 checkout and were not claimed as a live VM measurement. The JVMS defines bytecode behavior; directory and structure names describe OpenJDK HotSpot at tag `jdk-25+36`, not every JVM implementation.</p><ul><li><a href="https://github.com/openjdk/jdk/tree/jdk-25%2B36/src/hotspot">OpenJDK JDK 25 HotSpot source tree</a></li><li><a href="https://github.com/openjdk/jdk/tree/jdk-25%2B36/src/hotspot/share">OpenJDK JDK 25 shared HotSpot source</a></li><li><a href="https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-6.html">JVMS 25, instruction set</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/javap.html">JDK 25 javap command</a></li></ul></details>
