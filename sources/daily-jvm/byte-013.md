next byte



## Daily JVM Byte #13 — The HotSpot interpreter: executing bytecode before JIT compilation

Yesterday we covered JVM frames, locals, and the operand stack. Today we connect that to actual execution.

In HotSpot, bytecode can initially run through the **interpreter**. The interpreter executes JVM bytecodes using generated machine-code templates rather than compiling the whole method up front. Current HotSpot source still uses the template-interpreter machinery in JDK 25-era code. ([GitHub](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/interpreter/templateInterpreterGenerator.cpp?utm_source=chatgpt.com))

### Core execution model

Suppose bytecode is:
```text
iload_1
iload_2
iadd
ireturn
```

Conceptually, the interpreter repeatedly does:
```text
read current bytecode
↓
dispatch to implementation for that bytecode
↓
manipulate current frame / operand stack
↓
advance bytecode position
↓
repeat
```

So for `iadd`:
```text
operand stack before:
[..., 10, 20]

iadd

operand stack after:
[..., 30]
```

The JVM specification defines the semantics of the bytecodes; HotSpot decides how to implement those semantics efficiently. JDK 25 uses the same JVM execution model specified by the JVMS. ([OpenJDK](https://cr.openjdk.org/~prr/8357176/specs/index.html?utm_source=chatgpt.com))

## Why interpret at all?

Why not JIT-compile every method immediately?

Because compilation itself costs:
```text
CPU
+
memory
+
compiler-thread time
```

And many methods may execute only once.

For example:
```text
application starts
    ↓
thousands of methods touched
    ↓
many execute only a few times
```

Compiling all of them aggressively would waste resources.

Interpretation gives HotSpot a cheap startup path:
```text
method first executed
    ↓
interpret immediately
    ↓
observe runtime behavior
    ↓
compile only if worthwhile
```

That is the first key idea behind **tiered execution**.

## The interpreter is also a profiler

While executing code, HotSpot can collect information such as:
```text
method invocation frequency
loop back-edge frequency
branch behavior
receiver types at calls
```

Conceptually:
```text
foo(x)

observed:
90% → x is ArrayList
10% → x is LinkedList
```

This runtime information is extremely valuable to the JIT compiler.

Without profiling, the compiler might have to assume:
```text
many possible implementations
```

With profiling, it can speculate:
```text
ArrayList is overwhelmingly likely here
```

and optimize aggressively.

This is one reason Java can sometimes outperform what static inspection of the source would suggest: the optimizer sees **runtime behavior**, not just source structure.

## Invocation counters and hotness

HotSpot tracks method execution activity.

Conceptually:
```text
method called
    ↓
counter increases
    ↓
becomes "hot"
    ↓
candidate for compilation
```

Loops matter too.

Consider:
```java
void process() {
    for (int i = 0; i < 100_000_000; i++) {
        work(i);
    }
}
```

The method may only have been invoked once, yet the loop is clearly hot.

HotSpot therefore also tracks loop activity through **back-edge counters**.

Conceptually:
```text
loop branch jumps backward
        ↓
back-edge counter increases
        ↓
hot loop detected
```

This enables compilation even when a method has few invocations but contains heavily repeated work.

## Interpreter vs compiled code

Interpretation:
```text
bytecode
   ↓
interpreter template
   ↓
execute operation
```

Compiled execution:
```text
bytecode
   ↓
JIT compiler
   ↓
native machine code
   ↓
CPU executes directly
```

Compiled code avoids per-bytecode dispatch overhead.

But compilation has an upfront cost.

That creates the fundamental trade-off:
```text
Interpreter
+ starts immediately
+ cheap startup
- slower steady-state execution

JIT
+ much faster hot code
+ can perform speculative optimization
- compilation costs CPU and memory
```

HotSpot combines both rather than choosing one.

## A subtle point: interpretation is not "Java implemented in Java"

The interpreter itself is part of HotSpot.

The template interpreter generates architecture-specific native code for bytecode operations.

Conceptually:
```text
JVM bytecode: iadd

HotSpot template:
    native instructions implementing integer addition
```

So when Java code is interpreted, the CPU is still executing native instructions—the difference is that those instructions belong to the interpreter machinery rather than to a method-specific optimized compiled version. ([GitHub](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/interpreter/templateInterpreterGenerator.cpp?utm_source=chatgpt.com))

## Production implication: warm-up

This explains the familiar JVM warm-up curve:
```text
startup
  ↓
mostly interpreted / lightly compiled
  ↓
profiling accumulates
  ↓
hot methods identified
  ↓
more optimized code generated
  ↓
steady-state performance
```

Therefore:
```text
performance at second 1
≠
performance at minute 5
```

This matters for:

- microbenchmarks
- short-lived CLI applications
- serverless workloads
- autoscaling
- latency-sensitive services immediately after deployment

It is also why Java benchmarks need warm-up iterations.

## Mental model

We now have:
```text
.class
  ↓
class loading
  ↓
bytecode
  ↓
JVM frame
  ↓
interpreter executes bytecodes
  ↓
profiling data accumulates
  ↓
hotness detected
  ↓
JIT compilation
```

This is an important transition in the course: we are moving from **JVM execution semantics** into **adaptive optimization**.

**Next byte:** tiered compilation in HotSpot — C1 vs C2, compilation levels, why HotSpot deliberately compiles the same method more than once, and how profiling drives the path toward optimized machine code.
