# Daily JVM Byte #48 — ZGC Concurrent Relocation: How Objects Move While Java Threads Keep Running

**Baseline:** JDK 25 LTS  
**Focus:** Forwarding tables, load barriers, relocation races, and reference correctness.

In Byte #47, we established that ZGC can relocate objects concurrently with application execution.

Today we'll examine the mechanism that makes this possible.

The central question:

> **If GC moves an object from address A to address B while an application thread still holds a reference to A, how does HotSpot prevent that thread from accessing an invalid location?**

## 1. The fundamental relocation problem

Consider:

```java
Order order = customer.getOrder();
order.setStatus("PAID");
```

Suppose the `Order` object currently resides at address `0x1000`.

```text
Thread A                       Java Heap

order ───────────────────────► Order @ 0x1000
```

Meanwhile, ZGC decides to relocate that object.

```text
Before relocation:

0x1000 → Order

After relocation:

0x5000 → Order
```

Three problems immediately appear.

**Problem 1:** Thread A may still hold `0x1000`.

**Problem 2:** Another thread may attempt to relocate the same object simultaneously.

**Problem 3:** The application may modify the object while relocation is taking place.

ZGC must solve all three without stopping every application thread for the duration of relocation.

---

## 2. Forwarding tables: remembering where objects moved

ZGC maintains forwarding information for objects in pages selected for relocation.

Conceptually:

```text
Before:

Order @ 0x1000


After:

Old location           Forwarding table        New location

0x1000 ───────────────► 0x5000 ───────────────► Order
```

The forwarding table provides a mapping:

```text
old object address → relocated object address
```

This is not a permanent global map containing every Java object.

Forwarding information is associated with relocation activity and is retained for as long as the collector needs it.

In JDK 25, the relevant HotSpot structure is `ZForwarding`. Its implementation includes operations for looking up and inserting forwarding entries. [GitHub](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/z/zForwarding.hpp)

---

## 3. What happens when an application loads an old reference?

Suppose the heap still contains a reference to the object's original location.

```java
Order order = customer.order;
```

The generated code includes ZGC barrier machinery.

Conceptually:

```text
Load customer.order
        │
        ▼
Inspect pointer metadata
        │
        ├── Reference already usable
        │       │
        │       ▼
        │   Fast path
        │
        └── Reference needs processing
                │
                ▼
          Barrier slow path
                │
                ▼
        Resolve current location
                │
                ▼
          Return valid reference
```

During relocation, resolving the reference can involve consulting forwarding information.

The important distinction is:

**The application does not simply dereference an arbitrary stale address and hope the object remains there.**

HotSpot's barriers and relocation protocol ensure the reference is resolved appropriately before the application uses it.

The barrier may also repair the reference stored in memory, reducing the need for repeated slow-path processing.

This is called **self-healing**.

---

## 4. What if the object hasn't been relocated yet?

This is where the implementation becomes more interesting.

Suppose the application encounters a reference into a page selected for relocation, but no forwarding entry exists yet.

ZGC may relocate that object as part of resolving the reference.

Conceptually:

```text
Application loads reference
           │
           ▼
Reference requires relocation processing
           │
           ▼
Check forwarding table
           │
       ┌───┴────┐
       │        │
     Found    Missing
       │        │
       ▼        ▼
   Use new   Relocate object
   address        │
                  ▼
           Publish forwarding
                  │
                  ▼
           Use new address
```

This means application threads can participate in relocation work.

In the JDK 25 implementation, `ZRelocate::relocate_object()` checks forwarding information and, when appropriate, performs relocation before returning the resulting address. [GitHub](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/z/zRelocate.cpp)

---

## 5. What if two threads relocate the same object?

Consider:

```text
Thread A                         GC Worker

Find forwarding                  Find forwarding
      │                                │
   Missing                          Missing
      │                                │
Copy object to 0x5000             Copy object to 0x6000
      │                                │
      └──────────┬─────────────────────┘
                 ▼
        Compete to publish
           forwarding
```

Without coordination, the JVM could end up with two competing copies of the same logical object.

That would violate Java object identity.

ZGC handles this through atomic forwarding-table publication.

Conceptually:

```text
Thread A publishes:

0x1000 → 0x5000

Thread B discovers:

0x1000 already forwarded to 0x5000
```

Both threads must converge on the same canonical relocated object.

The losing thread can discard or undo its redundant allocation.

The JDK 25 source explicitly handles this case:

```cpp
const zaddress to_addr_final =
    forwarding->insert(from_addr, to_addr, cursor);

if (to_addr_final != to_addr) {
    allocator->undo_alloc_object(to_addr, size);
}
```

