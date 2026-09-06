---
title: "GitOps with Argo CD: From Deployment to Recovery"
description: "Build a GitOps delivery loop for Spring Boot on Kubernetes, pin images by digest, understand Synced versus Healthy, and recover failed releases through Git."
publishDate: 2026-09-06
tags:
  - kubernetes
  - spring boot
  - gitops
  - argocd
draft: false
---

Your build passes. The container image reaches the registry. Argo CD picks up the deployment change and reports **Synced**. But the new pod keeps crashing, and the application endpoint still returns the old response.

That sequence is possible because delivering a manifest and running a healthy application are different outcomes. To understand where a release can fail, it helps to follow the whole path: from an application commit, through an image and a deployment proposal, to reconciliation in Kubernetes. Recovery then becomes another change through the same path.

## Move the Deployment Decision into Git

Running `kubectl apply` from a laptop is convenient while learning Kubernetes. As more people and environments become involved, the harder questions are about coordination: which change was approved, which image should run in production, and how do we restore the previous release?

Keeping YAML in Git helps, but it does not ensure that the cluster runs the reviewed version. Someone can apply an uncommitted local change. The repository and the cluster can describe different systems.

In the delivery model used here, application code and deployment configuration have separate responsibilities:

- The application repository contains the Spring Boot code, tests, and Dockerfile. CI builds and publishes the image.
- The configuration repository contains Kubernetes manifests and Kustomize overlays. A reviewed change here authorizes deployment to an environment.

Separate repositories make permissions and ownership easier to manage. They are not a requirement for GitOps. For this example, `app/` and `deploy/` live in one repository, keeping the application and its deployment configuration together.

The delivery sequence is:

```text
Application commit
    |
    v
CI: test, package, build image, push to registry
    |
    v
Deployment PR: update the dev overlay's image digest
    |
    v
Review and merge
    |
    v
Argo CD: render Git configuration and sync resources
    |
    v
Kubernetes: roll out pods and report their state
```

The deployment PR is the handoff. Publishing an image makes it available; merging the configuration change selects it for deployment.

## Pin the Image You Actually Built

An image tag such as `v1` is a name that can point to different images over time unless the registry enforces tag immutability. If `v1` originally pointed to image A and a later push reassigns it to image B, a manifest containing `image: service:v1` no longer identifies the same artifact.

That makes rollback ambiguous. Restoring an old manifest that still says `v1` does not restore the old tag mapping. Image A might still be recoverable through its digest or another retained tag, but `v1` alone is no longer enough.

