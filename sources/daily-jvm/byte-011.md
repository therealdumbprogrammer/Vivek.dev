next byte:



## Daily JVM Byte #11 — The constant pool and why JVM bytecode uses symbolic references

Yesterday we covered how a `.class` file becomes a live JVM class. Today, focus on one of the most important structures inside that class file: the **constant pool**.

The core idea:
```text
JVM bytecode does not hard-code final object addresses,
method addresses, or field addresses.

It refers to symbolic entries in the constant pool.
```

The JDK 25 JVM Specification defines the class-file constant pool as a table containing constants plus symbolic information such as class names, field references, and method references. ([Oracle Docs](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-4.html?utm_source=chatgpt.com))

### 1. What is in the class-file constant pool?

A `.class` file can contain entries such as:
```text
CONSTANT_Class
CONSTANT_Fieldref
CONSTANT_Methodref
CONSTANT_InterfaceMethodref
CONSTANT_String
CONSTANT_Integer
CONSTANT_Long
CONSTANT_MethodHandle
CONSTANT_MethodType
CONSTANT_InvokeDynamic
CONSTANT_Dynamic
...
```

For example, suppose Java source contains:
```java
customer.getName();
```

The bytecode does not contain something like:
```text
call machine address 0x7ff01234
```

Instead, it may contain an instruction referring to a constant-pool index:
```text
invokevirtual #17
```

and entry `#17` ultimately describes something like:
```text
Customer.getName:()Ljava/lang/String;
```

That is still symbolic information. ([Oracle Docs](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-4.html?utm_source=chatgpt.com))

### 2. Why symbolic references exist

Consider separate compilation:
```text
Customer.java
OrderService.java
```

`OrderService` can be compiled even though the final runtime memory location of `Customer.getName()` obviously does not exist yet.

So compilation produces:
```text
bytecode
+
symbolic references
```

rather than final machine addresses.

This is what allows Java to support:

- separate compilation
- dynamic class loading
- different class loaders
- late binding
- runtime linking

### 3. Class-file constant pool vs runtime constant pool

These are related but distinct.

At class-file level:
```text
.class file
    │
    ▼
constant_pool table
```

When the JVM creates the class, it constructs a **runtime constant pool** for that class or interface. The JVMS explicitly defines one runtime constant pool per class/interface. ([Oracle Docs](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-5.html?utm_source=chatgpt.com))

Conceptually:
```text
class-file constant pool
        │
        ▼
class loading
        │
        ▼
runtime constant pool
```

The runtime constant pool contains:
```text
static constants
+
symbolic references
+
references that may later become resolved
```

It serves roughly the same purpose as a symbol table in a traditional runtime/linker. ([Oracle Docs](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-5.html?utm_source=chatgpt.com))

### 4. Resolution turns symbols into runtime entities

Suppose bytecode refers to:
```text
#17 → Customer.getName:()Ljava/lang/String;
```

At some point, the JVM must determine:
```text
Which Customer class?
Which defining ClassLoader?
Does getName() exist?
Is access allowed?
Which runtime method representation corresponds to it?
```

That is part of **resolution**.

Conceptually:
```text
symbolic Methodref
       │
       ▼
class loader / linking rules
       │
       ▼
resolved runtime method
```

Once resolved, HotSpot can cache runtime information so it does not repeat all symbolic lookup work on every invocation.

### 5. Resolution can be lazy

The JVM specification does not require every symbolic reference to be resolved eagerly when a class loads.

So a class can conceptually contain:
```text
Method A → resolved
Method B → unresolved
Class X  → unresolved
Field Y  → resolved
```

until execution actually needs them. ([Oracle Docs](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-5.html?utm_source=chatgpt.com))

This supports faster startup and avoids paying for unused code paths.

The trade-off is that some work can occur on first use.

### 6. Why this matters for the interpreter

Consider bytecode:
```text
aload_0
getfield      #12
invokevirtual #17
```

The interpreter processes JVM instructions, but instructions like:
```text
getfield #12
invokevirtual #17
```

need metadata associated with those constant-pool entries.

So the execution path becomes roughly:
```text
bytecode instruction
       │
       ▼
constant-pool reference
       │
       ▼
resolved runtime entity
       │
       ▼
perform operation
```

This is the bridge between:
```text
portable bytecode
```

and:
```text
actual runtime classes, fields and methods
```

### 7. Why the JVM does not expose layout assumptions

The JDK 25 specification explicitly notes that JVM instructions do not depend on the concrete runtime layout of classes, objects, or arrays; instead, they use symbolic information in the constant pool. ([Oracle Docs](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-4.html?utm_source=chatgpt.com))

That distinction is fundamental.

Your `.class` file can say:
```text
Customer.balance
```

without knowing:
```text
balance is physically at byte offset 24
```

HotSpot decides the actual layout later.

This preserves portability across:
```text
different JVM implementations
different architectures
different runtime configurations
```

### Production implications

Normally you never inspect the constant pool directly, but it becomes useful when diagnosing:

- `NoSuchMethodError`
- `NoSuchFieldError`
- `ClassNotFoundException`
- `NoClassDefFoundError`
- class-loader conflicts
- binary incompatibility between library versions

For example:
```text
compiled against:
Library.foo()

runtime library:
foo() no longer exists
```

The symbolic reference exists in bytecode, but resolution fails at runtime:
```text
Methodref
   ↓
resolution
   ↓
NoSuchMethodError
```

This is why some dependency incompatibilities compile successfully yet fail only after deployment.

### Mental model update

We now have:
```text
.java
  ↓
javac
  ↓
.class
├── bytecode
└── constant pool
       │
       ▼
class loading
       │
       ▼
runtime constant pool
       │
       ▼
symbolic resolution
       │
       ▼
runtime classes / methods / fields
```

This completes an important bridge:
```text
source code
→ bytecode
→ runtime metadata
```

The next question is now unavoidable:

> How does HotSpot actually execute those bytecode instructions before they become optimized native code?

**Next byte:** JVM stack frames and the operand stack — why JVM bytecode is stack-based, how local variables and operands are represented, and how the interpreter executes a method instruction by instruction.