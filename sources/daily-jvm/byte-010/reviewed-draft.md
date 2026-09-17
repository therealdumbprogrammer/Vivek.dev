# Retrieved reviewed draft

The conversation API truncated this draft at its per-message limit; the full user byte is preserved separately.

Lesson 10 is a good pivot from allocation/GC into **class lifecycle + execution preparation**. I’d keep the same illustration-first style and make a few refinements before implementation:

- **Loading, linking, and initialization are distinct lifecycle stages, but resolution can be lazy.** That should be visually obvious.
- For **preparation**, keep the `static int count = 42` example, but note the special case of certain compile-time constants so we don’t overstate “all statics are just zeroed first.”
- Keep the distinction between **HotSpot class metadata** and the Java-level `java.lang.Class` object very explicit.
- Make **class identity = binary name + defining loader** one of the headline ideas. It is too important to bury.
- Preserve the Metaspace/class-loader leak bridge because it connects directly back to Lesson 2.

## Draft — Lesson 10: Class loading lifecycle

```markdown
---
title: Class loading lifecycle — from .class bytes to a live JVM class
summary: Follow a class from bytecode bytes through loading, linking, and initialization, and see how HotSpot turns a class file into runtime metadata.
course: jvm
lessonSlug: class-loading-lifecycle
module: Foundations
order: 100
sourceByte: byte-010
draft: false
prerequisites:
  - escape-analysis-scalar-replacement
jdk: HotSpot · class loading foundations
---

So far, most of this course has started from an assumption:

```text
The class already exists inside the JVM.
```

We created objects.

We looked at object headers.

We followed references through the heap.

We watched GC reclaim them.

We even saw the JIT eliminate some allocations entirely.

But before any of that can happen, HotSpot first needs to turn:

```text
.class bytes
```

into something the running JVM can actually use.

The lifecycle is:

```text
.class bytes
     │
     ▼
  Loading
     │
     ▼
  Linking
   ├── Verification
   ├── Preparation
   └── Resolution
     │
     ▼
Initialization
     │
     ▼
Class ready for normal use
```

<figure>
<a href="/images/courses/jvm/class-lifecycle-overview.svg" aria-label="Open the class loading lifecycle diagram">
<img src="/images/courses/jvm/class-lifecycle-overview.svg"
     alt="A class file moves through loading, linking with verification preparation and resolution, then initialization before normal runtime use."
     width="820" height="520" />
</a>
<figcaption>A class goes through several distinct runtime stages before Java code can use it normally.</figcaption>
</figure>

The JVM specification defines this lifecycle, while HotSpot provides one concrete implementation of it.

## Loading: bring the class bytes into the runtime

Suppose the application needs:

```java
com.example.Customer
```

At some point, a class loader must provide the binary representation of that class.

Conceptually:

```text
Customer.class
      │
      ▼
 ClassLoader
      │
      ▼
class-file bytes
      │
      ▼
HotSpot runtime representation
```

At the Java API level, custom loaders often eventually reach mechanisms such as:

```java
ClassLoader.defineClass(...)
```

The important point is not the API call itself.

The important point is:

> Loading turns a class-file representation into a runtime type known to the JVM.

HotSpot creates internal runtime metadata representing the class.

Java code also gets a corresponding:

```java
java.lang.Class
```

object.

<figure>
<a href="/images/courses/jvm/loading-class-object.svg" aria-label="Open the class loading representation diagram">
<img src="/images/courses/jvm/loading-class-object.svg"
     alt="Class-file bytes are supplied by a class loader. HotSpot creates internal class metadata and exposes the runtime type to Java code through a java.lang.Class object."
     width="840" height="500" />
</a>
<figcaption>HotSpot's internal class representation and the Java-level Class object are related, but they are not the same thing.</figcaption>
</figure>

Conceptually:

```text
Customer.class
      │
      ▼
  ClassLoader
      │
      ▼
 ┌─────────────────────┐
 │ HotSpot class       │
 │ metadata            │
 └─────────────────────┘
          │
          └────────────► java.lang.Class
```

We will return to where that metadata lives shortly.

## Class identity includes the defining class loader

This is one of the most important rules in the class-loading model.

Suppose two independent class loaders both load bytes named:

```text
com.example.Customer
```

Are those automatically the same JVM type?

No.

Runtime class identity is determined by:

```text
binary name
+
defining class loader
```

Conceptually:

```text
Loader A
   │
   ▼
com.example.Customer
        │
        ▼
   Runtime type A


