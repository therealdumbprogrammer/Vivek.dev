---
title: JVM crash anatomy — what actually killed the process?
summary: Classify a vanished JVM as a managed exit, fatal HotSpot or native error, or external kill, then use crash reports, stacks, and OS evidence to investigate its cause.
course: jvm
lessonSlug: jvm-crash-anatomy
module: Native Memory
order: 380
sourceByte: byte-038
draft: true
prerequisites: [native-memory-tracking]
jdk: JDK 25 · HotSpot fatal-error diagnostics
---

A Java service disappears from production. Its last application log line offers no explanation. Before inspecting a stack trace or changing a heap setting, establish **what terminated the process**. A Java exception, a native fault, and an external `SIGKILL` leave different evidence and require different tools.

[Lesson 37](/courses/jvm/native-memory-tracking) followed memory growth across heap, HotSpot, process, and container measurements. A disappearing JVM crosses a related boundary: Java code executes in a native process that the operating system and container runtime can also terminate.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable JVM termination domains"><a href="/images/courses/jvm/jvm-termination-domains.svg" aria-label="Open JVM termination domains"><img src="/images/courses/jvm/jvm-termination-domains.svg" alt="A process may end through managed Java exit or exception, a fatal HotSpot or native fault, or an external OS, container, or operator kill; each has different first evidence." width="900" height="450" /></a><figcaption>Classify the termination domain before choosing a diagnostic artifact.</figcaption></figure>

## Three ways a Java process can end

An uncaught exception can end the last non-daemon application thread; a deliberate `System.exit(...)` or ordinary completion can end the VM normally. An `OutOfMemoryError` is a Java `Error`, not intrinsically a fatal native crash. Its effect depends on where it occurs, whether it is handled, and whether the application or VM has been configured to exit or crash on it.

A fatal HotSpot or native error is different. HotSpot itself, JIT-generated machine code, a JNI library, or an OS library can fault while executing machine instructions. A signal such as `SIGSEGV` may invoke HotSpot's fatal-error handler, which usually attempts to write `hs_err_pid<pid>.log` before termination. Finally, the OS, container runtime, or an operator can kill the process externally. `SIGKILL` cannot be caught, so HotSpot cannot use its fatal-error handler to write a report for that signal.

<mark>A vanished JVM is a symptom; the termination mechanism determines which evidence to trust.</mark> Check application logs, process exit status, supervisor/container records, and any fatal-error artifact together. The absence of an `hs_err` file alone proves neither a clean exit nor an external kill: the report may have been written elsewhere, storage may have been unwritable, or fatal reporting may have failed.

## Begin with the fatal-error header

When a fatal report exists, its header often gives the signal or exception and the **problematic frame**, the instruction location where the VM detected the failure. A simplified, illustrative header is:

```text
A fatal error has been detected by the Java Runtime Environment:
SIGSEGV (0xb) at pc=0x..., pid=..., tid=...
Problematic frame:
C  [libcompress.so+0x1234]  compress_block+0x34
```

The signal says what fault was reported; the frame names the immediate location. For a repeatable deployment, consider setting a writable, persistent report path at startup:

```text
-XX:ErrorFile=/var/log/java/hs_err_pid%p.log
```

`%p` expands to the process ID. In a container, the directory must exist and allow writes, and the report must be preserved beyond container replacement if you intend to inspect it after a restart. The default path and fallback behavior depend on the VM and environment.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable fatal error header anatomy"><a href="/images/courses/jvm/fatal-error-header-anatomy.svg" aria-label="Open fatal error header anatomy"><img src="/images/courses/jvm/fatal-error-header-anatomy.svg" alt="An example hs_err header identifies the fatal signal, program counter, process and thread IDs, and problematic frame, each serving as initial classification evidence." width="900" height="450" /></a><figcaption>The header locates the fault and identifies the report; it is the beginning of the investigation.</figcaption></figure>

HotSpot frame markers help classify the code at that location:

| Marker | Immediate code location | First investigation |
| --- | --- | --- |
| `J` | Compiled Java method | JIT code, involved method, VM build, corruption or unsafe/native interaction |
| `j` | Interpreted Java method | Interpreter context and involved Java path |
| `V` | HotSpot VM code | VM function, build, previous corruption, JNI interaction |
| `v` | VM-generated stub | Stub purpose, transition context, VM build |
| `C` | C/C++ native code | Library, symbols, native stack, library version |

