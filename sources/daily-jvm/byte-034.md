# Daily JVM Byte #34 — source archive

Source: originating ChatGPT conversation `6a996dbd-f8b0-83ee-a26a-3b05f1d7e4a3`. Original wording below is preserved from the user message. Lesson 34 also incorporates the reviewed technical refinements in that conversation.

## Daily JVM Byte #34 — Thread stacks and stack walking: how HotSpot understands executing code

Yesterday we followed JIT compilation into the Code Cache. Today we connect that compiled code back to **thread stacks**.

A platform thread executes using a native stack containing frames from interpreted Java, compiled Java, JVM runtime code, and native code.
```
Platform Thread
      │
      ▼
Native Stack

┌────────────────────┐
│ compiled Java frame│
├────────────────────┤
│ compiled Java frame│
├────────────────────┤
│ interpreter frame  │
├────────────────────┤
│ VM/native frame    │
└────────────────────┘
```

The difficult question is:

> If C2 aggressively rearranges execution, how can GC, deoptimization, exceptions, profilers, and stack traces still understand this stack?

### 1. A stack frame is an execution record

At the conceptual Java level:
```
void a() {
    b();
}

void b() {
    c();
}
```

produces:
```
Thread Stack

┌─────┐
│ c() │ ← current
├─────┤
│ b() │
├─────┤
│ a() │
└─────┘
```

Each invocation needs state such as return information, arguments/locals, intermediate values, and execution-specific metadata.

But the physical representation depends on **how the method is executing**.

---

## 2. Interpreter and compiled frames are different

For interpreted bytecode, HotSpot needs state corresponding closely to the JVM execution model:
```
Interpreter frame

locals
operand stack
current bytecode position
method information
return information
```

Recall our earlier frame model:
```
Local Variables
      +
Operand Stack
```

Compiled execution is different.

C2 may transform:
```
int x = object.value;
int y = x * 2;
return y;
```

into machine code where:
```
x → CPU register
y → never materialized
object → register
```

So a compiled frame does **not** simply contain a neat physical copy of the JVM local-variable table and operand stack.

Instead:
```
Java-level state

        ↓ JIT optimization

registers + stack slots
+ optimized-away values
+ compiler metadata
```

This is why compiled methods need metadata in their `nmethod`.

---

## 3. GC creates a particularly difficult problem

Suppose a thread is executing compiled code:
```
RAX → Java Object A
RBX → integer
stack slot 24 → Java Object B
stack slot 32 → long
```

GC needs to find roots.

But looking at raw machine state:
```
0x00000001234...
42
0x0000000789...
983728
```

doesn't tell the collector which values are object references.

It cannot conservatively assume:
```
"anything that looks like an address is an object"
```

HotSpot uses **precise GC**.

It must know exactly where object references are located.

---

## 4. OopMaps solve this

Compiled code contains metadata describing where object references—HotSpot calls them **oops**, ordinary object pointers—exist at particular execution points.

Conceptually:
```
Compiled method

machine code
─────────────────────────────
instruction 1
instruction 2
instruction 3    ← safepoint
instruction 4
─────────────────────────────

OopMap at safepoint:

RAX           → oop
stack slot 24 → oop
RBX           → not oop
stack slot 32 → not oop
```

Now GC can walk the stopped thread:
```
thread
  ↓
compiled frame
  ↓
identify current safepoint
  ↓
find OopMap
  ↓
RAX ─────────────► Object A
stack slot 24 ───► Object B
```

Those objects become part of the GC root set.

This connects two earlier topics:
```
Safepoints
    +
OopMaps
    ↓
precise stack-root discovery
```

---

## 5. Why GC cannot stop compiled code anywhere

This gives us a deeper explanation for safepoints.

Suppose C2 generated:
```
instruction
instruction
instruction
instruction
instruction
```

HotSpot does not necessarily maintain complete recoverable GC metadata for every arbitrary machine instruction.

Instead, the compiler establishes particular locations where JVM state is sufficiently well described.

