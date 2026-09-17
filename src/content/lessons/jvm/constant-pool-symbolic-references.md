---
title: The constant pool and why JVM bytecode uses symbolic references
summary: Open a class file, decode its numbered constant-pool entries, and follow a field or method reference into the running JVM.
course: jvm
lessonSlug: constant-pool-symbolic-references
module: Foundations
order: 110
sourceByte: byte-011
draft: false
prerequisites: [class-loading-lifecycle]
jdk: JVM class-file format · JDK 25 runtime linking
---

Start with a small Java class:

```java
public class Example {
    private String name;

    public String value() {
        return name.toUpperCase();
    }
}
```

At the Java level, `value()` reads the field `name`, calls `String.toUpperCase()`, and returns the result. The names make the code easy to follow.

Now compile it and ask `javap` to show the class file in detail:

```bash
javac Example.java
javap -v Example.class
```

Inside the output, the bytecode for `value()` looks like this:

```text
0: aload_0
1: getfield      #7
4: invokevirtual #13
7: areturn
```

`javap` also prints a comment after each numbered instruction that summarizes the selected pool entry. We will build those comments ourselves by following the entries.

You do not need to understand every instruction yet. Look first at the two numbered references:

```text
getfield      #7
invokevirtual #13
```

What are `#7` and `#13`? They are not source line numbers, object offsets, or memory addresses. Each number selects an entry in `Example.class`'s **constant pool**.

<figure>
<a href="/images/courses/jvm/constant-pool-overview.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/constant-pool-overview.svg" alt="Example.java is compiled to Example.class. The value method contains getfield 7 and invokevirtual 13, which refer to matching entries in the class-file constant pool." width="480" height="510" /></a>
<figcaption>The bytecode says what operation to perform; the constant pool describes the field or method named by that operation. <a href="/images/courses/jvm/constant-pool-overview.svg">Open full-size diagram</a>.</figcaption>
</figure>

[Lesson 10](/courses/jvm/class-loading-lifecycle) showed how class-file bytes become a live JVM class. This lesson opens those bytes and explains the numbered table that connects portable bytecode to runtime classes, fields, and methods.

## Read the numbers in javap output

Three kinds of numbers appear in the relevant `javap -v` output. They mean different things:

```text
1: getfield #7
↑           ↑
bytecode    pool
offset      index
```

The bytecode offset tells us where an instruction begins in the method's bytecode array. The number after `#` tells the instruction which constant-pool entry to use.

The pool itself contains these entries:

```text
 #7 = Fieldref      #8.#9
 #8 = Class         #10
 #9 = NameAndType   #11:#12
#10 = Utf8          Example
#11 = Utf8          name
#12 = Utf8          Ljava/lang/String;

#13 = Methodref     #14.#15
#14 = Class         #16
#15 = NameAndType   #17:#18
#16 = Utf8          java/lang/String
#17 = Utf8          toUpperCase
#18 = Utf8          ()Ljava/lang/String;
```

Here `#8.#9` is another lookup: entry `#7` points to entries `#8` and `#9`. Those entries point to more entries. The constant pool is a numbered table whose rows can refer to other rows.

Follow entry `#13`:

```text
#13 Methodref
  ├── #14 Class
  │     └── #16 Utf8 → java/lang/String
  │
  └── #15 NameAndType
        ├── #17 Utf8 → toUpperCase
        └── #18 Utf8 → ()Ljava/lang/String;
```

<figure>
<a href="/images/courses/jvm/bytecode-constant-pool-reference.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/bytecode-constant-pool-reference.svg" alt="The invokevirtual 13 instruction selects Methodref entry 13. That entry points to a Class entry for java.lang.String and a NameAndType entry for toUpperCase with its method descriptor." width="480" height="510" /></a>
<figcaption>Entry 13 is structured information assembled through other pool entries. It is not a pointer to executable code. <a href="/images/courses/jvm/bytecode-constant-pool-reference.svg">Open full-size diagram</a>.</figcaption>
</figure>

The comment printed by `javap` is a readable summary of that chain. Formatted across lines, its three pieces are:

