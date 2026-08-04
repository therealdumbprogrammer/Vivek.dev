---
title: "Kubernetes Rolling Updates: How Pods Get Replaced Without Downtime"
description: "What actually happens when Kubernetes replaces your Spring Boot pods during a deploy, how maxSurge and maxUnavailable control the rollout, and why a rollback is just a rolling update in reverse."
publishDate: 2026-08-04
tags:
  - kubernetes
  - java
  - spring boot
  - rolling updates
draft: false
---

You change the image version in your deployment, run `kubectl apply`, and Kubernetes replaces your pods. The rollout finishes and the new version is live.

But what happened in between? Kubernetes had to delete pods that were serving traffic and start new ones that weren't ready yet. For a window of time, the cluster was in a mixed state.

Whether that window costs you dropped requests depends entirely on how the rollout is configured. Here's what Kubernetes is actually doing during that window, and which settings control it.

## Desired State and Current State

Everything starts with the reconciliation loop.

Say you deploy an app with image version `v1` and `replicas: 2`. Kubernetes creates two pods running `v1`. The desired state and the current state match, so nothing happens.

Later you change the image to `v2` and apply it. Now the desired state says `v2`, but the current state still says `v1`. The reconciliation loop notices the mismatch and starts working to close it.

The interesting part is *how* it closes that gap. There are several ways to get from two `v1` pods to two `v2` pods, and most of them are bad.

## Three Ways This Goes Wrong

**Delete everything first.** Kubernetes kills both `v1` pods, then creates two `v2` pods. Simple, and it works eventually. But between the moment the old pods die and the moment the new ones are ready, there is nothing serving traffic. Every incoming request during that window fails. That's a downtime window, and it's exactly what a rolling update is supposed to prevent.

**Replace them one at a time, but too eagerly.** Kubernetes creates a `v2` pod, kills a `v1` pod, creates another `v2` pod, kills the last `v1` pod. There's no downtime, because something is always running. But once the last `v1` pod is gone, there is no known-good version left in the cluster. If `v2` has a startup bug or fails on the first real request, you have no stable pod to fall back on.

**Trust the new pods too early.** Kubernetes creates a `v2` pod and immediately deletes a `v1` pod to make room, then repeats. Now both pods are `v2`, but neither has finished starting up. The pod count looks correct, so nothing seems wrong. But no pod is actually able to serve a request.

The common thread is that pod count is not the same thing as availability. A pod existing and a pod being ready to serve traffic are two different states, and Kubernetes needs a way to reason about the difference.

## Deployments Don't Create Pods

Before the fix, one piece of the model is worth getting right, because rollbacks make no sense without it.

A Deployment never creates pods directly. It creates a **ReplicaSet**, and the ReplicaSet creates the pods.

When you deploy `v1`, you get a Deployment, one ReplicaSet for `v1`, and two pods underneath it.

When you release `v2`, Kubernetes does not modify the existing ReplicaSet. It creates a **new** ReplicaSet for `v2`, and all new pods are created under that one. As the new pods come up, the old ReplicaSet is scaled down.

The important detail: the old ReplicaSet is **scaled to zero, not deleted**. It stays attached to the Deployment with zero pods, still holding the full pod template, including the old image version.

```
Deployment
├── ReplicaSet (v1)  → 0 pods   (scaled down, still knows about v1)
└── ReplicaSet (v2)  → 2 pods   (current)
```

Release `v3` and you get a third ReplicaSet, with `v2` now scaled to zero as well. This is how a Deployment keeps its rollout history, and it's the reason rollbacks are cheap.

## maxSurge and maxUnavailable

Now the actual controls.

During a rollout, Kubernetes repeatedly asks itself two questions: *can I create a new pod?* and *can I delete an old one?* Two settings answer them.

**`maxSurge`** answers the first. It's how many pods Kubernetes may create *above* your desired replica count. With `replicas: 2` and `maxSurge: 1`, the cluster may temporarily hold three pods, but not four.

**`maxUnavailable`** answers the second. It's how many of your desired replicas are allowed to be unavailable at once. With `replicas: 2` and `maxUnavailable: 0`, all two replicas must stay ready throughout the rollout, so Kubernetes cannot delete an old pod until a new one is ready to take its place.

For a desired count of `n`, the bounds are:

- Kubernetes may run at most `n + maxSurge` pods
- Kubernetes must keep at least `n - maxUnavailable` ready pods

This is where readiness probes stop being optional. `maxUnavailable` is defined in terms of *ready* pods, and the only way Kubernetes knows whether a pod is ready is the readiness probe. Without one, a pod is treated as ready as soon as its container starts, which is usually well before your Spring Boot application can serve a request. The safety guarantee is only as accurate as the probe behind it.

## What Saves You When the New Version Is Broken

