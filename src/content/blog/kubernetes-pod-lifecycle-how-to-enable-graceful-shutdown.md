---
title: "Kubernetes Pod Lifecycle: How To Actually Enable Graceful Shutdown"
description: "What happens to in-flight requests when Kubernetes deletes your pod? Here's how the termination lifecycle works and how to configure graceful shutdown for Spring Boot."
publishDate: 2026-07-28
tags:
  - kubernetes
  - java
  - spring boot
  - graceful shutdown
draft: false
---

You deploy a new version of your Spring Boot app. Kubernetes starts a rolling update. The old pod gets deleted while it's still processing requests.

What happens to those in-flight requests? Do they complete? Do they get dropped? Does the shutdown process wait?

The answer depends on how your application and your Kubernetes deployment are configured. By default, most setups don't handle this well.

## What Happens When a Pod Gets Deleted

When a pod is deleted, whether from an explicit `kubectl delete`, a rolling update, or a scale-down, Kubernetes doesn't just kill it immediately. The pod goes through a termination lifecycle.

Here's the sequence:

1. The pod is marked for deletion in the API server.
2. The kubelet on the node where the pod is running picks up the event and starts the termination process.
3. If a **preStop hook** is configured, the kubelet executes it first.
4. The kubelet tells the container runtime to send a **SIGTERM** signal to the process inside the container.
5. The JVM receives the SIGTERM and triggers its shutdown hooks.
6. Spring Boot, which registers its own shutdown hook with the JVM, begins its shutdown sequence.
7. Once the JVM process exits, the container runtime detects the exit and the pod is removed.

That SIGTERM is the key moment. It's where your application gets a chance to finish what it's doing before going down.

## What Spring Boot Does on Shutdown

When Spring Boot receives the SIGTERM (via the JVM shutdown hook), it runs through its own shutdown lifecycle:

- **Stops the embedded web server** (Tomcat, Netty, etc.) so it stops accepting new connections
- **Closes the application context**, which triggers `@PreDestroy` methods on beans
- **Shuts down executors** and thread pools
- **Closes connection pools** (database connections, Redis, Kafka, etc.)

Each of these is a separate phase. The total shutdown time is the sum of all phases.

## Enabling Graceful Shutdown

By default, Spring Boot does not wait for in-flight requests to complete. When SIGTERM arrives, the embedded server shuts down and any active requests are dropped.

To change this, you need to enable graceful shutdown:

```properties
server.shutdown=graceful
```

With this setting, Spring Boot will stop accepting new requests but wait for existing requests to finish before proceeding with the rest of the shutdown sequence.

You also want to configure how long each shutdown phase is allowed to take:

```properties
spring.lifecycle.timeout-per-shutdown-phase=30s
```

This means Spring Boot will wait up to 30 seconds per phase. If a phase doesn't complete within that time, Spring moves on to the next one. This prevents a stuck request from blocking the entire shutdown indefinitely.

## The Kubernetes Side: terminationGracePeriodSeconds

Spring Boot's timeout is only part of the picture. Kubernetes has its own upper bound on how long it will wait for a pod to terminate.

This is controlled by `terminationGracePeriodSeconds` in the pod spec:

```yaml
spec:
  terminationGracePeriodSeconds: 40
```

This is the total time Kubernetes allows from the moment the pod is marked for deletion to the moment it must be gone. Everything happens within this window: the preStop hook, the SIGTERM, Spring Boot's shutdown phases, all of it.

If the JVM hasn't exited by the time this period expires, Kubernetes sends a **SIGKILL**. Unlike SIGTERM, SIGKILL doesn't give the process any opportunity to clean up. The JVM is killed immediately.

The default is 30 seconds. For most Spring Boot applications, that's tight. Between the preStop hook, graceful request draining, and context destruction, 30 seconds can easily be too short.

## PreStop Hooks

There's one more piece to configure: the preStop hook.

When Kubernetes deletes a pod, two things happen in parallel. The kubelet starts the termination sequence, and the endpoints controller removes the pod from the Service's endpoint list. These are asynchronous. There's a brief window where the pod is shutting down but still receiving traffic because it hasn't been removed from the endpoint list yet.

A preStop hook buys time. By introducing a short delay before SIGTERM is sent, you give the endpoints controller time to remove the pod from the Service:

```yaml
spec:
  containers:
    - name: app
      lifecycle:
        preStop:
          exec:
            command: ["sleep", "10"]
```

This 10-second sleep runs before SIGTERM is sent. During that time, the pod is removed from the Service endpoint list, so new requests stop arriving before the application starts shutting down.

## Putting It All Together

A working configuration needs three things aligned:

**Spring Boot** (`application.properties`):

```properties
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=30s
```

**Kubernetes** (`deployment.yaml`):

```yaml
spec:
  terminationGracePeriodSeconds: 40
  containers:
    - name: app
      lifecycle:
        preStop:
          exec:
            command: ["sleep", "10"]
```

The math matters. The preStop hook takes 10 seconds. Spring Boot's shutdown phase timeout is 30 seconds. The total needs to fit within `terminationGracePeriodSeconds` (40 seconds in this example). If the sum of preStop + shutdown time exceeds the grace period, Kubernetes sends SIGKILL before Spring Boot finishes draining.

## What Happens If a Request Takes Too Long

If an in-flight request is still running when the `terminationGracePeriodSeconds` expires, it doesn't matter that `server.shutdown=graceful` is set. Kubernetes sends SIGKILL and the JVM is terminated immediately. The request is lost.

This is by design. Kubernetes won't wait forever for a pod to shut down. The grace period is a hard upper bound. A stuck or slow request will not prevent the pod from being removed.

If you know your application has long-running requests, increase `terminationGracePeriodSeconds` accordingly. But keep in mind that during a rolling update, the old pod stays around for the entire grace period before it's fully replaced.

## Watch the Full Walkthrough

I recorded a hands-on demo where I deploy a Spring Boot app with a slow endpoint, delete the pod while a request is in flight, and watch the graceful shutdown process in real time.

[Watch the video on YouTube](https://youtu.be/Au1vv9r8UlU)

This is part of my [Hands-on Kubernetes with Spring Boot](https://www.youtube.com/playlist?list=PLpxcSt9FGVVGN-R6obf6ICr5m4SbvwgOo) series, where I cover everything from building container images to running production workloads.