```text
class:      java/lang/String
method:     toUpperCase
descriptor: ()Ljava/lang/String;
```

In the actual output, `javap` prints those pieces together after `// Method`. The class file stores the structured entries; `javap` follows them and creates the helpful comment for us.

## A constant-pool index belongs to one class file

Every class file has its own constant pool. In `Example.class`, `#13` means the method reference we just followed. In an unrelated `Customer.class`, `#13` could be a string, a number, a field reference, or another method reference.

The index only has meaning together with the class file that owns the pool:

```text
Example.class
    + #13
       │
       └── String.toUpperCase()
```

Recompiling the same source can also change the indexes because adding or removing entries can rearrange the table. Code should never attach meaning to a particular number such as 13. The entry's contents carry the meaning.

This gives us the first mental model:

```text
bytecode operand #n
        │
        ▼
entry n in this class file's constant pool
        │
        ▼
constant or symbolic description
```

## The pool contains more than literal constants

The name **constant pool** can suggest a list containing only values such as `42` or `"hello"`. It also contains the vocabulary that a class file uses to describe other parts of the program.

A useful grouping is:

```text
class-file constant pool

├── literal values
│   ├── integers and floating-point values
│   └── strings
│
├── symbolic references
│   ├── classes and interfaces
│   ├── fields
│   ├── class methods
│   └── interface methods
│
└── supporting structure
    ├── names and descriptors
    ├── method handles and method types
    └── dynamic invocation data
```

At the class-file level, these categories use entry kinds such as `CONSTANT_Class`, `CONSTANT_Fieldref`, `CONSTANT_Methodref`, `CONSTANT_String`, and `CONSTANT_Integer`. `CONSTANT_NameAndType` and `CONSTANT_Utf8` supply the names and type descriptions used by other entries.

You do not need to memorize the entry-kind list. You need to be able to look at an instruction such as `invokevirtual #13`, find entry 13, and follow its references until the target becomes readable.

Not every bytecode operand is a pool index. In `aload_0`, the `0` identifies a local-variable slot. In `1: getfield #7`, `1` is a bytecode offset and `#7` is a pool index. The syntax and instruction definition tell you which kind of number you are reading.

## Follow the method call through the pool

We can now return to the Java expression that began the lesson:

```java
name.toUpperCase()
```

The compiler emits `invokevirtual #13`. Entry 13 describes three pieces of information:

```text
reference class: java/lang/String
method name:     toUpperCase
descriptor:      ()Ljava/lang/String;
```

The descriptor records the parameter and return types. Here `()` means that this method takes no explicit arguments, and `Ljava/lang/String;` means that it returns a reference to `java.lang.String`.

The class named in a method reference is the **reference class**, where method lookup begins. The method can ultimately be inherited rather than declared directly in that class. The symbolic reference gives the JVM enough information to perform the specified lookup; it does not contain a final machine-code address.

The field instruction works the same way at this level. `getfield #7` leads to:

```text
reference class: Example
field name:      name
descriptor:      Ljava/lang/String;
```

The instruction and the entry have separate jobs. `getfield` means “read an instance field from an object reference.” Entry `#7` identifies which field.

## Symbols make separate compilation possible

`Example` can be compiled against the available `String` API without running the eventual application. Later, a class loader supplies the deployed runtime type and the JVM connects `String.toUpperCase()` to that live type. This supports separate compilation and dynamic loading without embedding the future process's addresses.

<figure>
<a href="/images/courses/jvm/symbolic-portability.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/symbolic-portability.svg" alt="The same Example class file contains a symbolic reference to String.toUpperCase. Separate JVM runs resolve that symbol against their own loaded runtime types." width="480" height="510" /></a>
<figcaption>Each run resolves independently against compatible deployed classes. <a href="/images/courses/jvm/symbolic-portability.svg">Open full-size diagram</a>.</figcaption>
</figure>

A compatible class file can be used across different JVM implementations, architectures, and process runs because each runtime supplies its own representation. Compatibility still matters: the runtime must support the class-file version and provide the required dependencies. Symbols defer binding; they do not make an incompatible library compatible.

