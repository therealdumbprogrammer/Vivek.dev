---
title: "Spring Security For Beginners — Part 2"
description: "How to secure a Spring Boot REST API with HTTP Basic Authentication"
publishDate: 2024-09-30
tags:
  - spring boot
  - security
draft: false
---

> How to secure a Spring Boot REST API with HTTP Basic Authentication

## TL;DR

[Watch on YouTube](https://www.youtube.com/watch?v=d1pw2FUnxgs?feature=oembed)

HTTP Basic is one of the simplest authentication mechanisms available. It’s also likely the first one people learn and try when getting started with Spring Security. This method is easier to understand because most of us are already familiar with username/password-based authentication.

> In this article, we will explore how to implement it.

## Where do we start and what do we need?

![](https://cdn-images-1.medium.com/max/1200/1*qQvOnKsq9IYv08vuS06L8g.png)

In projects like this, we need at least two key components:

1. **A User Store**
2. **An Authentication Mechanism**, i.e., a way to compare and validate user credentials with what we already have in our system.

Let’s break down the different components we’ll need and how we plan to implement them:

1. **User Store**
A user store is essentially an entity where we store user information, such as credentials. This could be an RDBMS, NoSQL database, or any third-party solution. In our case, we’ll use our own MySQL database, which will have a `Users` table.
2. **UserService and UserController**
The `UserController` will have a `registerUser` endpoint, which users will call to register themselves.

- `UserController` will call `UserService`.
- `UserService` will interact with `UserRepository` (a simple Spring Data repository) to insert new users or fetch existing user details from the MySQL database.

**3. PasswordEncoder**
`UserService` will use a `PasswordEncoder` bean to encode passwords before creating a new user, ensuring that passwords are stored in a hashed form rather than as plain text in the database.

- This encoder will also be used by Spring Security during authentication, where the framework will match the incoming raw password with the hashed password stored in the database.

**4. UserDetailsService**
Since we can have various types of user stores, how does Spring know where to find and load a user? The `UserDetailsService` interface defines a contract for this purpose. If Spring finds an implementation of this service, it will be used to load the user during the authentication flow.

**5. UserDetails**
Each product or project may represent users differently. To maintain consistency, Spring Security requires an instance of `UserDetails`, which represents the principal (the user being authenticated).

**6. SecurityFilterChain**
This is a bean that we’ll define to configure the security settings in our project.

**7. A Private Endpoint**
We’ll implement a simple controller that will serve as a private endpoint, accessible only to authenticated users.

## High Level Flow

Here’s the high-level flow of our demo app:

- The user accesses the public registration endpoint to register.
- The user provides a username, password, and email in the `POST` request.
- Since this is a public endpoint, Spring Security will not authenticate the request and will pass it on to the `UserController`.
- `UserController` calls `UserService`.
- `UserService` maps the incoming request to a JPA entity, uses the `PasswordEncoder` to hash the password, and then calls `UserRepository`.
- `UserRepository.save(..)` stores the user in the database.
- The user then accesses a private endpoint by passing their username and password through Postman or any other tool.
- The user sets the authentication type to **Basic Auth**.
- Spring Security looks for an implementation of `UserDetailsService` and calls its `loadUserByUsername()` method.
- The `UserDetailsService` implementation fetches the user from the database and creates an instance of `UserDetails`, representing the authenticated user.
- Spring Security automatically compares the raw password (entered by the user) with the hashed password (retrieved from the database).
- If the passwords match, the user is authenticated, and a `200 OK` response is returned.
- If they do not match, a `401 Unauthorized` error is returned to the client.

## Implemetation

Now that we understand the building blocks, the implementation will be easy to follow. You can find it here — [https://github.com/therealdumbprogrammer/spring-security-httpbasic-auth/tree/master](https://github.com/therealdumbprogrammer/spring-security-httpbasic-auth/tree/master)

## Conclusion

For more details, please check out the YouTube tutorial linked above.
If you enjoyed the content, don’t forget to like and share!

Happy coding!
