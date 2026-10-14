---
title: One object allocation, end to end
summary: Follow new Order() from bytecode and class metadata through a TLAB or slower allocation path, initialization, JIT optimization, and eventual reachability.
course: jvm
lessonSlug: object-allocation-end-to-end
module: HotSpot Internals
order: 420
sourceByte: byte-042
draft: true
prerequisites:
  - reading-hotspot-source
jdk: JDK 25 · HotSpot Internals
---

You write `Order order = new Order();` and receive a reference. What happened between those two points? [Lesson 41](/courses/jvm/reading-hotspot-source) showed where to look in HotSpot. Here we follow this operation from a class-file instruction through class metadata, memory allocation, constructor execution, possible compiler optimization, and finally the object's lifetime. The bytecode rules come from the JVMS; TLABs and the exact fast paths are HotSpot implementation choices.

Use this small class throughout:

```java
public class Order {
    long id;
    int quantity;
    Object customer;

    Order() { quantity = 1; }

    static Order make() { return new Order(); }
}
```

On JDK 25, save it as `Order.java`, run `javac Order.java`, then `javap -c -p Order`. The important part of `make` is representative of:

```text
0: new           #...  // class Order
3: dup
4: invokespecial #...  // Method <init>:()V
7: areturn
```

Constant-pool indexes vary. `new` creates a default-initialized instance; `dup` keeps a reference for the return after the constructor call consumes one; `invokespecial` calls `Order.<init>`. The constructor's own bytecode first invokes `Object.<init>` and then stores `1` into `quantity`. <mark>The `new` instruction and the constructor invocation are separate bytecode operations.</mark> A constructor can throw after allocation, so source-level creation is not one indivisible memory action.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable new bytecode sequence"><a href="/images/courses/jvm/java-new-bytecode-sequence.svg" aria-label="Open new bytecode sequence"><img src="/images/courses/jvm/java-new-bytecode-sequence.svg" alt="The new instruction obtains a default-initialized Order; dup preserves a reference; invokespecial runs the constructor; areturn returns the reference." width="1080" height="390" /></a><figcaption>The stack sketch shows semantic stages, not every verifier state or generated machine instruction.</figcaption></figure>

## A symbolic class name becomes usable metadata

`new #...` names a class through the current class's runtime constant pool. Resolution makes that symbolic reference usable as a class. If needed, the JVM loads and links the class; `new` also triggers initialization of that class when its initialization has not yet occurred. This work is **conditional**. Once `Order` is ready, subsequent allocations do not reparse the class file or rerun `<clinit>` for each object.

HotSpot's `InstanceKlass` represents the ordinary class. It provides or connects the prepared instance layout, field information, method metadata, and initialization state. The allocator needs a size and alignment decision before it can reserve memory. The class metadata was prepared from `Order.class`; allocation does not rediscover the fields from source code. The object reference and its `InstanceKlass` occupy different memory domains, as Lesson 40 established.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable class resolution and object layout"><a href="/images/courses/jvm/object-class-resolution.svg" aria-label="Open class resolution and layout"><img src="/images/courses/jvm/object-class-resolution.svg" alt="A symbolic Order class reference resolves to prepared InstanceKlass metadata; its size and field layout guide allocation of a heap object with header and fields." width="1080" height="440" /></a><figcaption>The field boxes describe kinds of storage, not a fixed physical field order or a fixed object-header encoding.</figcaption></figure>

An `Order` instance needs a header, storage for its fields, and perhaps padding for alignment. Do not calculate its physical size by adding Java field widths in source order. HotSpot can reorder fields within applicable constraints, compress references or class pointers, and use different header formats with configuration. JDK 25 includes opt-in compact object headers as a product feature, so a drawing with one universal header size would be false. The prepared `InstanceKlass` makes the chosen layout usable for this build and configuration.

## The common TLAB path

A **thread-local allocation buffer** (TLAB) is a region of heap space a Java thread can use for many small allocations. Its current pointer marks the next free position. For an eligible object, generated code can check whether `top + size` fits within the current TLAB end, advance `top`, and use the reserved bytes. The common path does not require every allocating thread to acquire one global heap lock for every object. Private allocation space explains why allocation can be fast even though the heap is shared.

