Byte #12 is a strong transition into execution. I’d preserve the structure, but add three technical refinements:

- The **JVM frame is a specification-level execution model**. HotSpot interpreter frames map closely to it, but JIT-compiled machine-code frames can have a very different physical layout.
- Local-variable “slots” are not exactly Java variables. They are indexed JVM storage locations; historically, `long` and `double` occupy two consecutive local-variable slots.
- The operand stack is **per-frame**, not the thread’s whole call stack. The thread has a stack of frames; each frame has its own operand stack.

This chapter should be highly visual because the key concept is literally values moving through a stack.

## Draft — Lesson 12: Stack frames, local variables, and the operand stack

```markdown
---
title: Stack frames, local variables, and the operand stack
summary: See where a JVM method keeps its execution state, how bytecode moves values through local-variable slots and the operand stack, and how method calls build a thread's call stack.
course: jvm
lessonSlug: stack-frames-operand-stack
module: Foundations
order: 120
sourceByte: byte-012
draft: false
prerequisites:
  - constant-pool-symbolic-references
jdk: JVM execution model · stack frames
---

In the previous lesson, we reached bytecode such as:

```text
aload_0
getfield      #12
invokevirtual #17
```

We now understand what:

```text
#12
#17
```

mean.

They lead through the runtime constant pool to fields, methods, and classes known to the running JVM.

But another question remains:

```text
Where are the values being manipulated
while these instructions execute?
```

For example:

```text
aload_0
```

loads something.

Where does it load it **from**?

And where does it put it?

The answer introduces one of the most important parts of the JVM execution model:

> **Each method invocation executes inside its own JVM frame.**

Conceptually:

```text
Method invocation
       │
       ▼
┌───────────────────────────┐
│           Frame           │
│                           │
│  Local variable array     │
│                           │
│  Operand stack            │
│                           │
│  Runtime constant-pool    │
│  reference                │
└───────────────────────────┘
```

<figure>
<a href="/images/courses/jvm/jvm-frame-overview.svg" aria-label="Open the JVM frame overview">
<img src="/images/courses/jvm/jvm-frame-overview.svg"
     alt="A method invocation has a JVM frame containing a local variable array, an operand stack, and access to runtime constant-pool information."
     width="820" height="500" />
</a>
<figcaption>A frame holds the working state for one particular method invocation.</figcaption>
</figure>

When the method invocation finishes, normally or exceptionally, that invocation's frame is no longer needed.

Let's build the model from the inside out.

## Every invocation gets its own frame

Consider:

```java
int add(int a, int b) {
    int result = a + b;
    return result;
}
```

Suppose:

```java
add(10, 20);
```

is invoked.

The JVM execution model gives that invocation its own frame:

```text
add(10, 20)

      │
      ▼

┌──────────────────────────┐
│       add() frame        │
│                          │
│ locals                   │
│ operand stack            │
│ runtime metadata access  │
└──────────────────────────┘
```

Invoke the same method again:

```java
add(100, 200);
```

and that is a different invocation with different execution state:

```text
Invocation 1              Invocation 2

add(10,20)                add(100,200)

┌───────────────┐         ┌───────────────┐
│ frame         │         │ frame         │
│ a = 10        │         │ a = 100       │
│ b = 20        │         │ b = 200       │
└───────────────┘         └───────────────┘
```

The method definition is shared.

The invocation state is not.

## Local variables become indexed slots

Now look inside the frame.

For an instance method:

```java
int add(int a, int b) {
    int result = a + b;
    return result;
}
```

the local-variable array might conceptually look like:

```text
LOCAL VARIABLES

slot 0 ─► this
slot 1 ─► a
slot 2 ─► b
slot 3 ─► result
```

<figure>
<a href="/images/courses/jvm/local-variable-slots.svg" aria-label="Open local-variable slot diagram">
<img src="/images/courses/jvm/local-variable-slots.svg"
     alt="An instance method frame contains indexed local-variable slots: slot zero for this, then slots for parameters a and b and the local result."
     width="800" height="450" />
</a>
<figcaption>Bytecode works with indexed local-variable slots rather than Java source variable names.</figcaption>
</figure>

The source-level name:

```text
result
```

is not what bytecode uses to access the value.

Bytecode works with the slot number.

For example:

```text
iload_1
```

means approximately:

```text
load int from local slot 1
```

Similarly:

```text
istore_3
```

means:

```text
store int into local slot 3
```

And:

```text
aload_0
```

means:

```text
load reference from local slot 0
```

For a normal instance method:

```text
slot 0 = this
```

So `aload_0` commonly means:

```text
push this reference
```

onto the operand stack.

## Static methods do not have `this`

Now compare:

```java
static int add(int a, int b) {
    return a + b;
}
```

There is no receiver object.

So:

```text
STATIC METHOD

