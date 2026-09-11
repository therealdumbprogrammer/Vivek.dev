and the 9th one



## Daily JVM Byte #9 — Escape analysis and scalar replacement

Yesterday we saw that ordinary allocation is often cheap because HotSpot allocates through TLABs. Today goes one step further:

> Sometimes the optimized machine code does not need to allocate the object at all.

The mechanism is **escape analysis**. HotSpot’s optimizing compiler analyzes how an object is used and whether it can be observed outside the current compilation scope. Oracle’s HotSpot documentation describes escape states such as `GlobalEscape`, `ArgEscape`, and `NoEscape`; scalar-replaceable `NoEscape` objects can have their allocation removed from generated code. [Oracle Docs](https://docs.oracle.com/javase/10/vm/java-hotspot-virtual-machine-performance-enhancements.htm?utm_source=chatgpt.com)

Consider:
```
int distance() {
    Point p = new Point(10, 20);
    return p.x() + p.y();
}
```

At source level:
```
new Point(...)
```

suggests:
```
allocate object
write x
write y
read x
read y
```

But if the JIT proves that `p` never escapes and its identity is irrelevant, the optimized representation can become conceptually:
```
x = 10
y = 20

return x + y
```

The `Point` object has effectively disappeared.

## Scalar replacement

This transformation is called **scalar replacement**.

Instead of representing:
```
Point
├── header
├── x
└── y
```

as a real heap object, HotSpot can treat its fields as independent scalar values:
```
x
y
```

Those values may then live in registers, stack slots, or be optimized away entirely.

So the important model is:
```
Java source object
      ↓
escape analysis
      ↓
does identity/allocation need to exist?
      ↓
        no
      ↓
scalar replacement
      ↓
no normal heap allocation
```

## Escape does not simply mean "returned"

A rough model:
```
NoEscape
    object remains confined enough
    for aggressive optimization

ArgEscape
    passed through calls but not globally exposed

GlobalEscape
    visible beyond the analyzed scope
```

Typical global escape examples include storing an object in:
```
static Object value;
```

or into an already-escaping object:
```
this.field = obj;
```

or otherwise making it externally observable.

But this is compiler analysis, not a simple Java-language rule. Inlining is especially important because it can expand the scope over which HotSpot can reason.

For example:
```
int calculate() {
    Point p = createPoint();
    return p.x();
}
```

might initially appear to involve an escaping object:
```
createPoint()
   ↓
returns Point
```

But if `createPoint()` is inlined:
```
calculate()
├── construct Point
├── read x
└── return
```

the optimizer may discover that the object does not really need to exist.

This is one reason **inlining and escape analysis reinforce each other**.

## Important correction: this is not stack allocation

A common explanation is:
```
"Escape analysis moves objects from heap to stack."
```

That is misleading for HotSpot.

Oracle explicitly documents that HotSpot does **not** generally replace non-escaping heap allocations with stack allocations. Instead, scalar-replaceable allocations can be eliminated from generated code. [Oracle Docs](https://docs.oracle.com/javase/10/vm/java-hotspot-virtual-machine-performance-enhancements.htm?utm_source=chatgpt.com)

So prefer this model:
```
Heap allocation
      ↓
eliminated
      ↓
fields become scalar values
```

rather than:
```
Heap object → stack object
```

## Lock elimination

Escape analysis also helps synchronization.

Suppose:
```
Object lock = new Object();

synchronized (lock) {
    doWork();
}
```

If HotSpot proves:
```
lock never escapes this execution scope
```

then no other thread can possibly contend on that monitor.

The synchronization may therefore be eliminated:
```
object allocation
+
monitor enter
+
monitor exit
        ↓
optimized away
```

Oracle’s documentation explicitly notes allocation elimination and lock elimination as consequences of escape analysis. [Oracle Docs](https://docs.oracle.com/javase/10/vm/java-hotspot-virtual-machine-performance-enhancements.htm?utm_source=chatgpt.com)

This connects object optimization directly to synchronization internals.

## Why this matters for allocation measurements

Consider a benchmark:
```
for (...) {
    new Point(i, i + 1);
}
```

Source code may appear to allocate millions of objects.

But after JIT compilation:
```
source-level allocations
        ≠
actual heap allocations
```

Some may disappear completely.

This is why microbenchmarks around object allocation are easy to get wrong. If the result is unused, HotSpot may optimize away far more than intended.

## Production implication

Escape analysis reduces:
```
heap allocation
GC pressure
memory traffic
locking overhead
```

But it depends on what the compiler can prove.

Two logically equivalent pieces of code can optimize differently because of:
```
inlining decisions
call structure
polymorphism
object identity usage
compiler visibility
```

So this is not an optimization you normally "program against" directly.

The practical rule is:
```
write clear object-oriented code
        ↓
allow HotSpot to optimize
        ↓
verify with profiling when performance matters
```

rather than manually avoiding every temporary object.

## Mental model update

We now have three allocation outcomes:
```
new SomeObject()
       │
       ▼
JIT analysis
       │
       ├── allocation eliminated
       │      └── scalar replacement
       │
       └── real allocation required
               │
               ▼
              TLAB
               │
               ▼
              Eden
               │
               ▼
               GC
```

That is an important shift in JVM thinking:

> Java source describes object semantics; HotSpot decides how much of that object representation must physically survive into machine code.

**Next byte:** class loading lifecycle — loading, linking, verification, preparation, resolution, initialization, and how a `.class` file becomes HotSpot runtime metadata.