```text
TLAB: [ allocated objects ][ free space................ ]
                            ^ top                      ^ end
after Order: [ allocated objects ][ Order ][ free...... ]
                                     ^ new top
```

This is an illustrative pointer model. Real HotSpot code includes alignment, overflow, zeroing, allocation events and collector interfaces. An object may be allocated outside the current TLAB because it is too large, the TLAB lacks room, TLAB use is disabled or unsuitable, or a collector chooses another path. A failed fit can lead to a refill, retirement of remaining TLAB space, or an allocation outside the TLAB. It does **not** imply that each slow allocation runs GC.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable TLAB allocation decision"><a href="/images/courses/jvm/tlab-refill-vs-outside.svg" aria-label="Open TLAB allocation paths"><img src="/images/courses/jvm/tlab-refill-vs-outside.svg" alt="A TLAB fit uses a local bump pointer; on a miss HotSpot may refill the TLAB, allocate outside it, or enter a collector-specific slow path, with GC only if needed." width="1080" height="510" /></a><figcaption>“Slow path” is a family of decisions, not a synonym for a collection.</figcaption></figure>

In the JDK 25 source, `gc/shared/threadLocalAllocBuffer.*` describes TLAB state and policy. `gc/shared/memAllocator.*` handles allocation routes, including TLAB use and alternatives, while collector-specific heap code supplies backing space and handles failure. `oops/instanceKlass.*` answers the size/layout side. The concrete code to inspect depends on the selected collector and whether execution is interpreted or compiled.

## Default values precede constructor assignments

The JVM gives a newly allocated instance default field values before the Java constructor's assignments are observed: numeric primitives start at zero, `boolean` at `false`, and references at `null`. In `Order`, `id` starts at `0`, `quantity` at `0`, and `customer` at `null`; the constructor later sets `quantity` to `1`. The VM also establishes header and class identity information needed to treat the memory as an object.

Do not convert that semantic ordering into a claim that HotSpot always emits one explicit zero store per field after moving the allocation pointer. Memory can be prezeroed in batches, TLABs can be prepared for fast allocation, and compiled code can combine or eliminate stores while preserving Java-visible behavior. The physical store sequence depends on the path and optimization. Constructor failure can leave an allocated but unreturned object that later becomes collectible.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable default versus constructor state"><a href="/images/courses/jvm/object-default-init-vs-constructor.svg" aria-label="Open default and constructor state"><img src="/images/courses/jvm/object-default-init-vs-constructor.svg" alt="After new, Order fields have default values id zero, quantity zero and customer null; after invokespecial constructor, quantity is one while the other fields retain defaults." width="1080" height="390" /></a><figcaption>These are Java-visible states. The diagram does not prescribe the physical timing of individual zero stores.</figcaption></figure>

## The JIT may inline the fast path or remove the object

After execution becomes hot, C1 or C2 can compile `make`. Generated code may place the allocation check, pointer movement, header setup, and constructor stores directly in the caller's machine code, with a transition to runtime code for uncommon or failed fast-path conditions. There need not be a native call to a generic allocator for each successful small allocation. The compiled path still respects class-initialization and Java memory semantics.

An even stronger optimization is possible. Consider a temporary object whose fields are used locally:

```java
static int quantityPlusOne() {
    Order o = new Order();
    return o.quantity + 1;
}
```

If the optimizer proves that this object's identity and address are not observably needed, **escape analysis** can support **scalar replacement**: represent relevant fields as values instead of allocating a physical heap object. It can then fold `quantity + 1` to `2` under the example's assumptions. This depends on the compiled path, analysis success, available optimization budget, and semantic details. A nonescaping source variable does not guarantee that HotSpot eliminates its allocation. Profiling or JFR may therefore report fewer heap allocations than a count of `new` expressions suggests.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable JIT allocation and scalar replacement"><a href="/images/courses/jvm/escape-analysis-no-allocation.svg" aria-label="Open JIT allocation and scalar replacement"><img src="/images/courses/jvm/escape-analysis-no-allocation.svg" alt="Compiled code either performs a fast heap allocation for an escaping Order or, when proven valid, keeps a temporary Order's fields as scalar values with no physical object." width="1080" height="430" /></a><figcaption>Scalar replacement is conditional; it is not a rule that all local objects disappear.</figcaption></figure>

