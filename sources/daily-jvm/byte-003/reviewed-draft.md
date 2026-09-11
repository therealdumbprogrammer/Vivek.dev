Yes. For Lesson 3 I would make the **visual model the primary teaching mechanism** and let the prose explain each diagram. This topic is particularly suited to that approach.

One technical adjustment is important for a JDK 25 course: the familiar HotSpot layout is typically **12-byte header = 8-byte mark word + 4-byte compressed class pointer**, but JDK 25 also provides **Compact Object Headers**, which can reduce the header to 8 bytes. It is a product feature in JDK 25 but remains disabled by default. citeturn706497search0turn706497search3

I would structure Lesson 3 around roughly **six illustrations**:

1. Heap → zoom into one object
2. Object anatomy: header + fields + padding
3. Klass pointer → class metadata
4. Alignment: raw 21 bytes → actual 24 bytes
5. Reference field vs referenced object
6. One object × millions of instances → aggregate cost

## Draft — Lesson 3: Object layout inside the heap

```markdown
---
title: Object layout inside the heap
summary: See what a Java object actually contains in memory, why its fields do not determine its full size, and where headers, references, and alignment fit.
course: jvm
lessonSlug: object-layout
module: Foundations
order: 30
sourceByte: byte-003
draft: false
prerequisites:
  - memory
jdk: HotSpot · object layout
---

In the previous lesson, we zoomed out and looked at the memory consumed by the entire JVM process.

Now let's move in the opposite direction.

All the way down to **one Java object inside the heap**.

Suppose we create:

```java
User user = new User();
```

At the Java level, we naturally think about the fields declared by `User`.

But the JVM needs more than those fields.

The key idea for this lesson is:

```text
Java fields ≠ total object size
```

A heap object contains both **your application data** and information HotSpot needs to manage that object.

<figure>
<a href="/images/courses/jvm/object-zoom.svg" aria-label="Open object layout overview">
<img src="/images/courses/jvm/object-zoom.svg"
     alt="The Java heap contains many objects. Zooming into one object reveals an object header, instance fields, and alignment padding."
     width="720" height="440" />
</a>
<figcaption>Zooming from the heap into a single object reveals more than its Java fields.</figcaption>
</figure>

At a high level:

```text
Java object
│
├── Object header
│
├── Instance fields
│
└── Alignment padding
```

Let's unpack those pieces.

## Start with the object header

Consider:

```java
class User {
    int id;
    boolean active;
    Object ref;
}
```

A simplified HotSpot layout might look like:

```text
┌──────────────────────────┐
│      Object Header       │
├──────────────────────────┤
│ id                       │
├──────────────────────────┤
│ ref                      │
├──────────────────────────┤
│ active                   │
├──────────────────────────┤
│ padding                  │
└──────────────────────────┘
```

The header exists even if your class declares no fields at all.

Why?

Because HotSpot needs runtime information about every object.

With the conventional 64-bit HotSpot layout and compressed class pointers, the header is commonly:

```text
Object header
├── Mark Word      8 bytes
└── Klass pointer  4 bytes
                   ────────
                   12 bytes
```

So before storing even one field, the object may already carry around 12 bytes of runtime information.

> These numbers depend on the JVM configuration and object-header mode. We are using the common conventional HotSpot layout as our working model.

We'll return to an important JDK 25 alternative—Compact Object Headers—shortly.

## The Mark Word carries per-object runtime state

The first part of the conventional object header is the **Mark Word**.

You can think of it as a compact place where HotSpot stores runtime state associated with this particular object.

Conceptually:

```text
Object
│
└── Mark Word
    ├── locking state
    ├── identity-hash information
    └── GC/runtime state
```

The exact bit layout is an implementation detail and can vary with JVM version, runtime configuration, locking mode, and garbage collector.

We do not need those individual bits yet.

The important idea is simpler:

> Some information needed to manage an object lives directly beside the object's application data.

That means:

```java
class Empty {
}
```

does not mean:

```text
object size = 0 bytes
```

Even an object with no instance fields still needs an object header and alignment.

## The JVM must also know the object's class

Suppose HotSpot encounters this object:

```text
┌─────────────────────┐
│       ?????         │
│ id = 42             │
│ active = true       │
└─────────────────────┘
```

How does it know this is a `User` rather than a `Customer`, `Order`, or something else?

The object header contains information that allows HotSpot to reach the runtime representation of its class.

With the conventional layout, this is represented by the **Klass pointer**.

<figure>
<a href="/images/courses/jvm/klass-pointer.svg" aria-label="Open klass pointer diagram">
<img src="/images/courses/jvm/klass-pointer.svg"
     alt="A User heap object contains a class pointer that leads to HotSpot metadata describing the User class."
     width="720" height="420" />
</a>
<figcaption>The object identifies its class; the full class metadata is maintained separately.</figcaption>
</figure>

Conceptually:

```text
Java Heap                         Metaspace / class metadata

