---
title: "JWT Simplified for Everyone"
description: "In my previous videos, we explored HTTP Basic Authentication and API Key Authentication.
 We also implemented features like user…"
publishDate: 2025-08-12
tags:
  - security
draft: false
---

[Watch on YouTube](https://www.youtube.com/watch?v=s699504UjeE?feature=oembed)

In my previous videos, we explored [**HTTP Basic Authentication**](https://youtu.be/d1pw2FUnxgs) and [**API Key Authentication**](https://youtu.be/QtK0VNUkfzY).
 We also implemented features like [**user activation via email verification**](https://youtu.be/EQp4tAFU9xM) and [**password reset flows**](https://youtu.be/vq2GWU-Oy8U).

Now, it’s time to dive into one of the most widely used methods for securing modern APIs: **JWT — JSON Web Token**.

## 📌 What is JWT?

**JWT (JSON Web Token)** is:

- A **compact, URL-safe token** exchanged over the internet.
- Contains **JSON-formatted information** (payload).
- Is an **open standard**.
- Can be **digitally signed** and **verified**.

## JWT Payload

```typescript
xxxxx.yyyyy.zzzzz
```

- `xxxxx` → Header
- `yyyyy` → Payload
- `zzzzz` → Signature

## When to Use JWT

**Authorization**

Once the user logs in, the server issues a JWT that’s used for subsequent secured requests.

Commonly used with OAuth.

**Information Exchange**

Can transmit any JSON payload securely.

Not limited to authentication data.

## JWT Structure explained

A JWT has three parts, separated by dots:

```cpp
 ┌────────────┐   ┌──────────────┐   ┌──────────────┐
 │  Header    │ . │   Payload    │ . │  Signature   │
 └────────────┘   └──────────────┘   └──────────────┘
   { "alg":        { "sub":123,        Signed using
     "HS256",        "name":"John",    secret or
     "typ":"JWT" }   "isAdmin":true }  private key
```

## 📬 How JWTs Are Sent

JWTs are usually sent in the **Authorization** HTTP header:

```makefile
Authorization: Bearer <token>
```

## Common JWT Claims

`iss` Issuer — who issued the token

`sub` Subject — who the token refers to

`aud` Audience — intended recipient

`exp` Expiration time `iat` Issued at time

✅ You can also define **custom claims** like `isAdmin: true`.

## Visualizing JWTs with jwt.io

[JWT.io](https://www.jwt.io/) lets you:

Paste a JWT and decode it instantly.

See the **header**, **payload**, and **signature**.

Experiment with algorithms.

Add/remove claims in real-time.

## 🔄 JWT in an Authentication Flow

Important: **JWT itself does not authenticate a user** — it represents authentication data.

**Authentication Flow with JWT**

```java
1. Login Request
    (username, password)
       ↓
 2. Server Authenticates
    (checks DB/user store)
       ↓
 3. JWT Issued
       ↓
 4. Client Stores Token
    (cookie, local storage)
       ↓
 5. Client Sends JWT on
    Subsequent Requests
       ↓
 6. Server Validates JWT
```

## Step-by-Step

**User Login** → client sends username/password.

**Server Authenticates** → verifies credentials against a database.

**JWT Issued** → contains claims about the user.

**Token Storage** → client stores the JWT securely.

**Subsequent Requests** → client includes JWT in `Authorization` header.

**Server Validation** → token decoded & verified before granting access.

## ⏳ Token Expiry and Refresh Tokens

Without an expiry, JWTs would remain valid forever — a big security risk.

## Recommended Setup:

**Access Token (JWT)** → Short-lived (e.g., 15 mins).

**Refresh Token** → Long-lived (e.g., 7 days).

**Access & Refresh Token Flow**

```vbnet
Login → Issue Access Token + Refresh Token
   ↓
Use Access Token for API Calls
   ↓
If Expired → Use Refresh Token
   ↓
Server Issues New Access Token
   ↓
Continue Requests Until Refresh Token Expires
```

## Why Use Refresh Tokens?

Prevents long-lived JWTs (reduces risk if stolen).

Improves UX — user doesn’t need to log in every 15 minutes.

Can be revoked without affecting all users.

## 📝 Key Takeaways

**JWT is not authentication**, it’s a way to securely transmit claims.

Structure: **Header.Payload.Signature**.

Always use short-lived access tokens with refresh tokens.

Send JWTs only over **HTTPS**.

Validate carefully on the server.

I know that this is all theory but my next video will be a hands-on tutorial on JWT. Stay tuned and happy coding!!
