Byte #11 is a strong bridge into interpreter execution. I would preserve most of it, with three refinements:

- **Resolution of `invokevirtual` does not mean the JVM has permanently selected the final implementation method.** Resolution identifies the referenced method/type relationship; dynamic dispatch may still choose an overriding implementation at invocation time.
- Keep **class-file constant pool vs runtime constant pool** clearly separated. The runtime structure is derived from class-file information but becomes part of the JVM's live class representation.
- For production errors, distinguish **linkage/resolution failures** such as `NoSuchMethodError` and `NoSuchFieldError` from broader loading failures such as `ClassNotFoundException` / `NoClassDefFoundError`.

This should also stay illustration-heavy. The key visual progression is:

```text
Java source
   ↓
.class
 ├─ bytecode: invokevirtual #17
 └─ constant pool: #17 → symbolic Methodref
                           ↓
                       resolution
                           ↓
                    runtime metadata
```

## Draft — Lesson 11: The constant pool and symbolic references

```markdown
---
title: The constant pool and why JVM bytecode uses symbolic references
summary: Open a class file and see how bytecode refers to classes, fields, methods, strings, and other values through the constant pool instead of hard-coded runtime addresses.
course: jvm
lessonSlug: constant-pool-symbolic-references
module: Foundations
order: 110
sourceByte: byte-011
draft: false
prerequisites:
  - class-loading-lifecycle
jdk: JVM class-file format · runtime linking
---

In the previous lesson, we followed a class through:

```text
.class bytes
     │
     ▼
Loading
     │
     ▼
Linking
     │
     ▼
Initialization
```

One part of linking was **resolution**.

We described it as turning symbolic references such as:

```text
Customer.getName()
```

into something meaningful to the running JVM.

But where did that symbolic reference come from?

To answer that, we need to open the `.class` file itself.

One of its most important structures is the **constant pool**.

The key idea is:

```text
JVM bytecode does not contain
final runtime addresses for classes,
fields, or methods.

It refers to symbolic information
through the constant pool.
```

<figure>
<a href="/images/courses/jvm/constant-pool-overview.svg" aria-label="Open the constant pool overview">
<img src="/images/courses/jvm/constant-pool-overview.svg"
     alt="A Java class file contains bytecode and a constant pool. Bytecode instructions refer to constant-pool entries, which symbolically describe classes, methods, fields, strings, and other values."
     width="840" height="500" />
</a>
<figcaption>Bytecode and the constant pool work together: instructions describe operations while constant-pool entries describe many of the things those operations refer to.</figcaption>
</figure>

## Start with a method call

Suppose our Java source contains:

```java
String name = customer.getName();
```

At the source level, the relationship looks simple:

```text
customer
   │
   ▼
getName()
```

But `javac` cannot encode:

```text
call machine address 0x7ff01234
```

Why?

Because when `javac` runs:

```text
the JVM process does not exist yet

Customer may not have been loaded yet

its runtime metadata does not exist yet

JIT-compiled machine code certainly
does not exist yet
```

Instead, bytecode can contain something conceptually like:

```text
aload_1
invokevirtual #17
astore_2
```

What is:

```text
#17
```

?

It is an index into the class file's constant pool.

Conceptually:

```text
BYTECODE

invokevirtual #17
       │
       ▼

CONSTANT POOL

#17 → Customer.getName:()Ljava/lang/String;
```

<figure>
<a href="/images/courses/jvm/bytecode-constant-pool-reference.svg" aria-label="Open the bytecode constant-pool reference diagram">
<img src="/images/courses/jvm/bytecode-constant-pool-reference.svg"
     alt="An invokevirtual bytecode instruction refers to constant-pool entry 17. That entry symbolically describes Customer.getName returning String."
     width="840" height="460" />
</a>
<figcaption>The bytecode instruction does not need to embed the final runtime location of the method.</figcaption>
</figure>

This indirection is fundamental to JVM bytecode.

## What lives in the constant pool?

Despite the name, the constant pool contains much more than numeric constants.

A class-file constant pool can describe things such as:

```text
classes
fields
methods
interface methods
strings
integers
floating-point values
method handles
method types
dynamic constants
invokedynamic call sites
names and descriptors
```

At the class-file level, these appear through entry types such as:

```text
CONSTANT_Class
CONSTANT_Fieldref
CONSTANT_Methodref
CONSTANT_InterfaceMethodref
CONSTANT_String
CONSTANT_Integer
CONSTANT_Long
CONSTANT_Float
CONSTANT_Double
CONSTANT_NameAndType
CONSTANT_MethodHandle
CONSTANT_MethodType
CONSTANT_InvokeDynamic
CONSTANT_Dynamic
...
```

You do not need to memorize that list.

Instead, remember the categories:

```text
CONSTANT POOL