┌─────────────────┐
│ User object     │
│                 │
│ Mark Word       │
│ Klass pointer ──┼──────────────► User class metadata
│ id              │                 ├── methods
│ active          │                 ├── fields
│ ref             │                 ├── runtime information
└─────────────────┘                 └── other metadata
```

The entire description of `User` is therefore **not copied into every `User` object**.

Each object only needs enough information to identify its class representation.

On ordinary 64-bit HotSpot configurations, compressed class pointers are commonly used so this class reference can occupy less space than a native 64-bit pointer.

## Then come your fields

Now we reach the part of the object that comes from your class definition.

For example:

```java
class Person {
    int age;
    double salary;
    Address address;
}
```

Conceptually:

```text
Person object
│
├── Object header
│
├── age
│
├── salary
│
├── address reference
│
└── possible padding
```

Primitive fields contribute their value storage directly.

But notice something different about:

```java
Address address;
```

The `Address` object itself is **not embedded inside the `Person` object**.

The field contains a reference.

<figure>
<a href="/images/courses/jvm/reference-vs-object.svg" aria-label="Open reference layout diagram">
<img src="/images/courses/jvm/reference-vs-object.svg"
     alt="A Person object contains an address reference. That reference points to a separate Address object elsewhere in the heap."
     width="760" height="420" />
</a>
<figcaption>A reference field occupies space in Person; the referenced Address is another heap object.</figcaption>
</figure>

So:

```text
Person object
┌───────────────────┐
│ header            │
│ age               │
│ salary            │
│ address reference │───────┐
└───────────────────┘       │
                            ▼
                    ┌────────────────┐
                    │ Address object │
                    │ header         │
                    │ fields...      │
                    └────────────────┘
```

This introduces an important memory-analysis concept.

The **shallow size** of `Person` includes:

```text
Person header
+
Person primitive fields
+
the address reference slot
+
padding
```

It does **not** include the body of the `Address` object.

`Address` has its own header, fields, and padding.

Later, when we study heap dumps, object graphs, dominators, and retained size, this distinction will become extremely important.

For now, retain this:

```text
reference ≠ referenced object
```

## Why objects contain padding

If we simply added all the individual pieces together, we might get an awkward object size.

Suppose a hypothetical layout requires:

```text
Header       12 bytes
int           4 bytes
reference     4 bytes
boolean       1 byte
             ────────
raw size     21 bytes
```

Does HotSpot necessarily place the next object immediately at byte 22?

Usually not.

Objects are aligned in memory, commonly on **8-byte boundaries**.

<figure>
<a href="/images/courses/jvm/object-alignment.svg" aria-label="Open object alignment diagram">
<img src="/images/courses/jvm/object-alignment.svg"
     alt="An object whose header and fields require 21 bytes is padded to a 24-byte aligned object."
     width="720" height="400" />
</a>
<figcaption>Alignment can make the actual object larger than the sum of its meaningful contents.</figcaption>
</figure>

Our 21-byte object may therefore become:

```text
Header       12
int           4
reference     4
boolean       1
padding       3
             ──
total        24 bytes
```

Visually:

```text
0                                              24
│                                               │
▼                                               ▼

┌────────────┬──────┬─────┬───┬──────────────┐
│   Header   │ int  │ ref │ b │   padding    │
│  12 bytes  │  4   │  4  │ 1 │      3       │
└────────────┴──────┴─────┴───┴──────────────┘

                    24 bytes
```

This produces a slightly surprising result.

Suppose we add another small field:

```java
boolean verified;
```

If it fits into space that would otherwise have been padding, the aligned object size might remain unchanged.

Conceptually:

```text
Before

data                 padding
████████████████████░░░
                    24 bytes


After adding boolean

data                   pad
█████████████████████░░
                    24 bytes
```

So:

> Field size and object-size growth are not always one-to-one.

Sometimes another field increases the object's aligned size.

Sometimes it occupies space that was previously padding.

## Source field order is not the memory layout contract

Consider:

```java
class Example {
    byte a;
    long b;
    byte c;
}
```

It is tempting to assume HotSpot must store those fields exactly like this:

```text
a
b
c
```

But source declaration order is not a physical-layout guarantee.

HotSpot's field-layout machinery can arrange fields in ways that reduce unnecessary gaps while preserving Java semantics.

The exact algorithm is an implementation detail and can change.

So the safe mental model is:

```text
Java source

byte a;
long b;
byte c;

        │
        ▼

HotSpot chooses
an object layout

        │
        ▼

header + fields + padding
```

Do not calculate production object sizes simply by reading fields from top to bottom in the source file.

## Put the whole object together

Let's return to:

```java
class User {
    int id;
    boolean active;
    Object ref;
}
```

Under a typical conventional 64-bit HotSpot configuration with compressed references, a simplified layout could be:

```text
 OFFSET       CONTENT                    SIZE

   0     ┌────────────────────────┐
         │       Mark Word        │       8
   8     ├────────────────────────┤
         │     Klass pointer      │       4
  12     ├────────────────────────┤
         │          id            │       4
  16     ├────────────────────────┤
         │      ref pointer       │       4
  20     ├────────────────────────┤
         │        active          │       1
  21     ├────────────────────────┤
         │        padding         │       3
  24     └────────────────────────┘

         Total: 24 bytes
