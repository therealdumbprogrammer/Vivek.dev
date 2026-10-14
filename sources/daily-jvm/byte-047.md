# Daily JVM Byte #47 — ZGC vs G1: How Concurrent Relocation Changes GC Architecture

**Baseline:** JDK 25 LTS  
**Focus:** Colored pointers, load barriers, concurrent relocation, and GC trade-offs

In Byte #46, we examined what happens when G1 cannot evacuate objects successfully.

Today we explore a fundamentally different design: **ZGC moves objects while application threads continue executing.**

Both G1 and ZGC are generational, tracing, compacting collectors. Their biggest architectural difference is *when they move objects and how they keep references correct*.

In JDK 25, ZGC is exclusively generational. The non-generational implementation was removed in JDK 24 under JEP 490. [OpenJDK Mail](https://mail.openjdk.org/pipermail/client-libs-dev/2024-October/023258.html?utm_source=chatgpt.com)

## 1. Why G1 needs stop-the-world evacuation

Recall the normal G1 collection:

```text
Application threads
        │
        ▼
   Safepoint
        │
        ▼
Identify live objects
        │
        ▼
Copy surviving objects
        │
        ▼
Update references
        │
        ▼
Resume application
```

G1 performs its evacuation work during a stop-the-world pause.

Why?

Consider:

```text
Customer ─────► Order @ 0x1000
```

Suppose GC moves `Order`:

```text
Old address: 0x1000
New address: 0x5000
```

Every reference to that object must eventually resolve to the new location.

If application threads are running simultaneously, one thread might still attempt to access `0x1000`.

G1 avoids this problem during evacuation by stopping mutators while the relevant objects are moved and references are updated.

**ZGC takes a different approach: allow references to be repaired while mutators run.**

---

## 2. ZGC's central idea: colored pointers

Normally, we imagine an object reference as an address:

```text
reference = 0x1000
```

ZGC uses **colored pointers**.

Conceptually, a reference contains:

```text
64-bit reference

┌───────────────────────┬────────────────────┐
│ GC metadata bits      │ Address information│
└───────────────────────┴────────────────────┘
```

The metadata helps ZGC determine whether a reference is in an appropriate state for the current GC phase.

This allows ZGC to distinguish between references that can be used immediately and references requiring additional processing.

Importantly, these are properties encoded in the **reference**, not simply an extra field inside every Java object.

The precise bit layout is implementation-specific and has evolved across ZGC versions.

---

## 3. Load barriers: repairing references during execution

Suppose an application executes:

```java
Order order = customer.getOrder();
```

The compiled code needs to load an object reference.

ZGC can associate this operation with a **load barrier**.

Conceptually:

```text
Load object reference
        │
        ▼
Check reference metadata
        │
   ┌────┴─────┐
   │          │
 Valid     Needs processing
   │          │
   ▼          ▼
Continue   Barrier slow path
              │
              ▼
        Resolve reference
              │
              ▼
           Continue
```

Now imagine GC has relocated an object:

```text
Before:

Customer ─────► Order @ 0x1000


After relocation:

Customer ─────► old reference
                     │
                     ▼
                forwarding information
                     │
                     ▼
                Order @ 0x5000
```

When the application loads a reference requiring remapping, ZGC can resolve the object's current location using relocation metadata.

The application continues with a usable reference.

This is often described as **self-healing references**.

The important distinction is that ZGC does not require every reference to be updated in one large stop-the-world operation.

---

## 4. Concurrent relocation becomes possible

We can now understand the architectural difference.

### G1

```text
Mutators:  ██████████          ██████████
GC:                  [Evacuate]
                     STW pause
```

### ZGC

```text
Mutators:  ████████████████████████████
GC:             ███████████████
                 Concurrent relocation
```

ZGC still requires brief stop-the-world coordination phases.

However, expensive operations such as object marking and relocation occur predominantly concurrently.

That is why ZGC targets substantially shorter GC pauses than G1, with pause duration designed to be largely independent of heap size. [Oracle Docs](https://docs.oracle.com/en/java/javase/17/gctuning/z-garbage-collector1.html?utm_source=chatgpt.com)

**Concurrent relocation does not mean zero synchronization.** It means most relocation work is moved outside global application pauses.

---

## 5. Generational ZGC also needs store barriers

There is another complication.

Like G1, ZGC separates objects into young and old generations.

```text
ZGC Heap

Young generation
    │
    └── recently allocated objects

Old generation
    │
    └── longer-lived objects
```

Consider:

```java
oldCustomer.latestOrder = youngOrder;
```

This creates:

```text
Old object ─────► Young object
```

A young-generation collection must account for references from old objects into young objects.

Generational ZGC therefore uses **store barriers** to maintain the information needed for generational collection.

The simplified distinction is:

| Mechanism | Primary purpose |
|---|---|
| Load barriers | Maintain correct reference access during concurrent GC |
| Store barriers | Track reference modifications and support generational GC invariants |
| Colored pointers | Encode GC state in object references |

A useful correction to a common simplification:

**G1 does not use only write barriers, and ZGC does not use only load barriers.** Their barrier designs differ because their collection algorithms maintain different invariants.

---

## 6. What does ZGC pay for shorter pauses?

Moving work out of stop-the-world pauses does not eliminate its cost.

Consider two execution models.

**G1:**

```text
Application execution
       ↓
GC pause
       ↓
Application execution
```

**ZGC:**

```text
Application execution
       +
Concurrent GC threads
       +
Reference barrier overhead
```

ZGC introduces several trade-offs.

**CPU overhead:** Concurrent marking and relocation consume CPU while application threads run.

**Barrier overhead:** Additional instructions are executed on relevant reference accesses.

**Memory headroom:** ZGC needs enough available heap space for allocations to continue while collection is underway.

**Throughput:** Some workloads achieve lower maximum application throughput than with G1.

In exchange, ZGC can substantially reduce GC-related tail latency.

The JDK 25 documentation explicitly describes this latency-versus-throughput trade-off. [Oracle Docs](https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html?utm_source=chatgpt.com)

---

## 7. What happens if ZGC cannot keep up?

Concurrent collection introduces another important constraint.

Suppose:

```text
Application allocation rate = 2 GB/sec

GC reclamation rate         = 1 GB/sec
```

These are illustrative rates.

If the imbalance continues, available heap space decreases.

Eventually:

```text
Available allocation space
          ↓
       exhausted
          ↓
   Allocation stalls
```

ZGC may need to make allocating threads wait while it attempts to recover space.

If sufficient space cannot be recovered, allocation can ultimately fail with `OutOfMemoryError`.

So ZGC is not immune to memory pressure.

Its low-pause architecture depends on having sufficient **heap headroom and concurrent GC capacity**.

---

## 8. Production comparison: G1 vs ZGC

| Dimension | G1 | Generational ZGC |
|---|---|---|
| Default in JDK 25 | Yes | No |
| Generational | Yes | Yes |
| Concurrent marking | Yes | Yes |
| Concurrent relocation | No, normal evacuation is STW | Yes |
| GC pauses | Generally milliseconds to potentially much longer | Designed for very short pauses |
| Main strength | Balanced throughput and latency | Low GC-related tail latency |
| Primary trade-off | Evacuation pause work | Concurrent CPU, barriers, heap headroom |
| Typical starting point | General server applications | Strict latency-sensitive applications |

Neither collector is universally faster.

For example, if an application has a 500 ms response-time SLO and G1 pauses are consistently below 20 ms, switching to ZGC might provide little practical benefit.

Conversely, if an application has a strict 10 ms tail-latency budget, G1's evacuation pauses may become a significant concern.

These are starting hypotheses, not substitutes for workload benchmarks.

---

## 9. A small JDK 25 experiment

You can compare both collectors using the same application.

**G1:**

```bash
java \
  -Xms2g \
  -Xmx2g \
  -XX:+UseG1GC \
  -Xlog:gc*:file=g1.log:time,uptime,level,tags \
  -jar application.jar
```

**ZGC:**

```bash
java \
  -Xms2g \
  -Xmx2g \
  -XX:+UseZGC \
  -Xlog:gc*:file=zgc.log:time,uptime,level,tags \
  -jar application.jar
```

No `-XX:+ZGenerational` flag is required in JDK 25.

Compare the following under equivalent load: maximum and percentile GC pause times, application throughput, p99 response latency, CPU consumption, and memory usage.

Do not compare only GC pause duration. The objective is better **application performance**, not simply smaller GC numbers.

---

## Mental model checkpoint

We now understand three important GC design dimensions:

```text
                    Garbage Collection
                            │
           ┌────────────────┼────────────────┐
           │                │                │
        Marking          Relocation       Reference
                                          correctness
           │                │                │
    ┌──────┴──────┐   ┌─────┴─────┐     ┌────┴─────┐
    │             │   │           │     │          │
   STW        Concurrent STW    Concurrent  Barriers/metadata
```

G1 combines concurrent old-generation marking with stop-the-world evacuation.

ZGC takes concurrency further by allowing object relocation while application threads execute, using colored pointers and barriers to preserve reference correctness.

### Key takeaway

**ZGC's defining innovation is not simply faster garbage collection. It changes how GC work is scheduled and how references remain correct during concurrent object movement.**

The cost shifts from relatively larger global pauses toward ongoing concurrent work and barrier overhead.

That architectural trade-off is what makes ZGC attractive for applications with demanding tail-latency requirements.

**Next byte — #48: ZGC's concurrent relocation protocol.** We'll trace one object as it moves, examining forwarding information, reference remapping, load-barrier slow paths, and how HotSpot prevents mutators from observing an invalid object location.

**Primary references:** [OpenJDK JEP 439 — Generational ZGC](https://openjdk.org/jeps/439?utm_source=chatgpt.com) · [OpenJDK JEP 490 — Remove Non-Generational ZGC](https://openjdk.org/jeps/490?utm_source=chatgpt.com) · [Oracle ZGC documentation](https://docs.oracle.com/en/java/javase/17/gctuning/z-garbage-collector1.html?utm_source=chatgpt.com)