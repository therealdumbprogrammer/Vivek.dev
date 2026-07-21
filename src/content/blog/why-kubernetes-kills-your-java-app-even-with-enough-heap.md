---
title: "Why Kubernetes Kills Your Java App (Even With Enough Heap)"
description: "Your JVM heap looks fine. Kubernetes still kills your pod with OOMKilled. Here's what's actually going on behind the scenes."
publishDate: 2026-07-21
tags:
  - kubernetes
  - java
  - spring boot
  - jvm
draft: false
---

You set `-Xmx512m`. Your app is using 300MB of heap. Kubernetes kills it anyway. Exit code 137. OOMKilled.

This is one of those problems that makes you question everything you thought you knew about Java memory. The heap says you're fine. The pod says you're dead.

If you've run into this, you're not alone. It's one of the most common and most confusing issues Java developers face when running on Kubernetes.

## The Disconnect Between JVM and Kubernetes

When you set a memory limit on a Kubernetes container, you're telling the Linux kernel (via cgroups) how much total memory that process is allowed to use. If the process exceeds that limit, the kernel kills it. No warning. No graceful shutdown. Just gone.

The JVM, on the other hand, manages its own memory. When you set `-Xmx512m`, you're only capping the Java heap. But the JVM uses a lot more memory than just the heap.

That gap is where things go wrong.

## What's Using Memory Beyond the Heap

The JVM allocates memory for several areas that live outside the heap:

- **Metaspace** for class metadata
- **Thread stacks** (each thread gets its own stack, typically around 1MB)
- **Code cache** for JIT-compiled code
- **Direct byte buffers** for NIO operations
- **GC overhead** for the garbage collector's own bookkeeping
- **Native memory** used by libraries and JNI calls

Add all of this up and it's not unusual for a JVM process to consume 1.5x to 2x the configured heap size in total resident memory.

So if you set `-Xmx512m` and your Kubernetes memory limit is `512Mi`, you're almost guaranteed to get OOMKilled. The heap alone fits, but the whole JVM doesn't.

## Requests vs Limits

Kubernetes has two settings for memory: requests and limits. They do very different things.

**Requests** tell the scheduler how much memory to reserve when placing your pod on a node. It's a scheduling hint. Your container can use more than this, but the scheduler uses this value to decide where to put the pod.

**Limits** are enforced by the kernel. If your container tries to use more than the limit, it gets killed.

A common mistake is setting the limit too close to the heap size, or worse, not setting it at all and relying on defaults. Without explicit limits, your pod might get evicted when the node runs low on memory.

## CPU Throttling Is a Related Trap

Memory isn't the only resource that behaves unexpectedly. CPU limits on Kubernetes can cause your Java app to slow down significantly without any obvious error.

When you set a CPU limit, the kernel uses CFS (Completely Fair Scheduler) bandwidth control to throttle your container. If your app exhausts its CPU quota within a scheduling period, it just stops running until the next period. The app doesn't crash. It just gets painfully slow.

For Java apps with multiple GC threads, JIT compilation, and application threads all competing for CPU, this throttling can make your app appear hung even though nothing is technically wrong.

## Sizing Containers for Java

Getting the sizing right comes down to understanding what the JVM actually needs.

A reasonable starting point:

1. Set your heap with `-Xmx` based on what your application needs
2. Add overhead for non-heap memory (typically 200-400MB depending on thread count and library usage)
3. Set the Kubernetes memory limit to cover both
4. Set the memory request close to the limit for predictable scheduling

For example, if your app needs 512MB of heap, a memory limit of 768Mi to 900Mi is a more realistic starting point than 512Mi.

## Container-Aware JVM Settings

Modern JVMs (Java 10+) are container-aware by default. They can read cgroup limits and adjust their behavior accordingly. But you still need to be intentional about it.

The `JAVA_TOOL_OPTIONS` environment variable is a good way to pass JVM flags in containerized environments. It gets picked up automatically without modifying your application's entrypoint.

Some useful flags:

- `-XX:MaxRAMPercentage=75.0` tells the JVM to use 75% of the container's memory limit for the heap, leaving room for non-heap memory
- `-XX:+UseContainerSupport` (enabled by default in modern JDKs) ensures the JVM reads cgroup limits
- `-XX:ActiveProcessorCount=N` can be used to override CPU detection if needed

Using `MaxRAMPercentage` instead of a fixed `-Xmx` makes your containers more portable. You can change the Kubernetes memory limit without also having to update the JVM flag.

## Watch the Full Walkthrough

I put together a hands-on video where I demonstrate this problem step by step. You can see the OOMKill happen in real time, inspect what the JVM is actually using, and watch how different configurations change the behavior.

[Watch the video on YouTube](https://youtu.be/f74bJBgPqZY)

This is part of my [Hands-on Kubernetes with Spring Boot](https://www.youtube.com/playlist?list=PLpxcSt9FGVVGN-R6obf6ICr5m4SbvwgOo) series, where I cover everything from building images to running production workloads.
