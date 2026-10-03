# Daily JVM Byte #33 — source archive

Source: original user attachment in conversation `6a996dbd-f8b0-83ee-a26a-3b05f1d7e4a3`. Original wording follows. Lesson 33 also incorporates the reviewed technical refinements in that conversation.

## Daily JVM Byte #33 — Code Cache internals: where JIT-compiled code lives

Yesterday we examined Metaspace. Today we move to another native-memory area that connects directly to the JIT pipeline we covered earlier: the **Code Cache**.

Recall:

```text
bytecode
   ↓
interpreter
   ↓
profiling
   ↓
C1 / C2
   ↓
native machine code
   ↓
?
```

That final machine code needs executable memory. HotSpot stores it in the **Code Cache**.

### 1. Why a Code Cache exists

Consider:

```java
int add(int a, int b) {
    return a + b;
}
```

Initially HotSpot may interpret its bytecode:

```text
iload_1
iload_2
iadd
ireturn
```

After the method becomes hot, C1 or C2 may compile it into native instructions.

Conceptually:

```text
Method metadata
     │
     │ bytecode
     ▼
JIT compiler
     │
     │ machine code
     ▼
Code Cache
```

Subsequent calls can execute the compiled version directly rather than repeatedly interpreting the bytecode.

---

## 2. The important HotSpot structure: `nmethod`

HotSpot does not simply dump anonymous machine-code bytes into executable memory.

A compiled Java method is represented by an internal structure called an **`nmethod`**.

Conceptually:

```text
nmethod
│
├── machine instructions
├── entry points
├── relocation information
├── exception-handling metadata
├── GC / oop metadata
├── deoptimization metadata
└── debugging / scope information
```

This is important because compiled code participates in many JVM subsystems.

For example, GC may need to know:

```text
Which object references exist
inside compiled stack frames?
```

Deoptimization needs to know:

```text
How do I reconstruct interpreter
frames from this optimized frame?
```

Class unloading may need to know:

```text
Does this compiled method depend
on metadata that is disappearing?
```

So an `nmethod` is not merely executable code. It is a runtime bridge between the JIT and the rest of HotSpot.

---

## 3. Code Cache is native executable memory

Our process model now expands:

```text
JVM Process
│
├── Java Heap
│
├── Metaspace
│
└── Code Cache
       │
       ├── compiled Java methods
       ├── JVM stubs
       └── associated code metadata
```

This memory is outside `-Xmx`.

Therefore JIT compilation contributes to native process memory:

```text
more compiled methods
       ↓
more nmethods
       ↓
more Code Cache usage
```

---

## 4. HotSpot uses a segmented Code Cache

Modern HotSpot normally divides the Code Cache into separate heaps.

Conceptually:

```text
Code Cache

┌──────────────────────────────┐
│ Non-method code              │
├──────────────────────────────┤
│ Profiled code                │
├──────────────────────────────┤
│ Non-profiled code            │
└──────────────────────────────┘
```

### Profiled code

Primarily contains code compiled at optimization levels that still collect profiling information, particularly C1-generated code.

```text
C1
 ↓
instrumented/profiled compiled code
 ↓
Profiled Code Heap
```

### Non-profiled code

Primarily contains highly optimized code that no longer needs profiling instrumentation—for example C2 output.

```text
C2
 ↓
optimized machine code
 ↓
Non-profiled Code Heap
```

### Non-method code

Contains JVM-generated code that is not ordinary compiled Java methods, including runtime stubs and adapter code.

Separating these areas helps HotSpot manage code with different lifetimes and purposes.

---

## 5. Connection to tiered compilation

Now our earlier tiered-compilation model becomes physical:

```text
Java method
    │
    ▼
Interpreter
    │
    │ profiling
    ▼
C1 compilation
    │
    ▼
Profiled Code Heap
    │
    │ more profiling
    ▼
C2 compilation
    │
    ▼
Non-profiled Code Heap
```

A single Java method can therefore have different compiled versions during its lifetime.

For example:

```text
time ─────────────────────────────►

interpret
   ↓
C1 version
   ↓
C2 version
```

Old compiled versions do not necessarily remain useful forever.

Which leads to reclamation.

---

## 6. Compiled code can become invalid

Recall speculative optimization.

