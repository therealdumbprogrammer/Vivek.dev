---
title: "Caching — A Quick Guide"
description: "TL;DR (Caching Playlist)"
publishDate: 2026-07-19
tags:
  - caching
draft: true
---

## TL;DR (Caching Playlist)

[Watch the playlist on YouTube](https://www.youtube.com/playlist?list=PLpxcSt9FGVVH4M_yg8K0kFa8yU2Ih8iat)

## What is Caching?

Caching is about storing frequently access data somewhere close to the caller for the fast retrieval.

### Do you store the whole dataset?

Depends on the use-case and the volume of dataset. Generally, we store a subset of data also known as hot or frequently accessed data.

### For how long do you store the data?

Generally the storage is transient/temporary. However, data can be cached for a long duration of time with the help of expiration, eviction, and invalidation as/when required.

## Cache Hit & Miss

When you find the requested data in the cache, that’s called a cache hit.

When you don’t find the requested data in the cache, that’s called a cache miss.

> We want higher cache hits and cache misses as low as possible.

## Eviction vs Expiration vs Invalidation

## Expiration

Expiration is about when to consider a cached value stale.

Doesn’t necessarily removes an entry but it tells whether or not a cached entry should be considered **stale**.

### Time-Based

Cached is considered valid for a specific time duration. Generally implemented using TTL(time to live) values with entries.

Suppose an entry has a TTL value of 50 secs which means it’ll be considered a stale/expired entry after 50 secs.

### Idle-time Based

### Version Based

### Priority Based

## Eviction

Eviction is about actually evicting, removing, or replacing cached items from a cache.

### LRU

### MRU

### FIFO

### LFU

## Invalidation

Invalidation is about explicitly invalidating cached entries.

## Consistency

## Coherence

## Caching Strategies

### Cache Aside

### Read Through

### Write Through

### Write Back
