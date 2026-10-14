---
title: JNI — crossing the Java/native boundary
summary: Learn how JNI references preserve GC safety, where native memory and execution leave Java's usual lifetime guarantees, and how to investigate retention, RSS growth, GC symptoms, and native crashes.
course: jvm
lessonSlug: jni-native-boundary
module: Native Memory
order: 360
sourceByte: byte-036
draft: true
prerequisites: [direct-mapped-memory]
jdk: JDK 25 · JNI and HotSpot diagnostics
---

A Java process can call code written in C or C++, reach an operating-system API, use a device library, or reuse a specialized native library. The standardized bridge is the **Java Native Interface (JNI)**. It lets native code call into the JVM and lets Java code enter native implementations, all inside the same process.

The hard question is not just how to make the call. It is: **how can native code safely interact with Java objects whose lifetime and location are controlled by a moving garbage collector?**

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable Java native boundary diagram"><a href="/images/courses/jvm/jni-boundary.svg" aria-label="Open Java native boundary diagram"><img src="/images/courses/jvm/jni-boundary.svg" alt="Managed Java execution crosses the JNI boundary to native code, which can call operating-system APIs, existing libraries, devices, and specialized native libraries." width="900" height="450" /></a><figcaption>JNI is a managed-runtime boundary inside one process.</figcaption></figure>

A Java declaration can mark a method as native and load a library that supplies its implementation:

```java
public native int compress(byte[] data);

static {
    System.loadLibrary("compressor");
}
```

Execution crosses from Java into the native function and eventually returns to Java. That transition brings rules about object references, thread context, array access, and native resource ownership.

## A JNI reference is not a raw Java address

An evacuating collector can move a Java object while preserving the program's logical reference to it. If native code kept an ordinary raw address to the old location, that address could become stale after relocation. JNI types such as `jobject`, `jclass`, `jstring`, and `jarray` are **opaque JNI-managed references**, not promises of stable object addresses.

<mark>A JNI reference such as `jobject` is not a permanent raw pointer to a Java object.</mark> Thinking of the reference as a managed handle is useful: the VM mediates access and preserves the reference's meaning across collection. The handle idea is conceptual; a particular HotSpot internal representation is not the JNI contract.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable JNI managed reference diagram"><a href="/images/courses/jvm/jni-managed-reference.svg" aria-label="Open JNI managed reference diagram"><img src="/images/courses/jvm/jni-managed-reference.svg" alt="Native code holds an opaque JNI reference; the VM mediates the reference to a Java object and can update its managed location when a moving collector relocates it." width="900" height="450" /></a><figcaption>The reference keeps its JNI meaning even if a collector changes the object's location.</figcaption></figure>

The rule matters because a moving collector must be able to find and update managed references it owns. Native code should use JNI operations on the opaque reference, not infer that its bits are a stable address it may save and dereference later.

## Local and global references participate in reachability

JNI references reconnect directly to the GC-root model from earlier lessons. A local reference is normally valid for the current native call and is automatically released when that native method returns. It is associated with the creating thread and cannot be handed to another thread as a generally usable reference. In a long loop, repeated JNI operations can create many local references before the call returns; `DeleteLocalRef(...)` or local frames can bound their lifetime.

A global reference is made with `NewGlobalRef(...)` and stays valid across native calls until native code invokes `DeleteGlobalRef(...)`. A strong global reference is a GC root: while it exists, the referenced Java object remains reachable. A weak global reference has different GC/lifetime semantics and does not keep its referent strongly alive.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable local and global JNI references"><a href="/images/courses/jvm/jni-local-global-references.svg" aria-label="Open local and global JNI references diagram"><img src="/images/courses/jvm/jni-local-global-references.svg" alt="A local JNI reference belongs to its creating thread and normally lasts for one native call; a strong global JNI reference crosses calls and remains a GC root until deleted." width="900" height="450" /></a><figcaption>Reference scope determines how long JNI contributes a path to an object.</figcaption></figure>

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable JNI global reference leak"><a href="/images/courses/jvm/jni-global-ref-leak.svg" aria-label="Open JNI global reference leak diagram"><img src="/images/courses/jvm/jni-global-ref-leak.svg" alt="A leaked strong JNI global reference remains a GC root and retains its Java object graph even when application-level owners have disappeared." width="900" height="450" /></a><figcaption>A forgotten global reference can retain much more than its direct referent.</figcaption></figure>

