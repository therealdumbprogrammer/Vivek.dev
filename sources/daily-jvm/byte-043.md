Source: originating conversation, supplied Daily JVM Byte. Original wording truncated by the bounded conversation reader; the user-approved review and detailed implementation request supply the remaining editorial scope.

## Daily JVM Byte #43 — One virtual method call end to end

Yesterday we followed `new Order()` from bytecode to TLAB allocation. Today we follow another extremely common operation:
```
payment.process();
```

when `process()` is a **virtual method**.

The interesting part is that HotSpot can transform this from dynamic dispatch into a direct, inlined call—while still preserving Java's polymorphic semantics.

### 1. Why virtual dispatch exists

Consider:
```
interface Payment {
    void process();
}

class CardPayment implements Payment {
    public void process() { ... }
}

class UpiPayment implements Payment {
    public void process() { ... }
}

void checkout(Payment payment) {
    payment.process();
}
```

At compile time:
```
payment → Payment
```

But at runtime:
```
payment → CardPayment
```

or:
```
payment → UpiPayment
```

So the actual target cannot generally be determined from the declared type alone.

---

## 2. Bytecode preserves that dynamic behavior

For a normal virtual class method, bytecode uses `invokevirtual`; interface calls normally use `invokeinterface`.

For example:
```
order.calculateTotal();
```

may produce conceptually:
```
aload_1
invokevirtual Order.calculateTotal
```

The constant pool identifies the symbolic method being requested:
```
invokevirtual #17
        │
        ▼
ConstantPool
        │
        ▼
Order.calculateTotal()
```

But this still does not necessarily determine the final implementation.

Runtime dispatch must consider the receiver's actual class.

---

## 3. The receiver tells HotSpot which implementation to use

Suppose:
```
reference type: Payment
actual object:  CardPayment
```

Recall the object model:
```
CardPayment object
       │
       │ Klass information
       ▼
InstanceKlass(CardPayment)
```

HotSpot can use the receiver's class metadata to locate the appropriate implementation.

Conceptually:
```
payment
   │
   ▼
CardPayment object
   │
   ▼
CardPayment Klass
   │
   ▼
process()
```

For virtual methods, HotSpot maintains dispatch metadata including **vtables**.

A simplified vtable looks like:
```
Payment-related slot
        │
        ▼
CardPayment.process()
```

A subclass overriding the method supplies its implementation in the corresponding dispatch position.

Interface dispatch has related but distinct machinery; HotSpot also maintains interface-specific dispatch metadata such as itables.

---

## 4. Straight virtual dispatch still has a cost

A generic virtual call conceptually requires:
```
load receiver
      ↓
determine receiver class
      ↓
locate target
      ↓
jump to target
```

Compared with:
```
call knownMethod
```

there is additional indirection.

More importantly, dynamic dispatch creates a barrier to one of the JIT's most powerful optimizations:

> **Inlining**

If C2 does not know what `process()` means, it cannot easily merge the callee into the caller.

---

## 5. Runtime profiling changes the picture

Recall that HotSpot profiles executing code.

Suppose this call site executes one million times:
```
CardPayment     999,800
UpiPayment          200
```

The site is overwhelmingly **monomorphic** in practice.

HotSpot can reason:
```
Java semantics:
Payment may
