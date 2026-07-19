---
title: "Mastering Java Class Loaders : Dynamic Class Loading & Custom Class Loaders"
description: "Ever thought about how JVM runs your code? Yes, it runs the class that has the main() method but how does it load and run it?"
publishDate: 2023-05-11
tags:
  - java
draft: false
---

> JVM uses a class loader to load the class.

> There is a two part series where I have covered this topic in detail:

> [Mastering Java Class Loaders: Dynamic Class Loading and Custom Class Loaders | Part-1](https://www.youtube.com/watch?v=RKARkwRjhuc)

> [Mastering Java Class Loaders: Dynamic Class Loading and Custom Class Loaders | Part-2](https://www.youtube.com/watch?v=VFO1ulWnLtk)

## What is a Class Loader?

Java Class Loader is a subsystem of the Java Virtual Machine that is responsible for dynamically loading Java classes into the JVM at runtime. The Java Class Loader loads the class files from the file system, network or other sources and creates a class object in the memory that can be used by the JVM.

## Types of Class Loader

1. **Bootstrap Class Loader**

This class loader is responsible for loading the core Java classes and libraries from the JDK/JRE. When a Java application starts up, the Bootstrap Class Loader is the first class loader to be invoked

2. **Extension/Platform Class Loader**

It is responsible for loading the classes from the extension directories. Extensions are optional packages that can be added to the JDK/JRE to provide additional functionality, extension directories are specified by java.ext.dirs system property.

**3. Application Class Loader**

It is responsible for loading the application classes(developed by us) from the classpath. This is what we provide using -cp either explicitly to javac command or indirectly via a build tool like maven, gradle.

**4. Custom class loader**

We can create our own class loader which we will cover later.

## But, how?

The class loaders in the JVM are organised into a tree hierarchy, in which every class loader has a parent. Prior to locating and loading a class, a good practice for a class loader is to check whether the class’s parent can load — or already has loaded — the required class.

If even the bootstrap loader can’t find the class, it will ask the child(which requested the loading) to load the class. So, now it’s the responsibility of the child loader to load the class.

![](https://cdn-images-1.medium.com/max/800/1*3kTCE5kxe4u8RFBZf9aHIQ.png)

## What if a class loader can’t a file?

Well, it will throw a ClassNotFoundException in that case.

## Class Loading mechanism

Class loading is a three step process:

1. Loading

2. Linking

a. Verification

b. Preparation

c. Resolution

6. Initialization

## What about the Custom Class Loader?

Sorry, I got lazy. I have covered custom class loaders in detail here [Mastering Java Class Loaders: Dynamic Class Loading and Custom Class Loaders | Part-2](https://www.youtube.com/watch?v=VFO1ulWnLtk)

Happy learning!
