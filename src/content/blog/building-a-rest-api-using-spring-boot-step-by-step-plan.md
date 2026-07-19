---
title: "Building a REST API using Spring Boot | Step-by-Step Plan"
description: "Hey Guys, I’m back again with another step-by-step plan."
publishDate: 2023-08-30
tags:
  - spring boot
draft: false
---

> If you are interested in or planning to learn Spring Data, please check out my previous article [https://medium.com/@thecodealchemist/mastering-spring-data-a-step-by-step-plan-with-free-course-links-360e1e021be9](https://medium.com/@thecodealchemist/mastering-spring-data-a-step-by-step-plan-with-free-course-links-360e1e021be9)

## TL;DR

If you’re in hurry, jump right on to the playlist:

[Watch on YouTube](https://www.youtube.com/watch?v=A86pk2n-u9I?list=PLpxcSt9FGVVGRjn_Hgrxl6WJv4aFUDjKE)

## APIs are everywhere!

APIs are everywhere. Everything is moving towards **X-as-a-Service.**

So, either you own an API or you’re consuming an API.

While there are a few solutions available e.g. GraphQL, gRPC, REST is still one of the most popular solutions available.

And, extend this to Java — again, there are different ways to develop an API but Spring Boot is the most widely used framework to develop an API.

> If you’re a beginner or just want to brush-up the basics then you’re at the right place.

> In this article, we will cover the basic knowledge of Spring Boot API. By the end of this article, you’ll be able to write your own API.

There is too much to learn and explore in Microservices area. Building an API is probably the first step.

To start, this is the bare minimum that we need:

1. A Spring Boot Project
2. How to handle and process the request?
3. How to read and consume parameters or data from the incoming request?
4. How to return a good Response?
5. How to handle the exceptions and errors?

## Step-1 [@RestController]

To start, we need to step a Spring Boot Project and we need to add right set of dependencies.

Once we have the project, the next thing is how to handle and process the request?

Well, we create a Controller. What’s a Controller?

Controller is a Java class which is annotated with @RestController annotation. This annotation tells Spring that this class is capable of handling the incoming requests.

Having a RestController is not enough. It will intercept the request but what to do after that?

To process the request, we need a method in the controller class. And, to invoke that method, we need another annotation to bind it with the incoming request’s HTTP method type. For instance, if this is an HTTP Get request, then we need to annotate the method with @GetMapping

[Watch on YouTube](https://www.youtube.com/watch?v=A86pk2n-u9I?feature=oembed)

## Step-2 [@RequestMapping]

You must have seen the URLs in API calls. How does an API translate and map these URLs to the Controllers we created in Step-1?

There’s another annotation — @RequestMapping. With this annotation, we define URL patterns for Controllers and method which will decide which controller and method to invoke in order to process a request.

[Watch on YouTube](https://www.youtube.com/watch?v=OhRstcHvIM4)

## Step-3 [@RequestParam & @PathVariable]

Now, we need to make it dynamic. We need to be able to consume data/parameters from the incoming requests.

There are different ways to pass the data in a request, request parameter and path variable being the most common ones.

Learn here how to use @RequestParam and @PathVariable annotations.

[Watch on YouTube](https://www.youtube.com/watch?v=TJG-LTLZo5s)

[Watch on YouTube](https://www.youtube.com/watch?v=BVRRfmBHKSU)

## Step-4 [@PostMapping & @RequestBody]

Now, we’re making some progress. Our API is getting some shape now.

Let’s see how to create the resources and how to process HTTP Post requests.

We use @PostMapping to do this.

[Watch on YouTube](https://www.youtube.com/watch?v=vHEGlrPTFdc?feature=oembed)

## Step-5 [@ResponseEntity]

It’s not a mandatory but a good-to-know thing.

@ResponseEntity gives us the flexibility to have more control over the response we’re returning.

Here’s a quick demo on the same.

[Watch on YouTube](https://www.youtube.com/watch?v=qo56g2PlS5o?feature=oembed)

## Step-6 [@ControllerAdvice & @ExceptionHandler]

All good? No? What we should we do then?

Yea, what should we do when it’s not all good? How to handle errors and exceptions gracefully?

We not only want to handle the abnormal situations but we want to report them in a clean meaningful way so that client can make a sense out of it and decide what to do accordingly.

@ControllerAdvice and @ExceptionHandler annotations provide a way to handle the exceptions and return an error response in a clean and consistent way.

[Watch on YouTube](https://www.youtube.com/watch?v=kzfQvtOu-JI?feature=oembed)

## You’re mostly ready!

Not kidding, you ARE!

These are the building blocks. If you’re comfortable with these concepts and annotations, believe me, you’re ready to develop a REST API of your own using Spring Boot.

There are other things like Security, discovery, HATEOAS that we have not covered but this is not an exhaustive guide.

Once you feel comfortable, the last step is to develop a demo API.

Need any help? Watch this video which covers a Demo API with MySQL DB connectivity using Spring Data JPA.

[Watch on YouTube](https://www.youtube.com/watch?v=uHqzGXR8Uqs)

Happy Learning!