slot 0 ─► a
slot 1 ─► b
```

instead of:

```text
INSTANCE METHOD

slot 0 ─► this
slot 1 ─► a
slot 2 ─► b
```

This is why bytecode listings often make more sense once you know whether the method is static.

## Slots are JVM storage locations, not source variables

It is useful not to over-identify:

```text
slot
```

with:

```text
Java variable
```

The compiler can reuse slots when source variables have non-overlapping lifetimes.

Conceptually:

```java
void example() {

    {
        int first = 10;
        use(first);
    }

    {
        int second = 20;
        use(second);
    }
}
```

may not require separate permanent slots for:

```text
first
second
```

throughout the entire method.

The class file describes the execution storage requirements the bytecode actually needs.

Another JVM detail is that `long` and `double` values historically occupy two consecutive local-variable slots.

For our mental model, the important point is:

> Local-variable slots are part of the JVM execution representation, not a one-to-one mirror of source-code variable declarations.

## The operand stack is the method's temporary workspace

Now we reach the other major part of the frame.

Suppose the source says:

```java
int result = a + b;
```

A simplified bytecode sequence is:

```text
iload_1
iload_2
iadd
istore_3
```

At first, that can look surprisingly verbose.

Why not simply encode:

```text
add slot 1 + slot 2 → slot 3
```

?

Because JVM bytecode uses a **stack-based execution model**.

Each frame contains its own **operand stack**.

Let's execute the instructions one at a time.

### Start

```text
LOCALS

0 → this
1 → 10
2 → 20
3 → ?

OPERAND STACK

[]
```

### `iload_1`

Load the value from local slot 1 and push it onto the operand stack.

```text
LOCALS                       OPERAND STACK

1 → 10                       ┌────┐
2 → 20                       │ 10 │
                             └────┘
```

### `iload_2`

```text
OPERAND STACK

┌────┐
│ 20 │  ← top
├────┤
│ 10 │
└────┘
```

### `iadd`

`iadd` consumes two integer operands.

Conceptually:

```text
pop 20
pop 10
add
push 30
```

So:

```text
before iadd

┌────┐
│ 20 │
├────┤
│ 10 │
└────┘


after iadd

┌────┐
│ 30 │
└────┘
```

### `istore_3`

Now pop the result and store it into local slot 3.

```text
LOCALS

0 → this
1 → 10
2 → 20
3 → 30


OPERAND STACK

[]
```

<figure>
<a href="/images/courses/jvm/operand-stack-addition.svg" aria-label="Open operand stack addition walkthrough">
<img src="/images/courses/jvm/operand-stack-addition.svg"
     alt="The bytecode sequence iload_1, iload_2, iadd, istore_3 loads two local variables onto the operand stack, adds them, and stores the result back into a local slot."
     width="860" height="600" />
</a>
<figcaption>Bytecode instructions move values between local slots and the operand stack.</figcaption>
</figure>

This is the heart of the JVM's stack-oriented instruction model.

## Bytecode instructions usually consume and produce stack values

Once the operand stack makes sense, many instructions become easier to read.

For example:

```text
iconst_1
```

means roughly:

```text
push integer constant 1
```

```text
iadd
```

means:

```text
pop int
pop int
add
push int result
```

```text
getfield #12
```

conceptually needs:

```text
object reference
```

on the operand stack.

It consumes that reference and pushes the field value.

Suppose:

```java
customer.age
```

is being read.

The bytecode may conceptually behave like:

```text
aload_1

stack:
[customer]


getfield #12

stack:
[age]
```

So the operand stack connects directly to the constant-pool work we studied in Lesson 11.

```text
getfield #12
      │
      ├── #12 identifies which field
      │
      └── operand stack supplies
          which object
```

That is a useful separation:

```text
constant pool
    │
    └── WHAT field/method/type?


operand stack
    │
    └── WHICH runtime values?
```

## Method calls use the operand stack too

Consider:

```java
customer.updateName("Vivek");
```

Before an invocation instruction executes, the operand stack conceptually needs the receiver and arguments.

Something like:

```text
aload_1
ldc #23
invokevirtual #17
```

may produce:

```text
after aload_1

[customer]


after ldc

[customer, "Vivek"]


invokevirtual #17

