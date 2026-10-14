# Daily JVM Bytes 41–43: implementation review

## Editorial placement

- Lesson 41 `reading-hotspot-source`, order 410, follows Lesson 40.
- Lesson 42 `object-allocation-end-to-end`, order 420, follows Lesson 41.
- Lesson 43 `virtual-method-call-end-to-end`, order 430, follows Lesson 42.
- Lesson 44, one GC cycle end to end, remains a text-only preview.

The originating conversation reader exposed the complete Byte #41 and #42 wording but truncated Byte #43. The user's approved implementation brief and the originating review supplied the rest of Lesson 43's editorial scope. Byte #42's unrelated scheduled-task text was not used as course content.

## Verified example

OpenJDK `javac 25.0.2` compiled disposable `Order.java` and `PaymentDemo.java` examples. `javap -c -p Order` showed `new`, `dup`, `invokespecial`, `areturn` in `make`, and `Object.<init>` followed by `putfield quantity` in the constructor. `javap -c -p PaymentDemo` showed `invokeinterface` for `submit(PaymentDemo.Payment)`.

## Technical boundaries retained

- JDK 25 HotSpot sources are linked at `jdk-25+36` rather than a moving main branch.
- `new` creates a default-initialized object; `invokespecial` invokes `<init>` afterward.
- TLAB misses can refill or allocate outside the TLAB; a miss does not imply GC.
- Escape analysis can permit scalar replacement but does not guarantee allocation removal.
- An interface-typed `Payment` call compiles to `invokeinterface` in the demonstrated case; `invokevirtual` covers a class-method call.
- Compiled inline caches route calls; speculative inlining copies a target body into compiled caller code.
- A receiver guard mismatch can take a fallback or deoptimize; changing a class-hierarchy dependency is a separate invalidation path.
- Diagrams are conceptual and avoid fixed object-header, field-order, or call-profile claims.

## Local integration

The course's shared `getTracks()` ordering derives the overview, sidebar, and previous/next links from lesson metadata. All three lessons have `draft: true`; production builds exclude their routes and links. Each ends with the established collapsed source disclosure.