├── literal values
│    ├── integers
│    ├── strings
│    └── other constants
│
└── symbolic program relationships
     ├── classes
     ├── fields
     ├── methods
     └── dynamic invocation information
```

The name **constant pool** can therefore be slightly misleading.

It is both:

```text
a pool of constants
```

and:

```text
a symbolic vocabulary
used by the class file
```

## A symbolic method reference has structure

Consider again:

```text
Customer.getName:()Ljava/lang/String;
```

This describes several pieces of information:

```text
Customer
   │
   └── declaring/reference class

getName
   │
   └── method name

()Ljava/lang/String;
   │
   └── method descriptor
```

The descriptor:

```text
()Ljava/lang/String;
```

means approximately:

```text
parameters: none

returns:
java.lang.String
```

For another method:

```java
int calculate(long value, String name)
```

the JVM descriptor conceptually represents:

```text
(long, String) → int
```

using the compact descriptor format defined by the class-file specification.

So bytecode does not merely say:

```text
call getName
```

It carries enough symbolic information to distinguish precisely which member is being referenced.

## Why compile symbolically?

Imagine two independently compiled files:

```text
Customer.java

OrderService.java
```

`OrderService` contains:

```java
customer.getName();
```

When `OrderService.java` is compiled, the final runtime address of `Customer.getName()` cannot possibly be known.

There may eventually be:

```text
different operating systems

different CPU architectures

different JVM implementations

different application runs

different class loaders

different object layouts

different JIT decisions
```

Yet the same `.class` file should still be usable.

So compilation produces:

```text
portable bytecode
        +
symbolic relationships
```

instead of:

```text
machine-specific addresses
```

<figure>
<a href="/images/courses/jvm/symbolic-portability.svg" aria-label="Open the symbolic reference portability diagram">
<img src="/images/courses/jvm/symbolic-portability.svg"
     alt="The same class file containing symbolic method references can be loaded by different JVM runs and platforms, each of which resolves those symbols into its own runtime representation."
     width="840" height="500" />
</a>
<figcaption>Symbolic references separate portable class-file structure from runtime-specific representation.</figcaption>
</figure>

This enables several important JVM properties:

```text
separate compilation
dynamic loading
runtime linking
class-loader isolation
portable class files
late runtime decisions
```

## The class file has a constant pool

Before loading, everything exists in the class file:

```text
Customer.class

┌──────────────────────────┐
│ class-file header        │
├──────────────────────────┤
│ constant pool            │
│                          │
│ #1 ...                   │
│ #2 ...                   │
│ #17 Methodref ...        │
│ ...                      │
├──────────────────────────┤
│ fields                   │
├──────────────────────────┤
│ methods                  │
│   └── bytecode           │
└──────────────────────────┘
```

At this stage:

```text
Customer
getName
java/lang/String
```

are class-file symbolic information.

They are not yet pointers to live HotSpot metadata.

That happens only after the class enters a running JVM.

## Loading creates a runtime constant pool

Recall our previous lesson:

```text
.class
  │
  ▼
ClassLoader
  │
  ▼
HotSpot runtime class
```

As part of the runtime representation of the class, the JVM maintains a **runtime constant pool**.

Conceptually:

```text
CLASS FILE

constant_pool
      │
      │ class loading
      ▼

RUNTIME CLASS

runtime constant pool
```

<figure>
<a href="/images/courses/jvm/classfile-vs-runtime-pool.svg" aria-label="Open class-file versus runtime constant pool">
<img src="/images/courses/jvm/classfile-vs-runtime-pool.svg"
     alt="The class-file constant pool exists in the class bytes. Loading creates a runtime class representation that includes a runtime constant pool containing constants, symbolic references, and references that can become resolved."
     width="840" height="500" />
</a>
<figcaption>The runtime constant pool is the live JVM counterpart to symbolic information stored in the class file.</figcaption>
</figure>

A useful simplified model is:

```text
runtime constant pool

├── constants
├── symbolic references
└── runtime information
    associated with resolved references
```

Do not think of it as simply:

```text
copy bytes from .class into Metaspace
```

HotSpot builds internal structures suitable for runtime execution.

The class-file representation and HotSpot's internal representation are related, but not identical data structures.

## Resolution connects symbols to the live JVM

Now suppose the runtime encounters:

```text
invokevirtual #17
```

and:

```text
#17
```

describes:

```text
Customer.getName:()Ljava/lang/String;
```

At some point, the JVM must determine what that symbolic reference means **in this JVM process**.

Questions include:

```text
Which Customer class?

