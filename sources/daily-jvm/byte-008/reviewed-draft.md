Byte #8 is a good chapter, but I’d tighten three things before converting it:

- **TLABs are not literally a permanent partition of Eden.** Think of them as thread-private allocation slices obtained from the collector’s current allocation area.
- With **virtual threads**, the important correction is stronger: millions of virtual threads do **not** imply millions of TLABs. A virtual thread executes mounted on a carrier platform thread, and HotSpot’s native thread allocation state includes the TLAB. citeturn723960search1turn723960search4
- `jdk.ObjectAllocationInNewTLAB` does **not mean “event for every allocation inside a TLAB.”** It represents an allocation associated with obtaining a new TLAB. For general allocation-pressure profiling, `ObjectAllocationSample` is also important. citeturn723960search3turn390219search0

I’d make this another visual chapter, especially around the difference between **shared allocation → private TLAB → local bump pointer**.

## Draft — Lesson 8: TLABs and why object allocation is usually very cheap

```markdown
---
title: TLABs and why object allocation is usually very cheap
summary: See how HotSpot turns ordinary object allocation into a mostly thread-local bump-pointer operation, and why allocation rate and GC pressure are different problems.
course: jvm
lessonSlug: tlabs-allocation
module: Foundations
order: 80
sourceByte: byte-008
draft: false
prerequisites:
  - write-barriers-card-tables
jdk: HotSpot · allocation internals
---

So far, most of our GC discussion has focused on what happens **after objects have been allocated**.

We followed objects through:

```text
Eden
  │
  ▼
Young GC
  │
  ▼
Survivor
  │
  ▼
Old Generation
```

But before a collector can reclaim anything, application threads first need to create those objects.

Consider something completely ordinary:

```java
Customer customer = new Customer();
```

It is tempting to think:

```text
new
 │
 ▼
ask operating system for memory
 │
 ▼
expensive allocation
```

That is usually the wrong mental model for ordinary HotSpot heap allocation.

For many small objects, the fast path is much closer to:

```text
check pointer
    │
    ▼
advance pointer
    │
    ▼
initialize object
```

The mechanism that makes this scalable across many allocating threads is the **Thread-Local Allocation Buffer**, or **TLAB**.

<figure>
<a href="/images/courses/jvm/tlab-overview.svg" aria-label="Open the TLAB overview">
<img src="/images/courses/jvm/tlab-overview.svg"
     alt="Several application threads obtain private allocation buffers from young heap allocation space and allocate independently inside them."
     width="840" height="500" />
</a>
<figcaption>Threads obtain private allocation areas so ordinary object creation does not require coordination on every allocation.</figcaption>
</figure>

## Start with the contention problem

Imagine four application threads all allocating objects:

```text
Thread A ─┐
Thread B ─┤
Thread C ─┼────► Heap allocation area
Thread D ─┘
```

Suppose the heap had only one shared allocation pointer:

```text
allocated                     free
████████████████████│....................
                    ▲
               shared top
```

Every new object would need to change:

```text
top
```

Now imagine:

```text
Thread A: new Customer()
Thread B: new Order()
Thread C: new byte[128]
Thread D: new RequestContext()
```

all at the same time.

If all of them had to serialize behind one lock:

```text
Thread A ─┐
Thread B ─┤
Thread C ─┼──► LOCK ───► shared top
Thread D ─┘
```

allocation would become a major scalability bottleneck.

But allocations are one of the most frequent operations in Java applications.

HotSpot therefore tries to remove that coordination from the common path.

## Give each allocating thread some private space

Instead of making every allocation compete for the same heap pointer, HotSpot can give a thread its own small allocation area.

Conceptually:

```text
Heap allocation area

┌────────────┬────────────┬────────────┬─────────────┐
│   TLAB A   │   TLAB B   │   TLAB C   │ other free  │
└────────────┴────────────┴────────────┴─────────────┘
      ▲            ▲            ▲
      │            │            │
 Thread A       Thread B     Thread C
```

A TLAB is therefore:

> **A portion of heap allocation space reserved for one HotSpot execution thread to allocate from without coordinating with other allocating threads on every object.**

For a traditional generational layout, it is useful to picture TLABs being obtained from Eden:

```text
Young / Eden allocation space

┌──────────────────────────────────────────────────┐
│ TLAB A │ TLAB B │ TLAB C │ unused allocation... │
└──────────────────────────────────────────────────┘
```

But don't treat this as a permanent physical partition.

The collector supplies allocation space, and threads obtain TLABs from it dynamically.

With a region-based collector such as G1, for example, the backing allocation area is managed through heap regions rather than one permanently contiguous physical Eden block.

## Inside the TLAB, allocation becomes local

Zoom into Thread A's TLAB:

```text
TLAB A

