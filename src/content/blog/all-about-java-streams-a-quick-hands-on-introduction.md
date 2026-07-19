---
title: "All about Java Streams — a quick hands-on introduction"
description: "Java 8 added great features to the Java language. Out of them, two stand out — Lambdas and Streams."
publishDate: 2023-03-14
tags:
  - java
draft: false
---

> Java 8 added great features to the Java language. Out of them, two stand out — Lambdas and Streams.

> You can find all the video links [here](https://youtube.com/playlist?list=PLpxcSt9FGVVGl_IwSP1o4AmSrQc6z4SFt). This is a very detailed and hands-on playlist.

### What is a Stream?

> See [this](https://youtu.be/OhTkD2ZucuQ) where I explain this in details.

In simple words — a stream is simply **a sequence** of **optionally ordered** values.

### That’s it! What else?

Oh yes, before I forget — Stream doesn’t store the data, their purpose is to process the data with the help of pipelines that a programmer would write/set.

And, Streams are lazy that means pipeline is not executed until we call a terminal operation.

### What do you mean by pipeline?

> You can see a small demo [here](https://youtu.be/Zxi6UrUb4pc)

Streams follow a declarative syntax, similar to a SQL query which is close to the problem statement. You write what to do rather than how to do it.

Additionally, we can chain multiple operations where each method represents a step, and this whole code is called a stream pipeline. See the example below and I’m sure you will appreciate the simplicity and clarity if you compare this with traditional Java code.

```java
int sum = widgets.stream()
             .filter(w -> w.getColor() ==RED)
             .mapToInt(w -> w.getWeight())
             .sum();
```

### Stream Operations

Stream supports many methods. On a very high level, they can be categorized as below.

![](https://cdn-images-1.medium.com/max/800/1*jTRiq-3Wn1RToJ2CEdJlXA.png)

### Creating a Stream

> See the demo here — [part1](https://youtu.be/a8CV9UU4OIg) and [part2](https://youtu.be/goO5LlKzD1c)

There are many ways to generate a Stream. We’ll be focusing on important ones.

### Via Static factory methods, Stream.of(..) variants

```java
// 1. static factory methods
System.out.println("Stream factory methods---------");

//Creating a stream of single element i.e. Hello
Stream.of("Hello").forEach(System.out::println);

System.out.println("------------------------");

//Creating a stream of multiple elemtns
Stream.of("Apple", "Banana", "Grapes").forEach(System.out::println);

System.out.println("------------------------");

//When source is null
Stream.ofNullable(null).forEach(System.out::println);

System.out.println("------------------------");
```

### From Arrays using Arrays.stream(..) method

```java
// 2. From Arrays
System.out.println("From arrays--------------------");
String[] names = {"Mike", "John", "Tom"};
Arrays.stream(names).forEach(System.out::println);
```

### From collections using stream() method

Most of the collections have a stream() method that can be used to create a new stream.

```java
// 3. From Collection
System.out.println("From collections---------------");

List<String> languages = List.of("Java", "Python");
languages.stream().forEach(System.out::println); //by calling stream()
```

### From Files

IO API has been enhanced to return streams. Here’s an example, where we’re reading a file using Stream.

```java
// 4. Files
System.out.println("From Files---------------------");
Files.readAllLines(Paths.get("src\\dummy.txt"))
     .stream()
     .forEach(System.out::println);
```

### Using map() and flatMap()

> See this [demo](https://youtu.be/ExjEQvg3U3A) to understand how to use these methods.

**map()** is used to transform an object or value. For instance, transform a stream of Movie objects to a stream of movie titles.

**flatMap()** is used when the value/object we’re trying to transform is itself a collection/array so we need to flatten the object first in order to get the individual items from that collection/array.

```java
public class StreamDemo {
    static List<Movie> MOVIES = List.of(
            new Movie(2, "LOTR", "Peter Jackson", "Aragorn", 10, 2000, new String[]{"Sam", "Frodo", "Gandalf"}),
            new Movie(3, "Matrix", "Wachowski", "Neo", 10, 2000, new String[]{"Trinity", "Agent", "Oracle"}),
            new Movie(1, "The Dark Knight", "Nolan", "Batman", 10, 2008, new String[]{"Joker", "Mr. Fox"})
    );
    public static void main(String[] args) {
        MOVIES.stream()
                .map(Movie::rating)
                .forEach(System.out::println);

        MOVIES.stream()
                .flatMap(movie -> Arrays.stream(movie.sideCharacters()))
                .forEach(System.out::println);

    }

    record Movie(int id, String title, String director, String character, int rating, int releaseYear, String[] sideCharacters) {    }
}
```

### Using filter()

> See the filter [demo](https://youtu.be/nUwtckjrLBk)

Filters are used to apply a predicate to filter the records.

```java
MOVIES.stream()
   .filter(movie -> movie.releaseYear() > 2000)
   .forEach(System.out::println);
```

### Using peek() to debug

> See the peek [demo](https://youtu.be/1BBUpDfEXms)

Just like print statements but for Streams.

```java
MOVIES.stream()
      .peek(movie -> {
          System.out.println("Before Filter:: "+movie);
      })
      .filter(movie -> movie.releaseYear() > 2000)
      .peek(movie -> {
          System.out.println("After Filter:: "+movie);
      })
      .forEach(System.out::println);
```

### Using limit() and skip()

> See the demo [here](https://youtu.be/lmT5G8I8Ei8)

**limit()** is used to truncate the Stream while **skip()** can be used to skip/jump stream by n elements.

```java
public class StreamDemo {
    static List<Movie> MOVIES = List.of(
            new Movie(2, "LOTR", "Peter Jackson", "Aragorn", 10, 2000, new String[]{"Sam", "Frodo", "Gandalf"}),
            new Movie(3, "Matrix", "Wachowski", "Neo", 10, 2000, new String[]{"Trinity", "Agent", "Oracle"}),
            new Movie(1, "The Dark Knight", "Nolan", "Batman", 10, 2008, new String[]{"Joker", "Mr. Fox"})
    );
    public static void main(String[] args) {
        MOVIES.stream()
                .limit(2) //will print first two but last movie in the list will be truncated
                .forEach(System.out::println);
        
        MOVIES.stream()
                .skip(2) //will print last movie with id 1
                .forEach(System.out::println);


    }

    record Movie(int id, String title, String director, String character, int rating, int releaseYear, String[] sideCharacters) {    }
}
```

### Using sorted()

> See the demo [here](https://youtu.be/-1MkEduVGJI)

**sorted()** is used to sort the stream elements.

```java
public class StreamDemo {
    static List<Movie> MOVIES = List.of(
            new Movie(2, "LOTR", "Peter Jackson", "Aragorn", 10, 2000, new String[]{"Sam", "Frodo", "Gandalf"}),
            new Movie(3, "Matrix", "Wachowski", "Neo", 10, 2000, new String[]{"Trinity", "Agent", "Oracle"}),
            new Movie(1, "The Dark Knight", "Nolan", "Batman", 10, 2008, new String[]{"Joker", "Mr. Fox"})
    );
    public static void main(String[] args) {
        MOVIES.stream()
                .sorted(Comparator.comparingInt(Movie::id)) //to sort on the basis of an int property i.e. movieID
                .forEach(System.out::println);

        MOVIES.stream()
                .sorted(Comparator.comparing(Movie::title)) //to sort on the basis of title, will apply natural ordering of String
                .forEach(System.out::println);


    }

    record Movie(int id, String title, String director, String character, int rating, int releaseYear, String[] sideCharacters) {    }
}
```

### Using distinct()

> See the demo [here](https://youtu.be/-1MkEduVGJI)

**distinct()** is used to process distinct elements by avoiding duplicates.

```java
public class StreamDemo {
    static List<Movie> MOVIES = List.of(
            new Movie(2, "LOTR", "Peter Jackson", "Aragorn", 10, 2000, new String[]{"Sam", "Frodo", "Gandalf"}),
            new Movie(3, "Matrix", "Wachowski", "Neo", 10, 2000, new String[]{"Trinity", "Agent", "Oracle"}),
            new Movie(1, "The Dark Knight", "Nolan", "Batman", 10, 2008, new String[]{"Joker", "Mr. Fox"}),
            //added a duplicate movie
            new Movie(1, "The Dark Knight", "Nolan", "Batman", 10, 2008, new String[]{"Joker", "Mr. Fox"})
    );
    public static void main(String[] args) {
        MOVIES.stream()
                .distinct() //will use equals to compare objects via id
                .forEach(System.out::println);
    }

    //added equals and hashcode to do a comparison on id
    record Movie(int id, String title, String director, String character, int rating, int releaseYear, String[] sideCharacters) {
        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            Movie movie = (Movie) o;
            return id == movie.id;
        }

        @Override
        public int hashCode() {
            return Objects.hash(id);
        }
    }
}
```

### Using forEach() and forEachOrdered()

> See the demo [here](https://youtu.be/glPFYqj8SVI)

```java
public class StreamDemo {
    static List<Movie> MOVIES = List.of(
            new Movie(2, "LOTR", "Peter Jackson", "Aragorn", 10, 2000, new String[]{"Sam", "Frodo", "Gandalf"}),
            new Movie(3, "Matrix", "Wachowski", "Neo", 10, 2000, new String[]{"Trinity", "Agent", "Oracle"}),
            new Movie(1, "The Dark Knight", "Nolan", "Batman", 10, 2008, new String[]{"Joker", "Mr. Fox"})
    );
    public static void main(String[] args) {
        MOVIES.parallelStream()
                //order is not guaranteed in case of parallel stream
                .forEach(System.out::println); 
    }

    record Movie(int id, String title, String director, String character, int rating, int releaseYear, String[] sideCharacters) {    }
}

Output:
Movie[id=3, title=Matrix, director=Wachowski, character=Neo, rating=10, releaseYear=2000, sideCharacters=[Ljava.lang.String;@2ef1e4fa]
Movie[id=2, title=LOTR, director=Peter Jackson, character=Aragorn, rating=10, releaseYear=2000, sideCharacters=[Ljava.lang.String;@3b0971b2]
Movie[id=1, title=The Dark Knight, director=Nolan, character=Batman, rating=10, releaseYear=2008, sideCharacters=[Ljava.lang.String;@6b408627]
```

**forEachOrdered()** makes sure the order remains the same in case of parallel streams.

```java
MOVIES.parallelStream()
                .forEachOrdered(System.out::println);
```

### Using findFirst() and findAny()

> See the demo [here](https://youtu.be/VFYEz6otWhw)

Depending on the filter applied, find*() methods try to find the matching element in the Stream.

```java
public class StreamDemo {
    static List<Movie> MOVIES = List.of(
            new Movie(2, "LOTR", "Peter Jackson", "Aragorn", 10, 2000, new String[]{"Sam", "Frodo", "Gandalf"}),
            new Movie(3, "Matrix", "Wachowski", "Neo", 9, 2000, new String[]{"Trinity", "Agent", "Oracle"}),
            new Movie(1, "The Dark Knight", "Nolan", "Batman", 10, 2008, new String[]{"Joker", "Mr. Fox"})
    );
    public static void main(String[] args) {
        Optional<Movie> m1 = MOVIES.stream()
                .filter(movie -> movie.releaseYear() == 2000)
                .findAny();

        m1.ifPresent(System.out::println);
        System.out.println("---------------------");

        Optional<Movie> m2 = MOVIES.stream()
                .filter(movie -> movie.releaseYear() == 2000)
                .findFirst();
        m2.ifPresent(System.out::println);

        System.out.println("========================================");

        Optional<Movie> pm1 = MOVIES.parallelStream()
                .filter(movie -> movie.releaseYear() == 2000)
                .findAny();

        pm1.ifPresent(System.out::println);
        System.out.println("---------------------");

        Optional<Movie> pm2 = MOVIES.parallelStream()
                .filter(movie -> movie.releaseYear() == 2000)
                .findFirst();
        pm2.ifPresent(System.out::println);
    }

    record Movie(int id, String title, String director, String character, int rating, int releaseYear, String[] sideCharacters){    }
}
```

### Using allMatch(), anyMatch(), and noneMatch()

> See the demo [here](https://youtu.be/VFYEz6otWhw)

```java
public class StreamDemo {
    static List<Movie> MOVIES = List.of(
            new Movie(2, "LOTR", "Peter Jackson", "Aragorn", 10, 2000, new String[]{"Sam", "Frodo", "Gandalf"}),
            new Movie(3, "Matrix", "Wachowski", "Neo", 9, 2000, new String[]{"Trinity", "Agent", "Oracle"}),
            new Movie(1, "The Dark Knight", "Nolan", "Batman", 10, 2008, new String[]{"Joker", "Mr. Fox"})
    );
    public static void main(String[] args) {
        //allMatch, noneMatch, anyMatch

        boolean result1 = MOVIES.stream()
                .allMatch(movie -> movie.rating() == 10);

        boolean result2 = MOVIES.stream()
                .anyMatch(movie -> movie.rating() == 10);

        boolean result3 = MOVIES.stream()
                .noneMatch(movie -> movie.rating() == 8);
                
    }

    record Movie(int id, String title, String director, String character, int rating, int releaseYear, String[] sideCharacters){    }
}
```

### Using takeWhile() and dropWhile()

> See the demo [here](https://youtu.be/8ggutKblxtM)

They make a Stream more like a “stream” where take/drop the elements while a condition is true.

```java
public class StreamDemo {
    static List<Movie> MOVIES = List.of(
            new Movie(2, "LOTR", "Peter Jackson", "Aragorn", 10, 2000, new String[]{"Sam", "Frodo", "Gandalf"}),
            new Movie(3, "Matrix", "Wachowski", "Neo", 9, 2000, new String[]{"Trinity", "Agent", "Oracle"}),
            new Movie(1, "The Dark Knight", "Nolan", "Batman", 10, 2008, new String[]{"Joker", "Mr. Fox"})
    );
    public static void main(String[] args) {
        MOVIES.stream()
                .takeWhile(movie -> movie.rating() == 10)
                .forEach(System.out::println);
        System.out.println("-----------------------");
        MOVIES.stream()
                .dropWhile(movie -> movie.rating() == 10)
                .forEach(System.out::println);

    }

    record Movie(int id, String title, String director, String character, int rating, int releaseYear, String[] sideCharacters){    }
}
```

### Using joining()

> See the demo [here](https://youtu.be/aca_dr0ZhXI)

```java
public static void main(String[] args) {

     String titles = MOVIES.stream()
              .filter(movie -> movie.rating() == 10)
              .map(Movie::title)
              .collect(Collectors.joining(", "));
    
      System.out.println(titles);

    }

Output:
LOTR, The Dark Knight
```

### Using Collectors.filtering() and Collectors.mapping()

> See the demo [here](https://youtu.be/IEHFtt_8row)

```java
String titles = MOVIES.stream()
            //.filter(movie -> movie.rating() == 10)
            //.map(Movie::title)
            .collect(
                Collectors.filtering(movie -> movie.rating() == 10, 
                                 Collectors.mapping(Movie::title, 
                                    Collectors.joining(", "))
                            ));

         System.out.println(titles);
```

### Using toList(), toSet(), toCollection()

> See the demo [here](https://youtu.be/CelzTHhyBnk)

```java
List<String> titles = MOVIES.stream()
            .filter(movie -> movie.rating() == 10)
            .map(Movie::title)
            .collect(Collectors.toList());

Set<String> titlesSet = MOVIES.stream()
      .filter(movie -> movie.rating() == 10)
      .map(Movie::title)
      .collect(Collectors.toSet());

ArrayList<String> titlesArrayList = MOVIES.stream()
      .filter(movie -> movie.rating() == 10)
      .map(Movie::title)
      .collect(Collectors.toCollection(ArrayList::new)); 
        //specifically asks to create an ArrayList
```

**Using toMap()**

> See the demo [here](https://youtu.be/SnJA4919nIk)

```java
//If keys are unique
Map<Integer, String> map = MOVIES.stream()
      .collect(Collectors.toMap(Movie::rating, Movie::title));

//If not, provide a merge function to merge two values with the same key
Map<Integer, String> map1 = MOVIES.stream()
      .collect(Collectors.toMap(Movie::rating, 
                                Movie::title, 
                                (s, s2) -> s.concat(", ").concat(s2)));
```

### Using flatMapping()

> See the demo [here](https://youtu.be/IEHFtt_8row)

```java
List<String> titles = MOVIES.stream()
                          //.flatMap(movie -> Arrays.stream(movie.sideCharacters()))
                          .collect(
                              Collectors.flatMapping(movie -> Arrays.stream(movie.sideCharacters()), 
                              Collectors.toList())
                           );

System.out.println(titles);
```

### Using Collectors.groupingBy()

> See the demo [here](https://youtu.be/HpzzZj1nsyg)

```java
Map<Integer, List<Movie>> byRating = MOVIES.stream()
        .collect(Collectors.groupingBy(Movie::rating));

System.out.println(byRating.getClass().getName());

Map<Integer, Set<Movie>> setByRating = MOVIES.stream()
        .collect(Collectors.groupingBy(Movie::rating, Collectors.toSet()));

System.out.println(setByRating.getClass().getName());

Map<Integer, Set<String>> titlesByRating = MOVIES.stream()
        .collect(Collectors.groupingBy(Movie::rating, Collectors.mapping(Movie::title, Collectors.toSet())));
System.out.println(titlesByRating.getClass().getName());

Map<Integer, Set<Movie>> linkedHashmapByRating = MOVIES.stream()
        .collect(Collectors.groupingBy(Movie::rating, LinkedHashMap::new, Collectors.toSet()));
System.out.println(linkedHashmapByRating.getClass().getName());
```

### Using Collectors.partitioningBy()

> See the demo [here](https://youtu.be/CnrWm1ZW_eQ)

```javascript
Map<Boolean, List<Movie>> moviesByRating = MOVIES.stream()
        .collect(Collectors.partitioningBy(movie -> movie.rating() == 10));

System.out.println(moviesByRating);

Map<Boolean, Set<Movie>> setmoviesByRating = MOVIES.stream()
        .collect(Collectors.partitioningBy(movie -> movie.rating() == 10, Collectors.toSet()));

System.out.println(setmoviesByRating);
```
