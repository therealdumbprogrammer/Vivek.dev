---
title: GC roots, reachability, and why GC is graph traversal
summary: Follow references from the root set to discover live objects, understand collectible cycles, and diagnose unwanted retention.
course: jvm
lessonSlug: gc-roots-reachability
module: Foundations
order: 40
sourceByte: byte-004
draft: false
prerequisites: [object-layout]
jdk: HotSpot · GC foundations
---

You finish processing an order, but its customer data is still on the heap. Does that mean garbage collection missed it? To answer that, we need to follow the references that still lead to the data.

In [Lesson 3](/courses/jvm/object-layout), we zoomed into one object and separated its own storage from the objects its fields reference. Now zoom back out. Each object is a **node**, and each reference is a directed connection to another node. Together, they form an **object graph**.

## References turn the heap into a graph

The final picture from Lesson 3 gives us our starting point. Follow the reference inside User to B, then from B to C. Each object occupies its own memory; the arrows describe how the objects are connected.

<figure>
<a href="/images/courses/jvm/object-graph.svg" aria-label="Open object graph diagram at full size"><img src="/images/courses/jvm/object-graph.svg" alt="User points to B, which points to C. Each object has its own shallow size." width="480" height="510" /></a>
<figcaption>Layout counts storage within a node; reachability follows paths between nodes. <a href="/images/courses/jvm/object-graph.svg">Open full-size diagram</a>.</figcaption>
</figure>

For the rest of this lesson, give those nodes application names:

```java
class Order {
    Customer customer;
}

class Customer {
    Address address;
}
```

An Order can reference a Customer, which can reference an Address. The collector's fundamental question is whether there is still a path to those objects from the running program. An object's age can influence how a collector manages it, but age alone does not decide whether it is garbage.

<aside class="lesson-callout" data-kind="key-idea" aria-label="Key idea">
<p class="callout-label">Key idea</p>
<p>An object becomes eligible for reclamation when it is no longer reachable from the GC root set.</p>
</aside>

We'll use ordinary strong references throughout these pictures. Special reference processing, including weak references and finalization, adds rules that belong in a later lesson. **<mark>Eligible does not mean reclaimed immediately</mark>**: the collector must discover and reclaim the object in an appropriate collection.

## Where traversal begins

The chain Order → Customer → Address does not tell us whether Order itself is reachable. We need an entry point into that chain. A **GC root** is a reference starting point the JVM knows to consider when discovering live objects.

<figure>
<a href="/images/courses/jvm/gc-root-overview.svg" aria-label="Open gc root overview diagram at full size"><img src="/images/courses/jvm/gc-root-overview.svg" alt="A root-set reference named currentOrder points into the heap to Order, then Customer, then Address." width="480" height="510" /></a>
<figcaption>Start at the known reference, then follow the arrows into the heap. <a href="/images/courses/jvm/gc-root-overview.svg">Open full-size diagram</a>.</figcaption>
</figure>

For example, a live reference to Order in an executing method can keep the whole chain reachable. Address does not need a direct root reference: the path through Order and Customer is enough.

A root is not a special kind of Java object with a “root” header. We draw the root-set starting reference separately to distinguish the entry point from the ordinary object graph. Heap analyzers sometimes label the first object reached as a GC root; that reporting convention does not change the underlying reachability question.

## Root sources connect the runtime to the heap

References can come from several parts of the running JVM. The left-hand labels in this picture identify sources; the object boxes are the things they keep reachable.

<figure>
<a href="/images/courses/jvm/gc-root-sources.svg" aria-label="Open gc root sources diagram at full size"><img src="/images/courses/jvm/gc-root-sources.svg" alt="Live stack slots and registers, static state, strong JNI handles, and VM structures provide reference starting points into the heap." width="480" height="570" /></a>
<figcaption>Root sources are runtime relationships, not a new category of heap object. <a href="/images/courses/jvm/gc-root-sources.svg">Open full-size diagram</a>.</figcaption>
</figure>

Live references in **thread stack frames and registers** connect executing methods to objects. **Static state** can also keep objects reachable through a live class and its runtime relationships. Static fields are not an unconditional promise of immortality: class-loader reachability and class unloading matter. Nor does the diagram imply static fields physically live outside the heap.