`C [libcompress.so+...]` makes the native compression library a strong lead. `J` points to the instruction in compiled Java code, which may deserve JIT investigation. Neither proves that the source defect originated in that component. A third-party library can overwrite memory and a later access in `libjvm` can fault; compiled code can encounter memory corrupted elsewhere.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable HotSpot frame markers"><a href="/images/courses/jvm/hotspot-frame-markers.svg" aria-label="Open HotSpot frame markers"><img src="/images/courses/jvm/hotspot-frame-markers.svg" alt="HotSpot report markers J, j, V, v, and C classify compiled Java, interpreted Java, VM code, VM stubs, and C or C++ native frames." width="900" height="450" /></a><figcaption>Frame markers classify the faulting code, then the stack and environment test the hypothesis.</figcaption></figure>

<aside class="lesson-callout" data-kind="important" aria-label="Important"><p class="callout-label">Important</p><p>The problematic frame is the location where the fault appeared, not proof of where the original defect occurred. Earlier native memory corruption can surface later in VM or compiled code.</p></aside>

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable crash location and root cause"><a href="/images/courses/jvm/crash-location-vs-root-cause.svg" aria-label="Open crash location and root cause"><img src="/images/courses/jvm/crash-location-vs-root-cause.svg" alt="A JNI buffer overrun corrupts memory first; later HotSpot reads the damaged structure and faults in libjvm, separating the originating defect from the crash location." width="900" height="450" /></a><figcaption>Follow the chain that could have created the damaged state, not just the final instruction.</figcaption></figure>

## Put the crashing thread back into its execution path

Find the `Current thread` section. Its type matters: a `JavaThread` doing application work suggests a different route from a compiler thread or GC worker. Read the native frames and any Java frames together. An illustrative path might be `OrderService.process()` → `CompressionService.compress()` → JNI transition → `libcompress.so` → fault. A library merely appearing in the loaded-library list is weaker evidence than appearing on the crashing thread's stack.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable crashing thread and stack"><a href="/images/courses/jvm/crashing-thread-stack.svg" aria-label="Open crashing thread and stack"><img src="/images/courses/jvm/crashing-thread-stack.svg" alt="The current Java worker thread follows an application call through a JNI transition into a native compression library where the fault occurs." width="900" height="450" /></a><figcaption>The crashing thread joins the application operation to the faulting native frame.</figcaption></figure>

[Lesson 34](/courses/jvm/thread-stacks-stack-walking) distinguished physical machine frames from logical Java frames reconstructed by HotSpot. A fatal report may include both views, but a crash can leave state incomplete or damaged. Read reconstructed frames as valuable context, then corroborate them with native symbols, the program counter, and a core or crash dump if needed.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable native and Java stack views"><a href="/images/courses/jvm/native-vs-java-stack.svg" aria-label="Open native and Java stack views"><img src="/images/courses/jvm/native-vs-java-stack.svg" alt="A physical native stack contains machine frames and JNI transitions; HotSpot may reconstruct logical Java methods from metadata, so the two views complement one another." width="900" height="450" /></a><figcaption>Physical frames show machine execution; logical Java frames restore application context where possible.</figcaption></figure>

The register section moves the inquiry below Java source. On x86-64, `RIP` is an instruction pointer and `RSP` a stack pointer; on AArch64, reports use names such as `pc` and `sp`, with general registers `x0` onward. A zero pointer register combined with an instruction dereferencing an offset can suggest a native null dereference. That is an inference from machine state, not a conclusion from a register value alone. The exact architecture, disassembly, and symbols determine what the instruction did.

## Read the report's environment as evidence

The rest of `hs_err_pid*.log` can include thread details, stack traces, registers, heap and GC state, VM flags and command line, loaded native libraries, OS and CPU information, and the exact JDK build. Capture the full build string, native library versions, recent deployments, and whether the failure reproduces. A fault confined to one JDK build or one native library revision is a useful clue; a single differing version does not itself prove causation.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable fatal error report sections"><a href="/images/courses/jvm/fatal-error-report-sections.svg" aria-label="Open fatal error report sections"><img src="/images/courses/jvm/fatal-error-report-sections.svg" alt="A fatal report offers header and signal, current thread and stacks, registers, VM options, JDK build, loaded libraries, OS and CPU, heap and memory context." width="900" height="450" /></a><figcaption>Use the report as a bundle of independent clues, including versions and environment.</figcaption></figure>

For deeper machine-state inspection, a native core or crash dump can preserve process memory and register state for a debugger. The `hs_err` text is an immediately readable summary; a dump supports symbolized native stack inspection and memory examination. On Linux, `gdb` is a common tool for a core. On macOS, use `lldb` with the platform's crash/core artifacts. Dump availability depends on OS limits and configuration.

