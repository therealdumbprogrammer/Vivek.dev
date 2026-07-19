---
title: "Role of Service Discovery in Microservices"
description: "TL;DR"
publishDate: 2023-09-26
tags:
  - microservices
draft: false
---

## TL;DR

[Watch on YouTube](https://www.youtube.com/watch?v=jbDvU6ce-a8?feature=oembed)

In Microservices architecture, we have different services instead of a monolithic application/service. On top of that, each service would have multiple instances.

> We used to have one application but now we have several applications.

![](https://cdn-images-1.medium.com/max/800/1*M2LmZDq8xe9Xv-8ngh1kUg.png)

## So, what’s the problem here?

As people say — all kind of things will go wrong as soon as you go from one instance to multiple instances.

Your application would have an address i.e. where to find it, how to connect to it. So, for instance, an IP and a port. Let’s say your application’s address is — [http://someip/abc](http://someip/abc) and it internally uses port 8081.

> When there’s a single application — you and the clients(client apps) know where it’s running.

A client app can use this IP and Port information to talk to your application.

Consider we add another instance of the same application. Now, we can’t run the new instance with the same port on the same host due to port conflicts, there are other ways to solve this problem.

Also, now we have to keep this information somewhere that this application has two instances and what are the addresses of these instances.

**What if the instance goes down?**

If an instance goes down, we need to remove it and add a new one. But, we also need to update the information(wherever we kept earlier) i.e. remove the crashed instance’s metadata and add the details of newly created instance.

**What if we scale up and down?**

What if we scale up to 100 instances and down to 1 when not required? How to keep the metadata updated for all created and destroyed instances?

**How does the client know which instance to call?**

How do we redirect the client calls in load balanced way? How does the client find the correct address of an instance to call the application?

![](https://cdn-images-1.medium.com/max/800/1*PwErEY6MC2W6HC1ThbpL_A.png)

> **You got it right, this is not going to be an easy task in a Microservices architecture!**

Let’s see how a Service Discovery solution can solve these problems..

## Service Discovery

> Service discovery is the process of automatically detecting devices and services on a computer network. This reduces the need for manual configuration by users and administrators. — Wikipedia

This is generally a two step process:

1. **Registration **— In this step, services(or their instances) register themselves with the Service Discovery when they’re coming up.
2. Discovery — Once the discovery service has the metadata about registered services, clients or other services can query the discovery service to find the required information about other services.

![](https://cdn-images-1.medium.com/max/800/1*rBUlQJAVw6pA7rtzINcwSg.png)

## Problems addressed by Service Discovery

**Registering and de-registering Services — **As discussed above, services can register themselves with the discovery service. In the same way, a particular instance of a Service can be deregistered as well in case of a crash or server failure.

**Monitoring** — Discovery service can monitor registered service so it knows what’s the status of different services and their instances. This information is useful in scaling and load balancing scenarios.

**Locating Services **— With the help of discovery service, clients(could be different services) can locate other services without knowing explicit host, port, or IP.

## Different Service Discovery Solutions

There are different ways to implement a service discovery solution, to name a few:

1. **Netflix Eureka**

[Watch on YouTube](https://www.youtube.com/watch?v=wTjnFzs8rBc)

[Watch on YouTube](https://www.youtube.com/watch?v=clBKsG_kpVs?feature=oembed)

**2. Consul**

[Watch on YouTube](https://www.youtube.com/watch?v=2INO3NYKqZk?feature=oembed)

**3. Zookeeper**

[Watch on YouTube](https://www.youtube.com/watch?v=1zyGkjHLeCo?feature=oembed)

**4. Kubernetes supported discovery service**

Happy Learning!!