Native code can hold **JNI local and strong global references**, and the JVM maintains references in **internal VM structures**. JNI weak global references have different retention semantics and are outside our strong-reference model. The exact root categories and scanning machinery depend on the JVM and collector.

## Follow one root from running code

Let's make the thread case concrete. `main` starts a platform thread named `t1`, then waits for it to finish:

```java
public static void main(String[] args)
        throws InterruptedException {
    Thread t1 = new Thread(
        RootExample::processOrder,
        "t1"
    );

    t1.start();
    t1.join();
}

static void processOrder() {
    Order order = loadOrder();
    chargeCustomer(order);
}
```

Imagine the collector examines the process while `chargeCustomer(order)` is still using the order. The running state includes both threads, but the important entry path to this object graph comes from `t1`:

<figure>
<a href="/images/courses/jvm/thread-root-example.svg" aria-label="Open thread root example diagram at full size"><img src="/images/courses/jvm/thread-root-example.svg" alt="The main thread starts t1 and waits. A live order reference in t1's executing frame or register points to Order, which points to Customer and Address." width="480" height="610" /></a>
<figcaption>The collector scans the root set for all relevant threads. Here, the live reference in <code>t1</code>'s execution state is the entry path to the Order graph. <a href="/images/courses/jvm/thread-root-example.svg">Open full-size diagram</a>.</figcaption>
</figure>

Read the path from the root reference downward:

```text
t1 stack slot or register
    └── order
          └──► Order
                  └──► Customer
                           └──► Address
```

`main` created `t1`, but that does not make the main thread the root of `Order`. The collector does not have to begin with `main` and walk through one Java-reference chain to every other thread. It builds a **root set** from all relevant runtime sources. In this snapshot, `t1`'s live `order` reference is one of those starting points. `main` may separately have a live `t1` reference in its own frame, but that is a different root path to the `Thread` object.

If `processOrder` returns and no other strong path reaches the order, the `t1` frame and its local reference disappear. The Order → Customer → Address graph can then become eligible for collection. Starting a thread does not permanently root every object it ever created.

While `order` is live, the collector still needs to find the reference whether it is held in a stack slot or a register. That reference keeps Order, Customer, Address, and everything strongly reachable from them alive. Source-level scope alone does not guarantee liveness until the closing brace: optimized code can stop needing a reference earlier.

The JVM cannot treat every machine word as an object reference. A frame may contain references, integers, saved execution state, and other values. HotSpot uses knowledge of the execution point and frame layout to identify the reference locations precisely.

For interpreted methods, HotSpot uses interpreter-frame information and reference maps for the bytecode position. For JIT-compiled methods, metadata associated with the compiled code describes where references can be found at relevant machine-code locations. Think of an **OopMap** as a map saying “this stack slot and this register contain object references.” It describes locations, not a list of every object reachable from them.

This is the connection to retain for later: the collector needs a correct root set, so the execution engine must help it interpret thread state. We'll return to compiled frames, OopMaps, and safepoints when that cooperation becomes the main topic. The code and snapshot above illustrate the relationship; they do not promise the exact machine location of `order` in every compiled execution.

## Reachability is transitive

Start at the reference at the top of the first panel. It reaches A; A reaches B; B reaches C. All three are reachable even though only A has a direct root reference.

<figure>
<a href="/images/courses/jvm/transitive-reachability.svg" aria-label="Open transitive reachability diagram at full size"><img src="/images/courses/jvm/transitive-reachability.svg" alt="Before: root reference reaches A, B and C. After removing the only root link, A, B and C are unreachable." width="480" height="590" /></a>
<figcaption>Removing the only entry path disconnects the entire chain. <a href="/images/courses/jvm/transitive-reachability.svg">Open full-size diagram</a>.</figcaption>
</figure>

Now remove the only root reference to A. B and C still have incoming references, and their fields have not changed. But those references originate inside a disconnected graph. Without another path from any root, all three become eligible for collection together.

Setting one variable to null is therefore not a universal instruction to collect an object. It removes one reference. Another local, a collection, or another root path may still reach that object.

## Cycles do not keep themselves alive

Suppose A references B and B references A. Both have incoming references, but neither has a path from the root set. Follow the arrows around the cycle: they never connect it back to the running program.

