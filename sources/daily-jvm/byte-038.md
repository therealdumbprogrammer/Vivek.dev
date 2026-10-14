## Daily JVM Byte #38 — JVM crash anatomy: what actually killed the process?

Yesterday we used NMT to diagnose native-memory growth. Today we cover a different native-side failure: **the JVM process crashes outright**.

This is fundamentally different from a Java exception:
```
Java failure                     Process failure

NullPointerException             SIGSEGV
OutOfMemoryError                 SIGBUS
StackOverflowError               SIGILL
        │                           │
 JVM remains alive          JVM may terminate
```

When HotSpot detects a fatal error, one of the primary artifacts is usually:
```
hs_err_pid<pid>.log
```

### 1. Why can a JVM crash?

Java normally provides memory safety:
```
Object x = null;
x.toString();
```

becomes:
```
NullPointerException
```

But the JVM itself executes native machine code:
```
Java application
      │
      ├── JIT-generated machine code
      ├── HotSpot VM code
      ├── JNI libraries
      └── OS/native libraries
```

A fault in those layers can reach the operating system directly.

For example, JNI code:
```
int *p = NULL;
*p = 42;
```

may trigger:
```
SIGSEGV
   ↓
HotSpot fatal-error handler
   ↓
hs_err_pid...
   ↓
process termination
```

---

## 2. Start with the header

A crash report typically begins with information conceptually like:
```
A fatal error has been detected by the Java Runtime Environment:

SIGSEGV ...
Problematic frame:
C  [libsomething.so+0x1234] ...
```

The first useful question is:

> **What kind of code was executing at the faulting instruction?**

HotSpot uses frame-type markers that can immediately narrow the investigation.

Common ones include:
```
J  → compiled Java code
j  → interpreted Java code
V  → VM code
C  → native C/C++ code
```

So:
```
Problematic frame:
C [libfoo.so+...]
```

immediately points toward native-library code.

Whereas:
```
V [libjvm.so+...]
```

places the fault inside HotSpot itself.

This does not by itself prove root cause, but it sharply narrows the search.

---

## 3. The current thread matters

Next identify the crashing thread.

Conceptually:
```
Current thread:
JavaThread "worker-17"
```

Then inspect its state and stack:
```
Java frames
     ↓
JNI transition
     ↓
native library
     ↓
CRASH
```

For example:
```
OrderService.process()
CompressionService.compress()
native compress()
libcompress.so
<fault>
```

Now there is a coherent execution path.

This is much stronger evidence than merely noticing that `libcompress.so` appears somewhere in the process.

---

## 4. Native and Java stacks complement each other

A crash can cross several execution domains:
```
Java frame
   ↓
compiled Java frame
   ↓
JNI wrapper
   ↓
native function
   ↓
OS library
```

The crash report can contain both native and Java frame information.

This reconnects directly to Byte #34:
```
physical machine stack
        +
HotSpot frame metadata
        ↓
logical Java execution state
```

Even during fatal-error reporting, HotSpot attempts to reconstruct enough runtime state to make the crash diagnosable.

---

## 5. Registers reveal the machine-level failure

A fatal report may include CPU registers:
```
RAX=...
RBX=...
RSP=...
RIP=...
```

`RIP` on x86-64, for example, identifies the current instruction pointer.

Suppose:
```
RAX = 0x0
```

and the crashing instruction effectively performs:
```
load [RAX + 8]
```

That strongly suggests a null/invalid native pointer dereference.

This is below the Java abstraction:
```
Java source
   ↓
bytecode
   ↓
machine code
   ↓
registers
   ↓
CPU fault
```

At this point debugging resembles native C/C++ debugging more than ordinary Java troubleshooting.

---

## 6. `C`, `V`, and `J` failures imply different investigations

A useful first classification is:
```
             Problematic frame
                    │
        ┌───────────┼───────────┐
        │           │           │
        C           V           J
        │           │           │
    native lib    HotSpot    compiled Java
```

### `C` — native library

Investigate:
```
JNI/native library
library version
native stack
symbols
core dump
recent library changes
```

