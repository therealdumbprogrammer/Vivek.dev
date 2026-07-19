---
title: "When Lambdas get confused"
description: "Lambdas are smart — they can infer a lot of details from the context."
publishDate: 2023-03-05
tags:
  - engineering
draft: false
---

But, sometimes, they can’t. In such cases, a lambda needs more information from the programmer.

### Here’s one such case

Interested in details? Please watch this video — [https://youtu.be/JQX9JIKF5CQ](https://youtu.be/JQX9JIKF5CQ)

Consider we have two functional interfaces —

SumFunctionInterface → To perform the sum

MultiplyFunctionalInterface → To perform the multiplication

```java
public interface SumFunctionalInterface {
    int sum(int a, int b);
}

public interface MultiplyFunctionalInterface {
    int multiply(int a, int b);
}
```

Then, we have the Runner class which has two overloaded methods with name m1 — one accepts SumFunctionalInterface and another MultiplyFunctionalInterface

```java
public class Runner {

    public static void main(String[] args) {
        int sumResult = m1((x, y) -> x + y, 5, 6);
    }

    //Method 1
    private static int m1(SumFunctionalInterface iface, int x, int y) {
        return iface.sum(x, y);
    }

    //Method 2
    private static int m1(MultiplyFunctionalInterface iface, int x, int y) {
        return iface.multiply(x, y);
    }
}
```

Now, if we try to call m1 and pass it a lambda to do the summation(see above) then we’ll a compile time error because this time compiler is not able to figure out which version of m1 needs to be called here.

There’s a conflict — both functional interfaces have the same method signature and passed lambda is a match for both of them so it’s getting confused.

To fix that, we will have to provide additional information for the compiler. We can add an explicit cast which will resolve this ambiguity.

```typescript
public static void main(String[] args) {
    int sumResult = m1((SumFunctionalInterface) (x, y) -> x + y, 5, 6);
}
```

Want to learn more about Lambdas and Streams? Please visit my playlist [https://www.youtube.com/playlist?list=PLpxcSt9FGVVGl_IwSP1o4AmSrQc6z4SFt](https://www.youtube.com/playlist?list=PLpxcSt9FGVVGl_IwSP1o4AmSrQc6z4SFt)