start
  │
  ▼
┌──────────────────────────────────────────────┐
│ Object │ Object │ Object │       FREE       │
└──────────────────────────────────────────────┘
                         ▲                    ▲
                        top                  end
```

Only Thread A allocates through this TLAB.

So Thread A can create another object approximately by doing:

```text
newTop = top + objectSize

if newTop <= end:
    objectAddress = top
    top = newTop
```

Visually:

```text
BEFORE

allocated                         free
████████████████│.........................
                ▲
               top


allocate 24-byte object


AFTER

allocated                              free
██████████████████████│...................
                      ▲
                     top
```

<figure>
<a href="/images/courses/jvm/tlab-bump-pointer.svg" aria-label="Open the TLAB bump-pointer allocation diagram">
<img src="/images/courses/jvm/tlab-bump-pointer.svg"
     alt="Inside a thread-local allocation buffer, the allocation pointer advances through contiguous free space as each object is allocated."
     width="820" height="450" />
</a>
<figcaption>The common allocation path is essentially a bounds check followed by advancing a thread-local pointer.</figcaption>
</figure>

This is the same **bump-pointer allocation** idea we introduced when discussing compact heaps.

But now the pointer is thread-local.

So:

```text
Thread A modifies topA

Thread B modifies topB

Thread C modifies topC
```

instead of:

```text
A, B and C all fight over top
```

That is the key scalability benefit.

## What actually happens during `new`?

Consider again:

```java
Customer customer = new Customer();
```

There are several different activities hidden behind this one expression.

A simplified fast-path view is:

```text
1. determine required object size

2. check whether it fits in current TLAB

3. advance the TLAB allocation pointer

4. initialize the object's header

5. establish Java's required initial field state

6. execute constructor initialization
```

It is useful to separate:

```text
memory allocation
```

from:

```text
constructor execution
```

They are related, but they are not the same operation.

For example:

```java
new Customer(expensiveDatabaseLookup())
```

may be expensive because of everything surrounding construction even though obtaining heap space for the object itself is cheap.

The key point is:

> **Ordinary heap allocation does not normally mean calling a general-purpose native allocator such as `malloc()` for every Java object.**

Most small allocations stay entirely inside JVM-managed heap space.

## Why this path is so cheap

Inside an existing TLAB, HotSpot already has:

```text
start
top
end
```

And no other Java allocation thread is advancing that particular `top`.

That means the common path avoids:

```text
global heap lock
free-list search
operating-system allocation
cross-thread contention
```

Conceptually:

```text
new Customer()
      │
      ▼
Does it fit in my TLAB?
      │
     YES
      │
      ▼
advance pointer
      │
      ▼
initialize object
```

<figure>
<a href="/images/courses/jvm/allocation-fast-path.svg" aria-label="Open the object allocation fast path">
<img src="/images/courses/jvm/allocation-fast-path.svg"
     alt="A small object allocation checks whether the object fits in the current TLAB, advances the local pointer, initializes the object, and returns it."
     width="820" height="480" />
</a>
<figcaption>Most ordinary allocations avoid the slower shared allocation machinery entirely.</figcaption>
</figure>

This is why advice such as:

```text
Avoid every temporary Java object
because new is expensive.
```

is too simplistic.

The memory still has a cost.

But the cost often appears later through:

```text
allocation volume
      │
      ▼
heap fills
      │
      ▼
GC work
```

rather than because advancing the allocation pointer itself was expensive.

## Eventually the TLAB runs out

Suppose Thread A reaches this state:

```text
TLAB A

┌──────────────────────────────────────┐
│ Object │ Object │ Object │ tiny free │
└──────────────────────────────────────┘
                              ▲
                             top
```

Now it wants to allocate:

```text
64-byte object
```

but only:

```text
24 bytes
```

remain.

The fast path fails:

```text
newTop > tlabEnd
```

HotSpot now needs a slower allocation path.

One possible outcome is that the existing TLAB is retired and the thread obtains another allocation buffer from the shared heap allocation area.

```text
old TLAB
   │
   ▼
retire

shared allocation area
   │
   ▼
obtain new TLAB

   │
   ▼