Which defining class loader?

Does that method exist?

Is the reference accessible?

Is the method shape compatible?

What runtime metadata represents it?
```

That is part of **resolution**.

Conceptually:

```text
symbolic Methodref

Customer.getName:()String

        │
        ▼
resolution
        │
        ▼
runtime class metadata
        │
        ▼
runtime method information
```

<figure>
<a href="/images/courses/jvm/method-resolution.svg" aria-label="Open symbolic method resolution">
<img src="/images/courses/jvm/method-resolution.svg"
     alt="A symbolic Customer.getName method reference passes through class-loader and JVM linking rules and becomes associated with runtime method metadata."
     width="820" height="470" />
</a>
<figcaption>Resolution connects portable symbolic class-file information to this process's live runtime types.</figcaption>
</figure>

After successful resolution, HotSpot can retain runtime information so execution does not need to repeat the full symbolic lookup process every time.

## Resolution is not the same as virtual dispatch

There is an important distinction here.

Suppose:

```java
class Customer {
    String getName() { ... }
}

class PremiumCustomer extends Customer {
    @Override
    String getName() { ... }
}
```

And the bytecode contains:

```text
invokevirtual #17
```

where `#17` symbolically references:

```text
Customer.getName()
```

Resolution establishes the referenced runtime method relationship.

But at execution time:

```java
Customer c = new PremiumCustomer();
c.getName();
```

the actual receiver is:

```text
PremiumCustomer
```

So virtual dispatch can select:

```text
PremiumCustomer.getName()
```

Conceptually:

```text
CONSTANT-POOL RESOLUTION

#17
 │
 ▼
Customer.getName
referenced method relationship


RUNTIME INVOCATION

receiver object
      │
      ▼
PremiumCustomer
      │
      ▼
virtual dispatch
      │
      ▼
PremiumCustomer.getName
```

<figure>
<a href="/images/courses/jvm/resolution-vs-dispatch.svg" aria-label="Open resolution versus virtual dispatch">
<img src="/images/courses/jvm/resolution-vs-dispatch.svg"
     alt="Constant-pool resolution identifies Customer.getName as the symbolic method reference, while invokevirtual later performs dynamic dispatch based on the runtime receiver PremiumCustomer."
     width="840" height="500" />
</a>
<figcaption>Resolving a symbolic method reference and choosing the final implementation for a virtual call are related but different operations.</figcaption>
</figure>

This distinction becomes extremely important when we later study:

```text
virtual calls
inline caches
type profiling
inlining
devirtualization
```

## Resolution can happen lazily

The previous lesson already introduced an important property:

```text
not every symbolic reference
must be resolved immediately
```

Suppose a class contains references to:

```text
Method A
Method B
Field C
Class D
```

At some moment, its runtime state might conceptually look like:

```text
Method A    RESOLVED
Method B    unresolved
Field C     RESOLVED
Class D     unresolved
```

<figure>
<a href="/images/courses/jvm/lazy-constant-pool-resolution.svg" aria-label="Open lazy constant-pool resolution">
<img src="/images/courses/jvm/lazy-constant-pool-resolution.svg"
     alt="A runtime constant pool contains a mixture of resolved and unresolved class, field, and method references, with additional entries resolved when execution needs them."
     width="820" height="470" />
</a>
<figcaption>The JVM can defer work for symbolic references that execution has not yet needed.</figcaption>
</figure>

This is useful for a simple reason.

Suppose an application has:

```text
thousands of classes
millions of symbolic relationships
```

but executes only a fraction of them during a particular run.

Resolving everything eagerly would perform work that may never be useful.

Lazy resolution provides:

```text
less startup work
+
less unused linking work
```

at the cost of:

```text
some first-use paths
having additional runtime work
```

This is another JVM pattern we have already encountered:

```text
Do work only when evidence says
we actually need it.
```

## The interpreter needs these runtime relationships

We are now very close to actual bytecode execution.

Suppose a method contains:

```text
aload_0
getfield      #12
invokevirtual #17
```

The first instruction:

```text
aload_0
```

operates primarily on the current method frame.

But:

```text
getfield #12
```

needs to know:

```text
Which field does #12 describe?
```

And:

```text
invokevirtual #17
```

needs runtime information about:

```text
Which method relationship
does #17 describe?
```

So interpreter execution conceptually becomes:

```text
bytecode instruction
       │
       ▼
constant-pool index
       │
       ▼
runtime constant pool
       │
       ▼
resolved class / field / method metadata
       │
       ▼
perform JVM operation
```

