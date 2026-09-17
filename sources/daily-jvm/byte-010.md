onto the next byte





## Daily JVM Byte #10 — Class loading lifecycle: from `.class` bytes to a live JVM class

So far we have mostly looked at objects **after classes already exist**. Now move one level earlier:
```text
.class bytes
   ↓
Loading
   ↓
Linking
   ├── Verification
   ├── Preparation
   └── Resolution
   ↓
Initialization
   ↓
Class ready for normal use
```

This lifecycle is specified by the JVM, and JDK 25 follows the same fundamental model. ([Oracle Docs](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-5.html?utm_source=chatgpt.com))

### 1. Loading

Loading means finding a binary representation of a class or interface and creating the JVM's runtime representation for it.

A class loader ultimately supplies bytes, commonly via:
```java
ClassLoader.defineClass(...)
```

The JVM then creates the class representation and its corresponding `java.lang.Class` object. ([Oracle Docs](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-5.html?utm_source=chatgpt.com))

Conceptually:
```text
Customer.class
     ↓
ClassLoader
     ↓
class-file bytes
     ↓
HotSpot runtime representation
     +
java.lang.Class object
```

One crucial rule:
```text
Class identity =
binary class name + defining class loader
```

So two loaders can load the same:
```text
com.example.Customer
```

and produce two distinct runtime types.

This is the basis of many plugin/application-server isolation mechanisms—and many `ClassCastException` surprises.

---

## 2. Linking

Loading alone does not make the class fully usable.

The JVM next **links** it into the runtime.

Linking consists of:
```text
Verification
Preparation
Resolution
```

### Verification

Verification checks that the class-file representation is structurally and semantically valid enough for safe JVM execution.

Examples include validating:

- bytecode structure
- operand-stack type consistency
- control-flow constraints
- legal use of fields and methods

Invalid bytecode can cause:
```text
VerifyError
```

This is important because JVM bytecode may come from something other than `javac`.

The JVM cannot simply assume that arbitrary `.class` bytes are trustworthy. ([Oracle Docs](https://docs.oracle.com/javase/specs/jvms/se25/jvms25.pdf?utm_source=chatgpt.com))

---

### Preparation

Preparation creates static fields and assigns their JVM default values.

Consider:
```java
class Config {
    static int count = 42;
}
```

During **preparation**, conceptually:
```text
count = 0
```

Not:
```text
count = 42
```

The explicit Java initializer runs later during initialization.

The JVM specification explicitly separates these two stages. ([Oracle Docs](https://docs.oracle.com/javase/specs/jvms/se25/jvms25.pdf?utm_source=chatgpt.com))

That distinction is easy to miss:
```text
Preparation
    ↓
static storage exists
default values installed

Initialization
    ↓
Java initialization logic runs
```

---

## 3. Resolution

Class files contain many **symbolic references**.

For example, bytecode may conceptually refer to:
```text
java/lang/String
Customer.process:()V
Order.total:I
```

The `.class` file does not simply contain final raw machine addresses for these things.

Its constant pool contains symbolic information.

During runtime, the JVM resolves such references into runtime entities:
```text
symbolic class reference
        ↓
actual loaded class

symbolic method reference
        ↓
runtime method

symbolic field reference
        ↓
runtime field
```

The JVMS permits implementations some flexibility about exactly when resolution occurs; it need not all happen eagerly at class-load time. ([Oracle Docs](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-5.html?utm_source=chatgpt.com))

This supports Java's dynamic-loading model.

---

## 4. Initialization

Initialization is where Java-level static initialization actually executes.

For example:
```java
class Config {
    static int count = 42;

    static {
        System.out.println("initializing");
    }
}
```

The compiler/JVM represents class initialization through a special method:
```text
<clinit>
```

Conceptually:
```text
<clinit>:
    count = 42
    print "initializing"
```

The JVMS defines initialization as execution of the class or interface initialization method. ([Oracle Docs](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-5.html?utm_source=chatgpt.com))

So:
```text
Loaded
≠
Initialized
```

A class may already exist in the JVM without its static initialization having run yet.

---

## Why lazy initialization matters

Imagine an application contains 20,000 classes.

Starting the JVM by fully initializing every possible class would:
```text
increase startup time
consume unnecessary memory
execute unused initialization code
```

Instead, loading and initialization happen largely on demand.

This allows:
```text
large application
+
many libraries
+
only subset actually used
```

without paying the full runtime cost upfront.

The trade-off is that first use of a class may involve class-loading/linking/initialization work.

---

## Class loading also creates runtime metadata

Recall Byte #2:
```text
Java heap
Metaspace
Code Cache
...
```

Loading a class creates HotSpot metadata representing things such as:
```text
class structure
method metadata
field information
runtime constant pool
type relationships
```

This connects class loading directly to **Metaspace**.

Conceptually:
```text
.class file
    ↓
ClassLoader
    ↓
HotSpot class metadata
    ↓
Metaspace/native JVM memory
```

Separately:
```text
java.lang.Class
```

is an ordinary Java object representing that runtime type to Java code.

Do not equate:
```text
Class object
```

with:
```text
all JVM class metadata
```

They are related but not the same thing.

---

## Production implications

Class loading becomes operationally important in systems with:

- dynamic proxies
- bytecode generation
- application reloads
- plugin architectures
- many class loaders
- frameworks generating large numbers of classes

A common leak pattern is:
```text
ClassLoader remains reachable
        ↓
classes defined by loader remain alive
        ↓
associated class metadata cannot be unloaded
        ↓
Metaspace grows
```

That is why a "Metaspace leak" is often fundamentally a **class-loader lifecycle problem**.

### Mental model update

We can now connect the source-to-runtime path:
```text
.java
  ↓ javac
.class
  ↓
ClassLoader
  ↓
Loading
  ↓
Linking
 ├─ verify
 ├─ prepare
 └─ resolve
  ↓
Initialization
  ↓
HotSpot runtime metadata
  ↓
bytecode available for execution
```

And that gives us our next transition.

We now know **how bytecode enters the JVM**.

**Next byte:** the `.class` file and runtime constant pool — what bytecode actually contains, why references are symbolic, and how that prepares the JVM for interpreter execution and later JIT compilation.
