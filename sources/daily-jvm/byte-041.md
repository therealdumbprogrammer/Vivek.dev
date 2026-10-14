Source: originating conversation, supplied Daily JVM Byte #41. Original wording available in the conversation reader.

## Daily JVM Byte #41 — Reading HotSpot source without getting lost

Yesterday we connected JVM concepts to structures such as `InstanceKlass`, `Method`, `nmethod`, `ClassLoaderData`, and `JavaThread`. Today we map those structures to the OpenJDK HotSpot source tree.

The objective is not to become a HotSpot contributor. It is to be able to answer:

> “I understand the JVM concept. Where is it actually implemented?”

The relevant code is primarily under:
```
src/hotspot/share/
```

### 1. Start with the subsystem directories

A useful map is:
```
src/hotspot/share/
│
├── oops/          object + class metadata
├── runtime/       threads, safepoints, VM runtime
├── interpreter/   bytecode interpreter
├── code/          generated/compiled code management
├── compiler/      compilation infrastructure
├── c1/            C1 compiler
├── opto/          C2 optimizing compiler
├── gc/            garbage collectors
├── memory/        memory-management infrastructure
├── classfile/     class loading/parsing
└── services/      diagnostics/serviceability
```

Do not browse HotSpot sequentially. Start from the subsystem corresponding to the concept you are investigating.

---

## 2. `oops/`: objects and class metadata

Despite the name, `oops/` is not just about heap objects.

You will find structures such as:
```
oop.hpp
klass.hpp
instanceKlass.hpp
method.hpp
constantPool.hpp
```

These map directly to yesterday's model:
```
Java object
    │
    ▼
oop

object's type
    │
    ▼
Klass
    │
    ▼
InstanceKlass

class
 ├── Method
 └── ConstantPool
```

`oop` means **ordinary object pointer** in HotSpot terminology.

So when source code contains something like:
```
oop obj
```

think:
```
reference to a Java heap object
```

Whereas:
```
Klass* klass
```

points into HotSpot's class metadata world.

That distinction is fundamental when reading HotSpot.

---

## 3. `runtime/`: execution machinery

For concepts such as:
```
JavaThread
safepoints
VM operations
locks
thread-local runtime state
```

look under:
```
src/hotspot/share/runtime/
```

Examples include files around:
```
thread.*
safepoint.*
vmOperations.*
```

This connects our earlier model:
```
java.lang.Thread
       ↓
JavaThread
       ↓
execution state
       ↓
safepoint coordination
```

When investigating *how HotSpot coordinates running threads*, `runtime/` is usually a better starting point than `oops/`.

---

## 4. `interpreter/`: bytecode execution

Recall:
```
bytecode
   ↓
interpreter
   ↓
profiling
   ↓
JIT
```

Interpreter implementation lives primarily under:
```
src/hotspot/share/interpreter/
```

HotSpot's normal interpreter is a **template interpreter**.

Rather than implementing bytecodes as something conceptually equivalent to:
```
while (...) {
    switch (opcode) {
        case IADD:
            ...
    }
}
```

HotSpot builds machine-code templates implementing bytecode operations.

Conceptually:
```
iadd bytecode
      ↓
HotSpot template
      ↓
generated machine instructions
      ↓
CPU
```

This is why our earlier statement that HotSpot's interpreter is itself largely generated native code matters.

---

## 5. `c1/`, `opto/`, and `compiler/`: JIT compilation

The compiler side is divided roughly into:
```
compiler/
    shared compilation infrastructure

c1/
    C1 compiler

opto/
    C2 optimizing compiler
```

Why `opto`?

Historically, HotSpot's server compiler is implemented around an optimizing compiler architecture, hence the directory name.

Our tiered model therefore maps roughly to source:
```
                hot method
                    │
           ┌────────┴────────┐
           ▼                 ▼
          C1                 C2
           │                 │
         c1/               opto/
           │                 │
           └───────┬─────────┘
                   ▼
               nmethod
```

The output then crosses into the Code Cache machinery.

---