consume receiver + argument
invoke method
```

If the called method returns a value, the returned value can become an operand in the caller's frame.

<figure>
<a href="/images/courses/jvm/invocation-operand-stack.svg" aria-label="Open method invocation operand-stack diagram">
<img src="/images/courses/jvm/invocation-operand-stack.svg"
     alt="A method invocation pushes the receiver and arguments onto the caller's operand stack. The invocation consumes them and a return value can later appear on the caller's operand stack."
     width="840" height="520" />
</a>
<figcaption>The operand stack also serves as part of the handoff between caller and callee.</figcaption>
</figure>

## Why is JVM bytecode stack-based?

Modern CPUs are register-based.

They operate with instructions more like:

```text
load register
add registers
store register
```

So why does the JVM use bytecode such as:

```text
iload
iload
iadd
istore
```

rather than designing bytecode directly around hardware registers?

Because JVM bytecode is not intended to be the final hardware instruction set.

It is a **portable intermediate representation**.

A stack-oriented representation has useful properties:

```text
compact instruction encoding
+
no dependency on a CPU's register count
+
portable execution semantics
+
structured operand typing
+
verification-friendly behavior
```

<figure>
<a href="/images/courses/jvm/stack-vs-register-ir.svg" aria-label="Open stack versus register instruction model">
<img src="/images/courses/jvm/stack-vs-register-ir.svg"
     alt="JVM stack bytecode uses load load add store operations over an operand stack, while a native register architecture may use register operands directly."
     width="820" height="470" />
</a>
<figcaption>Bytecode targets a virtual stack machine; the JIT later translates hot code into the register-oriented instruction set of the actual CPU.</figcaption>
</figure>

The trade-off is obvious.

The CPU ultimately wants something closer to:

```text
ADD register1, register2
```

not:

```text
push
push
pop
pop
push
```

But HotSpot has another stage for that.

```text
portable bytecode
      │
      ▼
interpreter
      │
      ▼
profiling
      │
      ▼
JIT compiler
      │
      ▼
native machine code
      │
      ▼
CPU registers
```

So JVM bytecode does not need to look like optimal machine code.

The JIT's job is to transform it.

## The class file already knows how much frame space is required

Does the JVM need to discover dynamically:

```text
Maybe this method needs
another operand-stack slot?
```

while executing the method?

No.

The method's class-file `Code` attribute includes values such as:

```text
max_locals
max_stack
```

For our `add()` example, conceptually:

```text
max_locals = 4
max_stack  = 2
```

Why two operand-stack entries?

Because the maximum point in:

```text
iload_1
iload_2
iadd
```

is:

```text
[a, b]
```

Two operands.

<figure>
<a href="/images/courses/jvm/max-stack-locals.svg" aria-label="Open max stack and locals diagram">
<img src="/images/courses/jvm/max-stack-locals.svg"
     alt="A method's Code attribute specifies maximum local-variable slots and maximum operand-stack depth, allowing execution storage requirements to be known before the method runs."
     width="820" height="470" />
</a>
<figcaption>The class file declares the maximum frame resources required by the bytecode.</figcaption>
</figure>

This is also connected to verification.

Malformed bytecode should not be able to say:

```text
max_stack = 2
```

and then unexpectedly execute a path requiring:

```text
stack depth = 500
```

The verifier checks that bytecode behavior is consistent with JVM constraints.

Again, our earlier lessons connect together.

## Calling another method creates another frame

Consider:

```java
void a() {
    b();
}

void b() {
    c();
}

void c() {
    work();
}
```

While `c()` is executing, the thread has several active method invocations.

Conceptually:

```text
THREAD JVM STACK

        top
         │
         ▼
┌────────────────────┐
│     c() frame      │  ← current
├────────────────────┤
│     b() frame      │
├────────────────────┤
│     a() frame      │
└────────────────────┘
```

<figure>
<a href="/images/courses/jvm/frame-call-stack.svg" aria-label="Open the method frame call-stack diagram">
<img src="/images/courses/jvm/frame-call-stack.svg"
     alt="A thread's logical JVM stack contains an a frame, then a b frame, then a c frame at the top while c is executing."
     width="760" height="500" />
</a>
<figcaption>Nested method invocations create nested frames for that thread.</figcaption>
</figure>

When `c()` returns:

```text
before

┌───────────┐
│ c()       │
├───────────┤
│ b()       │
├───────────┤
│ a()       │
└───────────┘


after c returns

┌───────────┐
│ b()       │  ← current
├───────────┤
│ a()       │
└───────────┘
```

The `c()` invocation is finished.

Its execution state is no longer required.

## Return values flow back to the caller

Suppose:

```java
int b() {
    return c();
}
```

and:

```java
int c() {
    return 42;
}
```

While `c()` runs, it has its own frame.

When it executes an integer return:

```text
ireturn
```

the value conceptually moves back into the caller's execution state.

```text
c() frame

