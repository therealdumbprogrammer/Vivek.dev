---
title: "Creating Immutable/Unmodifiable Sets in Java"
description: "Demo — https://youtu.be/cVn3zvqXeIA"
publishDate: 2023-04-12
tags:
  - java
draft: false
---

> Demo — [https://youtu.be/cVn3zvqXeIA](https://youtu.be/cVn3zvqXeIA)

```java
public class ImmutableSet {
    public static void main(String[] args) {
        //========== Method-1 ===========
        Set<String> immutableSet = Set.of("Value1", "Value2");

        //will contain only two elements
        System.out.println(immutableSet);

        /*
        Can't add or remove anything since Set is immutable.
        Doing so will throw UnsupportedOperationException
         */
        //immutableSet.add("Value3");
        //immutableSet.remove("Value1");


        //========== Method-2 ===========
        Set<String> sourceSet = new HashSet<>();
        sourceSet.add("E1");
        sourceSet.add("E2");

        /*
        Creates an immutable copy from another collection
         */
        Set<String> names = Set.copyOf(sourceSet);
        System.out.println(names);

        /*
        This won't make source immutable so we can still perform add and/or remove
        operations on the source collection.
        But these operations will have no impact on the immutable copy that we created.
         */
        sourceSet.add("E3");
        System.out.println(sourceSet);

        //this will still print two values E1 and E2
        System.out.println(names);
    }
}
```
