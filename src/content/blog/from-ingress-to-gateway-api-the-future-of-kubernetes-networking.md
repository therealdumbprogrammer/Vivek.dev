---
title: "From Ingress to Gateway API: The Future of Kubernetes Networking"
description: "Learn why Kubernetes is gradually moving beyond Ingress, understand the core building blocks of Gateway API, and migrate an existing…"
publishDate: 2026-07-12
tags:
  - kubernetes
draft: false
---

![](https://cdn-images-1.medium.com/max/800/1*c9XudXsRm72tsNsDHslw-A.png)

> *Learn why Kubernetes is gradually moving beyond Ingress, understand the core building blocks of Gateway API, and migrate an existing application without changing a single line of Spring Boot code.*

[Watch on YouTube](https://www.youtube.com/watch?v=5zaHSEpVfzU?feature=oembed)

## Introduction

For years, **Ingress** has been the standard way of exposing HTTP applications running inside a Kubernetes cluster. It gave us a single public entry point, path-based routing, and eliminated the need to expose every Service individually through NodePort.

For most applications, Ingress works remarkably well. You define a few routing rules, install an Ingress Controller such as NGINX, and your applications become accessible from outside the cluster through a clean, unified interface.

As Kubernetes adoption grew, however, so did the complexity of modern application networking. Organizations wanted richer traffic management, support for protocols beyond HTTP, better separation of responsibilities between platform and application teams, and a networking API that wasn’t tightly coupled to a single resource model.

This is exactly why the **Gateway API** was introduced.

Rather than replacing everything Ingress already provides, Gateway API builds upon the same ideas while introducing a cleaner architecture, clearer ownership boundaries, and a more extensible networking model.

The good news is that adopting Gateway API is much simpler than many developers expect.

> ***If your application is already deployed on Kubernetes using Services and Ingress, migrating to Gateway API usually requires little or no change to your application code.***

Your Spring Boot services remain exactly the same.

Your Deployments remain exactly the same.

Your Kubernetes Services remain exactly the same.

The migration primarily happens by replacing one set of Kubernetes networking resources with another.

In this article, we’ll understand why Gateway API was introduced, how its architecture differs from Ingress, and migrate an existing application from Ingress to Gateway API using only Kubernetes resources.

## Why Ingress Needed an Evolution

When Kubernetes introduced Ingress, it solved one of the biggest networking challenges faced by early adopters.

Instead of exposing every application through a separate `NodePort` or `LoadBalancer` Service, Ingress provided a **single entry point** into the cluster. Incoming requests could then be routed to the appropriate Service based on the request path or hostname.

A typical setup looked something like this:

```css
Client
                        │
                        ▼
                Ingress Controller
                        │
                Ingress Resource
                        │
         ┌──────────────┴──────────────┐
         ▼                             ▼
   Order Service                Inventory Service
         │                             │
       Pods                          Pods
```

For many applications, this model is perfectly sufficient.

You install an Ingress Controller such as NGINX — define your routing rules in an Ingress resource, and Kubernetes takes care of forwarding requests to the appropriate Service.

However, as Kubernetes became the de facto platform for running cloud-native applications, networking requirements became significantly more sophisticated.

Large organizations began asking questions such as:

- Can different teams independently manage infrastructure and application routes?
- Can the same API support HTTP, gRPC, TCP, and other protocols?
- Can we standardize networking without depending on controller-specific annotations?
- Can we define traffic management using a richer and more extensible API?

These weren’t problems that Ingress was originally designed to solve.

Ingress was intentionally simple. It focused primarily on HTTP routing and bundled multiple responsibilities into a single resource.

A typical Ingress resource contains both the infrastructure details and the application routing rules.

```makefile
apiVersion: networking.k8s.io/v1
kind: Ingress
```

```
spec:
  ingressClassName: nginx
```

```
  rules:
    - http:
        paths:
          - path: /api/orders
            backend:
              service:
                name: order-service
```

```
          - path: /api/inventory
            backend:
              service:
                name: inventory-service
```

Notice what’s happening here.

This single YAML file answers two completely different questions:

1. **Which controller should process this Ingress?**
2. **How should requests be routed?**

For smaller applications, this isn’t a problem.

For larger platforms, however, it creates an unnecessary coupling between infrastructure configuration and application routing.

Consider a company where a platform engineering team manages the Kubernetes infrastructure while individual application teams own their services.

The platform team should decide **which Gateway implementation is deployed**, which ports are exposed, and how external traffic enters the cluster.

Application teams, on the other hand, should simply define:

> *“Requests matching *`/api/orders`* should go to the Order Service."*

Those concerns are fundamentally different.

Yet with Ingress, they live inside the same resource.

This tight coupling was one of the motivations behind the Gateway API.

Instead of evolving the existing Ingress resource with more fields, more annotations, and more controller-specific extensions, the Kubernetes community chose a cleaner approach:

**Break the responsibilities into smaller, well-defined resources.**

That’s exactly what Gateway API does.

Instead of a single Ingress resource, Gateway API introduces three distinct building blocks:

```typescript
GatewayClass
                  │
                  ▼
              Gateway
                  │
                  ▼
             HTTPRoute
                  │
                  ▼
              Kubernetes
               Services
```

Each resource has a single responsibility.

- **GatewayClass** defines **who** implements the Gateway (for example, NGINX Gateway Fabric).
- **Gateway** defines **where** traffic enters the cluster.
- **HTTPRoute** defines **how** requests should be routed to Services.

This separation may appear like additional complexity at first glance, but it actually makes the system easier to understand.

Each object has a clear purpose.

Infrastructure teams can manage the Gateway without touching application routing.

Application teams can modify routes without needing access to the Gateway configuration.

In other words, Gateway API doesn’t replace the ideas behind Ingress — it refines them by introducing cleaner boundaries between infrastructure and application concerns.

## Understanding the Three Building Blocks of Gateway API

One of the biggest improvements Gateway API brings is a clear separation of responsibilities.

Rather than placing everything inside a single resource, Gateway API breaks networking into three independent components.

```sql
External Client
                      │
                      ▼
                 GatewayClass
                      │
                      ▼
                  Gateway
                      │
                      ▼
                 HTTPRoute
                      │
                      ▼
             Kubernetes Services
                      │
                      ▼
                     Pods
```

Think of these resources as answering three different questions.

ResourceQuestion it answersGatewayClass**Who** implements the Gateway?Gateway**Where** does traffic enter the cluster?HTTPRoute**Where should each request go?**

Let’s look at each one individually.

## GatewayClass — Choosing the Implementation

The first resource is the **GatewayClass**.

Gateway API defines a standard, but it doesn’t perform any routing on its own.

Just as an Ingress Resource required an Ingress Controller, Gateway API also requires a controller capable of interpreting Gateway resources.

That controller is represented by the GatewayClass.

For example, you might choose:

- NGINX Gateway Fabric
- HAProxy
- Envoy Gateway
- Kong Gateway

Conceptually, GatewayClass is simply telling Kubernetes:

> ***“Whenever you see Gateway resources that reference this class, let this controller manage them.”***

You can visualize it like this.

```markdown
                GatewayClass
                      │
      ┌───────────────┼───────────────┐
      │               │               │
   NGINX          HAProxy         Envoy
```

In our implementation, we use **NGINX Gateway Fabric** as the Gateway controller.

The first step in the migration is therefore installing this controller into the cluster.

Once installed, Kubernetes understands how Gateway resources should be processed.

Notice something important here.

As application developers, we don’t interact directly with the controller.

We simply reference its GatewayClass.

The controller takes care of everything else behind the scenes.

## Gateway — The Entry Point

Once a GatewayClass exists, we can create a **Gateway**.

The Gateway represents the point where external traffic enters the Kubernetes cluster.

If you’re familiar with Ingress, think of the Gateway as replacing the “public-facing” part of the Ingress setup.

Its responsibilities include defining things such as:

- Which GatewayClass should manage it
- Which port it listens on
- Which protocol it accepts

For our demo, the Gateway listens on HTTP port 80.

```yaml
                   Internet
                      │
                      ▼
                 Gateway
          Port : 80
          Protocol : HTTP
```

One thing immediately stands out.

There are still **no routing rules**.

The Gateway knows **how traffic enters** the cluster.

It has no knowledge of the applications running behind it.

This separation is intentional.

Infrastructure teams generally own these concerns because they rarely change once an environment is established.

## HTTPRoute — The Routing Rules

The third building block is the **HTTPRoute**.

This is where application-specific routing lives.

Instead of configuring listeners or controller details, an HTTPRoute simply answers the question:

> ***“When a request arrives, which Service should receive it?”***

Suppose our application consists of two Services.

- Order Service
- Inventory Service

The routing logic becomes very straightforward.

```bash
/api/orders
        │
        ▼
Order Service

/api/inventory
        │
        ▼
Inventory Service
```

Each route matches incoming requests and forwards them to the appropriate Kubernetes Service.

Notice that HTTPRoute doesn’t know anything about Pods.

It doesn’t communicate with Deployments.

It simply forwards traffic to Kubernetes Services, allowing the existing Service abstraction to continue handling endpoint discovery and load balancing.

This is one of the strengths of Gateway API.

It doesn’t replace Kubernetes networking.

It builds on top of it.

## Connecting Everything Together

At this point we have three independent resources.

The obvious question becomes:

**How are they connected?**

The relationship is actually very straightforward.

```vbnet
GatewayClass
               (NGINX Gateway)
                      │
              referenced by
                      │
                  Gateway
              app-gateway
                      │
              referenced by
                      │
                 HTTPRoute
          /api/orders
          /api/inventory
                      │
                Order Service
             Inventory Service
```

Each layer references the one above it.

- The **Gateway** references a **GatewayClass**.
- The **HTTPRoute** references a **Gateway**.
- Each routing rule references a Kubernetes **Service**.

This chain allows every component to remain focused on a single responsibility while still working together as one networking solution.

## Why This Design Matters

At first glance, Gateway API may appear more complicated than Ingress because it introduces additional resources.

In reality, it’s doing the opposite.

Instead of one resource trying to solve multiple problems, Gateway API distributes responsibilities across specialized objects.

This provides several practical advantages.

Platform teams can install and manage the Gateway infrastructure without modifying application routes.

Application teams can create or update routing rules without worrying about listener ports or Gateway implementations.

As applications grow and organizations become larger, these ownership boundaries become increasingly valuable.

Most importantly, your existing Spring Boot services remain completely unaware of this migration.

From the application’s perspective, nothing has changed.

It continues serving requests exactly as before.

Only the Kubernetes networking layer has evolved.

## Conclusion

Ingress laid the foundation for exposing applications on Kubernetes, and it continues to power countless production environments today.

Gateway API builds on those same principles while introducing a cleaner resource model, stronger separation of responsibilities, and a more extensible architecture for modern Kubernetes networking.

Perhaps the biggest takeaway is that adopting Gateway API doesn’t require rewriting your applications.

If your services already communicate through Kubernetes Services, the migration is largely about evolving the networking layer — not the application itself.
