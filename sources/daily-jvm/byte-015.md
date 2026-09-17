next byte:



## Daily JVM Byte #15 — Speculative optimization and deoptimization

Yesterday we covered tiered compilation and how C2 uses runtime profiles to optimize hot code. Today is the consequence of that design:

> HotSpot can optimize based on assumptions that are true now, then undo those optimizations later if reality changes.

That mechanism is **deoptimization**.

### Why speculation exists

Consider:
```java
interface Payment {
    int fee();
}

int calculate(Payment p) {
    return p.fee();
}
```

At compile time, many implementations may be possible.

But profiling may show:
```text
99.9% → CardPayment
```

C2 can optimize around that observed behavior.

Conceptually:
```text
virtual/interface call
        ↓
guard: receiver is CardPayment?
        ↓ yes
inline CardPayment.fee()
        ↓
optimized machine code
```

This is much faster than preserving a fully generic dispatch path everywhere.

### The assumption is guarded

HotSpot does not simply assume blindly.

Optimized code contains checks or relies on tracked runtime dependencies.

Conceptually:
```text
if receiver is CardPayment
    execute optimized path
else
    uncommon trap
```

The uncommon case can transfer control into the deoptimization machinery. Current HotSpot source explicitly builds uncommon-trap paths with deoptimization reasons and recompile actions. ([GitHub](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/opto/loopnode.cpp?utm_source=chatgpt.com))

### What happens during deoptimization?

Suppose a previously unseen implementation appears:
```text
CardPayment
BankTransferPayment  ← new runtime behavior
```

The optimized assumptions may no longer be safe.

HotSpot can:
```text
optimized compiled frame
        ↓
deoptimization
        ↓
reconstruct Java execution state
        ↓
continue in interpreter / less optimized code
        ↓
possibly recompile with new profile
```

This is not equivalent to restarting the method.

Execution continues from a logically equivalent Java state.

### Reconstructing frames

This gets interesting because C2 may have heavily transformed the method.

For example, it may have:
```text
inlined 4 methods
eliminated temporary objects
removed locks
moved values into registers
```

Yet deoptimization may need to restore the logical state:
```text
method A frame
method B frame
method C frame
locals
operand stacks
objects
locks
```

HotSpot therefore stores metadata alongside compiled code describing how optimized machine state maps back to JVM state.

The deoptimization code explicitly reconstructs virtual frames for inlined Java methods. ([GitHub](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/runtime/deoptimization.cpp?utm_source=chatgpt.com))

### Connection to escape analysis

Recall Byte #9:
```java
Point p = new Point(10, 20);
```

C2 may eliminate `p` completely through scalar replacement.

Then deoptimization occurs.

But the interpreter expects a real Java object.

So HotSpot may need to **rematerialize** the object:
```text
scalar values:
x = 10
y = 20
   ↓
deoptimization
   ↓
allocate Point
restore fields
   ↓
continue execution
```

The current HotSpot deoptimization implementation explicitly contains logic for reallocating objects removed by escape analysis and restoring eliminated locks. ([GitHub](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/runtime/deoptimization.cpp?utm_source=chatgpt.com))

This is one of the strongest examples of how sophisticated the JIT/runtime contract is.

### Why "uncommon trap"?

C2 often treats unlikely paths specially.

Suppose profiling says:
```text
condition false → 0.01%
```

Rather than generate fully optimized machine code for both paths, C2 may optimize the common path and turn the rare branch into an **uncommon trap**.

Conceptually:
```text
common path
    ↓
highly optimized

rare path
    ↓
uncommon trap
    ↓
deoptimize
```

This makes hot code smaller and faster.

The trade-off is obvious:
```text
better common-case performance
        vs
cost when speculation fails
```

### Recompilation after deoptimization

A failed assumption does not mean HotSpot gives up permanently.

Conceptually:
```text
profile A
   ↓
C2 compile
   ↓
assumption fails
   ↓
deopt
   ↓
new runtime profile
   ↓
compile again
```

HotSpot also tracks repeated traps so it can avoid repeatedly applying an optimization that keeps failing; the compiler contains explicit logic for "too many traps". ([GitHub](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/opto/graphKit.cpp?utm_source=chatgpt.com))

So adaptive optimization is iterative:
```text
observe
→ optimize
→ validate
→ deopt if needed
→ learn
→ optimize again
```

### Production implications

Occasional deoptimization is normal.

But excessive deoptimization can cause:
```text
CPU spent recompiling
performance instability
latency spikes
loss of optimized code
```

This can happen in workloads with unstable type profiles, highly dynamic code, or changing call-site behavior.

It also explains why performance may occasionally regress after a system has already warmed up.

A useful conceptual signal is:
```text
steady type behavior
→ stable optimized code

constantly changing behavior
→ speculation failures
→ deoptimization/recompilation
```

### Mental model update

We now have the adaptive execution loop:
```text
bytecode
   ↓
Interpreter
   ↓
profiling
   ↓
C1
   ↓
more profiling
   ↓
C2 speculative optimization
   ↓
optimized native code
   │
   ├── assumptions remain true
   │        ↓
   │   fast execution
   │
   └── assumption fails
            ↓
       deoptimization
            ↓
     reconstructed JVM state
            ↓
      interpreter / recompile
```

This is the important shift:

> JIT compilation is not a one-way conversion from bytecode to machine code. HotSpot continuously moves between execution representations as runtime knowledge changes.

**Next byte:** the Code Cache — where JIT-generated native code lives, how HotSpot organizes profiled vs non-profiled code, what happens when the cache fills, and why Code Cache pressure can affect production performance.