resume fast allocation
```

<figure>
<a href="/images/courses/jvm/tlab-refill.svg" aria-label="Open the TLAB refill diagram">
<img src="/images/courses/jvm/tlab-refill.svg"
     alt="A thread fills most of its current TLAB, retires it when the next allocation will not fit, obtains a fresh TLAB from the shared allocation area, and resumes local allocation."
     width="830" height="500" />
</a>
<figcaption>Shared coordination happens occasionally when buffers are replenished, not for every object allocation.</figcaption>
</figure>

Obtaining a new TLAB is more expensive than bumping the pointer inside an existing one because the JVM now has to coordinate with shared collector allocation state.

But consider the frequency:

```text
obtain TLAB once

then

allocate object
allocate object
allocate object
allocate object
allocate object
...
```

The refill cost is spread across many object allocations.

That is **amortization**.

## What about the unused tail?

Retiring a TLAB can leave some unused space:

```text
old TLAB

┌──────────────────────────────────────┐
│ objects................│ small waste │
└──────────────────────────────────────┘
```

Why not always abandon the remaining bytes immediately?

Because doing so too aggressively would waste heap space.

HotSpot therefore has policies that influence whether it is better to:

```text
retire TLAB
and obtain another
```

or:

```text
use another allocation path
for the current object
```

depending on factors such as how much space remains.

The exact policy is an implementation detail.

For our model, remember only:

```text
TLAB fast path
      │
      ▼
does object fit?
   /       \
 YES       NO
 │          │
 ▼          ▼
bump      slower allocation/
pointer   refill decision
```

## Not every object is allocated inside a TLAB

Some allocations bypass the thread's current TLAB.

A large object is an obvious example.

Imagine:

```java
byte[] buffer = new byte[20_000_000];
```

Trying to consume a huge fraction of a small private TLAB would make little sense.

Conceptually:

```text
ordinary small object
       │
       ▼
current TLAB
       │
       ▼
fast path
```

whereas:

```text
large / unsuitable allocation
       │
       ▼
allocation outside TLAB
       │
       ▼
collector/shared allocation machinery
```

<figure>
<a href="/images/courses/jvm/tlab-inside-outside.svg" aria-label="Open inside versus outside TLAB allocation">
<img src="/images/courses/jvm/tlab-inside-outside.svg"
     alt="Small ordinary objects use the thread-local allocation fast path, while a large or unsuitable allocation bypasses the current TLAB and uses a collector-specific shared allocation path."
     width="820" height="460" />
</a>
<figcaption>TLAB allocation is the common fast path, not a requirement that every Java object must follow.</figcaption>
</figure>

The exact threshold is not a Java rule.

It depends on HotSpot and the active collector's allocation policy.

And “outside TLAB” should not automatically be interpreted as:

```text
catastrophically expensive
```

It simply means the object did not use the normal thread-local fast path.

The collector may still have efficient mechanisms for that allocation.

## TLAB does not mean thread-owned object

The name **Thread-Local Allocation Buffer** can cause another misunderstanding.

Suppose:

```text
Thread A
   │
   ▼
allocates Customer X
inside TLAB A
```

Does `Customer X` now belong to Thread A?

No.

The TLAB is thread-local only during **allocation**.

Once the object exists:

```text
Thread A ─────► Customer X ◄───── Thread B
```

other threads can reference it normally.

The object is simply an ordinary heap object.

So do not confuse:

```text
Thread-Local Allocation Buffer
```

with:

```java
ThreadLocal<Customer>
```

They solve completely different problems.

```text
TLAB
│
└── optimize memory allocation


ThreadLocal<T>
│
└── associate Java values with threads
```

## What about virtual threads?

JDK 25 makes this distinction particularly important.

A JVM may have:

```text
1,000,000 virtual threads
```

Should we imagine:

```text
1,000,000 TLABs
```

each reserving a private chunk of Eden?

No.

That would defeat much of the scalability benefit of virtual threads.

A virtual thread is scheduled by the Java runtime and runs while **mounted on a carrier platform thread**.

Conceptually:

```text
Virtual Thread A ─┐
Virtual Thread B ─┼── scheduled onto ──► Carrier 1
Virtual Thread C ─┘


Virtual Thread D ─┐
Virtual Thread E ─┼── scheduled onto ──► Carrier 2
Virtual Thread F ─┘
```

HotSpot's low-level thread allocation machinery, including TLAB state, is associated with the native HotSpot execution thread.

So while a virtual thread is mounted and executing Java code, its allocations use the allocation machinery of the carrier on which it is currently running.

<figure>
<a href="/images/courses/jvm/virtual-thread-tlab.svg" aria-label="Open the virtual thread and TLAB relationship">
<img src="/images/courses/jvm/virtual-thread-tlab.svg"
     alt="Many virtual threads are scheduled over a much smaller number of carrier platform threads. TLAB allocation state belongs to the underlying HotSpot execution threads rather than requiring one permanent TLAB per virtual thread."
     width="850" height="520" />
</a>
<figcaption>Virtual-thread count does not translate into an equivalent number of permanently reserved TLABs.</figcaption>
</figure>

So avoid this mental model:

```text
1 virtual thread
=
1 permanently reserved TLAB
```

Instead think:

```text
virtual thread executes
        │
        ▼
