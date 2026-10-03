# Daily JVM Byte #29 — GC ergonomics: heap sizing, headroom, and why bigger is not always better

Source: originating ChatGPT conversation. The available source preview is bounded; the reviewed draft and full technical requirements in the current request are the conversion basis. No source date was supplied.

Original opening preserved from the source preview:

> We now understand the major JDK 25 collector architectures. The next question is operational: how much heap should the JVM have?
>
> -Xms → initial heap size
> -Xmx → maximum heap size
>
> But heap sizing is not simply: more heap = better.

Reviewed decisions: distinguish maximum capacity, committed heap, occupancy, and live set; connect G1 and ZGC headroom to their mechanisms; account for whole-process memory; bridge to GC logs.
