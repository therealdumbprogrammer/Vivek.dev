---
title: "Spring JDBC Quick Refresher"
description: "Database connectivity is one of the most important aspects of any application. After all, we need a persistent system to store the data."
publishDate: 2023-07-08
tags:
  - spring boot
draft: false
---

Storing the data is not enough, the application needs to perform other actions as well e.g. reading, deleting, and updating the data.

## Setting up the database

The very first thing is to setup a database. To do that, we need to finalize a data store. There are many options available in the market and it depends on the use case.

1. RDBMS — MySQL, Postgress, etc.
2. NoSQL — Cassandra, Couchbase, etc.
3. Document DB — MongoDB
4. Graph DB — Neo4J
5. Cloud DBs — Azure Cosmos DB or similar offerings from AWS and GCP

After finalizing the database, next step would be to install and setup it.

On your local, you’d have to do it on your own.

For instance — here we install MySQL on a Windows machine.

[Watch on YouTube](https://www.youtube.com/watch?v=xlDLc4pHyvo?feature=oembed)

## Connecting to the database

To connect, an application needs to know few basic properties like:

1. DB URL or connection String — which tells where it can find the running database.
2. Database driver — Each database has a driver that acts as an intermediary layer between application and the real database.
3. Credentials — it could be username and password, an access token, or some kind of access key.

## Database API

This is probably the most important aspect of DB connectivity. How exactly an application would talk to a database. We need a high level database API, compatible with the programming language, and the database.

## JDBC

JDBC or Java Database Connectivity is the core API shipped with JDK which allows Java applications to talk to different databases without worrying about low level details of database connectivity.

In general, an application does following things in order to interact with database:

1. Load the database driver — happens automatically in newer versions.
2. Create/get a data source — a wrapper representing the underlying data store.
3. Establish the connection
4. Create the statement objects
5. Execute CRUD queries
6. Handle the ResultSet if/when query returns the results
7. Handle exceptions
8. Closing statement
9. Closing/releasing the connection

As you can see, it looks a bit complicated.

> And that’s where Spring JDBC comes into the picture.

## Spring JDBC

Spring JDBC is a part of overall Spring Data project. It is suitable for simple JDBC operations where an application doesn’t need ORM/JPA capabilities.

Spring JDBC simplifies the aforementioned JDBC steps. It leverages Spring Framework capabilities like IoC, loosely coupled components which allow a developer to focus on the business logic.

Spring JDBC handles the connection, statements, releasing them, and handling common runtime exceptions.

## When would we use Spring JDBC?

There are quite a few options in Java space when it comes to the DB connectivity.

1. Using plain JDBC
2. Using native Hibernate
3. Using Spring JDBC
4. Using JPA with Hibernate as its implementation
5. Using Spring Data JPA which uses Hibernate as JPA implementation same as above point but simplifies everything same as other Spring projects.

#4 and #5 are best suited for applications which have complex entity models and need ORM features.

If your application doesn’t need these features but you still need a clean way to interact with database — choose Spring JDBC

## Starting with Spring JDBC

1. Create a maven project
2. Add Spring JDBC dependency
3. Add Mysql(or your database specific) connector dependency
4. Create DataSource bean using DB properties like URL, driver-class, username, and password
5. Autowire DataSource where you need it e.g. in DAO classes.
6. In DAO class, initialize JdbcTemplate/NamedParamaterJdbcTemplate.
7. Use template methods to query database.

See this detailed video on how to work with Spring JDBC.

[Watch on YouTube](https://www.youtube.com/watch?v=zjYCOBynhY0?feature=oembed)

## Spring JDBC with Spring Boot

Spring Boot further simplifies Spring JDBC.

When we use Spring Boot, we don’t need to create DataSource and JdbcTemplate/NamedParameterJdbcTemplate.

We just need to provide following details in application.properties and include corresponding starter poms in pom.xml:

1. spring.datasource.url
2. spring.datasource.username
3. spring.datasource.password

Spring boot will automatically create DataSource and JdbcTemplate bean.

In DAO classes, we simply need to autowire JdbcTemplate in order to use it.

You can find all the details in this video:

[Watch on YouTube](https://www.youtube.com/watch?v=l35K3W_v3Vw?feature=oembed)

If you like the content, please share the content and subscribe my channel for similar content.

Happy learning!
