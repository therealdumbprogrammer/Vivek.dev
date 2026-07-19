---
title: "Java on Azure Part 1 — Developing a CRUD application with Spring Boot & Azure MySQL"
description: "TL;DR"
publishDate: 2023-11-14
tags:
  - spring boot
  - java
  - cloud
draft: false
---

## TL;DR

[Watch on YouTube](https://www.youtube.com/watch?v=-T4x4-eIMLA?feature=oembed)

## A) How do we develop a Spring Boot Application?

Developing a simple CRUD application is quite easy, isn’t it!

We start with Spring Initializer, include required dependencies e.g. Spring JDBC, Spring Data, or Spring JPA. And then we use Crud or Jpa Repositories to implement CRUD operations.

In trivial cases, we don’t need to write any code at all as Spring Data repositories can generate required code at runtime.

> If you need a refresher, refer this playlist on Spring Data project [https://www.youtube.com/playlist?list=PLpxcSt9FGVVGq9vFTFdFVhz9-OEsqvPaj](https://www.youtube.com/playlist?list=PLpxcSt9FGVVGq9vFTFdFVhz9-OEsqvPaj)

## B) Okay, what about the database?

**Given**

Suppose, we have a relational database which is running on our local system. We’re familiar with different ways of running a database:

1. Download the executable and start the database server
2. Run the database in a container e.g. a docker container
3. Use a managed service e.g. a database running on cloud

While the top 2 are generally used to run databases on local, the last one is a purely managed service which means the database is not running on our local system.

**Then**

We provide the database details to our Spring boot application via application.properties or application.yml

## C) So, the important thing is…

We need the database details where it’s running and that can be a connection string or details like host, port, database name, a URL.

## D) What does it have to do with Azure MySQL?

Before that, let’s quickly cover what is Azure MySQL?

**Azure MySQL**

Azure MySQL is an Azure offering for MySQL database. It is fully managed by Azure.

Which means it belongs to the category of 3rd option in Section **B above.**

> Here, the difference is that the database is running on Azure cloud instead of our local system.

So, a Spring Boot application can easily connect to this MySQL instance same as any other MySQL as long as we provide/configure a correct connection string that can locate the running database server.

## E) Steps

1. Create/setup an Azure MySQL instance
2. Use Spring Initializer to setup a new code base
3. Add required azure dependencies and starters
4. Get the connection string of Azure database
5. Provide the datasource details(url, username, password) in application.properties file
6. Run the main class

![](https://cdn-images-1.medium.com/max/800/1*QqGqUKHkWtseJrLIdD6Fsg.png)

Happy learning!