<figure>
<a href="/images/courses/jvm/interpreter-constant-pool.svg" aria-label="Open interpreter constant-pool interaction">
<img src="/images/courses/jvm/interpreter-constant-pool.svg"
     alt="The interpreter reads bytecode such as getfield 12 and invokevirtual 17, uses those indexes to reach runtime constant-pool metadata, and then performs the corresponding runtime operation."
     width="840" height="520" />
</a>
<figcaption>The runtime constant pool is one of the bridges between portable bytecode instructions and live JVM metadata.</figcaption>
</figure>

This lets bytecode remain compact and portable while the JVM handles the runtime-specific details.

## Bytecode does not encode object field offsets directly

Return to an object:

```java
class Customer {
    int id;
    String name;
}
```

In Lesson 3, we learned that HotSpot decides the physical object layout.

Suppose `name` happens to occupy some particular location in one runtime configuration.

The class file does not need to say:

```text
name is always byte offset 24
```

Instead, the bytecode can contain:

```text
getfield #12
```

where `#12` symbolically identifies:

```text
Customer.name:Ljava/lang/String;
```

Conceptually:

```text
CLASS FILE

getfield #12
      │
      ▼
Customer.name


RUNTIME

Customer metadata
      │
      ▼
HotSpot knows actual layout
      │
      ▼
access field
```

<figure>
<a href="/images/courses/jvm/symbolic-field-layout.svg" aria-label="Open symbolic field layout diagram">
<img src="/images/courses/jvm/symbolic-field-layout.svg"
     alt="A class file uses getfield with a symbolic Customer.name field reference. HotSpot later maps that runtime field metadata to the actual object layout chosen for the running JVM."
     width="840" height="480" />
</a>
<figcaption>The class file describes which field is intended; HotSpot controls how that field is physically represented at runtime.</figcaption>
</figure>

This separates:

```text
Java/JVM semantics
```

from:

```text
HotSpot physical representation
```

and helps preserve portability across JVM implementations and runtime configurations.

## You can inspect this yourself with `javap`

This is one JVM concept that is easy to observe directly.

Suppose:

```java
public class Example {

    private String name;

    public String value() {
        return name.toUpperCase();
    }
}
```

Compile it:

```bash
javac Example.java
```

Then inspect the class file:

```bash
javap -v Example.class
```

Among other things, `javap` shows the constant pool and bytecode.

You may see output conceptually resembling:

```text
Constant pool:

 #7  = Fieldref
       Example.name:Ljava/lang/String;

 #13 = Methodref
       java/lang/String.toUpperCase:()Ljava/lang/String;
```

And later:

```text
Code:

aload_0
getfield      #7
invokevirtual #13
areturn
```

Now the relationship becomes visible:

```text
getfield #7
      │
      ▼
#7 Fieldref
      │
      ▼
Example.name
```

and:

```text
invokevirtual #13
      │
      ▼
#13 Methodref
      │
      ▼
String.toUpperCase()
```

This is worth trying once because it turns the constant pool from an abstract JVM structure into something concrete.

## Runtime incompatibility can surface during resolution

Symbolic references also explain a class of production failures.

Suppose an application is compiled against:

```text
library-v1.jar
```

containing:

```java
class Library {
    void foo() { ... }
}
```

The compiled application now contains a symbolic reference conceptually like:

```text
Library.foo:()V
```

Deployment accidentally uses:

```text
library-v2.jar
```

where:

```text
foo()
```

no longer exists.

Compilation succeeded because the compiler saw version 1.

But at runtime:

```text
Methodref
   │
   ▼
Library.foo()
   │
   ▼
resolution
   │
   ▼
method not present
   │
   ▼
NoSuchMethodError
```

<figure>
<a href="/images/courses/jvm/runtime-linkage-failure.svg" aria-label="Open runtime linkage failure">
<img src="/images/courses/jvm/runtime-linkage-failure.svg"
     alt="Application bytecode compiled against library version 1 contains a symbolic reference to Library.foo. Runtime version 2 lacks the method, so resolution fails with NoSuchMethodError."
     width="840" height="500" />
</a>
<figcaption>Some binary incompatibilities survive compilation and appear only when the runtime tries to connect a symbolic reference to the deployed classes.</figcaption>
</figure>

A similar situation can produce:

```text
NoSuchFieldError
```

when a symbolic field reference cannot be satisfied.

Other class-loading problems may produce errors or exceptions such as:

```text
ClassNotFoundException
NoClassDefFoundError
```

but those are not simply interchan