Loader B
   │
   ▼
com.example.Customer
        │
        ▼
   Runtime type B
```

<figure>
<a href="/images/courses/jvm/class-identity-loaders.svg" aria-label="Open class identity and class-loader diagram">
<img src="/images/courses/jvm/class-identity-loaders.svg"
     alt="Two different defining class loaders load classes with the same binary name and produce distinct runtime types."
     width="820" height="460" />
</a>
<figcaption>The same binary class name loaded by different defining loaders can represent different JVM types.</figcaption>
</figure>

So:

```text
Customer from Loader A
```

is not automatically assignment-compatible with:

```text
Customer from Loader B
```

even though both class files declare:

```text
com.example.Customer
```

This behavior is fundamental to:

```text
plugin isolation
application servers
module-like loading boundaries
hot reload systems
```

and also explains a particularly confusing failure:

```text
ClassCastException:
Customer cannot be cast to Customer
```

The names can look identical while the defining loaders differ.

## Loading is followed by linking

A loaded class is not simply accepted and used immediately.

The JVM next **links** it into the runtime.

Linking contains three conceptual stages:

```text
Verification
Preparation
Resolution
```

<figure>
<a href="/images/courses/jvm/linking-three-stages.svg" aria-label="Open the three stages of linking">
<img src="/images/courses/jvm/linking-three-stages.svg"
     alt="Linking consists of verification, preparation, and resolution. Resolution may occur lazily rather than being completed eagerly all at once."
     width="820" height="460" />
</a>
<figcaption>Linking prepares a loaded class for safe and meaningful use inside the runtime.</figcaption>
</figure>

The three stages solve different problems.

## Verification: can the JVM safely execute these bytes?

Remember that `.class` files are not necessarily produced by:

```text
javac
```

They may come from:

```text
other JVM languages
bytecode generators
instrumentation agents
proxies
hand-written bytecode
transformation tools
```

So the JVM cannot simply assume:

```text
These bytes must be valid
because a Java compiler made them.
```

Verification checks that the class-file representation satisfies the JVM's structural and execution constraints.

Examples include validating things such as:

```text
class-file structure
bytecode instruction validity
operand-stack usage
type consistency
control-flow constraints
legal field/method interactions
```

Conceptually:

```text
class-file bytes
      │
      ▼
 verifier
      │
      ├── valid ─────► continue
      │
      └── invalid ───► reject
```

Invalid bytecode can lead to errors such as:

```text
VerifyError
```

<figure>
<a href="/images/courses/jvm/bytecode-verification.svg" aria-label="Open the bytecode verification diagram">
<img src="/images/courses/jvm/bytecode-verification.svg"
     alt="Class-file bytecode passes through JVM verification checks for structure, types, stack consistency, and legal control flow before execution is allowed."
     width="820" height="480" />
</a>
<figcaption>The JVM verifies class files because bytecode can come from sources other than javac.</figcaption>
</figure>

The deeper reason is safety.

The JVM executes low-level stack-machine instructions.

It must know that those instructions obey the rules of the virtual machine before allowing normal execution.

## Preparation: create class state before Java initialization runs

Now consider:

```java
class Config {
    static int count = 42;
}
```

It is tempting to think that as soon as the class is loaded:

```text
count = 42
```

But the lifecycle separates two things:

```text
create static state
```

from:

```text
execute Java initialization logic
```

During **preparation**, the JVM creates storage associated with static fields and establishes their initial JVM state.

For an ordinary field like:

```java
static int count = 42;
```

the simplified model is:

```text
PREPARATION

count = 0
```

Later:

```text
INITIALIZATION

count = 42
```

<figure>
<a href="/images/courses/jvm/preparation-vs-initialization.svg" aria-label="Open preparation versus initialization">
<img src="/images/courses/jvm/preparation-vs-initialization.svg"
     alt="A static int field receives its default zero value during preparation, then receives the source-level value 42 when class initialization executes."
     width="820" height="470" />
</a>
<figcaption>Preparation creates JVM state; initialization later runs the class's Java-level initialization logic.</figcaption>
</figure>

This distinction is fundamental:

```text
Preparation
│
├── static storage exists
└── JVM initial/default values established


