---
title: "Java HashSet Cheat sheet"
description: "Demo — https://youtu.be/2tLxcaopKR4"
publishDate: 2023-04-12
tags:
  - java
draft: false
---

> Demo — [https://youtu.be/2tLxcaopKR4](https://youtu.be/2tLxcaopKR4)

```java
public class SetDemo {
    public static void main(String[] args) {
        //Initializing a new HashSet
        HashSet<String> mySet = new HashSet<>();

        //Adding values to set
        mySet.add("One");
        mySet.add("Two");
        mySet.add("Two");
        mySet.add("Three");

        //Printing set
        System.out.println(mySet);

        //Adding values in Bulk
        //Add values from myList to mySet maintaing unique constraints
        ArrayList<String> myList = new ArrayList<>();
        myList.add("Four");
        myList.add("Five");
        myList.add("Three");

        mySet.addAll(myList);
        System.out.println(mySet);

        //Accessing values using for-each loop
        System.out.println("=====for-each========");
        for(String element : mySet) {
            System.out.println(element);
        }

        //Accessing values using iterator
        System.out.println("=====Iterator========");
        Iterator<String> it = mySet.iterator();
        while(it.hasNext()) {
            System.out.println(it.next());
        }

        //Accessing values using forEach
        System.out.println("Using forEach and Consumer========");
        mySet.forEach(System.out::println);

        //Clearing
        //mySet.clear();

        //Check size
        System.out.println(mySet.size() + ", " + mySet.isEmpty());

        //Contains check -- constant time performance
        System.out.println(mySet.contains("Two"));

        //Removing elements
        mySet.remove("Three");
        System.out.println(mySet);

        //Retain elements
        ArrayList<String> keepThese = new ArrayList<>();
        keepThese.add("Four");
        keepThese.add("Two");

        mySet.retainAll(keepThese);
        System.out.println(mySet);

        //Converting set to Array
        Object[] arr = mySet.toArray();
        String[] strArray = mySet.toArray(new String[0]);

        //Using Stream
        List<String> fromSet = mySet.stream().collect(Collectors.toList());
        System.out.println(fromSet);

        //----------------------------------------------------------------
        //----------------- LinkedHashSet --------------------------------
        //----------------------------------------------------------------

        //Initializing LinkedHashSet
        System.out.println("=========LinkedHashSet==========");
        LinkedHashSet<String> lSet = new LinkedHashSet<>();

        lSet.add("One");
        lSet.add("Two");
        lSet.add("Four");
        lSet.add("Three");
        lSet.add("Three");

        System.out.println(lSet);

        for (String element : lSet) {
            System.out.println(element);
        }
    }


}
```
