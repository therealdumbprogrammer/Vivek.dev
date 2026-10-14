# Daily JVM Byte #49 — GC Barriers Inside JIT-Generated Machine Code

**Baseline:** JDK 25 LTS  
**Focus:** How C2 generates GC barriers, fast/slow paths, barrier optimization, and runtime overhead.

In Byte #47, we learned how ZGC uses load and store barriers. In Byte #48, we examined how those barriers support concurrent relocation.

Today we connect these mechanisms to the **JIT compiler**.

The central question:

> When Java executes a simple field assignment, how does HotSpot inject the additional instructions required by the garbage collector?

## 1. A Java assignment is not necessarily one machine instruction

Consider:

```java
class Customer {
    Order latestOrder;
}

void update(Customer customer, Order order) {
    customer.latestOrder = order;
}
```

At the bytecode level, the important operation is:

```text
putfield Customer.latestOrder
```

Conceptually, without GC barriers, compiled code might perform:

```text
calculate field address
        ↓
store object reference
```

However, garbage collectors need to maintain additional information about object references.

For G1, that might mean recording overwritten references or tracking modified cards.

For ZGC, it may involve ensuring reference correctness during concurrent relocation and maintaining generational metadata.

Therefore, compiled execution can look more like:

```text
Java reference assignment
          │
          ▼
     GC pre-barrier
          │
          ▼
     Reference store
          │
          ▼
     GC post-barrier
```

This is a conceptual sequence, not a universal instruction sequence. The actual barriers depend on the collector, operation, and compiler optimizations.

---

## 2. How does C2 know which barriers to generate?

HotSpot has a **BarrierSet** abstraction.

Its purpose is to let different garbage collectors provide their own reference-access semantics without requiring the JIT compiler to hardcode every collector's behavior.

Conceptually:

```text
                  Java bytecode
                       │
                       ▼
                 C2 compiler
                       │
                       ▼
                Memory access
                       │
                       ▼
                 BarrierSetC2
                       │
             ┌─────────┴─────────┐
             │                   │
             ▼                   ▼
       G1BarrierSetC2      ZBarrierSetC2
             │                   │
             ▼                   ▼
       G1 barriers          ZGC barriers
             │                   │
             └─────────┬─────────┘
                       ▼
               Machine code
```

C2 initially works with an intermediate representation (IR), not directly with final CPU instructions.

Collector-specific barrier logic participates in IR construction and subsequent optimization/lowering.

The resulting machine code contains the necessary reference-access checks, bookkeeping, and runtime calls.

This separation is visible in the JDK 25 HotSpot implementation. [GitHub](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/g1/c2/g1BarrierSetC2.cpp)

---

## 3. G1: What happens during a reference assignment?

Consider:

```java
customer.latestOrder = newOrder;
```

Suppose the existing reference points to `oldOrder`.

```text
Before:

Customer ─────► oldOrder

After:

Customer ─────► newOrder
```

G1 may need two different kinds of bookkeeping.

### A. SATB pre-write barrier

During concurrent marking, G1 must preserve information about overwritten references.

Conceptually:

```text
Read old reference
       ↓
Is concurrent SATB marking active?
       │
       ├── No  → continue
       │
       └── Yes
             ↓
       Record old reference
             ↓
       Continue
```

This prevents the concurrent marker from losing track of objects that belonged to its logical marking snapshot.

The pre-barrier is conditional. It does not necessarily enqueue something for every reference assignment.

### B. Post-write/card barrier

After the reference is stored, G1 must maintain information needed to discover relevant cross-region references.

```text
Store new reference
        ↓
Check whether card bookkeeping is required
        ↓
Mark card dirty
        ↓
Make information available for refinement/GC
```

The collector can later use this information to avoid scanning unrelated heap regions during young collections.

**Important:** SATB and card-table barriers serve different purposes. One supports concurrent marking; the other supports remembered-set maintenance.

---

## 4. ZGC: Load barriers enter the execution path

Now consider:

```java
Order order = customer.latestOrder;
```

Under ZGC, the compiled reference load may require a load barrier.

Conceptually:

```text
Load reference
      │
      ▼
Check pointer metadata
      │
   ┌──┴────────────┐
   │               │
Usable          Needs processing
   │               │
   ▼               ▼
Continue       Barrier slow path
                   │
                   ▼
              Resolve reference
                   │
                   ▼
                Continue
```

The fast path is designed to be inexpensive.

The slow path handles less common conditions, such as references requiring remapping during relocation.

Generational ZGC also uses store barriers for reference modifications and generational bookkeeping.

The exact barrier implementation is more sophisticated than a simple conditional around every Java load or store. C2 can specialize and optimize barriers based on the access and known object state. [GitHub](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/z/c2/zBarrierSetC2.cpp)

---

## 5. Why fast and slow paths matter

Suppose a hot method executes 100 million reference loads.

If every load required a full runtime call, the overhead would be substantial.

Instead, HotSpot tries to generate something conceptually like:

```text
load reference
      ↓
cheap condition check
      ↓
usually continue
```

Only exceptional cases enter the slow path.