Suppose C2 observes:

```text
Animal a

99.9% of calls:
a = Dog
```

It may optimize around that assumption.

Later:

```text
a = Cat
```

The assumption becomes invalid.

HotSpot may:

```text
invalidate nmethod
       ↓
deoptimize execution
       ↓
return to interpreter / lower tier
       ↓
possibly compile again
```

The old `nmethod` eventually becomes reclaimable.

Compiled code can also become obsolete because of:

```text
class unloading
method redefinition
dependency invalidation
replacement by newer compilation
```

So the Code Cache is dynamic memory, not a write-once repository.

---

## 7. Code Cache sweeping and reclamation

HotSpot tracks the lifecycle of compiled methods.

Simplified:

```text
compiled
   ↓
active
   ↓
invalid / not entrant
   ↓
no longer executing
   ↓
reclaimable
```

A method cannot simply disappear while a thread is executing inside its generated code.

HotSpot therefore coordinates code invalidation and reclamation carefully with runtime execution and safepoint/handshake mechanisms.

Eventually unused code-cache space can be reused for new compilations.

---

## 8. What happens when Code Cache pressure becomes severe?

The Code Cache has bounded capacity.

A relevant upper-bound option is:

```text
-XX:ReservedCodeCacheSize
```

Imagine:

```text
Code Cache

████████████████████████████░░
                         nearly full
```

If HotSpot cannot obtain sufficient space for new compiled code, JIT compilation can be constrained or disabled until space becomes available.

That is dangerous because the application may then execute more code at lower compilation tiers or through the interpreter.

The symptom can therefore be unusual:

```text
heap healthy
GC healthy
CPU increases
application slows down
```

The problem may actually be:

```text
Code Cache pressure
       ↓
less effective JIT compilation
       ↓
slower execution
```

This is why Code Cache exhaustion is a performance problem rather than the usual Java-heap `OutOfMemoryError` story.

---

## 9. Diagnosing the Code Cache

A useful command is:

```bash
jcmd <pid> Compiler.codecache
```

It exposes Code Cache usage and compilation-related information.

You can also inspect compilation activity with:

```bash
jcmd <pid> Compiler.queue
```

and Unified Logging can expose compiler/code-cache behavior when deeper investigation is required.

NMT also gives the broader native-memory view:

```bash
jcmd <pid> VM.native_memory summary
```

where Code Cache memory appears under the `Code` category.

The diagnostic path becomes:

```text
unexpected CPU/performance degradation
            ↓
GC looks normal
            ↓
check compilation activity
            ↓
check Code Cache
            ↓
is JIT compilation progressing normally?
```

---

## Production implications

Code Cache problems are uncommon in ordinary applications because HotSpot ergonomics generally handle them well.

They become more interesting with workloads containing:

```text
very large applications
many dynamically generated classes
heavy framework/proxy generation
dynamic languages
frequent class loading/unloading
large numbers of hot methods
```

The key lesson is not to start tuning `ReservedCodeCacheSize`.

It is to recognize the subsystem when diagnostics point there.

### Mental model checkpoint

We can now connect three major runtime areas:

```text
                 Java class
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼

     Objects       Metadata      Executable code

       │              │              │
       ▼              ▼              ▼

   Java Heap       Metaspace      Code Cache
                                      │
                                      ▼
                                  nmethods
```

And the execution pipeline becomes:

```text
.class
  ↓
Class Loader
  ↓
Metaspace
  ↓
bytecode
  ↓
Interpreter
  ↓
profiling
  ↓
C1 / C2
  ↓
nmethod
  ↓
Code Cache
  ↓
CPU executes native instructions
```

This also reconnects several earlier lessons: **tiered compilation creates the code, speculative optimization can invalidate it, deoptimization needs its metadata, GC must understand references inside it, and native-memory accounting must include it.**

The central idea is:

> **The Code Cache is where HotSpot turns its dynamic optimization decisions into executable machine code, while `nmethod` metadata keeps that optimized code connected to GC, deoptimization, class loading, and the rest of the runtime.**

**Next byte:** **Thread stacks and stack walking — native platform-thread stacks, compiled vs interpreted frames, oop maps, stack overflow, and how HotSpot/GC can safely understand a stack containing optimized machine-code frames.**