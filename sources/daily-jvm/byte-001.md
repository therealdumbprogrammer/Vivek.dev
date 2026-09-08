## Daily JVM Byte #1 — What the JVM actually is

Before GC, JIT, heap layout, or safepoints, establish the runtime model everything else fits into.

A useful approximation is:

```text
.java source
    │
    ▼
javac
    │
    ▼
.class / bytecode
    │
    ▼
┌─────────────────────────────────────────┐
│                  JVM                    │
│                                         │
│  Class Loading                          │
│       │                                 │
│       ▼                                 │
│  Runtime representation of classes     │
│       │                                 │
│       ▼                                 │
│  Execution Engine                       │
│    ├── Interpreter                      │
│    └── JIT compiler                     │
│                                         │
│  Runtime memory                         │
│    ├── Java Heap                        │
│    ├── Thread Stacks                    │
│    ├── Metaspace                        │
│    ├── Code Cache                       │
│    └── Native JVM memory                │
│                                         │
│  Runtime services                       │
│    ├── Garbage Collection               │
│    ├── Thread management                │
│    ├── Synchronization                  │
│    └── Safepoints                       │
└─────────────────────────────────────────┘
             │
             ▼
       Operating System
```

### The important distinction

The JVM is **not simply a bytecode interpreter**.

When you execute:

```bash
java MyApplication
```

the JVM creates a managed runtime environment. It loads classes, constructs internal metadata, allocates memory, creates and manages threads, executes bytecode, observes execution behavior, compiles hot code into native machine code, reclaims unreachable objects, and coordinates runtime operations such as safepoints.

This is why understanding Java performance eventually means understanding the runtime rather than only the Java language.

### A method's journey

Suppose:

```java
int calculate(int x) {
    return x * 2;
}
```

`javac` produces bytecode roughly corresponding to:

```text
iload_1
iconst_2
imul
ireturn
```

Initially, HotSpot can execute those instructions through its interpreter.

But execution also produces **profiling information**:

```text
calculate()
    │
    ├── invocation count
    ├── branch behaviour
    ├── observed receiver types
    └── other runtime profile data
             │
             ▼
         becomes hot
             │
             ▼
        JIT compilation
             │
             ▼
       native machine code
```

Future invocations can therefore execute compiled machine code rather than having every bytecode interpreted.

This introduces one of the most important JVM ideas:

> **Execution changes while the application runs.**

The JVM is continuously learning about the running program and optimizing based on what actually happens.

That is why concepts we will encounter later—**tiered compilation, MethodData, speculative optimization, inlining, deoptimization and the code cache**—are connected rather than isolated JIT features.

### Memory is similarly divided by responsibility

When an object is created:

```java
new Customer()
```

the object normally belongs to the **Java heap**.

But information describing `Customer` itself is represented elsewhere by JVM metadata, largely associated with **Metaspace**.

The executing method has a frame associated with its thread's **stack**.

JIT-compiled machine code occupies the **Code Cache**.

And HotSpot itself uses substantial **native memory** for its own data structures.

So:

```text
JVM process memory
│
├── Java Heap
├── Thread Stacks
├── Metaspace
├── Code Cache
├── GC structures
├── JIT/compiler structures
└── other native allocations
```

This distinction becomes operationally important.

A JVM process using 5 GB does **not** imply:

```text
Java heap = 5 GB
```

Consequently, diagnosing container OOMs purely from `-Xmx` can be misleading.

### The mental model to retain

Think of HotSpot as three interacting systems:

```text
             MEMORY
                │
                │
EXECUTION ──────┼────── RUNTIME SERVICES
                │
```

**Memory** answers where objects, class metadata, stacks and generated code live.

**Execution** answers how bytecode becomes actual CPU instructions.

**Runtime services** answer how HotSpot manages GC, threads, synchronization, safepoints and related machinery.

Most advanced JVM topics are interactions between these three.

For example:

```text
JIT optimization
      │
      ▼
compiled machine code
      │
      ▼
Code Cache
      │
      ▼
GC needs a safepoint
      │
      ▼
JVM must understand compiled frames
      │
      ▼
find object references
```

GC, JIT, stacks and safepoints therefore cannot ultimately be understood independently.

### Production takeaway

When investigating a JVM problem, first classify it:

```text
Memory?
Execution?
Runtime coordination?
```

A high CPU incident may involve JIT or GC. A memory incident may involve heap **or native memory**. A latency spike may involve allocation, GC, compilation, locking, or safepoint activity.

That classification prevents a common mistake: treating every JVM performance problem as a heap/GC problem.

**Next byte:** JVM process memory — exactly what lives in heap, stacks, Metaspace, Code Cache and native memory, and why JVM RSS can substantially exceed `-Xmx`.