```text
                    Reference load
                          │
                          ▼
                      Fast check
                          │
                ┌─────────┴─────────┐
                │                   │
             Common              Uncommon
                │                   │
                ▼                   ▼
          Continue             Runtime stub
                                    │
                                    ▼
                              Resolve state
                                    │
                                    ▼
                                Continue
```

This design reduces average overhead, although even the fast path may consume instructions, registers, and memory-system resources.

A slow path can also affect individual request latency despite very short global GC pauses.

---

## 6. Can C2 optimize barriers away?

Yes, **when it can prove that doing so preserves the collector's invariants**.

Consider:

```java
void process(Order order) {
    Holder holder = new Holder();
    holder.value = order;
    consume(holder);
}
```

Several optimizations are possible.

If escape analysis proves the `Holder` object does not need to exist physically, C2 may eliminate its allocation through scalar replacement.

Conceptually:

```text
Original:

allocate Holder
       ↓
store reference
       ↓
GC barrier bookkeeping


Optimized:

no physical Holder allocation
       ↓
no corresponding heap reference store
       ↓
no barrier needed for that store
```

This is an important connection between **escape analysis and GC performance**.

Eliminating an allocation can also eliminate the associated memory accesses and barrier work.

Other cases allow barrier elimination or simplification because C2 knows the access cannot violate a relevant GC invariant.

However, a barrier cannot be removed merely because its result is invisible to Java code.

The garbage collector depends on its effects for correctness.

---

## 7. GC barriers are not the same as Java memory barriers

This distinction matters.

A **GC barrier** maintains garbage-collector invariants.

A **memory-ordering barrier or fence** enforces ordering constraints required by the memory model and hardware.

For example:

```java
volatile Order latestOrder;
```

A volatile assignment has Java Memory Model requirements.

If the selected GC also needs reference-store barriers, both sets of requirements must be satisfied.

```text
Reference assignment
       │
       ├── Java Memory Model requirements
       │       └── ordering/visibility
       │
       └── GC requirements
               └── marking/remembered sets/relocation
```

The compiler may combine or optimize machine-level operations where legal, but the responsibilities are conceptually distinct.

---

## 8. What does this cost in production?

The trade-off is not simply “more instructions versus fewer instructions.”

Barriers can introduce several costs:

| Cost | Explanation |
|---|---|
| Instruction overhead | Additional checks and bookkeeping |
| Branching | Fast-path conditions and occasional slow paths |
| Memory traffic | Card-table updates, metadata accesses, buffers |
| CPU cache effects | Additional memory locations accessed |
| Runtime assistance | Slow-path calls or relocation work |

The actual cost depends on the collector, workload, hardware, and generated code.

For example, an application dominated by reference-heavy graph traversal may expose different ZGC overhead characteristics from one dominated by primitive arithmetic.

Similarly, an application frequently modifying references can generate substantial G1 card-marking activity.

**This is one reason GC choice can affect application throughput even when GC pause times are negligible.**

---

## 9. Where to find this in HotSpot

The JDK 25 source provides three useful starting points:

| Source | Responsibility |
|---|---|
| `gc/shared/c2/barrierSetC2.cpp` | Shared C2 barrier infrastructure |
| `gc/g1/c2/g1BarrierSetC2.cpp` | G1-specific C2 barriers |
| `gc/z/c2/zBarrierSetC2.cpp` | ZGC-specific C2 barriers |

Read the collector-specific implementation alongside the shared infrastructure rather than treating barrier generation as an isolated compiler feature.

Verified JDK 25 source files:

- [BarrierSetC2 — shared implementation](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/shared/c2/barrierSetC2.cpp)
- [G1BarrierSetC2 — G1 implementation](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/g1/c2/g1BarrierSetC2.cpp)
- [ZBarrierSetC2 — ZGC implementation](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/z/c2/zBarrierSetC2.cpp)

---

## Mental model checkpoint

We can now connect Java code, JIT compilation, and garbage collection:

```text
Java source
    │
    ▼
Bytecode
    │
    ▼
C2 compiler
    │
    ├── Inlining
    ├── Escape analysis
    ├── Scalar replacement
    │
    ▼
Memory access IR
    │
    ▼
Collector-specific BarrierSet
    │
    ├── G1: SATB / card barriers
    │
    └── ZGC: load / store barriers
    │
    ▼
Optimized machine code
    │
    ▼
CPU execution
    │
    ├── Common barrier fast paths
    │
    └── Occasional slow paths
```

This also connects back to our earlier lessons on allocation elimination and speculative JIT optimization.

### Key takeaway

**GC barriers are part of the machine code executed by application threads, not merely work performed by background GC threads.**

HotSpot's JIT compiler generates collector-specific barriers, optimizes them where correctness permits, and uses fast/slow paths to reduce their runtime cost.

This explains a fundamental GC trade-off: reducing stop-the-world work often requires additional coordination during normal application execution.

### Next byte — #50: How to measure GC overhead beyond pause times

We'll examine how to distinguish GC pause time, concurrent GC CPU consumption, allocation stalls, and mutator-side overhead—and why two collectors with similar pause metrics can produce different application throughput and p99 latency.