mounted on carrier
        │
        ▼
HotSpot execution thread
allocation machinery
        │
        ▼
TLAB fast path
```

We will revisit the carrier/runtime distinction in detail when the course reaches virtual-thread internals.

## Allocation rate is not allocation cost

Suppose JFR shows:

```text
2 GB / second allocated
```

That number may look enormous.

But what does it actually tell us?

It tells us:

```text
objects are being created quickly
```

It does **not** directly tell us:

```text
CPU is being spent in an expensive allocator
```

For example:

```text
2 GB/s allocation
+
99% dies young
```

may look like:

```text
TLAB allocation
      │
      ▼
Eden fills quickly
      │
      ▼
Young GC
      │
      ▼
tiny survivor set
```

HotSpot was designed to handle this kind of workload well.

Compare:

```text
2 GB/s allocation
+
50% survives
```

Now:

```text
TLAB allocation
      │
      ▼
Eden
      │
      ▼
large survivor set
      │
      ▼
copying cost
      │
      ▼
promotion
      │
      ▼
old-generation pressure
```

The allocation rate is identical.

The GC consequences are completely different.

This connects the last several lessons:

```text
How much do we allocate?
        │
        ▼
TLAB / Eden

How much survives?
        │
        ▼
Young GC cost

How much gets promoted?
        │
        ▼
Old-generation pressure
```

## Looking at allocation in JFR

JDK Flight Recorder exposes several useful views of allocation behavior.

Three names are worth separating:

```text
Thread Allocation Statistics

Object Allocation in New TLAB

Object Allocation Outside TLAB
```

There is also:

```text
Object Allocation Sample
```

They answer different questions.

### Thread Allocation Statistics

Useful for asking:

```text
Which threads are allocating heavily?
```

This gives a throughput-oriented view.

### Object Allocation in New TLAB

The name can be misleading.

It does **not** mean:

```text
event emitted for every object
allocated inside an existing TLAB
```

The event is associated with an allocation that obtains/uses a **new TLAB**, and includes information such as:

```text
object class
allocation size
TLAB size
```

It provides visibility into TLAB refill/allocation behavior.

### Object Allocation Outside TLAB

This tells us about allocations that bypass the normal TLAB path:

```text
object class
allocation size
allocation stack
```

Depending on the recording configuration, this can help expose unusually large or otherwise non-TLAB allocations.

### Object Allocation Sample

If the question is:

```text
Which classes and stack traces
are driving allocation pressure?
```

allocation sampling is often the more natural tool.

It samples allocations and assigns weights that can be aggregated to estimate allocation pressure.

<figure>
<a href="/images/courses/jvm/jfr-allocation-view.svg" aria-label="Open the JFR allocation diagnostics diagram">
<img src="/images/courses/jvm/jfr-allocation-view.svg"
     alt="Different JFR allocation signals answer different questions: per-thread allocation statistics, TLAB refill events, outside-TLAB allocations, and sampled allocation pressure by class and stack trace."
     width="850" height="520" />
</a>
<figcaption>Allocation diagnostics are most useful when the signal is matched to the question being investigated.</figcaption>
</figure>

So instead of asking only:

```text
Is allocation high?
```

we can ask:

```text
Which threads allocate?

Which code paths allocate?

Which classes dominate allocation pressure?

Are large allocations occurring outside TLABs?

How much survives afterward?
```

That is much closer to production diagnosis.

## Check your reasoning

Suppose two services both allocate:

```text
3 GB / second
```

Service A:

```text
almost every allocation uses the TLAB fast path
99.8% dies in young memory
```

Service B:

```text
same allocation rate
large survivor set
high promotion rate
```

Which fact is more concerning?

<details class="lesson-check">
<summary>Pause here, then check your reasoning</summary>
<p>The allocation rate alone is not enough to decide. Service B is likely to create greater GC pressure because much more data survives and must be copied or promoted. Service A may allocate enormous amounts of temporary data efficiently through TLABs and reclaim most of it during cheap young collections.</p>
</details>

This is why:

```text
allocation throughput
```

and:

```text
memory retention
```

must not be treated as the same problem.

## Put the allocation lifecycle toget