<figure>
<a href="/images/courses/jvm/unreachable-cycle.svg" aria-label="Open unreachable cycle diagram at full size"><img src="/images/courses/jvm/unreachable-cycle.svg" alt="A and B reference each other, but there is no path from the root set to either object." width="480" height="430" /></a>
<figcaption>Internal connectivity does not establish root reachability. <a href="/images/courses/jvm/unreachable-cycle.svg">Open full-size diagram</a>.</figcaption>
</figure>

A tracing collector can reclaim both objects. This is where tracing differs from simple reference counting: counting incoming references alone would miss that the entire cycle is disconnected. Ordinary cyclic Java structures do not inherently cause memory leaks. A root path into that cycle would keep it alive; the cycle itself does not.

## Marking is graph traversal

Imagine a heap where the root reaches A, and A reaches B and C. Elsewhere, D reaches E, with no connection from the roots. The three stages below show discovery rather than elapsed time.

<figure>
<a href="/images/courses/jvm/gc-mark-traversal.svg" aria-label="Open gc mark traversal diagram at full size"><img src="/images/courses/jvm/gc-mark-traversal.svg" alt="First discover A from the root. Then follow A to B and C. D and E remain undiscovered because no root path reaches them." width="480" height="620" /></a>
<figcaption>Visited objects are marked once; disconnected objects are never discovered. <a href="/images/courses/jvm/gc-mark-traversal.svg">Open full-size diagram</a>.</figcaption>
</figure>

Conceptually, the collector starts with root references and puts newly discovered objects on a worklist. It takes an object from that list, examines its outgoing references, and records newly discovered targets. It continues until no pending objects remain.

Remembering which objects have already been discovered avoids repeatedly following the same cycle. In this example A, B, and C are marked; D and E remain unmarked. Marking identifies the live graph. Reclaiming or moving memory is a subsequent part of the collector's strategy, and a mark need not mean modifying the object's header.

This is a simplified whole-heap traversal over a stable graph. Real collectors can collect selected regions or generations, and concurrent collectors must account for references changing during collection. We will add those mechanisms later; they do not turn object age or incoming-reference counts into substitutes for reachability.

## A Java heap leak usually contains reachable objects

Return to the customer data that survived processing. Suppose the application keeps an ever-growing cache:

```java
static Map<String, Object> cache =
    new HashMap<>();
```

Assume its class remains live, and the application continually inserts new keys and values without eviction. The static reference reaches the map, which reaches its entries and their values. Follow that path in the picture.

<figure>
<a href="/images/courses/jvm/reachable-leak.svg" aria-label="Open reachable leak diagram at full size"><img src="/images/courses/jvm/reachable-leak.svg" alt="Live static cache reference reaches a map, whose entries retain more and more values." width="480" height="510" /></a>
<figcaption>Unwanted data can remain strongly reachable; the collector preserves it. <a href="/images/courses/jvm/reachable-leak.svg">Open full-size diagram</a>.</figcaption>
</figure>

The application no longer needs some values, but it still holds paths to them. The collector cannot infer the application's intention. It correctly preserves reachable objects, so repeated collections cannot repair an unbounded retention policy.

This is the usual shape of a Java **heap-retention leak**: unwanted reachability rather than a failed collector. Native-memory and resource leaks need their own diagnosis. Even on the heap, a single large snapshot does not prove a leak; a deliberately sized cache can be legitimate. The important question is whether the retained data and its lifetime match the application's needs.

## Paths to GC roots explain survival

A heap histogram tells you which classes occupy memory. To understand why one Customer survives, inspect its incoming references and work back toward a root. A heap analyzer calls this a **path to GC roots**.

<figure>
<a href="/images/courses/jvm/path-to-gc-root.svg" aria-label="Open path to gc root diagram at full size"><img src="/images/courses/jvm/path-to-gc-root.svg" alt="A static cache reference reaches HashMap, its table, an entry, and Customer. Reference arrows point from root toward Customer; diagnosis traces the chain back." width="480" height="600" /></a>
<figcaption>The arrows show retention direction; diagnosis can follow the chain backwards. <a href="/images/courses/jvm/path-to-gc-root.svg">Open full-size diagram</a>.</figcaption>
</figure>

