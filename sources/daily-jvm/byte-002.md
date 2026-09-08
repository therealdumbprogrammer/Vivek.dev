# Source: byte-002

Origin: Save Backend Resource, conversation 6a996dbd-f8b0-83ee-a26a-3b05f1d7e4a3. Original wording follows; accuracy corrections are recorded in byte-002/review.md.

## Daily JVM Byte #2 — JVM process memory: heap is only one part

Yesterday’s model separated the JVM into memory, execution, and runtime services. Today, focus on the memory side.

The key idea:
```
JVM process memory ≠ Java heap
```

A JVM process contains several major memory regions:
```
JVM process
├── Java Heap
├── Thread Stacks
├── Metaspace
├── Code Cache
├── Direct / Native Buffers
├── GC data structures
├── JIT/compiler memory
└── other native JVM allocations
```

### 1. Java Heap

This is where ordinary Java objects normally live:
```
Customer c = new Customer();
```

The `Customer` object is allocated on the managed heap.

The heap is:

- garbage-collected
- shared by threads
- typically bounded by `-Xmx`
- usually the largest single JVM memory region

But `-Xmx4g` means only:
```
maximum Java heap ≈ 4 GB
```

It does not cap the whole process at 4 GB.

### 2. Thread stacks

Each platform thread gets a native stack.

A stack contains execution frames such as:
```
Thread stack
├── method frame
│   ├── local variables
│   ├── operand state
│   └── return information
├── caller frame
└── ...
```

Stack size is influenced by:
```
-Xss
```

If you have:
```
1000 threads × 1 MB stack
```

the theoretical stack reservation can already be substantial.

This is one reason thread count matters even when heap usage is stable.

### 3. Metaspace

Metaspace stores JVM metadata describing loaded classes.

Conceptually:
```
class Customer
      │
      ▼
HotSpot metadata
├── class structure
├── method metadata
├── field metadata
├── constant-pool-related structures
└── runtime class information
```

This is native memory, not Java heap memory.

Since Java 8, Metaspace replaced the old PermGen model.

Its growth is primarily related to:
```
number of loaded classes
+
class loader lifecycle
```

This matters in applications that dynamically generate or reload classes.

A classic leak pattern is:
```
ClassLoader remains reachable
        │
        ▼
its classes remain loaded
        │
        ▼
Metaspace cannot be reclaimed
```

### 4. Code Cache

When HotSpot JIT-compiles a method, the generated native machine code has to live somewhere.

That somewhere is the Code Cache.
```
bytecode
   │
   ▼
JIT compiler
   │
   ▼
native machine code
   │
   ▼
Code Cache
```

This memory is executable native memory.

A method can therefore simultaneously have:
```
bytecode representation
+
runtime metadata
+
compiled machine code
```

stored in different JVM regions.

### 5. Native/direct memory

Java can allocate memory outside the heap explicitly.

For example:
```
ByteBuffer.allocateDirect(...)
```

This creates a small Java-side object on the heap, but the actual backing storage is native memory.

Frameworks such as Netty make heavy use of this pattern because it can reduce copying during I/O.

So you can encounter:
```
heap stable
direct memory growing
RSS growing
```

without a traditional Java heap leak.

### Why RSS is larger than `-Xmx`

Suppose:
```
Heap          4.0 GB
Metaspace     300 MB
Code Cache    200 MB
Stacks        700 MB
Direct memory 600 MB
JVM native    500 MB
```

The JVM process may approach:
```
~6.3 GB
```

even though:
```
-Xmx = 4 GB
```

This distinction becomes critical in containers.

For example:
```
Kubernetes memory limit = 5 GB
-Xmx = 4 GB
```

may look safe, but the process can still be killed by the container runtime if native memory pushes RSS beyond the limit.

The OS/container does not care that some memory is called "heap" and some "Metaspace."

It sees the process total.

### HotSpot-level view

A useful simplification is:
```
Managed memory
└── Java Heap

JVM-managed native memory
├── Metaspace
├── Code Cache
├── thread stacks
├── GC structures
├── compiler structures
└── internal runtime structures

Application native memory
└── direct buffers / JNI / native libraries
```

Not every one of these regions is governed by the garbage collector.

That is an important boundary:

> GC manages Java heap object lifetime, not all JVM process memory.

### Production implication

If memory is increasing, first ask:
```
Which memory region is growing?
```

Do not jump immediately to a heap dump.

Typical mapping:
```
Heap growth
→ heap histogram / heap dump / GC analysis

Metaspace growth
→ loaded classes / class loaders

Thread stack growth
→ thread count / stack sizing

Direct memory growth
→ NIO / Netty / native buffer usage

General native growth
→ Native Memory Tracking
```

For HotSpot, one of the most useful tools later in this course will be:
```
jcmd <pid> VM.native_memory summary
```

with Native Memory Tracking enabled.

That gives a very different view from a heap profiler.

### Mental model

Keep this hierarchy:
```
OS sees:
    JVM process memory

JVM divides that into:
    heap + native regions

GC sees primarily:
    Java heap object graph
```

This separation explains many production incidents where:
```
heap looks healthy
but
container still OOMs
```

**Next byte:** object layout inside the heap — object headers, mark words, class pointers, alignment, and why a seemingly tiny Java object can occupy much more memory than its fields suggest.