<mark>A leaked strong JNI global reference is a managed-heap retention root.</mark> The heap can grow even when Java code appears to have dropped its objects, because a native library still owns a global reference. Delete it when the native owner is finished.

## Array access can copy or expose storage

For a primitive array, APIs such as `GetByteArrayElements(...)` provide native-accessible elements. Depending on the VM and circumstances, the returned elements may refer to a copy or provide access to the original storage. Do not assume that this API always copies or always pins. The optional `isCopy` result can indicate whether this particular call returned a copy; it does not establish a universal behavior.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable JNI array access alternatives"><a href="/images/courses/jvm/jni-array-copy-vs-direct.svg" aria-label="Open JNI array copy versus direct access diagram"><img src="/images/courses/jvm/jni-array-copy-vs-direct.svg" alt="GetByteArrayElements may provide a temporary copy or direct access to array storage depending on the VM; ReleaseByteArrayElements completes the access protocol." width="900" height="450" /></a><figcaption>Use the acquire/release protocol; the VM chooses the access strategy.</figcaption></figure>

The critical variant has stricter rules. `GetPrimitiveArrayCritical(...)` and `ReleasePrimitiveArrayCritical(...)` form a constrained access protocol. The VM may expose original storage or a copy, depending on its collector and implementation. **Critical does not prove that the original array was pinned.** The durable point is that holding this access constrains GC and object-movement behavior and requires VM coordination.

<aside class="lesson-callout" data-kind="important" aria-label="Important"><p class="callout-label">Important</p><p>Keep a critical region short. Do not block, sleep, wait on locks, do long computation, or make arbitrary JNI calls while holding it. Release the access promptly with <code>ReleasePrimitiveArrayCritical(...)</code>.</p></aside>

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable JNI critical access and GC coordination"><a href="/images/courses/jvm/jni-critical-gc-coordination.svg" aria-label="Open JNI critical access and GC coordination diagram"><img src="/images/courses/jvm/jni-critical-gc-coordination.svg" alt="Critical primitive array access creates a short constrained interval; native work releases it promptly so the VM can resume normal GC and object-movement coordination." width="900" height="450" /></a><figcaption>Critical access is coordination with the VM, not a general-purpose long-lived pointer.</figcaption></figure>

HotSpot collectors can respond to critical native access in collector-specific ways. For example, G1 has implementation paths involving pinned regions and may report pinned-related evacuation failures. These are HotSpot behaviors, not guarantees that every JNI critical access pins the original object or that every collector handles it identically. If long critical sections correlate with GC or pinning symptoms, shorten or restructure the native section before blindly tuning the collector.

## Native allocations and three different failure modes

JNI code and native libraries may allocate with `malloc(...)` and release with `free(...)`. Those bytes are outside the Java heap and outside GC ownership. If native code forgets to free them, the Java garbage collector cannot repair that native-memory leak.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable JNI leak and crash types"><a href="/images/courses/jvm/jni-leak-types.svg" aria-label="Open JNI leak and crash types diagram"><img src="/images/courses/jvm/jni-leak-types.svg" alt="Three distinct JNI problems: a leaked global reference retains Java objects on heap; leaked malloc allocations grow native memory and RSS; an invalid pointer or buffer overrun can crash the process." width="900" height="450" /></a><figcaption>Retention, native-memory growth, and memory corruption leave different evidence.</figcaption></figure>

