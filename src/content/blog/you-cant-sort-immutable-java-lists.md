---
title: "You can’t sort Immutable Java Lists?"
description: "I was working on a sorting demo using Comparable and Comparator when I first noticed this."
publishDate: 2023-04-23
tags:
  - java
draft: false
---

So, if you create a new List by calling List.of(…) which returns an immutable list then you can’t sort this list in a straightforward manner.

Suppose, we have a list of integers.

```java
List<Integer> nums = List.of(1, 4, 2, 3);
```

And, if we try sorting this list via Collections.sort(..) or List.sort(..) then it throws an UnsupportedOperationExcecption.

```java
nums.sort(null);
//OR
Collections.sort(nums);

----------------------------------
Exception in thread "main" java.lang.UnsupportedOperationException
 at java.base/java.util.ImmutableCollections.uoe(ImmutableCollections.java:142)
 at java.base/java.util.ImmutableCollections$AbstractImmutableList.sort(ImmutableCollections.java:261)
 at java.base/java.util.Collections.sort(Collections.java:145)
 at SortingDemo.main(SortingDemo.java:13)
```

So, how can we sort such list. Well, streams can do that.

```java
List<Integer> sortedNums = nums.stream()
                                .sorted()
                                .collect(Collectors.toList());
```
