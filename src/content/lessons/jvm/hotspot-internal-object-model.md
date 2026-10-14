---
title: HotSpot's internal object model — connecting Java abstractions to VM structures
summary: Connect Java objects, classes, methods, loaders, compiled code, and threads to the cooperating C++ structures HotSpot uses to execute and collect them.
course: jvm
lessonSlug: hotspot-internal-object-model
module: HotSpot Internals
order: 400
sourceByte: byte-040
draft: true
prerequisites:
  - jvm-diagnostics-system
jdk: JDK 25 · HotSpot Internals
---

The course has described objects, class loading, execution, JIT compilation, GC, and threads from the Java developer's point of view. [Lesson 39](/courses/jvm/jvm-diagnostics-system) connected their diagnostic views. Now we can ask what HotSpot keeps inside the VM to make those views possible.

Consider a call to `order.total()`. A Java object supplies the receiver. Class metadata helps identify its type and find the method. A `Method` describes the bytecode-level method. HotSpot may execute it through the interpreter or a compiled `nmethod`. A running thread carries frames whose references GC must find. <mark>This is a graph of cooperating structures, not one C++ object for each Java concept.</mark>

The diagrams in this lesson are **architectural maps**. Their arrows mean relationships or use; they do not claim every arrow is a literal field pointer or that the physical layout is fixed across builds.

## Two worlds: heap objects and VM metadata

A Java `Order` instance is a managed heap object. HotSpot represents a reference to such an object with its internal `oop` machinery. Its header lets the VM determine the object's class metadata, directly or through a configured encoding. The exact header bits and size vary with settings and developments such as compact object headers; this lesson does not assume one physical header layout.

The `java.lang.Class` object for `Order.class` is also on the Java heap. It is a **mirror** visible to Java reflection. HotSpot's `Klass` family is native VM metadata, normally allocated through Metaspace machinery. A mirror and a `Klass` describe related aspects of one type, but they are different objects in different memory domains.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable class mirror and Klass model"><a href="/images/courses/jvm/class-mirror-vs-klass.svg" aria-label="Open class mirror and Klass model"><img src="/images/courses/jvm/class-mirror-vs-klass.svg" alt="Heap Order instance and heap java.lang.Class mirror relate to native InstanceKlass metadata in Metaspace; relationship arrows are conceptual and header layout is configuration dependent." width="960" height="500" /></a><figcaption>The reflection mirror is a Java object; `InstanceKlass` is VM metadata used to implement the class.</figcaption></figure>

`Klass` is the common metadata base. `InstanceKlass` covers ordinary instance classes; `ArrayKlass` and its array subclasses cover array types. Class metadata holds or connects the information HotSpot needs for fields and layouts, methods, supertype and interface relationships, and dispatch. Do not read the conceptual arrows below as an exact ownership diagram for each implementation field.

```text
Klass
├── InstanceKlass        ordinary classes and interfaces
└── ArrayKlass           array types and specialized subclasses
```

This distinction matters when inspecting a heap dump or class statistics: an array's metadata is not simply another `InstanceKlass` with a special name. Likewise, a heap `Class` mirror does not account for all Metaspace used by its VM metadata.

## A method can have several representations

For `Order.total()`, HotSpot's `Method` metadata gives the VM a stable method-level identity while the class remains loaded. Its `ConstMethod` partner stores relatively stable information including bytecodes and method descriptors. Separate `MethodCounters` can hold invocation and backedge counts; `MethodData` can hold richer profiling information. These auxiliary structures are created according to need and policy, so a diagram showing them together must not imply they are all eagerly present for every method.

`java.lang.reflect.Method`, by contrast, is a Java-heap reflection object that exposes a method to Java code. It is not the VM's `Method` metadata.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable method metadata and compiled code model"><a href="/images/courses/jvm/method-vs-nmethod.svg" aria-label="Open method metadata and compiled code model"><img src="/images/courses/jvm/method-vs-nmethod.svg" alt="One HotSpot Method relates to ConstMethod bytecodes, optional counters and profiling, and potentially several nmethod compiled incarnations in the Code Cache; reflection Method is a separate heap object." width="960" height="520" /></a><figcaption>`Method` describes the method; an `nmethod` is one compiled code incarnation with a separate lifetime.</figcaption></figure>