## The class-file pool and runtime pool are distinct

On disk, `constant_pool` is a table in the class-file format. During creation of a class or interface, the JVM constructs its runtime constant pool from that information. There is a runtime constant pool for each runtime class or interface, rather than one global pool shared by the application.

<figure>
<a href="/images/courses/jvm/classfile-vs-runtime-pool.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/classfile-vs-runtime-pool.svg" alt="ON DISK · class-file constant_pool; Serialized constants and symbols. Class / interface creation; Derive a runtime representation. IN THE JVM · runtime constant pool; Constants + symbolic references; Associated resolved information" width="480" height="510" /></a>
<figcaption>The runtime pool is per class or interface, not a byte-for-byte file copy. <a href="/images/courses/jvm/classfile-vs-runtime-pool.svg">Open full-size diagram</a>.</figcaption>
</figure>

The runtime pool has static constants and symbolic references that may later be resolved. Runtime information can be associated with resolved references. It is not a byte-for-byte copy of the serialized table: descriptive entries such as `NameAndType` and `Utf8` contribute indirectly to runtime references. Nor is it the string-intern pool; string constants are only one part of the model.

HotSpot builds implementation-specific structures for execution. The specification defines their meaning without requiring a particular memory layout or a literal pointer in each entry. Resolving a reference does not rewrite the `.class` file on disk.

## Resolution connects symbols to live runtime entities

The class file has told us which member it needs:

```text
class:  java/lang/String
method: toUpperCase
type:   ()Ljava/lang/String;
```

Before the runtime can use that relationship, the JVM has to connect the symbol to the live types and members in this process. That work is called **resolution**.

At a high level, method resolution answers four questions:

1. Which runtime `java.lang.String` type does this name identify?
2. Does method lookup find `toUpperCase` with the recorded descriptor?
3. Is the access permitted?
4. If those checks succeed, what runtime method relationship represents the result?

<figure>
<a href="/images/courses/jvm/method-resolution.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/method-resolution.svg" alt="The symbolic reference to String.toUpperCase enters resolution. The JVM identifies the runtime class using class-loader rules, performs lookup and access checks, then establishes a method relationship or reports a linkage failure." width="480" height="510" /></a>
<figcaption>Resolution gives the portable symbol meaning inside this JVM process. <a href="/images/courses/jvm/method-resolution.svg">Open full-size diagram</a>.</figcaption>
</figure>

Class-loader identity remains part of the first question. Class resolution uses the defining loader of the referring class to initiate loading of the named type. Delegation may lead another loader to define `java.lang.String`. Runtime identity still depends on the binary name **and defining loader**, as we saw in Lesson 10.

Two independently defined classes with the same name are not interchangeable merely because their names match. Loader constraints help keep types in member signatures consistent across these relationships. Conversely, two child loaders delegating to the same parent definition can share a type. Field resolution follows its own lookup rules, and instruction-specific checks also matter, such as whether a field access expects a static or instance field.

Successful resolution lets the JVM reuse the established relationship instead of repeating symbolic lookup for every execution. The exact representation of cached execution information is an implementation choice.

## Resolution is not virtual dispatch

Suppose `PremiumCustomer` extends `Customer` and overrides `getName`:

```java
Customer customer = new PremiumCustomer();
String name = customer.getName();
```

The bytecode can reference `Customer.getName`. Resolving that reference does not permanently choose `Customer`'s implementation for all receivers. For this ordinary virtual call, method selection uses the receiver's runtime class and the resolved method relationship, so the override in `PremiumCustomer` executes.

<figure>
<a href="/images/courses/jvm/resolution-vs-dispatch.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/resolution-vs-dispatch.svg" alt="1 · RESOLUTION; What does Customer.getName denote?. 2 · RECEIVER AT INVOCATION; Customer or PremiumCustomer?. METHOD SELECTION; Customer → base implementation; PremiumCustomer → override" width="480" height="510" /></a>
<figcaption>One resolved reference can serve receivers with different implementations. <a href="/images/courses/jvm/resolution-vs-dispatch.svg">Open full-size diagram</a>.</figcaption>
</figure>

