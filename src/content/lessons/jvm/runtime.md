---
title: What the JVM actually is
summary: Meet the runtime behind your Java program, and get to know the parts that keep it running.
course: jvm
lessonSlug: runtime
module: Foundations
order: 10
sourceByte: byte-001
draft: false
prerequisites: []
jdk: HotSpot · introductory overview
---

You've written some Java code. You start the application, and it begins doing its job. Somewhere between those two things, the JVM enters the picture.

What does it actually do?

**The Java Virtual Machine, or JVM, is the software that runs your compiled Java program and manages the resources it needs along the way.** It gives your code somewhere to execute, provides memory for its data, and takes care of jobs such as reclaiming memory that is no longer needed.

That's the picture we'll build in this lesson. By the end, you should be able to sketch the JVM's main parts and explain what each one contributes. You don't need to know how a garbage collector or a JIT compiler works yet. We're going to meet them first.

## From your code to a running program

Let's start with something familiar: a Java source file. In the usual compile-and-run workflow, two different tools do two different jobs.

First, `javac`, the Java compiler, turns your `.java` file into a `.class` file. That class file contains **bytecode**: instructions intended for a JVM, along with information describing the class. Bytecode is an intermediate form of your program. It isn't the Java source you wrote, and it isn't native machine code for your particular CPU.

Then you start the program with a command such as `java MyApplication`. The Java launcher starts a JVM, which loads the program and begins running it. Follow that handoff in the picture below.

<figure>
<a href="/images/courses/jvm/execution-path.svg" aria-label="Open the source-to-runtime diagram at full size"><img src="/images/courses/jvm/execution-path.svg" alt="You write Java source. javac turns it into a class file containing bytecode. The JVM runs the compiled program using the operating system and CPU." width="480" height="520" /></a>
<figcaption>The compiler prepares the program; the JVM runs it. <a href="/images/courses/jvm/execution-path.svg">Open full-size diagram</a>.</figcaption>
</figure>

The word *virtual* can make this sound more mysterious than it is. Think of the JVM as a machine implemented in software. It understands its own instruction set, bytecode, and makes those instructions run on the actual computer underneath. It doesn't replace the operating system: it uses the OS for resources such as memory and CPU time.

This separation is also part of Java's portability story. The same class files can run on compatible JVMs on different platforms. The JVM implementation handles the platform-specific work, although your application still needs compatible libraries and must account for any platform-specific dependencies it uses.

Throughout this course, we'll usually look at **HotSpot**, the JVM implementation used by many OpenJDK distributions. “JVM” names the kind of runtime; “HotSpot” names a particular implementation. Details such as its JIT compiler and memory organization belong to that implementation.

## A tour of the JVM

Running a program involves more than carrying out its instructions. Classes need to be brought in, data needs somewhere to live, and work needs to be managed while the application runs.

We can organize those jobs into four parts. Read the map once to get your bearings, then we'll walk through each part together. The numbers are stops on our tour, not a fixed sequence that happens only at startup.

<figure>
<a href="/images/courses/jvm/runtime-map.svg" aria-label="Open the JVM component map at full size"><img src="/images/courses/jvm/runtime-map.svg" alt="Inside HotSpot: class loading brings classes in; execution runs the instructions; runtime memory holds objects, stacks, metadata and compiled code; runtime services manage garbage collection, threads, synchronization and safepoints. These responsibilities work together throughout execution." width="480" height="820" /></a>
<figcaption>One running system, with different responsibilities. Classes can keep loading and code can keep changing as the application runs. <a href="/images/courses/jvm/runtime-map.svg">Open full-size diagram</a>.</figcaption>
</figure>

### 1. Class loading brings the pieces in

Your application uses classes: the ones you wrote, the ones from libraries, and the ones supplied by Java. Before it can use a class, the JVM needs to find its compiled form and make it available inside the running program.

That's where class loading comes in. Related steps check the class and prepare it for use. The JVM also keeps information about it, such as the methods and fields it contains. You can think of this as bringing the program's building blocks into the runtime. It can happen as more classes are needed, rather than all at once before your code starts.

### 2. Execution makes the code do something

Once a method is ready to run, its instructions need to become actual work on the CPU. HotSpot has two important tools for this: an **interpreter**, which carries out bytecode instructions, and a **just-in-time compiler**, usually called the JIT, which can turn frequently executed code into native machine code.