| Native boundary problem | What grows or fails | First useful direction |
| --- | --- | --- |
| Leaked strong global JNI reference | Java objects remain reachable; managed heap retention | Heap dump and GC-root path analysis |
| Leaked `malloc` allocation | Native memory and often process RSS grow | OS/native allocation tooling and library investigation |
| Invalid pointer, use-after-free, or buffer overrun | Process may fault or corrupt state | `hs_err_pid*.log`, `-Xcheck:jni`, and native debugger |

The third case is qualitatively different from a Java exception. Java managed failures such as `OutOfMemoryError` follow Java exception handling. A bad native pointer can instead trigger an OS-level fault such as `SIGSEGV` or an access violation. JNI code executes inside the JVM process, so a fault in native code can bring down the whole JVM.

<aside class="lesson-callout" data-kind="production" aria-label="Production note"><p class="callout-label">Production note</p><p>For a fatal native crash, start with the generated <code>hs_err_pid*.log</code>. Review the problematic frame, thread state, registers, native library, VM arguments, heap summary, and loaded libraries as first-pass evidence. The report helps classify whether the location appears Java, JVM, or native; confirm with symbols and a native debugger when needed.</p></aside>

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable JNI crash diagnostics"><a href="/images/courses/jvm/jni-crash-diagnostics.svg" aria-label="Open JNI crash diagnostics diagram"><img src="/images/courses/jvm/jni-crash-diagnostics.svg" alt="A JVM fatal error report provides the problematic frame, thread and register state, native library, VM arguments, heap summary, and loaded libraries for initial native crash triage." width="900" height="450" /></a><figcaption>The fatal-error report is the first map of a process-level failure.</figcaption></figure>

## Threads bring their own JNI context

A `JNIEnv*` belongs to the current thread's JNI context. It is not a single process-global object that native code can share indiscriminately across arbitrary threads. A native-created thread that needs JNI interaction must attach to the VM to get its thread context and detach when finished; the mechanics are less important here than respecting the thread association.

HotSpot's `-Xcheck:jni` option is a valuable diagnostic mode. It checks many JNI invariants, including invalid references or types, use of a `JNIEnv` from the wrong thread, and misuse around critical regions. It can turn some hard-to-localize corruption into an earlier failure that points closer to the contract violation.

<aside class="lesson-callout" data-kind="important" aria-label="Important"><p class="callout-label">Important</p><p>Run <code>-Xcheck:jni</code> to diagnose JNI contract violations. Its checking adds overhead, so it is usually an investigation setting rather than a default production flag.</p></aside>

## Follow the evidence in production

**Case 1: stable heap, stable NMT, rising RSS after a native library was added.** Heap tools do not show growing Java ownership, and Native Memory Tracking does not explain the process growth. Suspect allocations in the third-party/JNI library or another external process mapping. NMT tracks HotSpot/JVM-managed native memory; it does not account for arbitrary allocations made by every JNI library. Use OS process/mapping views and the library's allocator instrumentation or native profiling tools.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable JNI and NMT accounting boundary"><a href="/images/courses/jvm/jni-nmt-boundary.svg" aria-label="Open JNI and NMT accounting boundary diagram"><img src="/images/courses/jvm/jni-nmt-boundary.svg" alt="NMT reports HotSpot-managed native categories, while an arbitrary third-party JNI library may allocate outside NMT; compare the NMT total with RSS and investigate unexplained growth using OS and native tooling." width="900" height="450" /></a><figcaption>NMT is a JVM accounting view, not a complete process-memory census.</figcaption></figure>

<mark>NMT cannot prove that a third-party or JNI native-memory leak is absent.</mark> An unexplained RSS delta beyond NMT is a strong clue to look outside HotSpot's tracked categories, though OS mappings and accounting differences still need investigation.

