Source ID: byte-003
Source: Save Backend Resource, conversation 6a996dbd-f8b0-83ee-a26a-3b05f1d7e4a3
No source publication date supplied. Original message follows verbatim.

Npw comes the Lession 3 byte

## Daily JVM Byte #3 — Object layout inside the heap

Yesterday we separated JVM process memory into heap and native regions. Now zoom into a single heap object.

The important idea is:
```
Java fields ≠ total object size
```

An object contains both **your data** and **JVM metadata**.
```
Object
├── Header
│   ├── Mark Word
│   └── Klass pointer
├── Instance fields
└── Padding
```

### 1. Mark Word

The Mark Word is part of every ordinary object header. HotSpot uses it for runtime state such as:

- locking/synchronization state
- identity hash information
- GC-related state, depending on collector/runtime mode

The exact bit layout depends on JVM version, architecture, and runtime configuration.

The key point is that some object state is stored directly in the object header.

### 2. Klass pointer

Every object needs to tell the JVM what class it belongs to.

Conceptually:
```
Customer object
   │
   └── klass pointer
          │
          ▼
     HotSpot class metadata
```

That metadata is associated with the loaded class representation, not duplicated inside every object.

On 64-bit HotSpot, compressed class pointers are commonly used to reduce header size.

### 3. Instance fields

Your declared fields come after the header.

For example:
```
class Person {
    int age;
    double salary;
    Address address;
}
```

Conceptually:
```
Person object
├── header
├── age
├── salary
├── address reference
└── padding
```

Notice that `address` contributes only the **reference** to this object's shallow size.

The actual `Address` object is separate:
```
Person
   │
   └── address reference ─────► Address object
```

This is the distinction between **shallow size** and the broader reachable object graph.

### 4. Alignment and padding

HotSpot aligns objects in memory, commonly to 8-byte boundaries.

That means a theoretically 29-byte object will not necessarily occupy 29 bytes.

It may be rounded up:
```
raw size      = 29 bytes
aligned size  = 32 bytes
```

Padding exists so objects start at addresses convenient for the runtime and hardware.

This has an important consequence:

> Small field changes do not always change object size linearly.

Adding a `boolean` might fit into existing padding and cost no additional aligned bytes. In another layout, the same field may push the object into the next alignment boundary.

### Example

Assume a typical 64-bit HotSpot JVM with compressed references:
```
class User {
    int id;
    boolean active;
    Object ref;
}
```

A simplified layout might resemble:
```
Header             ~12 bytes
int                  4
Object reference     4
boolean              1
padding              3
------------------------
total               24 bytes
```

The exact layout is JVM-dependent, but the principle is stable:
```
object size =
header
+ fields
+ reference fields
+ alignment padding
```

### Why field order matters

HotSpot may reorder fields internally to reduce wasted space.

Consider:
```
class Example {
    byte a;
    long b;
    byte c;
}
```

A naive source-order layout could introduce extra padding around the `long`.

HotSpot can organize fields to reduce that waste while preserving Java semantics.

So source declaration order should not be treated as a guaranteed physical layout.

### References are not embedded objects

This is especially important for reasoning about memory.
```
Person p = new Person();
p.address = new Address();
```

You have two heap objects:
```
Person object
   │
   └── ref ─────────► Address object
```

The `Person` shallow size includes:
```
Person header
+ primitive fields
+ reference slot
+ padding
```

It does **not** include the `Address` object's body.

This distinction becomes important later when we discuss:

- heap histograms
- retained size
- dominator trees
- object graphs

### Production implications

Object layout matters most when object counts are large.

Saving 8 bytes on one object is irrelevant.

Saving 8 bytes across:
```
100 million objects
```

is roughly:
```
~800 MB
```

So object shape matters in:

- large caches
- high-cardinality data models
- collections with many wrapper objects
- graph-heavy workloads
- low-latency systems where GC pressure matters

This is why replacing:
```
List<Integer>
```

with a primitive-oriented structure can sometimes save substantial memory: each `Integer` is a separate object with its own header and alignment overhead.

### Mental model

Keep this relationship:
```
Heap
└── objects
    ├── object header
    ├── fields
    ├── references to other objects
    └── padding
```

And separately:
```
Object graph
A ─► B ─► C
```

Object layout explains **how much each node costs**.

The object graph explains **how those nodes are connected and kept alive**.

We need both concepts before GC starts to make sense.

**Next byte:** references, reachability, GC roots, and why garbage collection is fundamentally a graph traversal problem.



I'd say, use illustration as much as possible as there are in the source byte...more than text, it's the diagrams that help people so I'm not suggesting to keep the lession small by trimming the text but I'm merely suggesting to give illustrations focus as well
