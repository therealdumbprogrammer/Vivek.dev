---
title: "Making Spring Transactions Transparent with Detailed Logging"
description: "TL;DR"
publishDate: 2024-06-05
tags:
  - spring boot
draft: false
---

## TL;DR

[Watch on YouTube](https://www.youtube.com/watch?v=riNWDhiv3fk?feature=oembed)

While working on my latest video on Transactions, I found a very useful logging configuration. By enable/configuring these log levels, you can gain valuable insights into your application’s transaction flow.

This makes Spring Boot to display detailed information related to Spring/JPA Transactions wherein you can see Transactions being created, joined, committed, and rolled back.

## Configuring log levels

Here’s a quick look at how you can set up detailed logging in your Spring Boot application:

Add these configurations to your `application.yml` file

> Note — for `application.properties` just change the format of keys and corresponding values.

```yaml
spring:
  datasource:
    username: root
    password: mysql@123!
    url: jdbc:mysql://localhost:3306/hibdemo
  jpa:
    show-sql: true
    hibernate:
      ddl-auto: create
logging:
  level:
    org.springframework.orm.jpa.JpaTransactionManager: debug
```

> Notice the last section where we’re setting the logging level.

This setting will provide detailed logs that include when transactions are created, committed, and rolled back. This makes it easier to follow the flow and understand what’s happening under the hood.

Here’s how it would look like when you run the application:

![](https://cdn-images-1.medium.com/max/800/1*uDX1waTmwXourMPHFF_pcA.png)

If you’re interested in a more in-depth explanation, including practical examples and best practices, check out my detailed YouTube video on Spring Transactions. In the video, I cover everything you need to know about managing transactions in Spring Boot, from basic concepts to advanced settings.

I hope this post helps you get a better grasp of Spring transactions and logging. If you have any questions or need further clarification, feel free to leave a comment below or reach out on social media.

Happy coding!