Conceptually:
```
machine code

───────●────────────●────────────●──────
       ↑            ↑            ↑
   safepoint    safepoint    safepoint
```

At these locations HotSpot knows enough to perform operations such as root scanning and other VM coordination.

So safepoints are not merely:

> "places where threads can stop."

More precisely, they are places where HotSpot can bring execution into a **well-defined VM state**.

---

## 6. Stack walking uses frame-specific knowledge

Now consider:
```
jstack <pid>
```

or:
```
jcmd <pid> Thread.print
```

HotSpot must reconstruct:
```
com.example.PaymentService.pay()
com.example.OrderService.submit()
com.example.Controller.handle()
```

from a physical stack containing potentially:
```
interpreter frame
compiled frame
compiled frame
native frame
VM frame
```

Stack walking therefore understands different frame types.

Simplified:
```
current frame
     ↓
identify frame kind
     ↓
use appropriate frame metadata
     ↓
locate caller
     ↓
repeat
```

This machinery is reused by many JVM features:
```
stack traces
profilers
GC root scanning
deoptimization
exception handling
JFR
debuggers
```

---

## 7. Deoptimization makes the problem even harder

Recall:
```
Java source
   ↓
bytecode
   ↓
C2 optimization
   ↓
inlining
scalar replacement
constant folding
register allocation
```

Suppose C2 inlined:
```
Controller.handle()
   ↓
Service.process()
   ↓
Repository.find()
```

into essentially one optimized compiled body.

Physically, the native stack may not contain three ordinary Java frames.

Yet if deoptimization occurs, HotSpot may need to reconstruct:
```
Controller.handle()
Service.process()
Repository.find()
```

This is why `nmethod` metadata contains information describing the **logical Java execution state** represented by optimized machine code.

Conceptually:
```
one optimized physical frame
             │
             │ deoptimization metadata
             ▼
multiple logical Java frames
```

That metadata is one of the costs of aggressive dynamic optimization.

---

## 8. Stack size and `StackOverflowError`

Platform-thread native stack sizing is influenced by:
```
-Xss
```

A larger stack permits greater call depth:
```
method
  ↓
method
  ↓
method
  ↓
...
```

but increases per-thread virtual-memory requirements.

A smaller stack:
```
less memory per platform thread
```

but increases the risk of:
```
StackOverflowError
```

particularly with deep recursion or stack-heavy native/JVM execution.

This creates the basic trade-off:
```
larger -Xss
    ↓
more call-depth headroom
    ↓
higher per-platform-thread memory reservation
```

---

## Production implications

Thread stacks connect performance and memory diagnostics.

If a process has:
```
2,000 platform threads
```

then stack reservations can represent significant native address space.

NMT may expose this under:
```
Thread
```

while:
```
jcmd <pid> Thread.print
```

answers a different question:
```
What are those threads actually doing?
```

These tools therefore complement each other:
```
NMT
 ↓
How much native memory is associated
with threads?

Thread dump
 ↓
Why do we have these threads,
and where are they executing?
```

### Mental model checkpoint

Several previously separate concepts now join together:
```
                Java method
                     │
        ┌────────────┴────────────┐
        │                         │
   Interpreter                  JIT
        │                         │
 interpreter frame           nmethod
                                  │
                            machine code
                                  │
                          compiled frame
                                  │
                             OopMaps
                                  │
                  ┌───────────────┼───────────────┐
                  ▼               ▼               ▼
                 GC          stack walking   deoptimization
```

The central idea is:

> **A compiled stack frame is optimized machine state, not a simple copy of a Java frame. HotSpot's compiler-generated metadata—especially OopMaps and deoptimization information—allows the VM to recover the Java-level meaning of that machine state when necessary.**

This is one of the important bridges between the **JIT, GC, safepoints, diagnostics, and runtime execution model**.

**Next byte:** **Direct and mapped memory — `ByteBuffer.allocateDirect`, native allocation, cleaners, `MaxDirectMemorySize`, memory-mapped files, and why off-heap memory can produce process-memory pressure that heap dumps barely explain.**