<aside class="lesson-callout" data-kind="production" aria-label="Production note"><p class="callout-label">Production note</p><p>A core or crash dump can be large and contain secrets from process memory. Store it with restricted access and the same care as other sensitive production data.</p></aside>

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable hs err and core dump comparison"><a href="/images/courses/jvm/hs-err-vs-core-dump.svg" aria-label="Open hs err and core dump comparison"><img src="/images/courses/jvm/hs-err-vs-core-dump.svg" alt="The HotSpot fatal log is a readable diagnostic summary; a core or crash dump preserves broader machine state for a native debugger but is larger and sensitive." width="900" height="450" /></a><figcaption>Escalate from the summary to a native dump when the question requires machine-state inspection.</figcaption></figure>

## Check for an external kill

An OS or container OOM kill usually gives HotSpot no chance to produce `hs_err`. In Kubernetes, inspect the terminated container's **last state**, reason, and exit code, then the prior instance's logs:

```bash
kubectl describe pod <name>
kubectl logs <name> --previous
```

If the pod has multiple containers, specify the relevant container with `-c <container>`. `OOMKilled` in the terminated state is stronger evidence of container memory enforcement than exit code `137` alone. Exit `137` commonly means termination by `SIGKILL`; it does not identify who sent it or prove OOM. Operator actions and other OS kills can also use `SIGKILL`. Correlate Kubernetes events, node/cgroup evidence, and the memory metrics from [Lesson 37](/courses/jvm/native-memory-tracking). Container memory may include charges beyond Java heap and process RSS.

<mark>Exit code 137 alone does not prove an OOM kill.</mark> Likewise, a Java `OutOfMemoryError` log line does not prove the kernel killed the container. These events may occur near each other, but their mechanisms and artifacts differ.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable JVM crash and OOM kill comparison"><a href="/images/courses/jvm/jvm-crash-vs-oomkill.svg" aria-label="Open JVM crash and OOM kill comparison"><img src="/images/courses/jvm/jvm-crash-vs-oomkill.svg" alt="A fatal HotSpot or native fault may create hs_err and carries a signal and problematic frame; a Kubernetes OOM kill sends SIGKILL, usually has OOMKilled last state, and gives the JVM no chance to write hs_err." width="900" height="450" /></a><figcaption>Crash and external kill can both look like disappearance from the application, yet leave different evidence.</figcaption></figure>

## A production triage path

Start with the supervisor or container's termination record and the final application logs. If they show a managed exception or deliberate exit, follow that path. If they show an external kill, inspect OS, cgroup, Kubernetes, or operator evidence. If there is a fatal report, read its signal and problematic frame, then the current thread, mixed native/Java stacks, registers, exact JDK build, loaded libraries, and VM options. Compare repeat incidents and recent changes. Use a native debugger and dump when the text report cannot explain the fault.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable JVM crash diagnostic flow"><a href="/images/courses/jvm/jvm-crash-diagnostic-flow.svg" aria-label="Open JVM crash diagnostic flow"><img src="/images/courses/jvm/jvm-crash-diagnostic-flow.svg" alt="A disappeared JVM branches into managed exit, external kill, or fatal report; fatal triage proceeds through signal, frame marker, current thread, mixed stack, environment and build, then native debugger if necessary." width="900" height="450" /></a><figcaption>Each step narrows the failure domain before the investigation gets more expensive.</figcaption></figure>

## Check your reasoning

A `C` frame in a third-party library makes that library an immediate lead, especially if it appears on the crashing thread's stack; it does not prove the library introduced the original corruption. A `J` frame identifies compiled Java code at the fault; investigate the method, JIT and VM build, and possible unsafe/native corruption before assigning blame. A `V` frame in `libjvm` can likewise be a later manifestation of damage elsewhere. If Kubernetes reports `OOMKilled` and there is no `hs_err`, investigate container memory enforcement rather than assuming a JVM fatal error. If only exit `137` is available, seek further evidence of the killer.

The full execution path now runs from Java source and bytecode through the interpreter or JIT, Code Cache machine instructions, native/JNI calls, CPU state, and OS control. <mark>The reliable first move is to classify the termination, then read the artifact produced by that domain.</mark> Continue with [Lesson 39, JVM diagnostics as a system](/courses/jvm/jvm-diagnostics-system), which brings `jcmd`, JFR, dumps, GC logs, NMT, and OS metrics together around the question each tool can answer.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Daily JVM Byte #38 and its reviewed scope are the primary editorial source. The report excerpts, process examples, and diagrams are illustrative; no crash workload was run. Fatal-error file format and frame markers describe HotSpot and can vary by JDK build, OS, architecture, and crash condition. Kubernetes evidence depends on the runtime and termination history.</p><ul><li><a href="https://docs.oracle.com/en/java/javase/25/troubleshoot/troubleshooting-guide.pdf">JDK 25 Troubleshooting Guide: fatal error logs, signals, and process dumps</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html">JDK 25 java launcher options</a></li><li><a href="https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/">Kubernetes debug running Pods</a></li><li><a href="https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/">Kubernetes container resources and OOM behavior</a></li></ul></details>