Initialization
│
└── class initialization code executes
```

### A small constant-value nuance

There is one specification detail worth knowing without derailing the model.

Certain `static final` fields whose values are represented as class-file constant values can receive those values as part of preparation.

For example, a compile-time constant such as:

```java
static final int SIZE = 42;
```

is not always best understood through the simple:

```text
0 first
then 42 in <clinit>
```

story.

So use this working rule:

> Ordinary static initialization logic runs during initialization, while some compile-time constant values can be established earlier by the JVM.

For understanding normal class lifecycle, the important separation remains:

```text
Preparation ≠ execution of arbitrary Java static initialization code
```

## Resolution: turn symbolic references into runtime relationships

A class file is full of symbolic references.

Suppose `OrderService` invokes:

```java
customer.process();
```

The `.class` file does not simply contain something like:

```text
jump to machine address 0x1234ABCD
```

Instead, class files contain symbolic descriptions through the constant pool.

Conceptually:

```text
com/example/Customer
process
()V
```

or:

```text
Order.total:I
```

These symbolic references need to become meaningful runtime relationships.

That process is **resolution**.

```text
symbolic class reference
        │
        ▼
runtime class


symbolic method reference
        │
        ▼
runtime method


symbolic field reference
        │
        ▼
runtime field
```

<figure>
<a href="/images/courses/jvm/symbolic-resolution.svg" aria-label="Open symbolic reference resolution">
<img src="/images/courses/jvm/symbolic-resolution.svg"
     alt="Symbolic class, method, and field references from a class-file constant pool are resolved to runtime classes, methods, and fields."
     width="840" height="500" />
</a>
<figcaption>Class files describe relationships symbolically; the runtime connects those symbols to actual runtime entities.</figcaption>
</figure>

This is one of the reasons Java supports dynamic class loading so naturally.

The class file does not need every runtime address wired in at compile time.

## Resolution does not have to happen all at once

The lifecycle diagram can accidentally suggest:

```text
load
then resolve absolutely everything
then initialize
```

That is too eager a mental model.

The JVM specification allows resolution to occur with flexibility.

Conceptually:

```text
class loaded
     │
     ▼
some symbolic references unresolved
     │
     ▼
code later needs one
     │
     ▼
resolve it when required
```

So:

```text
Loaded class
```

does not necessarily imply:

```text
Every symbolic reference in that class
has already been fully resolved.
```

<figure>
<a href="/images/courses/jvm/lazy-resolution.svg" aria-label="Open lazy resolution diagram">
<img src="/images/courses/jvm/lazy-resolution.svg"
     alt="A loaded class initially contains several symbolic references. Individual references are resolved later when runtime execution requires them."
     width="820" height="470" />
</a>
<figcaption>Resolution can be deferred, helping preserve the JVM's dynamic linking model.</figcaption>
</figure>

This flexibility lets the runtime avoid doing work for relationships that may never actually be used.

## Initialization: now Java static initialization executes

After the relevant lifecycle requirements are satisfied, the class can be **initialized**.

Consider:

```java
class Config {

    static int count = 42;

    static {
        System.out.println("initializing");
    }
}
```

At initialization time, the Java-level static initialization logic runs.

Conceptually:

```text
count = 42

print "initializing"
```

The class-file representation uses the special initialization method:

```text
<clinit>
```

Conceptually:

```text
<clinit>
│
├── perform static field initialization
└── execute static initializer blocks
```

<figure>
<a href="/images/courses/jvm/clinit.svg" aria-label="Open the class initialization diagram">
<img src="/images/courses/jvm/clinit.svg"
     alt="Static field initializers and static initializer blocks contribute to the class initialization method, commonly represented as clinit."
     width="820" height="480" />
</a>
<figcaption>Initialization is the stage where the class's Java-level static initialization behavior actually executes.</figcaption>
</figure>

This gives us an extremely important distinction:

```text
LOADED
≠
INITIALIZED
```

A runtime class can already exist inside HotSpot before its Java-level static initialization has executed.

## First use can trigger initialization

Suppose the JVM has loaded:

```text
Config
```

but no code has yet actively used it in a way that requires initialization.

The class may sit in the runtime:

```text
loaded
linked
not yet initialized
```

Later:

```java
System.out.println(Config.count);
```

may cause initialization to occur before that active use proceeds.

Conceptually:

```text
first relevant use
      │
      ▼
Is class initialized?
    /         \
  YES         NO
  │            │
  ▼            ▼
continue     initialize
               │
               ▼
            continue
```

This is why initialization is often described as **lazy**.

## Why not initialize everything at startup?

Imagine a large application contains:

```text
20,000 classes
```

But one particular request path only needs:

```text
3,000
```

If startup eagerly initialized everything:

```text
load everything
initialize everything
execute every static initializer
allocate everything required by them
```

the JVM could perform a huge amount of unnecessary work.

Instead, the runtime can defer work.

```text
Large application
      │
      ├── classes actually used
      │      └── loaded/resolved/initialized as needed
      │
      └── classes never used
             └── avoid some work
