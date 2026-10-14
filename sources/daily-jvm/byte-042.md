Source: originating conversation, supplied Daily JVM Byte. Original wording available in the conversation reader.

## Daily JVM Byte #42 — One object allocation, end to end

Yesterday we mapped JVM concepts onto the HotSpot source tree. Today we use that model to trace one of Java's most common operations:
```
Order order = new Order();
```

This apparently simple statement crosses **class metadata, bytecode, TLAB allocation, object layout, constructor execution, JIT optimization, and eventually GC**.

### 1. What does `new Order()` actually mean?

At source level:
```
Order order = new Order();
```

At bytecode level, roughly:
```
new           Order
dup
invokespecial Order.<init>
astore_1
```

Notice an important distinction:
```
new
 │
 └── allocate + initialize object storage

invokespecial <init>
 │
 └── execute constructor
```

Allocation and constructor execution are separate operations.

---

## 2. Before allocation: HotSpot needs the class metadata

The `new` bytecode refers symbolically to `Order` through the constant pool.

Conceptually:
```
new #7
     │
     ▼
ConstantPool entry
     │
     ▼
Order
```

Before an instance can be created, HotSpot needs the class resolved and initialized as required by JVM semantics.

Eventually the runtime has:
```
InstanceKlass(Order)
       │
       ├── object size
       ├── field layout
       ├── superclass
       ├── methods
       └── initialization state
```

This answers a critical allocation question:

> How many bytes does an `Order` instance require?

---

## 3. HotSpot already knows the object layout

Suppose:
```
class Order {
    long id;
    int quantity;
    Object customer;
}
```

HotSpot has already computed an instance layout.

Conceptually:
```
Order object

┌───────────────────┐
│ object header     │
├───────────────────┤
│ id                │
├───────────────────┤
│ quantity          │
├───────────────────┤
│ customer          │
├───────────────────┤
│ possible padding  │
└───────────────────┘
```

Therefore allocation does not involve dynamically discovering fields.

HotSpot effectively knows:
```
InstanceKlass(Order)
       ↓
instance size = N bytes
```

---

## 4. The common allocation path: TLAB bump-pointer allocation

Recall Byte #8.

Most ordinary objects are allocated from a thread's **Thread Local Allocation Buffer**.

Conceptually:
```
TLAB

start
 │
 ▼
████████████████░░░░░░░░░░░
                ▲          ▲
                top        end
```

To allocate an object of size `N`:
```
newTop = top + N

if newTop <= end:
    object = top
    top = newTop
```

That's essentially a **bump-pointer allocation**.

The common path can therefore be extremely cheap:
```
read TLAB top
    ↓
add object size
    ↓
bounds check
    ↓
advance pointer
```

No general-purpose `malloc()` is required.

And because the TLAB belongs to one thread, the common allocation path avoids global allocation contention.

---

## 5. What if the TLAB doesn't have enough space?

Suppose:
```
TLAB

██████████████████████████░
                         ↑
                      tiny gap
```

but `Order` needs more space.

HotSpot takes a slower path.

Depending on circumstances, it may:
```
attempt allocation outside current TLAB
          │
          ├── refill/replace TLAB
          │
          └── allocate through shared heap path
```

Eventually, insufficient heap space may trigger interaction with GC.

So:
```
new Order()
```

does **not** inherently mean:
```
run GC
```

Normally it is just a very cheap allocation.

GC becomes relevant when available allocation space becomes constrained.

---

## 6. Memory is prepared before the constructor runs

After storage is obtained, HotSpot establishes a valid Java object.

Conceptually:
```
allocated memory
      ↓
initialize header
      ↓
establish Klass information
      ↓
zero object fields
```

Java guarantees default field values:
```
reference → null
int       → 0
long      → 0
boolean   → false
```

So before:
```
Order()
```

starts assigning application values, the object already has valid default state.

Then:
```
invokespecial Order.<init>
```

runs the constructor.

This distinction matters:
```
allocation
    ≠
constructor execution
```

---

## 7. The object header connects back to `InstanceKlass`

