---
title: "Mastering Spring Data — A Step-by-Step Plan with free course Links"
description: "TL;DR"
publishDate: 2023-08-12
tags:
  - spring boot
draft: false
---

## TL;DR

If you’re unsure where to start, start from here:

[Watch the playlist on YouTube](https://www.youtube.com/playlist?list=PLpxcSt9FGVVGq9vFTFdFVhz9-OEsqvPaj)

Data is everywhere. Almost every application or system we design and develop has something to do with data.

It’s either generating new data sets OR ingesting data from some other system OR processing and transforming data so that some other application can do something based on what it consumes.

> In a nutshell — it’s all about the data.

On top of that, there are variety of data stores e.g. RDBMS, NoSQL, Caches, Distributed Caches, Time-series DBs and the list goes on….

Data management is so critical that it’s an essential skill for developers.

It’s important that we know how to write data to a database and read from the database.

And, it’s not a simple thing — consider available options like JDBC, JPA, Hibernate, Spring JDBC, Spring Data JPA, and so on. It can become messy and very confusing, especially for beginners.

So, in this step-by-step guide, we will see how you can start from the basics and master database connectivity in Java.

## Step-0 Learn JDBC Concepts

JDBC is a pretty low level API but it’s still the first thing you should familiarize yourself with. Since we don’t generally write raw JDBC code nowadays so you can avoid going into the deep from a beginner’s perspective. You can simply focus on the basics. Complete this free Oracle JDBC lesson to understand the building blocks of database connectivity in Java.

## Time to fly! Moving on to Spring Framework

Once you’re comfortable with JDBC, the next step is to pick Spring Framework.

> As of today, at the time of writing this article, you can’t succeed in your developer career if you don’t have hands-on experience on Spring Framework and related Spring projects.

And, this is mostly true as majority of enterprise applications are built on top of Spring stack.

If you simply visit the Spring homepage and explore Spring Data section, you’d see a long list of supported connectors and APIs.

![](https://cdn-images-1.medium.com/max/800/1*5AMAjug_MVfD3gDvXdOeHg.png)

Even if you can’t cover everything from the above list, couple of child projects which you should absolutely explore are:

1. Spring JDBC
2. Spring Data JPA
3. Spring Data for Cassandra

## Step-1 Spring Data JDBC

If you completed Step-0, you’d really appreciate Spring Data JDBC.

Spring Data JDBC is a wrapper around JDBC which simplifies JDBC connectivity. Spring JDBC is a perfect choice if you’re project is really simple and doesn’t really need complex ORM features.

You can start from here:

[Watch on YouTube](https://www.youtube.com/watch?v=zjYCOBynhY0?feature=oembed)

Then, move on to Spring Boot and learn how Spring Boot can further simplify Spring JDBC in a project.

[Watch on YouTube](https://www.youtube.com/watch?v=l35K3W_v3Vw?feature=oembed)

## Step-2 Spring Data JPA

Spring JDBC is all good but it really falls short when a project needs ORM features and has complex entity models and entity relationships.

Spring Data JPA uses Hibernate under the hood and simplifies entity mappings, data access with Repositories, pagination, filtering, etc.

Start from here:

[Watch on YouTube](https://www.youtube.com/watch?v=lyQsBU7E9Lo?feature=oembed)

Learn how to read data from the database using Data JPA.

[Watch on YouTube](https://www.youtube.com/watch?v=kx0eKDIsyx4?feature=oembed)

Next, understand how to implement Pagination and Sorting using Spring Data JPA.

[Watch on YouTube](https://www.youtube.com/watch?v=rous9SCn_MA?feature=oembed)

And, lastly how to perform search operation without writing much code using Spring code generation and Data repositories.

[Watch on YouTube](https://www.youtube.com/watch?v=z__lSUG-x_0?feature=oembed)

If you cover this much, you’d be pretty comfortable with JPA and can explore more features on your own e.g. native queries, caching, fetch plans, etc.

## Step-3 Spring Data Redis

Spring Data Redis is not needed for typical CRUD based applications. It has nothing to do with RDBMS data stores.

The main use-case of Redis is to use it as a high performance distributed cache.

Learning Spring Data Redis would expand your horizon as a developer as you learn more about capabilities of Spring Data and it easily integrates with similar NoSQL technologies and frameworks.

Even if you’re not working on Redis or similar solutions, I would still recommend to learn a little bit about Spring and Redis integration.

Follow this 3 part step-by-step playlist:

[Watch on YouTube](https://www.youtube.com/watch?v=Bh4mGFeRUhg?feature=oembed)

[Watch on YouTube](https://www.youtube.com/watch?v=aw8UATAuGYQ?feature=oembed)

[Watch on YouTube](https://www.youtube.com/watch?v=pCsNUDqamWk?feature=oembed)

## Step-4 Spring Data for Apache Cassandra

Apache Cassandra is an extremely popular NoSQL database which is heavily used in high performant distributed solutions.

Spring Data for Apache Cassandra is a Spring Data project which focuses on Cassandra integration and how easily you can setup a Java project that uses a Cassandra cluster.

This is also a 3 part series which will take you through the world of NoSQL world.

[Watch on YouTube](https://www.youtube.com/watch?v=pYmuJIejOcs?feature=oembed)

[Watch on YouTube](https://www.youtube.com/watch?v=KYbxYQBqWPc?feature=oembed)

[Watch on YouTube](https://www.youtube.com/watch?v=3PrrLD4qDDg?feature=oembed)

## Conclusion

If you covered this much, I’m pretty sure you’d feel ultra comfortable with any Spring based data project.

BUT…don’t just stop here. Keep exploring and don’t forget to subscribe so you don’t miss any future updates.

Happy learning!