## Allocation rate and retained heap answer different questions

If `order` is returned to a caller and kept in a cache, references from reachable roots can keep it alive. Once no live path from GC roots reaches it, a collector may reclaim its memory during an appropriate cycle. “No longer referenced by this local variable” is not proof of unreachability; other references may remain. Also, reclamation need not occur immediately after the last use.

Suppose a service allocates many short-lived `Order` objects each second but retains few after collection. Its **allocation rate** is high while its **live set** can remain stable. Conversely, a slow-growing cache may have moderate allocation rate but an increasing post-GC live set. JFR allocation evidence helps with the former; post-GC occupancy, heap analysis, and reference paths help with the latter. <mark>A high allocation rate does not by itself prove a memory leak.</mark>

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable allocation rate versus retention"><a href="/images/courses/jvm/allocation-vs-retention.svg" aria-label="Open allocation and retention comparison"><img src="/images/courses/jvm/allocation-vs-retention.svg" alt="One path allocates many Orders and releases most, leaving a stable live set; another retains Orders in a cache and grows the post-GC live set." width="1080" height="410" /></a><figcaption>Compare the slope of creation with the population that remains reachable after collection.</figcaption></figure>

## Follow the source only as far as the question needs

For a JDK 25 checkout, these searches find the core owners:

```bash
rg -n 'class InstanceKlass|size_helper' src/hotspot/share/oops/instanceKlass.*
rg -n 'class ThreadLocalAllocBuffer|allocate' src/hotspot/share/gc/shared/threadLocalAllocBuffer.*
rg -n 'MemAllocator|allocate_inside_tlab|allocate_outside_tlab' src/hotspot/share/gc/shared/memAllocator.*
rg -n 'AllocateNode|GraphKit::new_instance' src/hotspot/share/opto
```

Use `javap` to establish which bytecodes the source generated, and JFR or controlled allocation logs to determine what a running build actually did. Source inspection tells you possible paths and their conditions; a bytecode listing alone cannot prove that a hot method allocated a physical object.

<details class="lesson-check"><summary>If a TLAB has no space for the next Order, must GC run immediately?</summary><p>No. HotSpot can obtain or refill a TLAB, allocate outside it, or take a collector-specific route. Collection is one possible later response to insufficient heap space, not the meaning of every TLAB miss.</p></details>

<details class="lesson-check"><summary>Can a constructor assignment be the operation that creates an object's first default value?</summary><p>No. The JVM model gives the instance default field values before constructor assignments are observed. HotSpot may implement that result using bulk zeroing or optimized stores, but the constructor changes an already allocated object's state.</p></details>

The next lesson, [Lesson 43](/courses/jvm/virtual-method-call-end-to-end), follows a call on a receiver such as `payment.process()`: how its class selects a method, how profiling changes the generated call, and how HotSpot stays correct when an optimization's assumption fails.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on Daily JVM Byte #42 and its approved review. The example was compiled and disassembled with OpenJDK 25.0.2; the bytecode order matched this lesson, while constant-pool indexes are illustrative. No allocation count or machine-code path is inferred from bytecode alone. JVMS default initialization and invocation semantics are guarantees; TLAB, field layout, compiler and collector paths describe OpenJDK HotSpot at tag `jdk-25+36` and depend on configuration.</p><ul><li><a href="https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-6.html#jvms-6.5.new">JVMS 25, new</a></li><li><a href="https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-6.html#jvms-6.5.invokespecial">JVMS 25, invokespecial</a></li><li><a href="https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-2.html#jvms-2.3">JVMS 25, default values and types</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/shared/memAllocator.cpp">OpenJDK JDK 25 MemAllocator</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/shared/threadLocalAllocBuffer.cpp">OpenJDK JDK 25 TLAB implementation</a></li><li><a href="https://openjdk.org/jeps/519">JEP 519, compact object headers</a></li></ul></details>