Here's the interesting part: HotSpot can observe the program while it runs and use those observations to guide optimization. A method may be interpreted earlier and use compiled code later. The program's behavior must stay correct, but the way HotSpot carries out the work can change.

For now, keep that one idea in mind: **execution can change while the application runs**. We'll explore the decisions behind that change when we reach JIT compilation.

### 3. Runtime memory gives everything a place to live

It's easy to hear “Java memory” and think only of the heap. But an application needs space for more than its objects.

Suppose your code creates a `Customer`. The object belongs to the Java heap in the JVM's memory model. The running method also needs space to keep track of its work. HotSpot needs information describing the `Customer` class, and it needs somewhere to keep any machine code the JIT produces.

These names describe the main places you'll encounter:

- **Java heap:** space for objects and arrays.
- **Thread stacks:** frames that keep track of method calls and their working data.
- **Metaspace:** native memory used for much of HotSpot's class metadata.
- **Code cache:** space for generated machine code, including JIT-compiled code.
- **Other native memory:** space for the JVM's own work, including compiler and garbage collector data structures.

You don't need to memorize all of these today. Notice why they exist: storing an object, tracking a method call, and keeping compiled code are different jobs. Also, “native memory” is a broader category: Metaspace, for example, is itself native memory, not part of the Java heap.

### 4. Runtime services keep the work moving

While your code runs, the JVM also manages the environment around it.

**Garbage collection** reclaims heap space occupied by objects that are no longer needed. **Thread management** supports the threads doing the work. **Synchronization**, used by mechanisms such as `synchronized`, helps coordinate access to shared data.

You'll also meet **safepoints**. These let HotSpot coordinate certain runtime operations at points where the relevant thread state can be examined safely. We can leave their mechanics for later. Their place on this map is alongside the work needed to manage a running program.

This is what *managed runtime* means here. You write the application's logic, and the JVM handles many of the tasks needed to execute and manage it. Those services still consume CPU time and memory, so they're part of the application's performance picture too.

## Put the pieces together

Let's return to a small method:

```java
int calculate(int x) {
    return x * 2;
}
```

In your source, it's a multiplication and a return. Around that small piece of logic, several things are happening.

The compiler turns the method into bytecode. When the application uses the class containing it, the JVM brings that class into the runtime. Executing the method involves a thread and a method frame to hold its working state. HotSpot may interpret the method, and if it becomes worth optimizing, the JIT may compile it. Generated machine code then needs space in the code cache.

Meanwhile, runtime services continue doing their jobs for the application as a whole. A call to this method doesn't automatically trigger garbage collection or a safepoint. The parts cooperate when needed; they aren't a chain of steps that every method must pass through.

That's why describing the JVM as a bytecode interpreter leaves so much out. Interpretation is one way it executes code. The JVM also supplies the memory and services around that execution.

## Use the map before reaching for a setting

Here's a useful consequence of this bigger picture. Suppose you set a maximum Java heap of 512 MB, but your application's process uses more memory than that. Has the JVM ignored your setting?

<details class="lesson-check">
<summary>Pause here, then check your reasoning</summary>
<p>No. The heap is only one part of process memory. Thread stacks, Metaspace, the code cache, and other native allocations also need space. The <code>-Xmx</code> option limits the Java heap; it doesn't cap the whole process.</p>
</details>

The same habit helps with other performance questions. High CPU usage could involve application code, compilation, or garbage collection. A slow request might be waiting for a lock. The symptom gives you a starting point, but you still need evidence to identify the cause.

When you meet a new JVM topic, place it on this map: **how code executes, where data lives, or how the runtime manages the work**. Those three questions connect the parts we've just met. The next [memory lesson](/courses/jvm/memory), currently a preview, will zoom into where the memory goes.

<details class="lesson-sources">
<summary>Sources and further reading</summary>
<ul>
<li><a href="https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-2.html">JVM specification: the abstract machine, class files, and runtime data areas</a></li>
<li><a href="https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-5.html">JVM specification: loading, linking, and initialization</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/vm/java-hotspot-virtual-machine-performance-enhancements.html">HotSpot: tiered compilation and the code cache</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/other-considerations.html">HotSpot: class metadata and native memory</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html">Java launcher and heap size options</a></li>
<li><a href="https://cr.openjdk.org/~redestad/slides/openjdk-scalability.pdf">OpenJDK: runtime coordination and thread-local handshakes</a></li>
</ul>
</details>
