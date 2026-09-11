Liked the tone of Lesson 3. On to Lesson 4



## Daily JVM Byte #4 — GC roots, reachability, and why GC is graph traversal

Yesterday we looked at objects as nodes connected by references. Garbage collection starts from that graph.

The core rule is:
```
An object is reclaimable when it is no longer reachable
from any GC root.
```

### 1. The heap is an object graph

Consider:
```
class Order {
    Customer customer;
}

class Customer {
    Address address;
}
```

At runtime:
```
Order ──► Customer ──► Address
```

The JVM does not ask:
```
"Was Address allocated a long time ago?"
```

It asks:
```
"Can Address still be reached from a live root?"
```

That distinction is fundamental.

### 2. What is a GC root?

A GC root is a starting point that the JVM knows must be considered alive.

Typical roots include references from:

- active thread stacks
- static fields of loaded classes
- JNI/native references
- JVM runtime structures

Example:
```
static Order currentOrder;
```

Conceptually:
```
GC Root
   │
   ▼
currentOrder
   │
   ▼
Order ──► Customer ──► Address
```

All three objects are reachable.

### 3. Stack references as roots

Suppose a thread is executing:
```
void process() {
    Customer c = loadCustomer();
    use(c);
}
```

While `c` is considered live in the executing frame, the JVM may treat the corresponding object reference as part of the root set.

Conceptually:
```
Thread
└── stack frame
      └── c ─────► Customer
```

The GC must therefore understand thread execution state well enough to locate object references.

This is one reason GC, stacks, compiled code, and safepoints are tightly connected.

### 4. Reachability is transitive

If:
```
Root ─► A ─► B ─► C
```

then all three are reachable.

If the reference to `A` disappears:
```
Root

A ─► B ─► C
```

then `A`, `B`, and `C` may all become unreachable together.

The JVM does not need every object to be directly referenced by a root. It only needs a path from some root.

### 5. Cycles do not prevent collection

This is an important difference from pure reference counting.

Suppose:
```
A ─► B
▲    │
└────┘
```

and nothing outside the cycle points to either object.

There is no path from a GC root:
```
GC roots

   X

A ⇄ B
```

Both objects are garbage.

So a tracing collector can reclaim cyclic structures naturally.

### 6. Marking is graph traversal

A simplified tracing collector works conceptually like this:
```
1. Start from GC roots
2. Visit referenced objects
3. Mark them reachable
4. Follow their outgoing references
5. Continue until no new objects remain
6. Everything unmarked is garbage
```

Example:
```
Root ─► A ─► B

C ─► D
```

Traversal discovers:
```
A, B = live
C, D = unreachable
```

This is the conceptual foundation behind mark-sweep, mark-compact, and the marking phases of modern collectors.

### Why root discovery is non-trivial

The JVM must identify references not only in heap objects, but also in executing code.

For interpreted code, HotSpot understands interpreter frames.

For JIT-compiled code, it must know something like:
```
At this machine-code location:
register R1 contains an object reference
stack slot 24 contains an object reference
stack slot 40 contains an integer
```

That metadata is generated alongside compiled code.

Later, when we study safepoints and JIT internals, this will matter greatly.

The GC cannot safely scan arbitrary machine state and guess which values are pointers.

### Production implication: retained objects are often still reachable

A memory leak in Java usually does **not** mean memory became unreachable and GC failed to reclaim it.

More commonly:
```
Application accidentally keeps a reference
              │
              ▼
object remains reachable
              │
              ▼
GC correctly preserves it
```

Example:
```
static Map<String, Object> cache = new HashMap<>();
```

If entries are continually added and never removed:
```
Static field
   │
   ▼
Map
   │
   ├──► object
   ├──► object
   ├──► object
   └──► object ...
```

From the GC's perspective, nothing is wrong.

The objects are reachable.

This is why heap-leak diagnosis often becomes:
```
What GC-root path is keeping this object alive?
```

rather than:
```
Why didn't GC delete this object?
```

### Connection to retained size

Suppose:
```
Root ─► A ─► B ─► C
```

and `A` is the only path keeping `B` and `C` alive.

Removing `A` would make all three collectible.

So `A` can dominate a large subgraph.

This is the basis for concepts such as:

- retained size
- dominator trees
- paths to GC roots

which heap analyzers use to identify memory leaks.

### Mental model

We now have:
```
JVM process
└── Java heap
    └── object graph
         ▲
         │
      GC roots
```

GC is fundamentally answering:
```
Which nodes are reachable from the root set?
```

Collector-specific algorithms differ mainly in **how** they discover, move, reclaim, and track those objects efficiently.

**Next byte:** the first major GC design split — mark-sweep vs mark-compact vs copying collection, and why fragmentation and allocation speed drive the design of modern collectors.