This is a simplified excerpt from `zRelocate.cpp`. [GitHub](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/z/zRelocate.cpp)

**This is the key concurrency invariant: one logical object must have one authoritative relocated destination.**

---

## 6. What about concurrent object modifications?

Now consider a more difficult scenario:

```java
order.quantity = 10;
```

What if a GC worker is copying that same object?

A naive implementation could produce:

```text
GC copies quantity = 5
         │
         ▼
Application writes quantity = 10
         │
         ▼
Relocated copy still contains 5
```

That would be incorrect.

ZGC therefore cannot treat relocation as an ordinary, uncoordinated `memcpy()`.

Its protocol coordinates object access, relocation, forwarding publication, and the lifetime of the original storage.

The essential invariant is:

> **Application writes must remain visible through the authoritative object location, regardless of whether relocation is underway.**

Barrier processing and relocation coordination establish when threads may access the original object and when they must use the relocated object.

The source also includes special handling for in-place relocation, where access to a page must be coordinated while its contents are reorganized. [GitHub](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/z/zRelocate.cpp)

---

## 7. Why doesn't ZGC immediately reclaim the old memory?

Suppose an object has moved:

```text
0x1000 → old location

0x5000 → relocated object
```

A thread might still hold a reference that requires remapping.

Therefore, the original storage cannot simply be reused without ensuring that no thread can incorrectly access it.

ZGC coordinates forwarding-table lifetime, page retention, and safe reclamation.

Conceptually:

```text
Relocate object
       ↓
Publish forwarding information
       ↓
Resolve outstanding references safely
       ↓
Old storage no longer needed
       ↓
Reclaim/reuse memory
```

This is another reason concurrent relocation requires more infrastructure than stop-the-world copying.

---

## 8. The trade-off: short pauses versus barrier work

Compare the two models.

| Aspect | G1 | ZGC |
|---|---|---|
| Object evacuation | Stop-the-world | Predominantly concurrent |
| Reference correction | During evacuation pause | Through concurrent processing and barriers |
| Forwarding information | Used internally during evacuation | Essential to concurrent relocation |
| Mutator overhead | Primarily write-barrier and GC coordination costs | Load/store barriers and possible relocation assistance |
| Main benefit | Balanced throughput and latency | Very short GC pauses |

ZGC moves work from global pauses into concurrent execution.

That reduces GC-related latency, but it can increase ongoing CPU work.

**A low GC pause does not necessarily mean an application thread never waits for GC-related work.** A barrier slow path or allocation stall can still affect request latency.

---

## 9. HotSpot source-code connection

The JDK 25 implementation can be explored through three files:

| Source file | Responsibility |
|---|---|
| `zForwarding.hpp` | Forwarding-table representation and lookup |
| `zRelocate.cpp` | Object relocation, copying, forwarding publication |
| `zBarrier.cpp` | Barrier slow paths and reference processing |

These files are under:

```text
src/hotspot/share/gc/z/
```

Relevant source references:

[ZForwarding.hpp — JDK 25](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/z/zForwarding.hpp) · [zRelocate.cpp — JDK 25](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/z/zRelocate.cpp) · [zBarrier.cpp — JDK 25](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/gc/z/zBarrier.cpp)

---

## Mental model checkpoint

We can now trace concurrent relocation end to end:

```text
                ZGC marking
                     │
                     ▼
          Select pages for relocation
                     │
                     ▼
             Concurrent relocation
                     │
            ┌────────┴────────┐
            │                 │
        GC workers        Mutator threads
            │                 │
            │           Load reference
            │                 │
            │            Load barrier
            │                 │
            └────────┬────────┘
                     │
                     ▼
              Forwarding lookup
                     │
              ┌──────┴──────┐
              │             │
           Exists         Missing
              │             │
              │         Relocate if
              │         appropriate
              │             │
              │        Publish forwarding
              │             │
              └──────┬──────┘
                     │
                     ▼
          Resolve authoritative location
                     │
                     ▼
           Continue Java execution
```

### Key takeaway

**Concurrent relocation is possible because ZGC separates an object's logical identity from the physical address currently used to store it.**

Forwarding information identifies the authoritative destination, barriers resolve references safely, and atomic coordination prevents competing copies from becoming independently visible.

This preserves Java semantics while avoiding long stop-the-world evacuation pauses.

### Next byte — #49: GC barriers inside JIT-generated machine code

We'll connect ZGC and G1 to the JIT compiler: how C2 inserts GC barriers, how fast and slow paths are generated, why barriers cannot simply be optimized away, and what these mechanisms cost during ordinary Java execution.