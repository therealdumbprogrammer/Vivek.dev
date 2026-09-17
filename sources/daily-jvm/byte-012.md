# Source: byte-012

Originating conversation: Save Backend Resource (6a996dbd-f8b0-83ee-a26a-3b05f1d7e4a3). No source publication date supplied.

next byte



## Daily JVM Byte #12 — Stack frames, local variables, and the operand stack

Yesterday we covered how bytecode refers to runtime entities through the constant pool. Today we look at **where bytecode execution keeps its working state**.

Each method invocation gets its own JVM **frame**. A frame contains at least:
```text
Frame
├── Local variable array
├── Operand stack
└── Reference to the runtime constant pool
```

The JVM Specification defines a new frame for each method invocation; the frame is discarded when that invocation completes, normally or exceptionally. ([Oracle Docs](https://docs.oracle.com/javase/specs/jvms/se25/jvms25.pdf?utm_source=chatgpt.com))

### 1. Local variables are indexed slots

Consider:
```java
int add(int a, int b) {
    int result = a + b;
    return result;
}
```

For an instance method, the local-variable array conceptually starts like:
```text
slot 0 → this
slot 1 → a
slot 2 → b
slot 3 → result
```

For a static method, there is no `this`, so parameters begin at slot 0. The JVMS explicitly specifies this convention. ([Oracle Docs](https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-2.html?utm_source=chatgpt.com))

These are not Java source-level variables anymore. They are indexed runtime slots used by bytecode instructions such as:
```text
iload_1
istore_3
aload_0
```

---

## 2. The JVM is stack-oriented

Arithmetic usually happens through the frame's **operand stack**.

Suppose:
```java
int c = a + b;
```

A simplified bytecode sequence might be:
```text
iload_1
iload_2
iadd
istore_3
```

Follow the operand stack:
```text
initial
[]

iload_1
[a]

iload_2
[a, b]

iadd
[a + b]

istore_3
[]
```

`iadd` does not say:
```text
add local 1 to local 2
```

Instead it means roughly:
```text
pop two ints
add them
push result
```

The operand stack is therefore the JVM bytecode engine's temporary workspace. ([Oracle Docs](https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-2.html?utm_source=chatgpt.com))

---

## 3. Why use a stack-based instruction set?

A register-based bytecode might encode operations like:
```text
ADD r1, r2, r3
```

The JVM instead uses:
```text
load
load
add
store
```

A stack-oriented instruction set has useful properties:

- compact bytecode encoding
- no dependency on physical CPU register counts
- easy portability across architectures
- straightforward verification of operand types

The trade-off is that stack bytecode is not directly how modern CPUs execute efficiently.

That is fine because HotSpot does not intend hot methods to remain bytecode forever:
```text
bytecode
   ↓
interpreter
   ↓
profiling
   ↓
JIT compiler
   ↓
register-based native machine code
```

So the JVM bytecode format is optimized more for **portable intermediate representation** than for direct hardware execution.

---

## 4. Frame sizes are known from the class file

The JVM does not need to dynamically grow the local-variable array or operand stack for each bytecode instruction.

The class file's `Code` attribute records:
```text
max_locals
max_stack
```

Conceptually:
```text
method {
    max_locals = 4
    max_stack  = 2
}
```

The verifier and runtime can therefore know the maximum execution-state requirements in advance. ([Oracle Docs](https://docs.oracle.com/javase/specs/jvms/se25/jvms25.pdf?utm_source=chatgpt.com))

This is another reason bytecode verification matters: HotSpot should not discover halfway through execution that malformed bytecode exceeds the declared operand-stack shape.

---

## 5. Method invocation creates another frame

Suppose:
```java
void a() {
    b();
}

void b() {
    c();
}
```

The thread's logical JVM stack becomes:
```text
Thread stack

┌──────────┐
│ c frame  │ ← current frame
├──────────┤
│ b frame  │
├──────────┤
│ a frame  │
└──────────┘
```

When `c()` returns:
```text
c frame removed
b frame becomes current
```

Return values are passed back to the invoking frame through the invocation/operand-stack machinery. ([Oracle Docs](https://docs.oracle.com/javase/specs/jvms/se25/jvms25.pdf?utm_source=chatgpt.com))

This is the conceptual origin of the stack traces you see:
```text
at Foo.c(...)
at Foo.b(...)
at Foo.a(...)
```

---

## 6. Frames are thread-local

A frame belongs to the thread executing the invocation.
```text
Thread A                 Thread B

Frame foo()              Frame foo()
Frame main()             Frame run()
```

Thread B cannot directly access Thread A's JVM frames.

This matters for concurrency reasoning:
```text
heap objects → potentially shared
frames       → thread-confined execution state
```

But references stored inside those frames may point to shared heap objects:
```text
Frame
  │
  └── local variable ─────► shared Customer object
```

That distinction becomes important later when we discuss synchronization, data races, and GC roots.

---

## 7. Connection to GC roots

Recall Byte #4.

A local reference may live in a frame:
```text
Frame local slot
      │
      ▼
   Customer
```

During GC, HotSpot needs to know which frame locations currently contain object references.

That is why stack frames connect directly to:

- GC-root scanning
- safepoints
- interpreter metadata
- JIT-generated stack maps

So frames are not just an execution abstraction. They are part of the GC/runtime contract.

---

## Production implications

Frames become operationally visible through:
```text
StackOverflowError
thread dumps
JFR stack traces
async-profiler stacks
exception traces
```

Deep recursion creates many frames:
```text
foo()
 └─ foo()
     └─ foo()
         └─ foo()
             ...
```

eventually exhausting available stack space.

Conversely, large numbers of platform threads historically implied significant aggregate stack-memory concerns. Virtual threads change that runtime model substantially, which we will cover later in the threading section.

---

## Mental model update

We can now follow execution farther:
```text
.class
  │
  ├── bytecode
  └── constant pool
        │
        ▼
method invoked
        │
        ▼
new JVM frame
├── locals
├── operand stack
└── constant-pool reference
        │
        ▼
bytecode instructions manipulate frame state
```

We now have enough machinery to examine execution itself.

**Next byte:** the HotSpot interpreter — how bytecodes are dispatched and executed before JIT compilation, why interpretation is useful despite being slower, and how interpreted execution collects the profiling data that enables aggressive JIT optimization.