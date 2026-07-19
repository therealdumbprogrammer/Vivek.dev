---
title: "Java HashMap — Cheat sheet"
description: "Watch the video where I explain these operations https://youtu.be/vtjkyOaHSyw"
publishDate: 2023-04-17
tags:
  - java
draft: false
---

> Watch the video where I explain these operations [https://youtu.be/vtjkyOaHSyw](https://youtu.be/vtjkyOaHSyw)

```java
import java.util.HashMap;
import java.util.LinkedHashMap;

public class MapDemo {
    public static void main(String[] args) {
        //Initializing a new hashmap
        HashMap<Integer, String> intToStringMap = new HashMap<>();

        LinkedHashMap<String, String> map = new LinkedHashMap<>();
 
        //Adding a new entry
        System.out.println("====== Adding a new entry ======");
        intToStringMap.put(1, "One");
        intToStringMap.put(2, "Two");

        System.out.println(intToStringMap);

        //Getting a value by key
        System.out.println("====== Getting a value by key ======");
        System.out.println(intToStringMap.get(2));
        System.out.println(intToStringMap.get(3));

        //Getting default value
        System.out.println("====== Getting default value ======");
        System.out.println(intToStringMap.getOrDefault(3, "NA"));

        //Checking key in the map
        System.out.println("====== Checking key in the map ======");
        System.out.println(intToStringMap.containsKey(3) + ", " + intToStringMap.containsKey(2));

        //Checking value
        System.out.println("====== Checking value ======");
        System.out.println(intToStringMap.containsValue("One"));

        //Clearing hashmap
        System.out.println("====== Clearing hashmap ======");
        //intToStringMap.clear();

        //Checking size of hashmap + isEmpty
        System.out.println("====== Checking size of hashmap + isEmpty ======");
        System.out.println(intToStringMap.size() + ", " + intToStringMap.isEmpty());

        //compute
        System.out.println("====== compute ======");
        intToStringMap.compute(9, (integer, s) -> integer + "-" + s);
        System.out.println(intToStringMap);

        //computeIfAbsent
        System.out.println("====== computeIfAbsent ======");
        intToStringMap.computeIfAbsent(7, integer -> {
            return String.valueOf(integer);
        });
        System.out.println(intToStringMap);

        //computeIfPresent
        System.out.println("====== computeIfPresent ======");

        //Getting all entries
        System.out.println("====== Getting all entries ======");
        intToStringMap.entrySet().forEach(integerStringEntry -> System.out.println(integerStringEntry.getKey() + "==>" + integerStringEntry.getValue()));

        //Getting all keys
        System.out.println("====== Getting all keys ======");
        for(Integer key : intToStringMap.keySet()) {
            System.out.println(key);
        }

        //Getting all Values
        System.out.println("====== Getting all Values ======");
        intToStringMap.values().forEach(System.out::println);

        //forEach
        System.out.println("====== forEach ======");

        //merge
        System.out.println("====== merge ======");
        System.out.println(intToStringMap);
        intToStringMap.merge(2, "TWO", (s, s2) -> s.concat("-").concat(s2));
        System.out.println(intToStringMap);

        //putAll
        System.out.println("====== putAll ======");
        HashMap<Integer, String> target = new HashMap<>();
        target.put(5, "Five");
        target.put(6, "Six");

        intToStringMap.putAll(target);
        System.out.println(intToStringMap);

        //putIfAbsent
        System.out.println("====== putIfAbsent ======");
        intToStringMap.putIfAbsent(3, "Three");
        intToStringMap.putIfAbsent(2, "sdjfgjsdgf");
        System.out.println(intToStringMap);

        //remove
        System.out.println("====== remove ======");
        intToStringMap.put(3, "Three");
        intToStringMap.put(4, "Four");
        intToStringMap.put(4, "FOUR");
        System.out.println(intToStringMap);

        intToStringMap.remove(4);
        System.out.println(intToStringMap);

        intToStringMap.remove(3, "Three");
        System.out.println(intToStringMap);

        //replace, replaceAll
        System.out.println("====== replace, replaceAll ======");
        intToStringMap.replace(2, "TWO");
        System.out.println(intToStringMap);

        intToStringMap.replace(2, "TWO" , "Two");
        System.out.println(intToStringMap);

        intToStringMap.replaceAll((key, value) -> key % 2 == 0 ? value.concat("-Even") : value);
        System.out.println(intToStringMap);
    }
}
```