**Case 2: the heap grows and a heap dump shows objects rooted through JNI Global.** The native component has kept strong global references alive. Follow the GC-root paths from the retained objects, identify the native owner, and make sure it releases each global reference at the right lifecycle point.

**Case 3: GC pauses or evacuation symptoms appear after introducing a critical array path.** Check whether native code holds `GetPrimitiveArrayCritical(...)` across blocking work or a long operation. Keep the critical interval short, release it, and restructure the native work if needed. Do not start by changing G1 tuning based only on a pinning symptom.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable JNI diagnostic flow"><a href="/images/courses/jvm/jni-diagnostic-flow.svg" aria-label="Open JNI diagnostic flow"><img src="/images/courses/jvm/jni-diagnostic-flow.svg" alt="Heap growth leads to heap tools and root analysis; RSS growth asks whether NMT explains it and otherwise points to external native memory; crashes lead to hs_err, Xcheck:jni, and a native debugger; JNI Global retention uses heap dump root analysis." width="900" height="450" /></a><figcaption>Start from the symptom and choose the accounting or crash evidence that can see it.</figcaption></figure>

Use this compact decision tree:

- **Heap growth** → heap histogram/dump and retaining paths.
- **RSS growth** → ask whether NMT explains it; if not, investigate external/native/JNI memory with OS and native tools.
- **Crash** → inspect `hs_err_pid*.log`, retry with `-Xcheck:jni` when appropriate, and use a native debugger.
- **JNI Global retention** → heap dump and GC-root analysis.

## Check your reasoning

Is `jobject` a permanent raw pointer? **No**: it is an opaque JNI reference. Does a leaked strong global reference keep an object alive? **Yes**: it acts as a GC root. Does calling `GetPrimitiveArrayCritical(...)` prove that the JVM pinned the original array? **No**: a VM may provide original storage or a copy; critical access means a constrained protocol with GC/object-movement coordination.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable complete JVM and JNI memory model"><a href="/images/courses/jvm/jni-complete.svg" aria-label="Open complete JVM and JNI memory model"><img src="/images/courses/jvm/jni-complete.svg" alt="The JVM process model connects Java heap objects and JNI GC roots, HotSpot-managed native memory, external malloc allocations, critical array coordination, and native execution that can leak memory or crash the process." width="900" height="450" /></a><figcaption>JNI connects managed reachability to a process that also contains unmanaged storage and execution.</figcaption></figure>

The full model now includes the Java heap; HotSpot-managed native areas such as stacks, Metaspace, Code Cache, and GC structures; external native allocations from JNI libraries; and memory-mapped regions managed with OS participation. JNI references let the GC preserve managed reachability across the boundary. Critical array access coordinates native access with collection. `malloc` and `free` belong to the native allocator, while invalid pointers can escape Java's exception model and fault the process.

The central rule is: **JNI protocols preserve GC safety at the managed/native boundary, but raw pointers, native allocations, and native execution lose Java's usual memory-safety and lifetime guarantees.** Next, Lesson 37 goes deeper on [Native Memory Tracking](/courses/jvm/native-memory-tracking): reserved versus committed, summary versus detail, baseline/diff analysis, category ownership, NMT scope, and a practical workflow for “heap looks fine, process is huge.”

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Daily JVM Byte #36 and its reviewed draft inform this local lesson. JNI reference, local/global reference, array access, and critical-access descriptions follow the JNI specification; G1 pinning behavior and <code>-Xcheck:jni</code> diagnostics are HotSpot implementation details. Diagrams are explanatory and do not report measured JVM behavior.</p><ul><li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/jni/index.html">JDK 25 JNI specification</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/jni/functions.html">JNI functions</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html">JDK 25 java launcher options</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/vm/java-virtual-machine-guide.pdf">JDK 25 Java Virtual Machine Guide: fatal error logs and NMT</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/gc/g1/g1CollectedHeap.cpp">OpenJDK JDK 25 G1 implementation</a></li></ul></details>
