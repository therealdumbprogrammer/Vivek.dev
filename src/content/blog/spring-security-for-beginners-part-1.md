---
title: "Spring Security For Beginners — Part 1"
description: "If you’re like — struggling with Spring Security — how to start or where to start then this is the right place for you."
publishDate: 2024-09-10
tags:
  - spring boot
  - security
draft: false
---

## TL;DR

[Watch on YouTube](https://www.youtube.com/watch?v=eG8caAniBrA?feature=oembed)

If you’re like me— struggling with Spring Security — how to start or where to start then this is the right place for you.

I’ve been learning and experimenting with Spring Security and I will be sharing my learnings in a step-by-step manner with all of you who are in the same boat.

In this post, we’ll start with the first step i.e. the Spring Security architecture on a high level.

I’ll walk you through the architecture of Spring Security, breaking down its core components like the **Security Filter Chain**, **AuthenticationManager**, **ProviderManager**, and more. This will give you a strong conceptual foundation to understand how Spring Security works under the hood.

## Filters

![](https://cdn-images-1.medium.com/max/800/1*nUp2mvBf98hgPZo4VQCtHw.png)

Filters are an essential part of any Java-based web application.

In a typical web app, filters handle tasks such as logging, authentication, encoding, and more. The request moves through each filter in sequence, and on the way back, it goes through them again(but in reverse order).

> The role of any filter is to intercept the incoming request, optionally do some operation, pass it to the next filter in the chain.

## Spring Security

![](https://cdn-images-1.medium.com/max/800/1*3LjgtOANbjDIqjBnKCV3bA.png)

Let’s break down the architecture and understand the key components.

## 1. Security Filter Chain

At the core of Spring Security lies its **SecurityFilterChain**. This is a specialized filter chain(has a series of security related filters) that handles all the security logic in your application.

When a request hits your application, it enters the SecurityFilterChain and passes through a series of filters designed to handle various security aspects like:

- Authentication
- Authorization
- Session management
- Exception handling

Here’s how it works:

1. **Inbound Requests**: When a request is received, it passes through multiple filters that perform tasks such as checking if the user is authenticated, authorizing access to resources, and managing sessions.
2. **Security Filters**: Some of the key filters include `UsernamePasswordAuthenticationFilter` (handles authentication via username and password), `BasicAuthenticationFilter` (for HTTP Basic authentication), and `ExceptionTranslationFilter` (handles security-related exceptions).
3. **Outbound Responses**: Once the request is processed and a response is generated, it travels back through the filters, ensuring that the response is secure before it reaches the client.

## 2. AuthenticationManager and ProviderManager

Once a request reaches the **Security Filter Chain**, it is passed to the **AuthenticationManager**. The AuthenticationManager is responsible for managing the authentication process, but it doesn’t directly authenticate the user. Instead, it delegates that task to **ProviderManager**.

The **ProviderManager** is a collection of **AuthenticationProviders**, each responsible for authenticating users through different methods. For instance, one provider might handle username-password authentication, while another could handle OAuth tokens.

Here’s how the authentication flow works:

1. **ProviderManager** checks each provider to see if it can handle the current authentication method.
2. Once the right provider is found, it processes the request and determines if the user is authenticated.
3. If authentication is successful, the user is granted access; if not, an error is thrown.

## 3. UserDetailsService and PasswordEncoder

These two components are usually used with username/password based authentication mechanism but good to cover here.

- **UserDetailsService**: This defines an interface contract which has a key method to find/load a user by username otherwise Spring Security has no idea how to load a user and from where. We provide an implementation of this method in our application through which the service loads user details (such as username, password, and roles) from a data source, usually a database which is used for user/client authentication.
- **PasswordEncoder**: Spring Security never stores plain-text passwords. Instead, it uses a **PasswordEncoder** to hash passwords when they are saved and to validate them during login attempts.

## 4.SecurityContextHolder and Authentication

Once authentication is successful, the user’s details are stored in the **SecurityContextHolder**. This is a global object that holds security-related information for the current session(following the ThreadLocal model), specifically the **Authentication** object.

The **Authentication** object contains:

- **Principal**: This usually represents the authenticated user.
- **Credentials**: Typically, this holds sensitive data like the password. Once authentication is complete, the credentials are cleared.
- **Authorities**: These are the roles or permissions granted to the user, used for authorization purposes.

By storing this information in the SecurityContextHolder, Spring Security ensures that the user’s identity and roles are available throughout the application, allowing it to make authorization decisions as needed.

## Summary

Here’s a high-level summary of how a request is processed in a Spring Security-enabled application:

1. **Request hits the SecurityFilterChain**: Filters handle various security tasks.
2. **AuthenticationManager delegates to ProviderManager**: Authentication providers are consulted to authenticate the user.
3. **UserDetailsService and PasswordEncoder(optional)**: These are used to retrieve user information and verify credentials.
4. **SecurityContextHolder stores authentication details**: The user’s authentication state is stored and available for future security checks.

This architecture ensures that all aspects of security — authentication, authorization, session management — are handled efficiently and in a modular way. You can add or customize filters, implement different authentication providers, and modify how user details are managed, all without breaking the security flow.

## Conclusion

Spring Security’s architecture is powerful yet flexible, allowing you to secure web applications with ease. By understanding the core components like the **SecurityFilterChain**, **AuthenticationManager**, and **ProviderManager**, you’ll be better equipped to configure and customize your security needs.

In future posts, I’ll dive deeper into these individual components, showing how they can be customized and extended to fit different application requirements.

Until then, keep experimenting, and don’t forget — security is not optional, it’s essential!

Happy coding!