Tiered compilation can create C1 and C2 compiled forms, and on-stack replacement (OSR) can compile a loop entry separately. An `nmethod` lives in the native Code Cache and includes machine code plus metadata needed for execution, stack walking, GC, and recovery. A dependency change can make compiled code non-entrant and trigger deoptimization; later, code may be reclaimed. <mark>Losing an `nmethod` does not mean the Java class or its `Method` metadata was unloaded.</mark> The interpreter or another compiled incarnation can still execute the method.

## Symbols become usable runtime relationships

The class file has a constant pool of symbolic entries, including class, field, and method references. HotSpot builds a runtime `ConstantPool` associated with class metadata and uses resolution and cache machinery to make those entries usable. Linkage may be lazy: a reference can remain unresolved until execution needs it. A resolved symbolic method reference is not the same thing as selecting every possible virtual dispatch target. Nor should resolution be taught as universally rewriting the entire pool into raw pointers. The exact cache representation is an implementation detail.

For the `order.total()` example, bytecode first names a symbolic method reference. At runtime, resolution establishes the relevant method relationship, then dispatch and optimization rules determine the actual executed code for the receiver. A compiler may inline a target under a guarded assumption and later deoptimize if that assumption no longer holds. This ties the [constant-pool lesson](/courses/jvm/constant-pool-symbolic-references) to the [speculation lesson](/courses/jvm/speculative-optimization-deoptimization).

## Loaders own a metadata lifetime

`ClassLoaderData` is HotSpot's VM-side record for metadata associated with a defining loader or an appropriate loader-data lifetime. It connects class metadata to Metaspace allocation and unloading. If a loader remains reachable, its classes and metadata may remain too; when unloading becomes possible, HotSpot can reclaim the relevant metadata. Hidden classes add a nuance: their metadata can have a lifetime that differs from an ordinary named class even when a defining loader is involved. The precise loader-data relationship depends on class kind and VM policy, so a single “one loader owns one arena forever” picture would be misleading.

This explains an operational pattern: rising Metaspace and class count invite a loader-lifetime investigation. A heap dump may reveal a retained Java class loader or mirror; `VM.classloader_stats` and NMT Class accounting add VM-side evidence. A mirror count alone does not measure all metadata.

## Running threads connect code to roots

For a platform thread, its Java-heap `java.lang.Thread` object is distinct from HotSpot's C++ `Thread` base, a `JavaThread`, and the underlying OS thread represented through `OSThread` machinery. `NonJavaThread` covers VM service threads outside that Java execution category. A `JavaThread` carries VM execution state used for safepoint and handshake coordination, JNI transitions, exceptions, stack walking, and root discovery. These are roles, not a claim that the Java object physically contains all the native structures.

A virtual thread is still a Java `Thread` object, but it mounts on a carrier platform thread to run. It may unmount and later mount on another carrier. <mark>Its identity does not imply a permanent one-to-one `JavaThread` or OS thread.</mark> This is why a traditional platform-thread dump and a virtual-thread-aware dump answer different questions.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable JavaThread and virtual-thread model"><a href="/images/courses/jvm/javathread-runtime-model.svg" aria-label="Open JavaThread runtime model"><img src="/images/courses/jvm/javathread-runtime-model.svg" alt="A platform Java Thread heap object relates to a HotSpot JavaThread and OS thread; a virtual Java Thread mounts temporarily on a carrier JavaThread and can later mount elsewhere." width="960" height="500" /></a><figcaption>The carrier supplies execution resources; virtual-thread identity can outlive and move across mounts.</figcaption></figure>

Now follow one compiled call during GC. A `JavaThread` is executing a physical stack frame for an `nmethod`. The `nmethod` includes an `OopMap` for appropriate safepoint locations: it identifies where live object references sit in that compiled frame, such as registers or stack slots. The collector combines those locations with other roots to trace live heap objects. This is different from class metadata describing **where reference fields sit inside an object instance**. Both concern references, but they describe different contexts.

