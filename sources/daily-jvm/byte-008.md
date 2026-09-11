8th bytes



Roughly **60–75 daily bytes** for a solid end-to-end JVM mastery horizon at the current depth.

- **Foundation + memory model:** \~10 days
- **GC fundamentals + collectors:** \~15–20 days
- **Bytecode, interpreter, JIT, profiling, deoptimization:** \~15–20 days
- **Threads, synchronization, safepoints:** \~8–10 days
- **Class loading, Metaspace, native memory:** \~6–8 days
- **HotSpot internals + diagnostics integration:** \~10–15 days

So at one byte per day, expect about **2–2.5 months**.

We’re currently on **Byte #7**, so around **50–65 days remain** depending on how deeply we go into G1/ZGC/JIT/HotSpot internals.

## Daily JVM Byte #8 — TLABs and why object allocation is usually very cheap

Yesterday we saw how generational GC makes young-object reclamation efficient. Today, move one step earlier in the lifecycle:
```
Before GC can reclaim objects,
the JVM first has to allocate them.
```

A common misconception is that `new` is inherently expensive because it allocates memory.

In HotSpot, ordinary small-object allocation is often extremely cheap.

### The core problem

Imagine many application threads allocating simultaneously:
```
Thread A ─┐
Thread B ─┼──► Eden
Thread C ─┤
Thread D ─┘
```

If every allocation had to modify one shared heap pointer under a lock, allocation would become a major contention point.

HotSpot avoids this using **Thread-Local Allocation Buffers**, or TLABs.

Oracle’s JDK 25 troubleshooting documentation describes TLABs as small memory areas used for new-object allocation; when a TLAB fills, the thread obtains another one. Larger objects can be allocated outside a TLAB. [Oracle Docs](https://docs.oracle.com/en/java/javase/25/troubleshoot/troubleshooting-guide.pdf?utm_source=chatgpt.com)

---

## 1. Eden is divided into private allocation chunks

Conceptually:
```
Young Generation / Eden

+-------------------------------+
| TLAB A | TLAB B | TLAB C |...|
+-------------------------------+
    ▲        ▲        ▲
 Thread A Thread B Thread C
```

Each thread gets a private portion of Eden.

Inside its TLAB, a thread can allocate without coordinating with other threads.

A simplified TLAB contains:
```
start
  │
  ▼
+-----------------------------+
| allocated |      free       |
+-----------------------------+
            ▲
           top
```

Allocation then becomes approximately:
```
address = top
top += objectSize
```

plus a bounds check:
```
if top <= tlabEnd
    allocation succeeds
```

That is **bump-pointer allocation**.

No general-purpose `malloc()` is required for each Java object.

---

## 2. Why TLAB allocation is so fast

Suppose:
```
Customer c = new Customer();
```

Ignoring constructor execution and optimization effects, the allocation fast path is roughly:
```
1. determine object size
2. check remaining TLAB capacity
3. advance TLAB pointer
4. initialize object memory/header
```

Because the TLAB belongs exclusively to the current thread:
```
no global lock
no free-list search
no contention with other allocating threads
```

This is why short-lived Java objects are often cheaper than developers intuitively expect.

The expensive part of allocation-heavy workloads is frequently not the allocation instruction itself.

It is eventually:
```
allocation
   ↓
heap consumption
   ↓
GC work
```

---

## 3. What happens when the TLAB fills?

Suppose:
```
Thread A TLAB

[objects..................][tiny remainder]
```

and the next object does not fit.

HotSpot may retire that TLAB and obtain another chunk from Eden:
```
old TLAB
   ↓
retired

new Eden space
   ↓
new TLAB
```

Obtaining a new TLAB requires coordination with the shared allocation region, so it is more expensive than allocating *inside* an existing TLAB.

But this happens once per many allocations rather than once per object.

So the cost is amortized.

---

## 4. Some objects allocate outside the TLAB

An object may bypass the TLAB when it is unsuitable for the remaining/private buffer—for example, sufficiently large allocations can take a slower shared allocation path.

Conceptually:
```
small normal allocation
       ↓
      TLAB
       ↓
fast path

large / unsuitable allocation
       ↓
shared heap allocation path
       ↓
slower path
```

The exact thresholds and policies are implementation details and can vary.

The important distinction is:
```
allocation inside TLAB
vs
allocation outside TLAB
```

JDK Flight Recorder exposes this distinction directly through events such as:
```
jdk.ObjectAllocationInNewTLAB
jdk.ObjectAllocationOutsideTLAB
```

JDK 25 documentation specifically recommends these events when investigating allocation behavior. [Oracle Docs](https://docs.oracle.com/en/java/javase/25/troubleshoot/troubleshooting-guide.pdf?utm_source=chatgpt.com)

---

## 5. TLABs are thread-local, not object-local

Do not confuse:
```
TLAB
```

with:
```
ThreadLocal<T>
```

A TLAB is a HotSpot allocation mechanism.

Its purpose is essentially:
```
give each allocating thread
a private slice of Eden
```

Objects allocated there are still ordinary heap objects.

Once allocated:
```
Thread A allocates Object X
```

another thread can reference `X` normally.

The object does not remain "owned" by Thread A.

---

## 6. What about virtual threads in JDK 25?

This is worth separating carefully.

JDK 25 has both platform threads and virtual threads; virtual threads are scheduled by the Java runtime over a smaller set of carrier/platform threads. [Oracle Docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html?utm_source=chatgpt.com)

Do not build the mental model:
```
millions of virtual threads
=
millions of large permanently reserved Eden chunks
```

TLAB sizing and ownership are HotSpot implementation details, and buffers are managed dynamically. The important architectural point remains that HotSpot uses thread-local allocation state to avoid turning normal heap allocation into a globally contended operation.

We will revisit virtual-thread runtime mechanics separately when we reach JVM threading.

---

## Production implication

Suppose profiling shows:
```
2 GB/s allocation rate
```

That does **not** mean the application is spending huge amounts of CPU calling an expensive memory allocator.

The more useful question is:
```
What happens to those objects afterward?
```

For example:
```
2 GB/s allocation
+
99% dies in young generation
```

may work surprisingly well.

But:
```
2 GB/s allocation
+
high survival
+
promotion
```

creates much more GC pressure.

This connects directly to our previous bytes:
```
TLAB
  ↓
cheap allocation
  ↓
Eden
  ↓
Young GC
  ↓
survivors
  ↓
promotion
  ↓
Old generation
```

### Diagnostic angle

In JFR, useful signals include:
```
Thread Allocation Statistics
Object Allocation in New TLAB
Object Allocation Outside TLAB
```

These help answer different questions:
```
Which threads allocate heavily?
Which object types drive allocation?
Are significant allocations bypassing normal TLAB use?
```

This is often more useful than merely observing that GC happens frequently.

---

## Mental model update

We can now see why the generational heap is optimized at both ends:
```
                 Allocation
                     │
                     ▼
                Thread TLAB
                     │
              bump-pointer write
                     │
                     ▼
                   Eden
                     │
                 Young GC
                     │
            mostly dead objects
                     │
          cheap bulk reclamation
```

So HotSpot exploits two workload properties simultaneously:
```
Allocation is frequent
→ make allocation almost trivial

Most objects die young
→ make reclamation cheap
```

That combination is one of the core reasons managed allocation can perform so well.

**Next byte:** escape analysis and scalar replacement — why some Java objects written with `new` may never need a normal heap allocation at all.