### `V` — HotSpot

Possibilities include:
```
actual JVM bug
native memory corruption caused earlier
bad JNI interaction
hardware problems
```

A crash inside HotSpot does **not automatically mean HotSpot caused the corruption**.

Native code might corrupt memory:
```
JNI writes beyond buffer
        ↓
memory corrupted
        ↓
milliseconds later
        ↓
HotSpot touches corrupted structure
        ↓
crash occurs inside libjvm
```

The crash location and root cause can therefore differ.

### `J` — compiled Java method

This is rarer and may warrant investigation of:
```
JIT-generated code
VM/JIT bug
unsafe/native interactions
memory corruption
```

Again, the problematic frame is evidence, not final proof.

---

## 7. The crash report contains broader VM context

Useful sections commonly include information about:
```
VM version
JDK build
command-line arguments
heap configuration
GC
loaded native libraries
threads
CPU
OS
memory
environment
```

This matters because crashes are frequently environment-specific.

For example:
```
same application
same Java code

JDK 25.0.x + library version A
           ↓
         crash

JDK 25.0.x + library version B
           ↓
         stable
```

Exact runtime and native-library versions are therefore part of the evidence.

---

## 8. When `hs_err` isn't enough: core dumps

The fatal log is a summarized diagnostic artifact.

A **core dump** captures much more of the process state at failure.

Conceptually:
```
hs_err
  ↓
HotSpot-generated diagnostic summary

core dump
  ↓
process memory + machine state
```

Native debuggers such as `gdb` or `lldb` can inspect a core dump to investigate:
```
native stacks
registers
memory
loaded libraries
native symbols
```

For a third-party JNI crash, this can be essential.

The trade-off is size and operational complexity: core dumps can be very large and may contain sensitive process memory.

---

## 9. Do not confuse crashes with external kills

A JVM disappearing does **not** necessarily mean the JVM crashed.

Compare:
```
HotSpot/native crash
        ↓
hs_err often produced
```

with:
```
container exceeds memory limit
        ↓
kernel/cgroup kills process
        ↓
SIGKILL
        ↓
JVM cannot run fatal-error handling
```

For example:
```
Kubernetes:
OOMKilled

hs_err:
none
```

is entirely plausible.

The JVM was killed externally.

Likewise:
```
kill -9 <pid>
```

gives HotSpot no opportunity to write normal shutdown diagnostics.

So one of the first questions should be:
```
Did the JVM fail internally,
or did something outside the JVM kill it?
```

---

## Production workflow

For a suddenly terminated JVM:
```
Process disappeared
       ↓
Was it externally killed?
       │
   ┌───┴────┐
  yes       no / crash evidence
   │              │
cgroup/OS      hs_err
OOM killer        ↓
or operator    signal
               ↓
          problematic frame
               ↓
       C / V / J classification
               ↓
          crashing thread
               ↓
          native + Java stack
               ↓
       exact JDK/library versions
               ↓
       core dump if necessary
```

Do not begin with a heap dump unless evidence actually indicates a heap problem.

## Mental model checkpoint

We have now followed JVM execution all the way down:
```
Java source
    ↓
bytecode
    ↓
interpreter / JIT
    ↓
nmethod in Code Cache
    ↓
machine instructions
    ↓
CPU registers + native stack
    ↓
OS
```

And JNI adds another route:
```
Java
 ↓
JNI transition
 ↓
native library
 ↓
machine code
 ↓
OS
```

This explains why the JVM normally feels like a highly controlled managed environment while still ultimately being an ordinary native process capable of segmentation faults, memory corruption, and external termination.

> **When a JVM disappears, first classify the failure domain: managed Java failure, HotSpot/native crash, or external process termination. The correct diagnostic path follows from that classification.**

**Next byte:** **JVM diagnostics as a system — `jcmd`, JFR, thread dumps, heap histograms/dumps, NMT, GC logs and OS metrics: which layer each tool observes, their blind spots, and how to choose the smallest diagnostic tool that can answer the production question.**