Keep the two questions separate: resolution establishes what member the symbolic reference denotes; dispatch selects the applicable implementation for this receiver. Another call through the same resolved reference can receive an ordinary `Customer`. A JIT can optimize dispatch when its assumptions permit, while preserving Java's required behavior.

## Resolution may be lazy

An initialized class can still have unresolved references. A JVM may resolve references eagerly or defer work until needed, within the specification's rules for when errors become observable. “Everything resolved before initialization” is therefore too strong, but “every reference always resolves at first use” is also too strong.

<figure>
<a href="/images/courses/jvm/lazy-constant-pool-resolution.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/lazy-constant-pool-resolution.svg" alt="Caller is initialized; Execution may proceed. Reference A · already resolved; Reference B · still symbolic. A later path needs B; Resolve if needed; use or fail" width="480" height="510" /></a>
<figcaption>A permitted lazy strategy; exact timing is implementation-dependent. <a href="/images/courses/jvm/lazy-constant-pool-resolution.svg">Open full-size diagram</a>.</figcaption>
</figure>

Deferring work can avoid resolving unused paths and move some cost to first use. This helps explain why a rarely used endpoint can reveal a missing dependency long after startup. A successful health check only exercises the paths it actually reaches; it does not establish that every symbolic reference in the application is satisfiable.

## Field access does not encode object offsets

Return to `getfield #7`. Entry 7 identifies `Example.name` with descriptor `Ljava/lang/String;`. It does not say “read eight bytes at physical object offset 24.” The pool describes which field is intended; the running JVM determines how to access it in its chosen object representation.

<figure>
<a href="/images/courses/jvm/symbolic-field-layout.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/symbolic-field-layout.svg" alt="The class file uses getfield 7 to identify the symbolic field Example.name of type String. The running JVM resolves that field and accesses it using its chosen object layout." width="480" height="510" /></a>
<figcaption>The JVM may use offsets internally. The operand 7 is not one. <a href="/images/courses/jvm/symbolic-field-layout.svg">Open full-size diagram</a>.</figcaption>
</figure>

HotSpot may use field offsets internally, and generated machine code may incorporate layout information. That is a runtime implementation detail, not the meaning of the class-file operand.

Keep these three numbers apart:

```text
1      → bytecode offset
#7     → constant-pool index
layout → chosen by the runtime
```

The `javap` command examines the class file. It does not display the running JVM's resolved metadata, a field's runtime offset, or the moment resolution happens.

## The interpreter combines metadata with operands

The example also reveals the next layer of execution. Each invocation has a frame with local variables, an operand stack, and access to the runtime constant pool of the current method's class. The receiver and values live in the frame's execution state; symbols identify the members used by instructions.

<figure>
<a href="/images/courses/jvm/interpreter-constant-pool.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/interpreter-constant-pool.svg" alt="aload_0; Push this from local variable 0. getfield #7; Use field relationship; push name. invokevirtual #13; Use method relationship + receiver; Return String, then areturn" width="480" height="510" /></a>
<figcaption>The frame supplies values; its class’s runtime pool supplies relationships. <a href="/images/courses/jvm/interpreter-constant-pool.svg">Open full-size diagram</a>.</figcaption>
</figure>

In `value()`, `aload_0` pushes `this`. `getfield #7` consumes that object reference and pushes the `name` reference. `invokevirtual #13` consumes the String receiver, selects and invokes the method, and supplies its returned String reference. `areturn` returns that reference to the caller. If `name` is null, invocation fails with `NullPointerException`; successful resolution does not guarantee valid operands.

This describes bytecode semantics and the interpreter's conceptual inputs. It does not require HotSpot to redo a full symbolic search on every instruction, nor mean all methods must be interpreted before compilation.

## A deployed library can break a symbolic relationship

Now consider a production failure. The application was compiled against a library supplying `Library.foo:()V`. At deployment, the selected version no longer supplies that method, including through the applicable inheritance lookup. The caller still contains the original symbolic reference, so resolving it fails with `NoSuchMethodError`.