Immutable tag policies can prevent reassignment. Another approach is to deploy by **image digest**, which identifies content rather than a movable name. Kubernetes supports references such as `registry/service@sha256:...`. The referenced image must still be retained in the registry. See the [Kubernetes image documentation](https://kubernetes.io/docs/concepts/containers/images/).

The pipeline uses two identifiers with different jobs. The GitHub Actions build assigns a tag based on `github.sha`, the source commit. The build action then returns `steps.build.outputs.digest`, the actual image digest. The overlay receives that second value.

A Git commit SHA is not an image digest. Rebuilding the same commit with different dependencies or a different base image can produce a different artifact.

The development overlay pins the image by digest. Replace the example digest below with the output from your own build:

```yaml
# deploy/overlays/dev/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: dev
resources:
  - ../../base
images:
  - name: docker.io/thecodealchemist/delivery-lab
    digest: sha256:748fd47b8344929a39a0f238c6084566a3bf93388e27e2e2c0c78de9ed7477af
```

The image `name` must match the image in the base Deployment. Kustomize then renders the digest reference into the final manifest. The [earlier Kustomize post](/blog/kustomize-why-spring-profiles-fail-in-kubernetes) explains how bases and overlays fit together.

## Let CI Propose the Deployment

The [build workflow](https://github.com/therealdumbprogrammer/delivery-lab/blob/video-2/.github/workflows/build-and-propose-dev.yml) checks out the application, configures Java 21, runs Maven verification, logs in to Docker Hub, and builds and pushes the image. A failing verification step stops the job before it publishes an image or proposes a deployment.

After the build, this step updates the overlay. It assumes Mike Farah's `yq` is installed and that the first `images` entry is the application being released:

```yaml
- name: Pin dev overlay to the new digest
  env:
    DIGEST: ${{ steps.build.outputs.digest }}
  run: |
    yq -i 'del(.images[0].newTag) | .images[0].digest = strenv(DIGEST)' \
      deploy/overlays/dev/kustomization.yaml
```

Removing `newTag` converts the original tag-based configuration to a digest reference. The edit preserves other overlay settings, including patches added by a developer.

The next workflow step opens a PR containing that file. In this repository layout, the build trigger watches `app/**`, so merging a deployment-only PR does not start another application build.

For a separate configuration repository, CI also needs to check out that repository and use credentials scoped to create its deployment branch and PR. The same-repository example does not provide cross-repository access automatically. Docker Hub credentials belong in Actions secrets, and repository settings must permit the workflow to create pull requests.

## Give Argo CD a Repository, Revision, and Path

Once Argo CD is installed in the cluster, an `Application` resource tells it where to find the desired configuration and where to apply it. You can install Argo CD with Helm; the [setup runbook](https://github.com/therealdumbprogrammer/delivery-lab/blob/video-2/RUNBOOK.md) contains the cluster setup and UI access steps.

The following application configuration connects the development overlay to the cluster:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: delivery-lab-dev
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/therealdumbprogrammer/delivery-lab
    targetRevision: master
    path: deploy/overlays/dev
  destination:
    server: https://kubernetes.default.svc
    namespace: dev
  syncPolicy:
    automated:
      prune: true
      selfHeal: false
    syncOptions:
      - CreateNamespace=true
```

Use your repository URL and actual deployment branch. This configuration follows `master`; a repository using `main` should name `main` instead.

Argo CD renders the Kustomize overlay, compares the resulting desired resources with the cluster, and synchronizes differences according to its policy. Kubernetes controllers then manage the rollout. Argo CD does not build the image, and the nodes' container runtimes handle pulling it.

The policy choices matter. `prune: true` allows sync to remove managed resources deleted from Git. `selfHeal: false` means a live-only edit does not, by itself, trigger automatic correction in this example. Enabling self-healing changes that behavior. These are separate options, described in the [automated sync documentation](https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/).

With the application registered, an ordinary release becomes a code PR followed by a deployment PR. After the second merge, Argo CD picks up the new desired state and Kubernetes starts replacing pods.

## Synced and Healthy Answer Different Questions

**Synced** means the desired manifests and the live resources match under Argo CD's comparison rules. It does not mean the new process started successfully.

**Healthy** is a resource health assessment. Argo CD uses resource-specific checks, including Deployment status, to assess whether resources have reached their expected state. Kubernetes probes influence pod readiness and availability, which in turn influence that status. Argo CD is not directly calling every application's health endpoint.

The combinations are useful when diagnosing a release:

| What you see | What to investigate |
| --- | --- |
| Synced and Healthy | The declared resources match and pass their health checks; verify the released behavior too. |
| Synced and Progressing | The configuration matches, but the rollout has not reached its expected state. |
| Synced and Degraded | The configuration matches, but a resource reports a failure condition. |
| Unknown sync status with a comparison error | Argo CD could not determine the comparison, for example because manifest generation failed. |

A healthy resource status is not an end-to-end business test. Broken routing, incorrect responses, or an untested dependency can still require separate verification. The [Argo CD resource health documentation](https://argo-cd.readthedocs.io/en/stable/operator-manual/health/) explains its checks.

## Break the Application Through Configuration

To see how sync and health diverge, add an opt-in startup failure to the Spring Boot application. A bean reads `delivery-lab.demo.startup-failure`, defaulting to `false`, and throws an exception when it is enabled. In the [source implementation](https://github.com/therealdumbprogrammer/delivery-lab/blob/video-2/app/src/main/java/dev/deliverylab/DeliveryLabApplication.java), the exception is thrown by an `ApplicationReadyEvent` listener during startup completion.

After building an image containing that code, a development overlay patch activates it:

```yaml
# deploy/overlays/dev/checkpoint-2-startup-failure.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: delivery-lab
spec:
  template:
    spec:
      containers:
        - name: delivery-lab
          args:
            - --delivery-lab.demo.startup-failure=true
```

The container name matches the base Deployment. Because the Dockerfile uses `ENTRYPOINT ["java", "-jar", "app.jar"]`, this argument reaches Spring Boot as an application property. It is a command-line argument here, rather than an environment variable or JVM `-D` option.

Add the patch reference to the existing overlay, preserving its resources and image digest:

```yaml
patches:
  - path: checkpoint-2-startup-failure.yaml
```

Leave this reference out of the overlay while establishing a healthy baseline, then add it through a configuration PR to trigger the failure. Enabling it changes the pod template, so Kubernetes starts a rollout even if the image digest stays the same.

Once synchronized, the new container exits because of the deliberate exception. Repeated restart failures lead to `CrashLoopBackOff`. Argo CD can still report **Synced**: the Deployment now contains exactly the configuration requested in Git. Its health can remain **Progressing** while the rollout waits, and later become **Degraded** when the Deployment reports failure to progress.

## A Manifest Error Fails Earlier

A deployment can also fail before Kubernetes receives any new resources. For example, a patch reference can mistakenly use `patch` where it needs `path`:

```yaml
# Incorrect: a filename is being supplied as inline patch content.
patches:
  - patch: checkpoint-2-startup-failure.yaml
```

`patch` is valid when supplying the patch content inline. `path` tells Kustomize to read a file. Mixing them up prevents this overlay from rendering, so Argo CD cannot even compare the intended manifests with the live resources. The sync status can become `Unknown`, accompanied by a manifest generation or comparison error.

This is a different investigation from a process crash. Check rendering errors before looking for a new application container:

```bash
kubectl kustomize deploy/overlays/dev
```

This command renders locally without applying anything. Adding overlay rendering to PR validation catches this class of mistake before merge, though it does not prove the application will run successfully.

## Why the Old Pod Can Keep Serving

The endpoint can still respond during this failure because the old pod remains available while its replacement fails. The Deployment has one replica and uses the default rolling-update strategy. Its percentage defaults round to one extra pod and zero unavailable pods for this replica count.

The intended availability constraint can also be expressed explicitly:

```yaml
spec:
  replicas: 1
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
```

Kubernetes can create the replacement, but cannot remove the available old pod while the new one fails to become available. The rollout stalls. The old version continues serving while the new version fails to start. The release has still failed, and unrelated problems can still affect availability.

Inspect both the rollout and the failing pod:

```bash
kubectl -n dev get deployments,replicasets,pods
kubectl -n dev rollout status deployment/delivery-lab --timeout=60s
kubectl -n dev describe pod <new-pod-name>
kubectl -n dev logs <new-pod-name> --previous
```

The previous container's logs are useful when its replacement has already restarted. Check that the endpoint returns the intended new behavior as well as checking availability. An old pod can make a stalled release look successful if all you test is whether the endpoint responds.

The [rolling update post](/blog/kubernetes-rolling-updates-how-pods-get-replaced-without-downtime) develops this model further; the [Kubernetes Deployment documentation](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) specifies the rollout controls.

## Recover by Changing the Desired State

For this deliberate failure, remove the patch reference through a configuration PR. For a faulty image release, restore the last known-good digest. When both code and configuration changed, review both: an old image paired with incompatible new configuration may still fail.

After the recovery PR merges, Argo CD synchronizes the corrected desired state and Kubernetes reconciles the workload. There is no need to rebuild an old image if its digest is still available.

A direct `kubectl rollout undo` changes the live Deployment without correcting Git. With self-healing enabled, Argo CD can restore the bad configuration automatically. With `selfHeal: false`, the mismatch can remain until another sync. Either way, Git still describes the release you meant to undo.

Reverting the configuration PR records the recovery and makes the restored version the desired state. Choose the smallest reversal that restores a compatible image and configuration, without discarding unrelated changes.

Rolling forward uses the same delivery loop: fix the application, run CI, review the new digest proposal, and merge it. When service is impaired and a known-good version is available, rollback can restore service while that fix is prepared. Stateful changes need additional care: reverting manifests does not reverse a database migration or restore changed data.

## Watch the Complete Delivery and Recovery Flow

For a hands-on walkthrough of the delivery pipeline and its recovery paths, watch:

- [Stop Deploying Kubernetes by Hand: GitOps + Argo CD](https://youtu.be/_1nCRT1TufU), with the [delivery setup source](https://github.com/therealdumbprogrammer/delivery-lab/tree/video-1).
- [Why Argo CD Says Synced When Your App Is Broken](https://youtu.be/EFjIM3TmhXQ), with the [failure and recovery source](https://github.com/therealdumbprogrammer/delivery-lab/tree/video-2).

Both are part of the [Hands-on Kubernetes with Spring Boot](https://www.youtube.com/playlist?list=PLpxcSt9FGVVGN-R6obf6ICr5m4SbvwgOo) series.
