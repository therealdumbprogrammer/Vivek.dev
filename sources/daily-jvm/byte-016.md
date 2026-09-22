## Daily JVM Byte #16 — The Code Cache: where JIT-compiled machine code lives

Yesterday we saw that C2 can generate optimized code, invalidate it, deoptimize, and later compile another version. That raises a physical question:

> Where does all this generated machine code actually live?

Not in the Java heap. HotSpot stores generated native code in a native-memory area called the **Code Cache**. Oracle describes it as the memory used by the JVM for generated native code. ([Oracle Docs](https://docs.oracle.com/en/java/javase/24/docs/specs/man/java.html?utm_source=chatgpt.com))

### 1. From bytecode to Code Cache

Our execution pipeline now looks like:

```text
.class
   ↓
bytecode
   ↓
Interpreter
   ↓
profiling
   ↓
C1 / C2
   ↓
native machine code
   ↓
┌─────────────────┐
│    Code Cache   │
└─────────────────┘
   ↓
CPU executes it
```

Once a method has been compiled, subsequent invocations can enter its compiled machine code instead of interpreting its bytecodes.

Conceptually:

```text
foo() bytecode

   ↓ C2

0x...:
    mov ...
    cmp ...
    jne ...
    add ...
    ret
```

Those native instructions need executable memory. The Code Cache provides it.

---

## 2. It is native memory

Recall our early JVM process-memory model:

```text
JVM process
│
├── Java Heap
├── Thread stacks
├── Metaspace
├── Code Cache
├── GC/JIT native structures
└── other native memory
```

The Code Cache is **outside the Java heap**.

Therefore `-Xmx` does not include it.

This becomes important when reasoning about container memory, RSS, and native-memory pressure. A JVM with a 4 GB heap does not necessarily consume only 4 GB of process memory.

---

## 3. HotSpot normally segments the Code Cache

With tiered compilation, HotSpot can divide the cache into three Code Heaps:

```text
Code Cache

┌─────────────────────────────┐
│ Non-method code             │
├─────────────────────────────┤
│ Profiled nmethods           │
├─────────────────────────────┤
│ Non-profiled nmethods       │
└─────────────────────────────┘
```

Oracle documents segmented Code Cache as the default when tiered compilation is enabled and the reserved cache is sufficiently large. ([Oracle Docs](https://docs.oracle.com/en/java/javase/24/docs/specs/man/java.html?utm_source=chatgpt.com))

### Profiled nmethods

This area primarily holds code that still collects profiling information:

```text
C1 Level 2/3 code
        ↓
profiled nmethods
```

These compiled versions are often transitional:

```text
Interpreter
    ↓
C1 + profiling
    ↓
C2
```

So their expected lifetime can be relatively short.

### Non-profiled nmethods

This area contains code that does not carry profiling instrumentation, notably fully optimized C2 code, along with certain other compiled methods.

```text
C2 Level 4
    ↓
optimized machine code
    ↓
non-profiled nmethods
```

These versions tend to have longer useful lifetimes.

### Non-method code

The third area contains JVM-generated executable code that is not ordinary compiled Java methods, such as runtime stubs, adapters, and interpreter-related code. Oracle's segmented-Code-Cache documentation distinguishes this non-method segment from the two nmethod heaps. ([Oracle Docs](https://docs.oracle.com/en/java/javase/12/vm/java-hotspot-virtual-machine-performance-enhancements.html?utm_source=chatgpt.com))

---

## 4. What is an `nmethod`?

You will encounter this term frequently in HotSpot internals.

An **nmethod** is HotSpot's runtime representation of a compiled Java method.

```text
Java Method metadata
        │
        │ compilation
        ▼
      nmethod
        │
        ├── machine instructions
        ├── relocation information
        ├── debugging/runtime metadata
        ├── safepoint information
        └── deoptimization information
```

So the Code Cache contains more than a raw stream of CPU instructions. HotSpot needs metadata allowing compiled code to cooperate with GC, deoptimization, stack walking, exceptions, safepoints, and runtime services.

This connects directly to yesterday's lesson. If C2 inlined `A() → B() → C()` into one compiled body, HotSpot still needs enough metadata to reconstruct those logical Java frames during deoptimization.

---

## 5. Compiled code has a lifecycle

Code Cache contents are dynamic.

```text
method becomes hot
       ↓
compile
       ↓
allocate nmethod in Code Cache
       ↓
execute
       ↓
assumption invalidated / method superseded
       ↓
old nmethod becomes unusable
       ↓
eventually reclaimed
```

This is why the Code Cache is a **cache**, not simply permanent storage for every compilation ever performed. HotSpot includes mechanisms for identifying and reclaiming compiled methods that are no longer needed. Without reclamation, repeated compilation and deoptimization would continually consume executable memory.

---

## 6. Why segmentation exists

Imagine mixing short-lived C1 code, long-lived C2 code, runtime stubs, and interpreter code inside one allocation space. Over time, repeated allocation and removal can contribute to fragmentation and poor locality.

Segmentation groups code with similar characteristics. Oracle lists benefits including reduced fragmentation and improved instruction-cache/iTLB locality. ([Oracle Docs](https://docs.oracle.com/en/java/javase/24/docs/specs/man/java.html?utm_source=chatgpt.com))

```text
more sophisticated memory management
        ↓
better locality
less fragmentation
better control of footprint
```

---

## 7. What happens if the Code Cache becomes constrained?

Compilation requires available Code Cache space.

If HotSpot cannot maintain enough usable space for new compiled code, JIT activity can be affected. That matters because the JVM's performance model depends on moving hot execution toward compiled code.

```text
hot method
   ↓
needs compilation
   ↓
Code Cache pressure
   ↓
compilation constrained
   ↓
more execution remains less optimized
```

This can produce a strange production symptom:

```text
heap looks fine
GC looks fine
CPU increases
application becomes slower
```

because the problem is not Java-object memory at all.

---

## 8. Diagnosing it

One useful starting point is:

```bash
java -XX:+PrintCodeCache ...
```

You can also inspect JVM flags such as:

```text
ReservedCodeCacheSize
ProfiledCodeHeapSize
NonProfiledCodeHeapSize
NonNMethodCodeHeapSize
```

`ReservedCodeCacheSize` controls the maximum reserved Code Cache size; Oracle's Java launcher documentation also documents the individual heap-size options used with segmented Code Cache. ([Oracle Docs](https://docs.oracle.com/en/java/javase/24/docs/specs/man/java.html?utm_source=chatgpt.com))

JFR also exposes Code Cache-related statistics, making it possible to correlate cache pressure with compilation activity without relying solely on startup flags.

---

## Production implications

Code Cache problems are uncommon in ordinary applications with sensible defaults, so increasing it preemptively is generally unnecessary.

It becomes more relevant for workloads involving very large applications, large numbers of hot methods, heavy dynamic code generation, long-running JVMs, and unusual compilation behavior.

```text
JVM performance problem
        ≠
necessarily heap or GC problem
```

The JIT has its own memory lifecycle.

---

## Mental model checkpoint

We have now built most of HotSpot's execution pipeline:

```text
Java source
    ↓
.class / bytecode
    ↓
Class loading + runtime metadata
    ↓
JVM frames
    ↓
Interpreter
    ↓
runtime profiling
    ↓
C1
    ↓
more profiling
    ↓
C2
    ↓
optimized nmethod
    ↓
Code Cache
    ↓
CPU
    │
    └── assumption fails
              ↓
        deoptimization
              ↓
       profile / compile again
```

This is the core of HotSpot's **adaptive execution engine**.

The next piece is what allows all of these moving parts—compiled code, GC, deoptimization, stack walking, and runtime operations—to coordinate safely.

**Next byte:** **Safepoints — why HotSpot sometimes needs every Java thread to reach a known execution state, how compiled code cooperates with safepoint polling, and why "time to safepoint" is different from the GC pause itself.**