## 6. `code/`: compiled-code lifecycle

For concepts such as:
```
nmethod
Code Cache
compiled-method lifecycle
relocation information
```

look under:
```
src/hotspot/share/code/
```

This connects Byte #33 directly to HotSpot:
```
C1 / C2
   ↓
machine code
   ↓
nmethod
   ↓
Code Cache
```

An important lesson when reading the source is that compilation and compiled-code management are separate concerns.

The compiler **creates** optimized code.

The code subsystem must then manage its runtime lifecycle:
```
install
execute
invalidate
deoptimize
reclaim
```

---

## 7. `gc/`: collector implementations

Under:
```
src/hotspot/share/gc/
```

you will find collector-specific implementations.

Conceptually:
```
gc/
│
├── shared/
├── g1/
├── zgc/
├── serial/
├── parallel/
└── ...
```

This explains why some JVM mechanisms are shared:
```
GC roots
barriers
allocation infrastructure
```

while others are collector-specific:
```
G1 regions / remembered sets

ZGC colored pointers / load barriers

Parallel GC worker algorithms
```

When reading GC code, first determine:

> Is this generic GC infrastructure or a collector-specific implementation?

Otherwise it is easy to mistake a G1 implementation detail for a universal JVM rule.

---

## 8. Trace concepts, not entire call graphs

Suppose you want to understand class loading.

Do **not** attempt:
```
main()
 ↓
follow every function
 ↓
300 files later
 ↓
lost
```

Instead start from your mental model:
```
.class bytes
    ↓
parse class
    ↓
create InstanceKlass
    ↓
create Method metadata
    ↓
attach ConstantPool
    ↓
associate with ClassLoaderData
```

Then locate those structures and the code connecting them.

The source should validate and deepen your model—not replace it.

---

## 9. Example: tracing a Java method

Consider:
```
int add(int a, int b) {
    return a + b;
}
```

We can now trace it across HotSpot conceptually:
```
classfile/
    │
    │ parse .class
    ▼
oops/
    │
    │ Method + ConstantPool
    ▼
interpreter/
    │
    │ execute bytecodes
    │
    │ collect profiles
    ▼
c1/ or opto/
    │
    │ compile
    ▼
code/
    │
    │ create/install nmethod
    ▼
Code Cache
    │
    ▼
CPU
```

That one path crosses much of what we've learned over the last 40 bytes.

---

## Production implications

You rarely need HotSpot source during routine incidents.

It becomes useful when documentation stops at:
```
"the JVM does X"
```

and you need to know:
```
Under exactly what conditions?

Is this collector-specific?

Is this still true in JDK 25?

What does this diagnostic counter actually measure?

What causes this VM operation?

Where does this memory category originate?
```

For example:
```
JFR/NMT/GC observation
        ↓
unexpected JVM behavior
        ↓
identify subsystem
        ↓
find relevant HotSpot structure
        ↓
inspect implementation
```

This is a much more productive use of the source than reading HotSpot for its own sake.

## Mental model checkpoint

We now have three levels of JVM understanding:
```
Level 1 — Java abstraction

Class
Method
Thread
Object


Level 2 — JVM mechanism

class loading
interpreter
JIT
GC
safepoints


Level 3 — HotSpot implementation

InstanceKlass
Method
JavaThread
nmethod
ClassLoaderData
OopMaps
```

And now those structures have locations:
```
Objects/classes ─────► oops/
Threads/runtime ─────► runtime/
Interpreter ─────────► interpreter/
C1 ──────────────────► c1/
C2 ──────────────────► opto/
Compiled code ───────► code/
GC ──────────────────► gc/
Class loading ───────► classfile/
```

The central idea:

> **Do not learn HotSpot by reading its source tree. Build the JVM mental model first, then use that model as an index into the source.**

That makes millions of lines of C++ considerably less intimidating.

**Next byte:** **One object allocation end-to-end — following `new Order()` through bytecode `new`, `InstanceKlass`, TLAB allocation, object-header initialization, constructor execution, JIT fast paths, and finally GC reachability.**



\===========