Here, Customer is an entry value, the entry is reachable through the map's table, and the map is held by the live cache. Removing the entry can break this path. It only makes Customer collectible if no other strong root path remains. A request still in flight or a second cache might provide another one.

Heap tools can filter paths by reference strength. Keep those settings in mind: a weak-reference path does not establish the same retention as the strong paths shown here. Finding one path explains survival; finding and removing one path does not prove that all paths are gone.

## From reachable size to retained size

Lesson 3 separated an object's **shallow size** from the objects it references. Retained size asks a different question: how much memory would become eligible for collection if this object were removed from the reachable graph?

<figure>
<a href="/images/courses/jvm/dominator-intuition.svg" aria-label="Open dominator intuition diagram at full size"><img src="/images/courses/jvm/dominator-intuition.svg" alt="In the first graph every path to B and C passes through A. In the second graph a root bypasses A to reach B, so B and C survive without A." width="480" height="620" /></a>
<figcaption>An alternate root path changes which objects A retains. <a href="/images/courses/jvm/dominator-intuition.svg">Open full-size diagram</a>.</figcaption>
</figure>

In the first panel, all paths to B and C pass through A. A therefore **dominates** B and C. Its retained set includes itself and those objects, and its retained size is the sum of their shallow sizes. A small object can consequently retain a large graph.

In the second panel, a root reaches B without passing through A. Removing A leaves B reachable, and B still reaches C. Neither B nor C belongs to A's retained set in that graph. Merely adding up everything reachable from A would overstate what A alone retains.

This is the intuition behind a dominator tree: it organizes objects by which objects every root path must pass through. Its edges describe domination, not necessarily direct Java field references. We do not need the construction algorithm yet; we need the alternate-path check before interpreting a large retained-size number.

## Check your reasoning

Use the marking picture again: a root reaches A, A reaches B and C, and a disconnected D references E. Now add a reference from E back to D.

<details class="lesson-check">
<summary>Which objects can be reclaimed? What if another root reaches E?</summary>
<p>A, B, and C remain reachable. D and E form a cycle, but no root reaches it, so both are eligible for collection. If another root reaches E, E becomes reachable and its reference to D makes D reachable too. Both must be preserved. The number of arrows was never the deciding factor; the root paths were.</p>
</details>

<details class="lesson-check">
<summary>A reaches B and C, but a second root reaches B. Does A retain both?</summary>
<p>Use the second dominator panel, where B references C. The alternate root reaches B and then C without A. A therefore retains neither B nor C, even though both are reachable from A. Removing a single path is not the same as removing all root paths.</p>
</details>

## Keep the graph model

We can now connect object layout to lifetime. Layout tells us what a node occupies; references connect the nodes; root-set starting references let the collector discover the live graph. This also gives us a practical debugging question: **which root path keeps this unwanted object alive?**

The next [Lesson 5: mark-sweep, mark-compact, and copying](/courses/jvm/gc-reclamation-strategies) moves from deciding what is live to deciding how to reclaim and organize memory. Fragmentation and allocation speed will help explain why those strategies differ.

<details class="lesson-sources">
<summary>Sources and further reading</summary>
<ul>
<li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-collector-implementation.html">Oracle GC guide: reachability and collection strategy</a></li>
<li><a href="https://docs.oracle.com/javase/specs/jls/se25/html/jls-12.html#jls-12.6.1">JLS §12.6.1: reachability and optimized reference liveness</a></li>
<li><a href="https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/compiler/oopMap.hpp">HotSpot JDK 25: OopMap metadata</a></li>
<li><a href="https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/runtime/frame.cpp">HotSpot JDK 25: interpreted and compiled frame reference scanning</a></li>
<li><a href="https://help.eclipse.org/latest/topic/org.eclipse.mat.ui.help/concepts/gcroots.html">Eclipse MAT: reported GC root categories</a></li>
<li><a href="https://help.eclipse.org/latest/topic/org.eclipse.mat.ui.help/concepts/shallowretainedheap.html">Eclipse MAT: shallow and retained heap</a></li>
<li><a href="https://help.eclipse.org/latest/topic/org.eclipse.mat.ui.help/concepts/dominatortree.html">Eclipse MAT: dominator trees</a></li>
</ul>
</details>
