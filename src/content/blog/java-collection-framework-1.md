---
title: "Java Collection Framework — 1"
description: "We all know the importance of data structures, right? Data structures help in organizing, storing, and processing data."
publishDate: 2023-04-03
tags:
  - java
draft: false
---

There are many well-known data structures like —

> Array

> 2. Queue

> 3. Stack

> 4. Map

## **How do we store data?**

In any programming language, variables are probably the most basic way to store data either temporarily or long-term.

> In Java, we can use **primitive variables** to store or hold primitive values. To store objects, we use **reference variables.**

Let’s say we have to create and store an Employee object. To do that, we will do something like below:

```java
Employee emp = new Employee();
```

That’s fine to handle a single object.

But, what if we have to store 100 Employee objects?

You’d say — why not use Arrays? Well — yes, we can and we will use an array to store 100 Employee objects.

```java
Employee[] manyEmployees = new Employee[100];
```

> We just used **Array** which is one of oldest, fastest, and well-known data structures.

## But, do you see the problem?

Array is a fixed-size data structure, isn’t it? What if our code at runtime produced 101 employees? Would our array be able to store 101 employees?

You guessed it right — no, it won’t be able to automatically.

To do that, we’ll have to create a new bigger array and then copy all objects from the old array to the new array.

Now, you see the problem, right? It’s the overhead of creating bigger array and copying elements.

In such cases — what we need is a dynamic array that can do this automatically.

But, how do we do that? You’d say — we can implement a dynamic array ourselves.

## There’s more!

What if we need Stack or maybe a Queue? Well — implement few more classes from scratch, right?

**I hope you see the bigger problem now.**

It’s a common problem and developers across the world will be developing the same things on their own, reinventing the wheel again and again!

## Collections to the rescue

Java language designers saw this problem and they worked and developed various data structures which we can find in JDK.

Java Collection framework is a set of interfaces and classes which provides different ready-to-use data structures so that we don’t have to reinvent the wheel.

You need a list, you can find one in JDK API. You need a map, just use the Map from JDK API.

## Collection framework outline

![](https://cdn-images-1.medium.com/max/800/1*2EId7zgKUnQ2OcInhROk3Q.png)

Just a different way to show the same thing.

![](https://cdn-images-1.medium.com/max/800/1*4O7xO0L0b_mXqVyVsIKb7g.png)

It’s just a very high level overview of Java Collection Framework. There’s much more to cover.

If you liked the article, please give a thumbs-up and subscribe my YouTube channel where I will be uploading a new playlist on Collections [https://www.youtube.com/@therealdumbprogrammer/featured](https://www.youtube.com/@therealdumbprogrammer/featured)

Happy learning!
