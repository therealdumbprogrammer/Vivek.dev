---
title: "Interview Question — Comparable vs Comparator"
description: "What is the difference between Comparable and Comparator? It’s a very popular entry/mid-level Java interview question, isn’t it?"
publishDate: 2023-04-23
tags:
  - java
draft: false
---

Candidates often start comparing interfaces based on their method signatures and how we implement and use them.

But, we generally miss the intent or use-cases of these interfaces.

Before we understand the differences, we need to understand what is the natural ordering?

## Natural Ordering

Let me ask you a question — if I don’t provide any extra information and give you a list of numbers or string values like names then how would you sort them?

You’d say numbers in ascending order and names in alphabetical order.

But why? You’d say it feels natural, isn’t it.?

Well, what’s what natural order is all about. We don’t need any extra information, we simply know how to sort them.

Now, consider I ask you to sort a list of students.

You’d probably say — how? By roll number, by name, by date of birth, or by their marks?

Here, we need extra information because Student doesn’t have a natural order.

## Comparable vs Comparator

> Using Comparable [https://www.youtube.com/watch?v=E0jkSl-QPEk&list=PLpxcSt9FGVVHp2QywnxaGNQGMErthxRfU&index=16](https://www.youtube.com/watch?v=E0jkSl-QPEk&list=PLpxcSt9FGVVHp2QywnxaGNQGMErthxRfU&index=16)

> Using Comparator [https://www.youtube.com/watch?v=SJFa9sldCCk&list=PLpxcSt9FGVVHp2QywnxaGNQGMErthxRfU&index=17](https://www.youtube.com/watch?v=SJFa9sldCCk&list=PLpxcSt9FGVVHp2QywnxaGNQGMErthxRfU&index=17)

Now, we come back to the question.

Everything is secondary but the main thing to remember about these interfaces is that if we’re defining the natural order of an entity/class then we use Comparable.

> Natural order == Comparable

What would be the natural order of a Student?

Finalizing the natural order of an entity depends on the requirement and use-case.

In case of Student class, if we decide it to be by roll number then we would implement Comparable interface and provide the logic to compare them by their roll numbers.

```java
class Student implements Comparable<Student> {
        private int rollNo;
        private String name;
        private LocalDate dob;

        Student(int rollNo, String name, LocalDate dob) {
            this.rollNo = rollNo;
            this.name = name;
            this.dob = dob;

        }

        @Override
        public String toString() {
            return "Student{" +
                    "rollNo=" + rollNo +
                    ", name='" + name + '\'' +
                    ", dob=" + dob +
                    '}';
        }

        @Override
        public int compareTo(Student o) {
            return this.rollNo - o.rollNo;
        }
    }
```

**Custom Sorting**

We chose roll number to be the natural order of Students. But, what if I want to sort them by their marks or age?

To apply custom sorting, we use Comparator interface.

Comparator has many utility methods that we can use to provide a custom sorting criteria.

Here’s an example to sort the students by their name.

```java
students.sort(Comparator.comparing(Student::getName));
```

Or, we can combine multiple attributes.

```java
//sort by name and date of birth
students.sort(Comparator.comparing(Student::getName).thenComparing(Student::getDob));
```

## Conclusion

Comparable is used to define the natural order of an entity.

Comparator is all about custom sorting.