```text
JavaThread → physical stack → compiled frame → nmethod → OopMap
                                                        ↓
                                                live references for GC
```

The exact frame encoding and root mechanics vary by execution mode and HotSpot build. Interpreted frames have their own metadata and map machinery; the compiled `OopMap` path here is one concrete route through the graph.

## Put the graph together

The complete map connects two overlapping paths. The **class path** runs from loader data to `InstanceKlass`, runtime `ConstantPool`, `Method`, optional profile data, and compiled `nmethod`s in the Code Cache. The **execution path** runs from a Java thread through a carrier or platform `JavaThread`, a physical stack, a compiled frame, and an `nmethod` whose OopMap helps GC identify roots. Heap instances and mirrors relate to class metadata across the heap/Metaspace boundary.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable complete HotSpot metadata and execution graph"><a href="/images/courses/jvm/hotspot-metadata-complete.svg" aria-label="Open complete HotSpot graph"><img src="/images/courses/jvm/hotspot-metadata-complete.svg" alt="Conceptual HotSpot graph: ClassLoaderData connects to InstanceKlass, ConstantPool, Method and compiled nmethod in Code Cache; JavaThread executes a frame using nmethod and OopMap, which identifies heap references for GC; heap instances and Class mirrors relate to metadata." width="1120" height="690" /></a><figcaption>Follow relationships across heap, Metaspace, Code Cache, and execution stack; arrows are conceptual unless explicitly labeled.</figcaption></figure>

This graph turns production evidence into a more precise question. **Metaspace growth** asks about `ClassLoaderData` and class lifetimes. **Code Cache pressure** asks about compilation and `nmethod` incarnations. **GC root questions** lead to stack frames and reference maps. **Deoptimization** concerns compiled code and reconstructed logical Java state, not necessarily class unloading.

## Check your reasoning

<details class="lesson-check"><summary>A reflection Method object disappears, compiled code is invalidated, and a virtual thread changes carriers. Which VM identities must disappear?</summary><p>None follows automatically. The reflection object is separate from HotSpot Method metadata. An invalidated nmethod can be replaced or reclaimed while its Method and class remain. The virtual thread retains its Java identity while mounting on another carrier JavaThread.</p></details>

<details class="lesson-check"><summary>Does an object field-reference layout map tell GC where a compiled frame keeps live references?</summary><p>No. Class metadata describes references inside instances. An nmethod's OopMap describes live oop locations in a compiled frame at relevant points. GC needs both kinds of information in their respective contexts.</p></details>

Continue with [Lesson 41, Reading HotSpot source without getting lost](/courses/jvm/reading-hotspot-source). It uses this architecture to navigate the JDK 25 implementation, from `oops/` and `runtime/` to the interpreter, compilers, Code Cache, and GC.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>The supplied approved Lesson 40 brief and originating review supply the editorial scope; the original Byte #40 attachment was unavailable through the conversation reader. The graphs and call path are conceptual and illustrative; no VM structure layout or Java process was measured. Names and relationships describe OpenJDK HotSpot around JDK 25, not a JVMS-required C++ design. Allocation, header, compilation, and unloading details vary by build and configuration.</p><ul><li><a href="https://github.com/openjdk/jdk/tree/jdk-25+36/src/hotspot/share/oops">OpenJDK 25 HotSpot oops metadata sources</a></li><li><a href="https://github.com/openjdk/jdk/tree/jdk-25+36/src/hotspot/share/runtime">OpenJDK 25 HotSpot runtime thread sources</a></li><li><a href="https://github.com/openjdk/jdk/tree/jdk-25+36/src/hotspot/share/code">OpenJDK 25 HotSpot compiled-code and OopMap sources</a></li><li><a href="https://openjdk.org/jeps/519">JEP 519: Compact Object Headers</a></li><li><a href="https://openjdk.org/jeps/444">JEP 444: Virtual Threads</a></li><li><a href="https://openjdk.org/jeps/371">JEP 371: Hidden Classes</a></li></ul></details>