```

The Java fields themselves account for only:

```text
int        4
reference  4
boolean    1
           ─
           9 bytes
```

Yet the object occupies:

```text
24 bytes
```

That difference comes from:

```text
object header
+
alignment
```

This is the central lesson:

```text
Java fields ≠ object footprint
```

## A JDK 25 note: Compact Object Headers

There is one modern HotSpot detail worth knowing now.

JDK 25 includes **Compact Object Headers** as a supported HotSpot feature.

With the conventional layout we have used so far:

```text
Mark Word       8 bytes
Klass pointer   4 bytes
                ────────
Header         12 bytes
```

Compact Object Headers can instead encode the required information into a smaller header:

```text
Conventional header                Compact header

┌───────────────────────┐          ┌───────────────────────┐
│ Mark Word       8 B   │          │                       │
├───────────────────────┤          │ Compact Header  8 B   │
│ Klass pointer   4 B   │          │                       │
└───────────────────────┘          └───────────────────────┘

        12 B                                8 B
```

In JDK 25, Compact Object Headers are a product feature but are **not enabled by default**.

They can be enabled with:

```bash
-XX:+UseCompactObjectHeaders
```

We do not need their internal bit layout here.

The reason they matter to this lesson is more fundamental:

> Object layout is a HotSpot implementation choice, not a fixed property of the Java language.

Our diagrams therefore give us a useful working model, not a language-level promise.

## Why a few bytes can matter

For one `User` object, arguing over four or eight bytes would usually be pointless.

But JVM applications frequently contain enormous numbers of objects.

Suppose an object could be made:

```text
8 bytes smaller
```

and your live heap contains:

```text
100,000,000 instances
```

The difference is roughly:

```text
8 × 100,000,000

≈ 800 MB
```

<figure>
<a href="/images/courses/jvm/object-scale.svg" aria-label="Open object scale diagram">
<img src="/images/courses/jvm/object-scale.svg"
     alt="An eight-byte overhead appears tiny for one object but grows to roughly 800 megabytes across one hundred million objects."
     width="760" height="400" />
</a>
<figcaption>Object overhead becomes important through multiplication, not because one object is expensive.</figcaption>
</figure>

This is where object layout becomes operationally relevant:

```text
tiny overhead per object
          │
          ▼
millions of objects
          │
          ▼
large heap footprint
          │
          ▼
more allocation / larger live set
          │
          ▼
more work for memory management
```

Consider something like:

```java
List<Integer>
```

The list stores references, and integer values outside cases where objects are shared or cached may require separate `Integer` objects.

Those objects carry their own:

```text
header
+
value field
+
alignment
```

A primitive-oriented representation can therefore sometimes use substantially less memory—not because an `int` suddenly becomes smaller, but because it avoids layers of object and reference overhead.

## Object layout and object graphs answer different questions

We can now separate two ideas that are easy to mix together.

### Object layout

Answers:

```text
How much does this individual object cost?
```

For example:

```text
┌────────────────────┐
│ header             │
│ fields             │
│ reference slots    │
│ padding            │
└────────────────────┘

        24 bytes
```

### Object graph

Answers:

```text
What other objects does this object connect to?
```

For example:

```text
┌──────────┐       ┌──────────┐       ┌──────────┐
│ Person A │──────►│ Address B│──────►│ String C │
└──────────┘       └──────────┘       └──────────┘
```

Together:

```text
OBJECT LAYOUT
How much does each node cost?

          +

OBJECT GRAPH
How are the nodes connected?

          │
          ▼

How does the heap behave?
```

That combination is where our GC story begins.

Garbage collection does not simply ask:

```text
How large is this object?
```

It needs to answer:

```text
Which objects are still reachable?
```

And answering that requires understanding the graph formed by all those references.

The next lesson therefore moves from the **inside of one object** to the **connections between objects**:

**References, reachability, GC roots, and why garbage collection is fundamentally a graph problem.**
```

### One change from the original Byte I consider important

I deliberately separated:

```text
shallow size
```

from:

```text
reachable graph / retained size
```

rather than implying they are just two opposite measurements. **Retained size has a more specific meaning**: roughly, the memory that would become collectible if a particular object were no longer retained. We'll introduce that properly with object graphs/dominators rather than muddying Lesson 3.

The illustration density here is also intentional. Lesson 3 should feel almost like **walking through object memory visually**, with the prose supporting the pictures rather than the diagrams merely decorating the text.

I’d review this version once, then hand exactly this direction to Work to build the lesson and SVG illustrations.