After allocation:
```
Heap

Order instance
┌────────────────────┐
│ Mark Word          │
├────────────────────┤
│ Klass information │──────────┐
├────────────────────┤          │
│ fields             │          │
└────────────────────┘          │
                                ▼
                         InstanceKlass(Order)
                              Metaspace
```

We have now connected three earlier lessons:
```
Object layout
     +
TLAB allocation
     +
HotSpot Klass metadata
```

into one operation.

---

## 8. JIT compilation makes this path even cheaper

If the allocating method becomes hot, C1/C2 compile it.

Instead of repeatedly executing the interpreter's implementation of:
```
new
```

the JIT can generate an allocation fast path directly into the compiled method.

Conceptually:
```
compiled foo()

...
load TLAB top
add object size
compare with TLAB end
branch to slow path if necessary
initialize object
...
```

So allocation logic can effectively be embedded into the generated machine code.

The uncommon case branches into HotSpot runtime code:
```
          compiled code

        TLAB has space?
         /           \
       yes            no
        │              │
 fast allocation   runtime slow path
```

This fast-path/slow-path design appears repeatedly inside HotSpot.

---

## 9. Escape analysis may eliminate the allocation entirely

Now consider:
```
int calculate() {
    Point p = new Point(10, 20);
    return p.x + p.y;
}
```

If C2 proves that `p` does not escape in a way requiring an actual object, it may apply scalar replacement.

Conceptually:
```
Source:

Point object
 ├── x = 10
 └── y = 20


Optimized execution:

x = 10
y = 20
return 30
```

The heap allocation can disappear.

Therefore:
```
Java source contains "new"
```

does not necessarily imply:
```
heap object was actually allocated
```

once optimized execution is involved.

This is one reason reasoning about allocation purely from source code can be misleading.

---

## 10. If the object is allocated, GC eventually decides its fate

Suppose the object really reaches the heap:
```
Thread
  │
  ▼
order reference
  │
  ▼
Order object
```

While reachable from GC roots:
```
GC Root
   ↓
...
   ↓
Order
```

the collector preserves it.

Later:
```
order = null;
```

doesn't directly free anything.

Instead:
```
Order no longer reachable
        ↓
future GC discovers this
        ↓
memory reclaimed
```

Depending on the collector, reclamation might involve:
```
copying
compaction
region evacuation
concurrent relocation
```

The allocation path and reclamation path are deliberately decoupled.

---

## Production implications

This explains an important characteristic of Java performance.

Code like:
```
for (...) {
    new SmallObject();
}
```

is not automatically expensive merely because it performs many allocations.

TLAB allocation itself is usually cheap.

The more important questions are:
```
How much allocation per second?

How long do objects survive?

How much data reaches older generations?

Can JIT eliminate some allocations?

Can the collector reclaim them efficiently?
```

For example:
```
10 million short-lived objects
```

may be easier for a generational collector than:
```
1 million objects
that remain reachable indefinitely
```

The latter creates retention and long-term heap pressure.

So:

> **Allocation rate and live-set growth are different problems.**

## Mental model checkpoint

One line of Java now connects much of the course:
```
new Order()
     │
     ▼
bytecode `new`
     │
     ▼
ConstantPool
     │
     ▼
InstanceKlass
     │
     ├── instance size
     └── layout
     │
     ▼
JIT/interpreter allocation path
     │
     ▼
TLAB
     │
     ▼
object header + zeroed fields
     │
     ▼
<init>
     │
     ▼
reachable Java object
     │
     ▼
GC lifecycle
```

And optimization can short-circuit the entire physical allocation:
```
new Order()
     ↓
escape analysis
     ↓
scalar replacement
     ↓
no heap object
```

The central idea is:

> **Java object allocation is fast because HotSpot moves expensive work away from the common path: class layout is computed beforehand, threads usually allocate by bumping a private TLAB pointer, uncommon cases enter runtime slow paths, and C2 may eliminate the allocation entirely.**

**Next byte:** **One virtual method call end to end — `invokevirtual`, vtables, inline caches, type profiling, speculative inlining, C2 optimization, uncommon traps, and deoptimization when HotSpot's assumptions stop being true.**

I noticed you haven’t viewed this scheduled task in a while. Would you like me to keep it running?



\============