<figure>
<a href="/images/courses/jvm/runtime-linkage-failure.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/runtime-linkage-failure.svg" alt="Compile against library v1; Library.foo:()V exists. Deploy caller with library v2; No matching foo in lookup. Resolve caller’s Methodref; NoSuchMethodError" width="480" height="510" /></a>
<figcaption>A missing matching Fieldref can similarly cause NoSuchFieldError. <a href="/images/courses/jvm/runtime-linkage-failure.svg">Open full-size diagram</a>.</figcaption>
</figure>

A removed field, or a changed field descriptor that leaves no matching field, can similarly produce `NoSuchFieldError`. These are member linkage failures. Check the exact owner, name, and descriptor in the error and caller's `javap` output, then compare them with the actual deployed classes. Inspect dependency selection, duplicate JARs, and the defining loaders involved; the build-time dependency tree alone may not describe deployment.

`ClassNotFoundException` and `NoClassDefFoundError` are related but distinct. The former commonly comes from explicit name-based loading APIs when a requested class cannot be found. The latter is a linkage error that can surface when a required class definition cannot be obtained, including during resolution. It can also follow a failed class initialization; inspect the earlier cause. Neither is an interchangeable name for a missing method or field.

## Check your reasoning

One call site has successfully resolved `Customer.getName`. A later call receives a `PremiumCustomer` that overrides it. Must it execute the base implementation? And does successful initialization of the caller prove that its unused field references will resolve?

<details class="lesson-check">
<summary>Pause here, then check your reasoning</summary>
<p>No to both. Resolution establishes the method relationship, while virtual selection still depends on the receiver, so the overriding method can execute. Initialization does not require all symbolic references to have been resolved. An unused reference can still expose a linkage failure when a later path needs it.</p>
</details>

Now suppose `getfield #7` appears in two unrelated class files. Must both instructions access the same field or offset?

<details class="lesson-check">
<summary>Check what the index identifies</summary>
<p>No. Each operand identifies an entry in its containing class's pool. Those entries may describe different fields, and neither index encodes a physical object offset.</p>
</details>

## From portable symbols to executing instructions

The class file supplies instructions and symbolic relationships. Loading constructs the live class representation, and resolution connects its references to runtime entities as required. Execution then combines those relationships with actual receivers and values.

<figure>
<a href="/images/courses/jvm/constant-pool-complete.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/constant-pool-complete.svg" alt="Java source → javac → .class; Bytecode + constant pool. Loading → live class and runtime pool; Resolution connects required symbols. Frame + operands + runtime entities; Execute field access or method call" width="480" height="510" /></a>
<figcaption>Next: follow local variables and the operand stack through a method. <a href="/images/courses/jvm/constant-pool-complete.svg">Open full-size diagram</a>.</figcaption>
</figure>

The next lesson follows stack frames, local variables, and the operand stack: where method arguments and intermediate values live, and how the interpreter executes a method instruction by instruction before we explore optimized execution.

<details class="lesson-sources">
<summary>Sources and implementation boundaries</summary>
<p>Adapted from Daily JVM Byte #11 and the available reviewed draft. Diagrams and pool indexes outside the javap exercise are illustrative. The compilation and disassembly exercise was verified on Homebrew OpenJDK HotSpot 25.0.2; deployment failures are reasoning examples. JVM rules are distinguished from HotSpot representation choices.</p>
<ul>
<li><a href="https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-4.html#jvms-4.4">JVMS 4.4: constant-pool structure and symbolic references</a></li>
<li><a href="https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-5.html">JVMS 5: runtime pools, loader identity, resolution, and method selection</a></li>
<li><a href="https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-6.html#jvms-6.5.invokevirtual">JVMS 6: invokevirtual and field-access semantics</a></li>
<li><a href="https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-2.html#jvms-2.6">JVMS 2.6: frames and dynamic linking</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/javap.html">JDK 25 javap command</a></li>
</ul>
</details>