operand stack
┌────┐
│ 42 │
└────┘

     │
   ireturn
     │
     ▼

c frame removed

b() frame resumes

operand stack
┌────┐
│ 42 │
└────┘
```

The exact runtime mechanics are implementation-specific, but this is the right JVM-level model.

## Stack traces are frame histories made visible

Consider:

```text
Exception in thread "main" ...

at Foo.c(Foo.java:30)
at Foo.b(Foo.java:20)
at Foo.a(Foo.java:10)
at Foo.main(Foo.java:5)
```

Conceptually, you are seeing the method-invocation chain:

```text
main
  │
  ▼
 a
  │
  ▼
 b
  │
  ▼
 c
```

or from the stack's current top:

```text
c()
b()
a()
main()
```

So the call stack we reason about during debugging comes directly from the runtime's nested invocation structure.

## Each thread has its own execution stack

Suppose two threads both invoke:

```java
process(customer);
```

Their execution state is separate.

```text
THREAD A                        THREAD B

┌──────────────────┐           ┌──────────────────┐
│ process() frame  │           │ process() frame  │
│ local slot 1     │           │ local slot 1     │
└──────────────────┘           └──────────────────┘
```

Thread B does not directly reach into Thread A's frame and modify:

```text
local slot 1
```

Frames are thread-confined execution state.

But this does **not** mean everything referenced by a frame is private.

Both frames might contain:

```text
local reference
       │
       ▼
same Customer object
```

<figure>
<a href="/images/courses/jvm/thread-frames-shared-heap.svg" aria-label="Open thread frames and shared heap diagram">
<img src="/images/courses/jvm/thread-frames-shared-heap.svg"
     alt="Two threads have separate method frames and local references, while both references point to the same shared Customer object in the heap."
     width="840" height="490" />
</a>
<figcaption>Execution state is thread-local, while heap objects referenced from that state may still be shared.</figcaption>
</figure>

This gives us a fundamental concurrency distinction:

```text
THREAD FRAME

local execution state
normally confined to thread


HEAP OBJECT

may be reachable
from many threads
```

Later, synchronization and data-race discussions will depend heavily on this distinction.

## Frames also connect execution to garbage collection

Return to our GC-root lesson.

Suppose a local slot contains:

```text
customer reference
```

Conceptually:

```text
Thread
  │
  ▼
Frame
  │
  └── local slot ─────────► Customer
```

If that reference is live at a point where GC inspects thread state, it may contribute to the root set.

So the garbage collector must understand:

```text
Which locations in this frame
currently represent object references?
```

It cannot simply treat every machine word as an object pointer.

This is where several JVM systems meet:

```text
method frames
      │
      ▼
reference locations
      │
      ▼
GC roots
      │
      ▼
reachability traversal
```

<figure>
<a href="/images/courses/jvm/frame-gc-root.svg" aria-label="Open the frame to GC-root connection">
<img src="/images/courses/jvm/frame-gc-root.svg"
     alt="A live object reference in a thread's method frame points to a Customer heap object and participates in GC root discovery."
     width="820" height="460" />
</a>
<figcaption>Frames are execution structures, but references held in them also matter to garbage collection.</figcaption>
</figure>

For interpreted code, HotSpot understands its interpreter frame representation.

For JIT-compiled code, the machine-code frame may look very different, so the JIT emits metadata that tells HotSpot where object references can be found at relevant points.

We previously introduced that idea as:

```text
OopMap intuition
```

Later, safepoints and compiled frames will make it concrete.

## JVM frames are a logical model

One distinction is worth making now before we go deeper into HotSpot internals.

The JVM specification describes things in terms of:

```text
frames
local variables
operand stacks
```

That defines the execution semantics.

But once C2 compiles a hot method, do not imagine that the CPU literally continues manipulating:

```text
JVM operand stack array
```

for every instruction.

The JIT can transform:

```text
iload_1
iload_2
iadd
```

into register-oriented machine code.

Conceptually:

```text
BYTECODE MODEL

locals
  │
  ▼
operand stack
  │
  ▼
iadd
```

may become:

```text
OPTIMIZED MACHINE CODE

CPU register
     +
CPU register
     │
     ▼
CPU instruction
```

<figure>
<a href="/images/courses/jvm/logical-vs-compiled-frame.svg" aria-label="Open logical JVM frame versus compiled execution">
<img src="/images/courses/jvm/logical-vs-compiled-frame.svg"
     alt="The JVM specification models execution with local-variable slots and an operand stack, while JIT-compiled code may represent the same values in machine registers and optimized stack locations."
     width="840" height="500" />
</a>
<figcaption>The frame and operand-stack model defines JVM semantics; opt