This combination is what protects you from a bad release. Walk through a rollout where `v2` has a readiness bug, with `replicas: 2`, `maxSurge: 1`, and `maxUnavailable: 0`.

Kubernetes creates a `v2` pod. It never becomes ready, because the readiness probe keeps failing. The cluster now has two ready `v1` pods and one unready `v2` pod, which is three total, right at the `maxSurge` ceiling.

Can it create another pod? No, three is the limit.

Can it delete a `v1` pod? Also no. Deleting one would leave a single ready pod, and `maxUnavailable: 0` requires two. So Kubernetes stops.

The rollout stalls, and stalling is the correct behavior. Your old version keeps serving traffic at full capacity while the broken new version sits there failing its probe. Nothing is dropped. The rollout simply never completes, which is a much better outcome than a cluster full of pods that can't answer a request.

## The Configuration

Here's what this looks like in a deployment manifest:

```yaml
spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
```

`maxUnavailable: 0` is the setting that makes this a genuine zero-downtime rollout. It costs you a little extra capacity during the deploy, since you briefly run `n + 1` pods, and it makes rollouts slightly slower, because each new pod must become ready before an old one is removed. That tradeoff is almost always worth it for a request-serving application.

There's one more piece, and it's the subject of the [previous post in this series](/blog/kubernetes-pod-lifecycle-how-to-enable-graceful-shutdown). `maxUnavailable` protects you on the *startup* side by making sure new pods are ready before old ones go away. It does nothing for the *shutdown* side. When Kubernetes finally deletes an old pod, that pod may still be processing requests. Without `server.shutdown=graceful` and a `terminationGracePeriodSeconds` that accommodates it, those in-flight requests are dropped even with a perfectly configured rollout.

Both halves have to be right. A correct `maxUnavailable` with a non-graceful shutdown still loses requests on every deploy.

## Watching a Rollout Happen

The rollout is easier to believe once you watch it. Three terminals are enough.

Apply the new version:

```bash
kubectl apply -f deployment.yml
```

Watch the pods change state in real time:

```bash
kubectl get pods -w
```

And track the rollout itself:

```bash
kubectl rollout status deployment/<deployment-name>
```

The sequence you'll see with `maxSurge: 1` and `maxUnavailable: 0` is exactly what the rules predict. A new pod appears in `Pending`, then `ContainerCreating`, then `Running`. Only after it's running does one of the old pods move to `Terminating`. Then the next new pod is created, and the last old pod is terminated after it comes up.

Notice that `kubectl rollout status` blocks. It doesn't return the moment you apply the change; it waits for the whole replacement process to finish. That blocking behavior is useful in a deployment pipeline, since it's the difference between "the manifest was accepted" and "the new version is actually serving traffic."

You can confirm the ReplicaSet behavior afterwards:

```bash
kubectl get replicasets
```

The old ReplicaSet is still listed with zero pods. The new one holds the full replica count.

To see which ReplicaSet owns a given pod:

```bash
kubectl describe pod <pod-name>
```

The `Controlled By` field points at the ReplicaSet that created it.

## Rollback Is Just a Rolling Update in Reverse

Once the ReplicaSet model is clear, rollback stops being a special operation.

```bash
kubectl rollout undo deployment/<deployment-name>
```

By default this goes back one revision. Kubernetes doesn't need to rebuild anything or look up an old image, because the previous ReplicaSet is still sitting there with its pod template intact. It scales the current ReplicaSet down to zero and scales the previous one back up.

That's the same rolling update process, running in the other direction, with the same `maxSurge` and `maxUnavailable` rules applied. Which also means a rollback is zero-downtime for exactly the same reasons a rollout is, and it fails in the same ways if those settings are wrong.

This is the practical payoff of ReplicaSets never being deleted. Your rollout history is a set of ready-to-go pod templates, and rolling back is just picking an earlier one.

## The Takeaway

A rolling update is not automatically a zero-downtime update. Kubernetes gives you the mechanism, but the guarantees come from configuration you have to supply.

Three things need to be true:

- A readiness probe that reflects when your application can actually serve requests, because every availability guarantee is computed from it
- `maxUnavailable` set low enough, ideally `0`, so old pods are only removed once new ones are ready
- Graceful shutdown configured, so the pods being removed finish their in-flight requests instead of dropping them

Get those right and both rollouts and rollbacks become uneventful, which is the goal.

## Watch the Full Walkthrough

I recorded a hands-on demo where I deploy a Spring Boot app, roll out a new version, watch the pods swap in real time, and then roll the whole thing back with a single command.

[Watch the video on YouTube](https://youtu.be/ikhTjrGVBEI)

This is part of my [Hands-on Kubernetes with Spring Boot](https://www.youtube.com/playlist?list=PLpxcSt9FGVVGN-R6obf6ICr5m4SbvwgOo) series, where I cover everything from building container images to running production workloads.
