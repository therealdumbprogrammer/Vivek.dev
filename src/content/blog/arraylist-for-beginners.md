---
title: "ArrayList for Beginners"
description: "ArrayList belongs to the List hierarchy in Java Collection framework."
publishDate: 2023-04-08
tags:
  - java
draft: false
---

> If you like this article, please give me a thumbs up. Here’s the complete video [https://youtu.be/b3WKatSm6lA](https://youtu.be/b3WKatSm6lA)

> ArrayList is an ordered collection which is internally implemented by Array.

Although backed by array which is a fixed-size data structure, ArrayList is dynamically sized meaning it can be resized.

**Creating a new ArrayList**

```java
ArrayList<String> l = new ArrayList<>();

//adding elements to the list
l1.add("Item1"); //index 0
l1.add("Item2"); //index 1
l1.add("Item3"); //index 2
l1.add("Item4"); //index 3

//getting elements from the list by passing the index to get method
System.out.println(l1.get(0));
System.out.println(l1.get(1));
System.out.println(l1.get(2));
System.out.println(l1.get(3));
```

We can also set elements by index.

```java
//this will set/update element at index 1 to 21
nums.set(1, 21);
```

**Adding elements to ArrayList in Bulk/Batch**

```java
private static void addingElementsFromAnotherCollection(ArrayList<String> l1) {
      //creating a new collection
      ArrayList<String> l2 = new ArrayList<>();
      l2.add("Item5");
      l2.add("Item6");

      //Use addAll method to add values from collection l2 to l1 in bulk
      l1.addAll(l2);

      System.out.println(l1);
 }
```

**Accessing elements using Iterator and for-each**

```java
private static void usingForEach(ArrayList<String> l1) {
    System.out.println("for-each==============");
    for (String element : l1) {
        System.out.println(element);
    }
}

private static void usingIterator(ArrayList<String> l1) {
    System.out.println("Iterator===========");
    Iterator<String> it = l1.iterator();
    while(it.hasNext()) {
        System.out.println(it.next());
    }
}
```

**Finding elements**

```java
String toCheck = "Item4";
//returns true if list contains Item4 otherwise returns false
System.out.println(l1.contains(toCheck)); 

//indexOf returns index of first occurrence
//lastIndexOf returns index of first occurrence from the end
System.out.println(l1.indexOf("Item6") + ", " + l1.lastIndexOf("Item6"));
```

**Size related methods**

```java
l.size(); //returns size of the arrayList

//returns true if List is empty
l.isEmpty();

l.clear(); //clears the list, removes all elements from the list
```

**Removing elements from the List**

```java
private static void removeAndRetain(ArrayList<String> l1) {
    l1.add("Item1");
    l1.add("Item2");
    l1.add("Item3");
    l1.add("Item4");
    l1.add("Item5");
    System.out.println(l1);

    //remove Item3 from the list
    l1.remove("Item3");
    System.out.println(l1);

    //remove element at index 1
    l1.remove(1);
    System.out.println(l1);

    
    ArrayList<String> tobeDeleted = new ArrayList<>();
    tobeDeleted.add("Item4");
    tobeDeleted.add("Item5");

    //remove Item4 and Intem5 from l1 in a single pass
    l1.removeAll(tobeDeleted);
    System.out.println(l1);

    ArrayList<Integer> nums = new ArrayList<>();
    nums.add(1);
    nums.add(2);
    nums.add(3);
    nums.add(4);
    
    //internally iterates the list elements and applies passed predicate to 
    //each element.
    //All matching elements will be removed from the list
    nums.removeIf(integer -> integer % 2 == 0);

    System.out.println(nums);

    ArrayList<Integer> nums1 = new ArrayList<>();
    nums1.add(5);
    nums1.add(6);
    nums1.add(7);
    nums1.add(8);

    ArrayList<Integer> keepThese = new ArrayList<>();
    keepThese.add(6);
    keepThese.add(7);
    
    //Opposite of removeAll
    //All elements in nums1 which are not part of passed collection
    //will be removed.
    nums1.retainAll(keepThese);
    System.out.println(nums1);

}
```

**Converting an ArrayList to Array**

```java
ArrayList<Integer> nums = new ArrayList<>();
nums.add(1); //0
nums.add(2); //1
nums.add(3); //2
nums.add(4); //3

Object[] arr = nums.toArray(); //returns an object array

//An explicit cast is required to convert object[]
Integer[] arr = (Integer[]) nums.toArray();

//This doesn't need an explicit cast
//this version can infer the type from array type passed to toArray(..)
Integer[] arr = nums.toArray(new Integer[0]);
```

**Performing an action on each element**

```java
//passed consumer will be applied to all elements
l1.forEach(s -> System.out.println(s.toUpperCase()));
```
