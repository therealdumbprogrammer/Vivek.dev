---
title: "Spring Framework for Everyone"
description: "Below YouTube playlist is a great place to start."
publishDate: 2023-06-24
tags:
  - spring boot
draft: false
---

> Below YouTube playlist is a great place to start.

[https://www.youtube.com/watch?v=OurfeLMrmv0&list=PLpxcSt9FGVVFaGNMP2t4egMom6ziSejah](https://www.youtube.com/watch?v=OurfeLMrmv0&list=PLpxcSt9FGVVFaGNMP2t4egMom6ziSejah)

## What is Spring?

[Watch on YouTube](https://www.youtube.com/watch?v=OurfeLMrmv0?feature=oembed)

Spring is an open-source Java platform that enables to write maintainable and scalable Java applications.

**What do we mean by ‘platform’?**

Spring is a *complete ecosystem* for Java applications. It’s not a single project but a collection of various projects under the umbrella of Spring and each project focuses on a certain aspect of Java development.

> Modern Java development is so dependent on Spring projects that it’s really difficult to think about a non-spring application.

**Where can I find the information on Spring?**

We can find everything about Spring here — [https://spring.io/](https://spring.io/)

## What are Spring projects?

Each Spring project is a framework in itself which helps developers to develop a certain kind of Java application. For instance, if you want to develop a web application, there’s a Spring project for that.

**Where can I find these projects?**

You can find all the projects here [https://spring.io/projects/](https://spring.io/projects/)

Another view of the same is [https://spring.io/projects/spring-boot](https://spring.io/projects/spring-boot)

## What is Spring Framework?

While there are many projects, the core of everything is Spring core AKA Spring Framework which provides dependency injection features.

## Dependency Injection(DI) & Inversion of Control(IoC)

[Watch on YouTube](https://www.youtube.com/watch?v=phIA8MDZwSg?feature=oembed)

In a Java project, we generally write classes, define their dependencies, and create objects where required. If class A wants to use class B then we do something like this:

```java
public class A {
  public void something() {
    B = new B(); //creating the object manually using new keyword 
    B.dosomething();
  }
}
```

In a nutshell, the program as it executes, creates such objects and link those objects to do what it’s supposed to do.

**Spring uses DI** to inject the dependencies where required instead of us creating objects manually using new keyword. Spring can use below two methods to inject the dependencies:

1. Constructor Injection
2. Setter Injection

When we use Spring, the control is inverted which means we tell Spring the dependencies of an object and it’s the job of Spring to create the objects and inject those dependencies appropriately which is why this principle is called Inversion of Control(IoC).

```java
class A {
  private B b; //A is dependent on B
  
  //Spring will call this constructor to pass an object of B
  public A(B b) {
    this.b = b;
  }
}
```

## How does Spring know what to do?

[Watch on YouTube](https://www.youtube.com/watch?v=59-mYIniU4o?feature=oembed)

On its own, Spring has no idea about the project. We need to pass some information to the framework.

![](https://cdn-images-1.medium.com/max/800/1*ghFn_jH-oog2s7fh6LEp_w.png)

We provide the configuration metadata i.e. details about classes being managed, their dependencies(classes they’re dependent upon). Spring then reads that config, initialized it’s IoC container, and prepares the system.

## How do I start?

You need to setup a Java project first with correct maven dependencies.

[Watch on YouTube](https://www.youtube.com/watch?v=VoV2jfW2wNs?feature=oembed)

Once we have the project setup, we can start with Spring code.

> As we know that we need to provide configuration metadata to IoC container. To do that, we will use *@Configuration annotation*.

This is a class-level annotation. We create a class, annotate it with @Configuration, then pass this class to IoC container.

At server startup, Spring will scan this class to read the metadata and to find more details about the classes that it needs to manage.

> The classes that we want Spring to manage are called **beans. **You can say this is just another name for class. A spring bean means a Java class that spring knows about.

Watch this video where we use both the annotations.

[Watch on YouTube](https://www.youtube.com/watch?v=UOAe94RpLa4?feature=oembed)

## @Bean alternatives

@Bean is not the only way to configure a Java class as a Spring bean. There are other ways to do that. Few annotations that can do the same thing are as follows:

> @Component, @Service, @Repository in conjunction with @ComponentScan

These are explained in detail with hands-on here:

[Watch on YouTube](https://www.youtube.com/watch?v=L2GfpD5WCM0?feature=oembed)

## Bean Scopes

While being managed by Spring i.e. IoC container, each bean has a certain scope which essentially defines the scope of the object.

A bean can have different scopes such as:

1. Singleton
2. Prototype
3. Request
4. Session
5. Application

Singleton means that IoC container will create a single object of a bean so every time you ask Spring container for an object of say ClassA, it will the same object every time. This is similar to Gang of Four Singleton design pattern with a difference that this scope is guaranteed by the IoC container. You’re still free to create a new object using **new** keyword.

Just opposite is the Prototype scope, which means a new object every time.

Here we discuss all this in great detail:

[Watch on YouTube](https://www.youtube.com/watch?v=4nMOGehJ-yk?feature=oembed)

## Lazy and Eager initialization

It explains when a bean will be initialized and a new object of the bean is created by Spring container.

It will make more sense if you go through this video as you get to see the practical details:

[Watch on YouTube](https://www.youtube.com/watch?v=FBs0yCmOLhg?feature=oembed)

## @PostConstruct and @DependsOn

In continuation of lazy and eager initialization, we should also understand the lifecycle of a bean and how beans can be dependent on each other. It is actually important that we identify and setup beans accordingly as out of order initialization can crash an application.

[Watch on YouTube](https://www.youtube.com/watch?v=HtW7yWa9PhE?feature=oembed)

[Watch on YouTube](https://www.youtube.com/watch?v=XHz0ryPqqiY?feature=oembed)

## Autowiring

Autowiring is the process by which Spring’s IoC container identifies the object dependencies and wire them together where needed.

For instance — If we configured that ClassA needs an object of ClassB that means ClassB is a dependency of ClassA so IoC container will create objects of ClassA and ClassB, and inject the object of ClassB in ClassA automatically.

@Autowired annotation simplifies the autowiring process which can be used on variable declaration, constructors, and setter methods.

Autowiring is explained here in great details with examples:

[Watch on YouTube](https://www.youtube.com/watch?v=H1eKX26i714?feature=oembed)

[Watch on YouTube](https://www.youtube.com/watch?v=YKrR57_NoM0?feature=oembed)
