# Review notes for Daily JVM Byte #9

- Placed as JVM Foundations Lesson 9 after TLAB allocation because it asks whether the allocation needs to exist before following the real-allocation path.
- Kept escape analysis as compiler analysis and scalar replacement as one enabled optimization. `NoEscape` is an opportunity, not a guarantee of elimination.
- Corrected the common stack-allocation model: HotSpot C2 generally eliminates scalar-replaceable allocations and decomposes fields into values.
- Added the relationship with inlining, lock elimination, warmed-up allocation measurement, JMH caution, and a short deoptimization/materialization bridge.
- Refined the final decision tree so TLAB and outside-TLAB allocation are sibling paths inside real heap allocation; TLAB is not a separate generation before Eden.
- Primary references were checked against Oracle JDK 25 documentation, the OpenJDK escape-analysis status report, JDK 25 deoptimization sources, and OpenJDK JMH samples.
- The conversation reader returned the reviewed lesson through the final decision-tree section and then truncated mid-diagram. The implementation completes that ending from the user's explicit requirements and source byte; the retrieved review text is preserved verbatim in `reviewed-draft.md`.
- Examples are illustrative. No JVM performance experiment was run or claimed.
- Reader review added compact source/compiler-view examples for NoEscape, ArgEscape, and GlobalEscape, and rewrote the stack-allocation correction around the simpler distinction between moving an object and eliminating its container.
