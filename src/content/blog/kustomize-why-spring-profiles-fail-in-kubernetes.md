---
title: "Kustomize: Why Spring Profiles Fail in Kubernetes"
description: "Spring Profiles configure an application, but they cannot manage environment-specific Kubernetes manifests. Learn how Kustomize bases and overlays prevent duplicated YAML and configuration drift."
publishDate: 2026-08-13
tags:
  - kubernetes
  - java
  - spring boot
  - kustomize
draft: false
---

A Spring Boot application often starts with one environment. A `default` profile is enough, the deployment has one replica, and the service URL is fixed. Then the application needs to run in development, staging, and production.

The usual instinct is to reach for Spring Profiles. That is the right tool when the value belongs to the application: a feature flag, a database connection property, or an integration endpoint consumed by the application at runtime.

It is the wrong tool when the value belongs to Kubernetes. Replica counts, container resources, image tags, namespaces, routes, and autoscaling rules are deployment concerns. They live in Kubernetes manifests, outside the JAR. Putting every environment-specific decision into separate copies of those manifests creates a different problem: duplicated YAML that gradually drifts apart.

Kustomize solves that problem by separating the shared Kubernetes configuration from the small set of changes that each environment needs.

## The Configuration Problem Is Outside the Application

Consider a small Spring Boot service with a ConfigMap, Deployment, and HTTPRoute. A single set of manifests might be enough locally:

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo-service
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: app
          image: demo-service:latest
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
```

Production may need eight replicas, a versioned image, more memory, an HPA, and a production hostname. Staging may need an entirely different namespace and only two replicas. Those are valid differences, but copying `deployment.yaml`, `configmap.yaml`, and `httproute.yaml` into `dev`, `stage`, and `prod` directories is expensive to maintain.

Every copy needs to stay structurally consistent. Add a readiness probe to the development Deployment and it is easy to forget to add it to staging. Fix a Service port in production but not in the other copies and the manifests are now describing different applications.

This is configuration drift. The more environments and resources a service has, the harder it becomes to spot.

## Why Spring Profiles Do Not Fix It

Spring Profiles choose configuration *inside* a running Spring application. For example, an application can load a different logging level or datasource URL through profile-specific property files:

```properties
# application-prod.properties
logging.level.root=WARN
```

That is useful application configuration. But Spring cannot use a profile to change the replica count of a Deployment, add a HorizontalPodAutoscaler, or replace the hostname in an HTTPRoute. Kubernetes reads those values before the application container is even running.

A ConfigMap does not solve the broader problem either. It is a Kubernetes resource for supplying data to workloads. It does not compose or transform the other manifest files that define the workload.

The useful boundary is simple:

- Spring Profiles configure how the application behaves.
- Kubernetes manifests configure how the application is deployed.
- Kustomize manages environment-specific variations of those manifests.

Keeping that boundary clear makes both sides easier to reason about.

## Kustomize Uses Bases and Overlays

Kustomize works with two layers.

The **base** contains the Kubernetes resources shared by every environment. An **overlay** starts with that base and describes only what changes for one environment. Kustomize builds those layers into a final set of standard Kubernetes manifests.

```
k8s/
├── base/
│   ├── configmap.yaml
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── httproute.yaml
│   └── kustomization.yaml
└── overlays/
    ├── dev/
    │   ├── deployment-patch.yaml
    │   ├── configmap-patch.yaml
    │   ├── httproute-patch.yaml
    │   └── kustomization.yaml
    └── prod/
        ├── deployment-patch.yaml
        ├── httproute-patch.yaml
        ├── hpa.yaml
        └── kustomization.yaml
```

The base `kustomization.yaml` lists the resources that form the common application:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - configmap.yaml
  - deployment.yaml
  - service.yaml
  - httproute.yaml

labels:
  - pairs:
      app.kubernetes.io/name: demo-service
```

The file must be named `kustomization.yaml` (or one of Kustomize's supported alternatives). It tells Kustomize which resources to include and which transformations to apply.

## Describe Only the Difference in an Overlay

The development overlay can set a namespace, pin an image tag, and apply small patches to the base resources:

```yaml
# overlays/dev/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - ../../base

namespace: development

images:
  - name: demo-service
    newTag: dev-42

patches:
  - path: configmap-patch.yaml
  - path: deployment-patch.yaml
  - path: httproute-patch.yaml
```

The Deployment patch contains only the development-specific fields:

```yaml
# overlays/dev/deployment-patch.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo-service
spec:
  replicas: 2
```

Likewise, an HTTPRoute patch changes only the host for this environment:

```yaml
# overlays/dev/httproute-patch.yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: demo-service
spec:
  hostnames:
    - dev.demo.local
```

Kustomize identifies the target resource using its API version, kind, and metadata name, then merges the patch with the matching base resource. The final rendered Deployment includes the base container, Service labels, and resources, with the overlay replica count applied.

This matters because the overlay is not a second Deployment definition. It is a small, intentional diff from the shared configuration.

## Production Can Add Resources Too

An overlay is not limited to patching existing resources. Production can add resources that do not make sense in local development, such as an HPA:

```yaml
# overlays/prod/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - ../../base
  - hpa.yaml

namespace: production

images:
  - name: demo-service
    newTag: 1.0.1

patches:
  - path: deployment-patch.yaml
  - path: httproute-patch.yaml
```

```yaml
# overlays/prod/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: demo-service
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: demo-service
  minReplicas: 4
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

The final production output contains the shared resources, the production patches, and the HPA. The base does not need to contain a placeholder HPA just because one environment uses it.

## Build and Apply an Environment

`kubectl` includes Kustomize support. Instead of applying one file with `-f`, point it at the overlay directory with `-k`:

```bash
kubectl apply -k k8s/overlays/dev
```

Kustomize renders the base plus the development overlay before `kubectl` sends the resulting resources to the API server. Kubernetes still receives ordinary manifests. Kustomize is a build step, not a new runtime resource in the cluster.

It is often useful to inspect that output before applying it:

```bash
kubectl kustomize k8s/overlays/dev
```

One detail is easy to miss: setting `namespace` in an overlay applies that namespace to namespaced resources, but it does not create the Namespace resource. Create it separately or include a `Namespace` manifest in the overlay before applying the workload.

## The Practical Takeaway

Kustomize does not replace Spring Profiles. It keeps them focused on the configuration they were designed to handle.

Use a Spring Profile when the application needs to behave differently at runtime. Use a Kustomize overlay when Kubernetes needs to deploy the same application differently. A shared base gives every environment one source of truth, and overlays make the differences visible without duplicating the entire YAML stack.

That structure becomes more valuable as the application gains resources, environments, and deployment requirements.

## Watch the Full Walkthrough

The video walks through a base-and-overlay setup for a Spring Boot application, including environment-specific patches, image tags, namespaces, and production-only resources.

[Watch the video on YouTube](https://youtu.be/mNgbozYHuWw)

This is part of the [Hands-on Kubernetes with Spring Boot](https://www.youtube.com/playlist?list=PLpxcSt9FGVVGN-R6obf6ICr5m4SbvwgOo) series.
