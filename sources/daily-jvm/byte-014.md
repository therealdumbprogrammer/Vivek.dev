next byte



## Daily JVM Byte #14 — Tiered compilation: C1, C2, and why HotSpot compiles a method more than once

Yesterday we saw the interpreter execute bytecode while collecting runtime profiling data. Today is the next step:
```text
Interpreter
   ↓
C1 compilation
   ↓
more profiling
   ↓
C2 compilation
```

HotSpot uses **tiered compilation** so it can balance startup speed, profiling quality, and peak performance. In current HotSpot, tiered compilation is enabled by default for the server VM. ([Oracle Docs](https://docs.oracle.com/en/java/javase/24/vm/java-hotspot-virtual-machine-performance-enhancements.html?utm_source=chatgpt.com))

### 1. Why two JIT compilers?

HotSpot has two main JIT compilers:
```text
C1 → fast compilation, lighter optimization
C2 → slower compilation, aggressive optimization
```

C1 exists because compiling everything with C2 immediately would cost too much CPU and startup time.

C2 exists because hot server code eventually benefits from much deeper optimization.

So HotSpot does not choose:
```text
fast startup OR peak performance
```

It tries to get both.

### 2. The compilation levels

A useful mental model is:
```text
Level 0 → Interpreter
Level 1 → C1, no profiling
Level 2 → C1, limited profiling
Level 3 → C1, full profiling
Level 4 → C2
```

The common path for an important method is roughly:
```text
0 → 3 → 4
```

Meaning:
```text
interpret
   ↓
compile quickly with C1 + profiling
   ↓
collect richer execution data
   ↓
recompile with C2
```

HotSpot can choose other transitions depending on runtime conditions and compiler queues; the path is policy-driven rather than a fixed sequence. ([OpenJDK](https://cr.openjdk.org/~thartmann/talks/2017-Compiler-Design-Guest-Talk.pdf?utm_source=chatgpt.com))

### 3. Why C1 profiling is valuable

Suppose the interpreter observes:
```text
process(Order)
```

becoming hot.

Instead of continuing to interpret it while collecting more data, HotSpot can compile it with C1:
```text
bytecode
   ↓
C1
   ↓
native code + profiling instrumentation
```

Now the method executes much faster than interpreted code while still gathering information such as:
```text
invocation counts
branch behavior
receiver types
loop activity
```

This is one of the key advantages of tiered compilation: profiling itself happens in reasonably fast compiled code. Oracle's HotSpot documentation explicitly describes this as a major reason tiered compilation improves both startup and profiling quality. ([Oracle Docs](https://docs.oracle.com/en/java/javase/24/vm/java-hotspot-virtual-machine-performance-enhancements.html?utm_source=chatgpt.com))

### 4. C2 uses the profile to speculate

Now imagine HotSpot observes:
```java
service.process(request);
```

and profiling shows:
```text
99.9% of receivers → DefaultService
```

At the source level, this could be a polymorphic virtual call.

C2 can effectively reason:
```text
"Almost every execution uses DefaultService."
```

and optimize around that assumption.

That can enable:
```text
virtual call
   ↓
devirtualization
   ↓
method inlining
   ↓
further optimization
```

Once code is inlined, C2 sees a much larger optimization scope.

For example:
```java
int total(Order o) {
    return o.price() + o.tax();
}
```

may eventually become a highly optimized sequence with method-call overhead removed entirely.

This is why **inlining is central to JIT performance**: it exposes more code to constant propagation, dead-code elimination, escape analysis, loop optimization, and other transformations.

### 5. The same method can exist in multiple forms over time

A method may conceptually go through:
```text
bytecode
   ↓
interpreted execution
   ↓
C1-compiled version
   ↓
C2-compiled version
```

This means "the method" is not represented by one permanent piece of machine code.

During the JVM lifetime, HotSpot may:
```text
compile
replace compiled version
invalidate code
recompile again
```

This dynamic lifecycle is fundamental to adaptive optimization.

### 6. Why not send everything directly to C2?

Suppose an application touches 50,000 methods during startup.

If C2 aggressively optimized every one:
```text
large compiler CPU cost
large compilation queues
more generated code
more Code Cache usage
```

Most of those methods might never become hot.

Tiered compilation instead spends expensive optimization effort primarily where runtime evidence suggests it will pay off.

That is the central trade-off:
```text
more compilation work
        ↓
potentially faster execution

but

too much compilation
        ↓
startup CPU + memory + Code Cache pressure
```

### 7. Compilation happens concurrently

Application threads generally do not perform all JIT compilation themselves.

HotSpot has compiler threads:
```text
Application threads
       │
       └── hot method discovered
                 ↓
          compilation request
                 ↓
          compiler queue
          /           \
        C1             C2
        ↓              ↓
     machine code   machine code
```

When compilation finishes, HotSpot can begin executing the compiled version.

Meanwhile the application may have continued running through an older compiled version or through the interpreter.

This is another reason the JVM is an adaptive runtime rather than a simple "bytecode-to-native" translator.

### 8. The Code Cache appears

Where does all that generated native code go?

Not into the Java heap.

HotSpot stores JIT-generated machine code in the **Code Cache**:
```text
Java Heap
  → Java objects

Metaspace
  → class metadata

Code Cache
  → generated native code
```

With tiered compilation, HotSpot may generate more compiled code because different versions of methods can exist over time. The Code Cache is therefore larger when tiered compilation is enabled, and HotSpot supports a segmented Code Cache for profiled, non-profiled, and non-method code. ([Oracle Docs](https://docs.oracle.com/en/java/javase/24/docs/specs/man/java.html?utm_source=chatgpt.com))

We will examine the Code Cache separately.

### Production implications

A JVM service does not immediately start in its final performance state:
```text
startup
   ↓
interpretation
   ↓
C1
   ↓
profiling
   ↓
C2
   ↓
steady state
```

So production latency can temporarily change after:
```text
application restart
new deployment
autoscaling
traffic shift
```

This is why warm-up matters for low-latency systems.

It also explains why benchmarking a JVM application for only a few seconds can be misleading.

You may be measuring:
```text
interpreter/C1 phase
```

instead of:
```text
steady-state C2 performance
```

### Mental model update

We now have the core adaptive-execution pipeline:
```text
.class bytecode
      ↓
Interpreter
      ↓
runtime profiling
      ↓
C1 compiled code
      ↓
more profiling
      ↓
C2
      ↓
aggressively optimized native code
      ↓
Code Cache
```

The important idea is:

> HotSpot optimizes based on what the program actually does, not only on what the source code says it could do.

That power comes with a risk: C2 sometimes makes optimistic assumptions that later become false.

**Next byte:** speculative optimization and deoptimization — how HotSpot safely bets on runtime behavior, what happens when the bet becomes wrong, and why optimized machine code can be discarded while the JVM is running.