```

This helps:

```text
startup behavior
memory usage
dynamic loading
plugin architectures
optional dependencies
```

But laziness also has a trade-off.

The first operation that triggers loading, linking, resolution, or initialization may pay that cost.

So:

```text
first call slower
later calls faster
```

can sometimes involve class lifecycle work in addition to JIT warmup.

## Loading also consumes native JVM memory

Now connect this lesson back to our earlier memory model.

In Lesson 2 we separated:

```text
Java Heap
Metaspace
Code Cache
Thread stacks
other native memory
```

When HotSpot loads a class, it creates runtime metadata describing things such as:

```text
class structure
methods
fields
runtime constant pool
type relationships
other VM metadata
```

Much of that metadata is associated with **Metaspace**.

Conceptually:

```text
.class bytes
     │
     ▼
 ClassLoader
     │
     ▼
HotSpot class metadata
     │
     ▼
Metaspace / native JVM memory
```

Meanwhile Java code interacts with:

```text
java.lang.Class
```

which is an ordinary heap object.

<figure>
<a href="/images/courses/jvm/class-metadata-vs-class-object.svg" aria-label="Open class metadata versus Class object">
<img src="/images/courses/jvm/class-metadata-vs-class-object.svg"
     alt="HotSpot class metadata resides in native JVM memory such as Metaspace, while the corresponding java.lang.Class object is an ordinary Java heap object."
     width="840" height="500" />
</a>
<figcaption>The Java Class object is a gateway to a runtime type, not the entirety of HotSpot's internal class metadata.</figcaption>
</figure>

So do not use this mental model:

```text
java.lang.Class object
=
all metadata for the class
```

Prefer:

```text
HotSpot runtime class metadata
          │
          ├── internal VM representation
          │
          └── associated java.lang.Class mirror
```

The exact implementation relationship is a HotSpot detail, but conceptually separating the two is very useful.

## Class unloading depends on class-loader reachability

Now our earlier Metaspace discussion becomes more concrete.

Suppose a plugin system repeatedly creates a new class loader:

```text
PluginClassLoader #1
PluginClassLoader #2
PluginClassLoader #3
...
```

Each loader defines classes:

```text
Loader
  │
  ├── Class A
  ├── Class B
  ├── Class C
  └── ...
```

If an old loader becomes unreachable and the JVM can unload its classes, associated metadata can eventually be reclaimed.

But suppose something accidentally keeps the loader reachable:

```text
GC Root
   │
   ▼
some framework cache
   │
   ▼
PluginClassLoader
   │
   ├── class
   ├── class
   └── class
```

<figure>
<a href="/images/courses/jvm/classloader-metaspace-leak.svg" aria-label="Open the class-loader Metaspace leak diagram">
<img src="/images/courses/jvm/classloader-metaspace-leak.svg"
     alt="A GC root keeps a framework cache reachable, which retains a plugin class loader. Classes defined by that loader and their associated Metaspace metadata remain alive."
     width="840" height="520" />
</a>
<figcaption>A Metaspace leak is often really a class-loader reachability problem.</figcaption>
</figure>

Conceptually:

```text
ClassLoader remains reachable
        │
        ▼
classes remain associated
with live loader
        │
        ▼
class unloading cannot occur
        │
        ▼
class metadata remains
        │
        ▼
Metaspace stays occupied
```

This is why applications involving:

```text
application redeployment
plugins
dynamic proxies
runtime bytecode generation
framework-generated classes
```

can encounter class-loader and Metaspace problems.

The GC is not necessarily failing.

Just like the heap leaks we discussed earlier:

```text
something remains reachable
```

so the JVM correctly keeps it alive.

## Check your reasoning

Consider:

```java
class Config {
    static int count = 42;
}
```

At some point, HotSpot has loaded and prepared `Config`, but class initialization has not yet run.

What value should you use in the conceptual model for `count` at the preparation stage?

<details class="lesson-check">
<summary>Pause here, then check your reasoning</summary>
<p>For this ordinary static field, use <code>0</code>. Preparation establishes the field and its JVM default value. The assignment to <code>42</code> belongs to class initialization. Certain compile-time constant static-final fields have a specification-level constant-value nuance, but ordinary static initialization logic does not execute during preparation.</p>
</details>

The distinction
