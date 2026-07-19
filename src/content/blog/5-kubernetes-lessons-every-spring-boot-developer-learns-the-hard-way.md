---
title: "5 Kubernetes Lessons Every Spring Boot Developer Learns the Hard Way"
description: "If you’ve built a Spring Boot application, packaged it into a Docker image, and successfully run it on your machine, you’ve already crossed…"
publishDate: 2026-06-10
tags:
  - kubernetes
  - spring boot
draft: false
---

![](https://cdn-images-1.medium.com/max/800/1*uvEjNLMu1GCSN3TM7nSjYw.png)

If you’ve built a Spring Boot application, packaged it into a Docker image, and successfully run it on your machine, you’ve already crossed an important milestone.

Then comes Kubernetes.

At first glance, Kubernetes may look like a natural extension of Docker. After all, you’re still running containers. But many developers quickly discover that a container running perfectly on a laptop doesn’t automatically translate into a reliable application running in a cluster.

The reason is simple. Kubernetes is not just a container runtime. It is an orchestration platform that manages application lifecycle, networking, configuration, scaling, and recovery.

When moving Spring Boot applications to Kubernetes, there are a few concepts that fundamentally change how you design and operate your services.

## 1. A Container Is Not the Final Destination

[Watch on YouTube](https://www.youtube.com/watch?v=7aGsOp6RKBU?feature=oembed)

The first step in any Kubernetes journey is packaging your application as a container image.

For Spring Boot applications, there are several ways to build images:

- Spring Boot Build Image Plugin
- Google Jib
- Traditional Dockerfiles
- Multi-stage Dockerfiles

Each approach has trade-offs.

The Spring Boot Build Image Plugin and Google Jib prioritize developer productivity and standardization. They automatically create optimized image layers and reduce the amount of Docker-specific knowledge required.

Dockerfiles, especially multi-stage Dockerfiles, give you more control over image size and build behavior.

The important thing is not which tool you choose. The important thing is establishing a consistent image-building strategy across your services.

As the number of microservices grows, consistency becomes more valuable than squeezing a few extra megabytes out of an image.

## 2. Pods Are Disposable. Deployments Are What Matter.

[Watch on YouTube](https://www.youtube.com/watch?v=CUSzCcvIyv4?feature=oembed)

One of the biggest mindset shifts in Kubernetes is understanding that Pods are temporary.

A Pod can disappear because:

- The application crashed
- The node failed
- The Pod was evicted
- Someone accidentally deleted it

Once a Pod is gone, Kubernetes does not repair that Pod.

Instead, Kubernetes creates a brand-new Pod.

This is why applications should never be deployed as standalone Pods in production.

A Deployment defines the desired state of your application.

> “I want three instances of this service running.”

If one Pod dies, Kubernetes automatically creates another one to maintain that state.

This self-healing behavior is one of the primary reasons organizations adopt Kubernetes.

Rather than manually recovering failed instances, the platform continuously works to keep your application available.

## 3. Stop Packaging Configuration Inside Your Application

[Watch on YouTube](https://www.youtube.com/watch?v=vFUY_9IN9sw?feature=oembed)

A common anti-pattern is embedding environment-specific configuration directly inside the application.

Examples include:

- Development database URLs
- Staging API endpoints
- Production feature flags

When configuration is bundled into the application, every environment requires a different build artifact.

Kubernetes encourages a better approach through ConfigMaps and Secrets.

ConfigMaps store non-sensitive configuration:

```ini
APP_MESSAGE=Welcome to Production
```

Secrets store sensitive information such as database passwords, API tokens, and access keys.

Spring Boot integrates very well with this model.

If Kubernetes provides an environment variable called:

```typescript
APP_MESSAGE
```

Spring Boot automatically maps it to:

```typescript
app.message
```

through its relaxed binding mechanism.

One important security note:

> Kubernetes Secrets are not encrypted by default. They are Base64 encoded.

That means access control, not encoding, is what actually protects your secrets. Proper RBAC policies are essential in production environments.

## 4. You Probably Don’t Need Eureka Anymore

[Watch on YouTube](https://www.youtube.com/watch?v=YJYkv1CpkjA?feature=oembed)

Many Spring developers come from a Spring Cloud background where service discovery is handled by Eureka.

In Kubernetes, service discovery is built into the platform.

Every Service receives:

- A stable network identity
- A stable DNS name
- Built-in load balancing

If you have an Inventory Service, another service can simply call:

```bash
http://inventory-service:8080
```

Kubernetes handles the lookup automatically.

No registration process.

No discovery server.

No additional infrastructure.

This significantly simplifies microservice architectures.

One thing to watch carefully, however, is label matching.

A Kubernetes Service routes traffic to Pods using selectors.

If the Service selector does not match the labels on your Pods, traffic will never reach your application.

This is one of the most common causes of connectivity issues in Kubernetes environments.

## 5. Kubernetes Doesn’t Know When Your Application Is Ready

[Watch on YouTube](https://www.youtube.com/watch?v=LM3ze3P_PTE?feature=oembed)

Starting a container and starting a Spring Boot application are not the same thing.

From Kubernetes’ perspective, the container process may already be running.

Meanwhile, Spring Boot could still be:

- Initializing the ApplicationContext
- Creating database connections
- Starting Hibernate
- Loading caches

If traffic arrives too early, requests fail.

This is where probes become critical.

## Startup Probe

Determines whether the application has successfully started.

This is particularly useful for Spring Boot applications that take time to initialize.

## Readiness Probe

Determines whether the application is ready to receive traffic.

If the readiness check fails, Kubernetes temporarily removes the Pod from load balancing.

## Liveness Probe

Determines whether the application is still healthy.

If it becomes unresponsive, Kubernetes restarts it automatically.

Spring Boot Actuator makes probe implementation straightforward through endpoints such as:

```bash
/actuator/health/liveness
/actuator/health/readiness
```

When configured correctly, Kubernetes can make intelligent decisions about routing traffic and recovering unhealthy instances without human intervention.

## Final Thoughts

Running Spring Boot on Kubernetes is not just about containerizing an application.

It is about embracing a different operational model.

Instead of managing individual servers, you define desired outcomes.

Instead of manually recovering failures, you allow the platform to self-heal.

Instead of maintaining external service discovery infrastructure, you leverage Kubernetes-native networking.

The teams that succeed with Kubernetes are usually the ones that stop treating it as “Docker at scale” and start treating it as a distributed operating system for their applications.

Once you make that mindset shift, Kubernetes becomes far less intimidating and far more powerful.

Happy learning!!
