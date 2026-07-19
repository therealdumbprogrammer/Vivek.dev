---
title: "Why Your Database Needs a StatefulSet (Not a Deployment) in Kubernetes"
description: "The concepts you need to understand before running Postgres, or any database, on Kubernetes"
publishDate: 2026-07-13
tags:
  - kubernetes
draft: false
---

![](https://cdn-images-1.medium.com/max/800/1*7HTGy9m2BuPT7Cmvk5mezg.png)

[Watch on YouTube](https://www.youtube.com/watch?v=uInpj2iajAg?feature=oembed)

## The concepts you need to understand before running Postgres, or any database, on Kubernetes

Most people’s first Kubernetes workloads are stateless, things like an API service or a web app that doesn’t care which pod handles a given request. Sooner or later though, someone needs to run a database on the same cluster, and the usual approach, a plain Deployment, quietly falls apart.

Here is why, and what to use instead.

## Why you can’t just throw a database into a regular pod

Stateless workloads are easy to run on Kubernetes because none of them care if their pod dies. Kubernetes kills a pod, spins up a replacement, reattaches it to the same Service, and nobody notices. The new pod has no memory of the old one, and that is fine, because it did not need one.

A database breaks that assumption completely. If Postgres, or any database, runs as an ordinary stateless pod and that pod dies, Kubernetes will happily create a brand new container to replace it, with a brand new identity and zero knowledge of anything the old container had stored. Your data does not crash. It just ceases to have ever existed.

## Decoupling storage from the pod: PV and PVC

Kubernetes solves the durability half of this problem with **Persistent Volumes**. A Persistent Volume represents actual storage, whether that is a directory on disk, a cloud disk, or whatever your infrastructure provides, and it exists completely independently of any pod’s lifecycle. Attach it to a pod, and anything the pod writes lands in that external volume. Kill the pod, and the volume is untouched. The next pod that gets attached to it picks up exactly where the last one left off.

Pods do not talk to a Persistent Volume directly, though. They go through a **Persistent Volume Claim**, which is essentially a request: “I need 1Gi of storage with read write once access, please find me something that satisfies that.” Kubernetes matches the claim to a volume behind the scenes, and the pod never has to know the details.

So a single database pod backed by a PVC and a PV can survive crashes and restarts just fine. That is good, but not good enough for anything resembling production, because there is no redundancy. One pod, one point of failure.

## The real problem: identity, not just storage

Try to scale that setup into something more realistic, say a primary and a couple of replicas, and a new problem shows up that persistent storage alone does not fix. If one of the replica pods dies and Kubernetes replaces it, the replacement has no idea what role it is supposed to play. Was it the primary? A replica? If it is a replica, which node should it be replicating from? A generic Kubernetes Service gives you a stable network endpoint, but it says nothing about *identity*, and database clusters live and die by identity.

This is exactly the gap a **StatefulSet** is built to close.

## What a StatefulSet actually gives you

A StatefulSet is a Kubernetes resource, just like a Deployment or a ConfigMap, but it solves two specific problems: stable identity and predictable startup/shutdown ordering.

Instead of pods getting random names, a StatefulSet names them deterministically, something like `pg-0`, `pg-1`, `pg-2`, and their PVCs follow the same naming convention. When `pg-1` dies, its replacement is not just *a* new pod, it is specifically `pg-1`again, reattached to the exact same PVC and the exact same underlying volume. The identity crisis disappears.

The ordering guarantee matters too. Pods start in sequence, `pg-0` first, then `pg-1`, then `pg-2`, and shut down in reverse. For a database cluster where a primary needs to exist before replicas try to sync from it, that ordering is not a nice to have, it is the whole point.

That’s why databases get deployed as StatefulSets, not Deployments.

## Deploying a database on Kubernetes

With the theory out of the way, the actual deployment usually comes down to two YAML files.

**A Secret**, holding the database username, password, and database name, since these are sensitive values that do not belong in plain text config.

**A StatefulSet**, defining the database container itself (image, port, environment variables sourced from the Secret), a `volumeClaimTemplate` for the storage, which lets Kubernetes create the PVC and PV automatically, a readiness probe that can run a command instead of hitting an HTTP endpoint, labels for matching, and a replica count that matches how much redundancy you actually need.

Alongside the StatefulSet, a **headless Service** links everything together via `clusterIP: None`, matched to the same pod labels and tied to the StatefulSet through `serviceName`. Once the namespace, Secret, and StatefulSet are deployed, `kubectl get pods`shows exactly what you would expect: pods named with predictable, ordered suffixes like `-0`, `-1`, and so on, each backed by its own PVC following the same naming pattern.

## Wiring an application up to it

On the application side, connecting a Spring Boot service to a database like this follows the usual Spring Data checklist:

- Add the JDBC or JPA starter, the database driver, and a migration tool like Flyway to your build file
- Add a migration file so the schema gets created automatically on first startup
- Point your configuration at the database, with sane local defaults for development
- Override those defaults via a **ConfigMap** for non-sensitive values like the JDBC URL, and a **Secret** for the username and password
- Write a small repository layer for your queries
- Wire the controller to that repository instead of any in-memory storage

Once deployed, the application connects to the database using its Kubernetes DNS name, the migration tool applies its first migration, and the schema is in place. From there, every request that touches the database is landing in real, durable storage, something that survives pod restarts in a way in-memory storage never could.

## The takeaway

StatefulSets are not just “Deployments for databases.” They exist because databases need two things Deployments were never designed to give them: durable storage tied to a specific pod identity, and a strict, predictable order of startup and shutdown. Once you understand Persistent Volumes, Persistent Volume Claims, and StatefulSets as three separate but connected pieces, running a real database on Kubernetes stops feeling like magic and starts feeling like plumbing.

*If you want to see this entire setup built step by step, from the YAML to the Spring Boot code to the live demo, I cover it in detail on my YouTube channel, *[*The Code Alchemist*](https://www.youtube.com/@the_codealchemist)*, where I focus on Java, Spring Boot, Kubernetes, and cloud native engineering.*
