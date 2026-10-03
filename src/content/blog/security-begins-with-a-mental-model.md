---
title: "Security Before Frameworks: A Practical Mental Model for Backend Engineers"
description: "A practical way to reason about identity, trust boundaries, authorization, risk, and failure before choosing security configuration."
publishDate: 2026-10-03
tags:
  - security
  - backend engineering
  - architecture
draft: true
---

An API receives this request:

```http
DELETE /users/91823
```

The caller is authenticated. Should the request succeed?

There is no honest way to answer yet. We know that somebody logged in, but we do not know who they are, whether they may delete users, whether they may delete this particular user, or whether deleting an account should require stronger proof than the caller presented at login.

That small example captures a mistake I see often in backend security: we start with the mechanism. We ask which filter to add, how to validate a JWT, or where to put an authorization annotation. Those are implementation questions. The security question comes first:

> What trust decision is this system making, and what happens if that decision is wrong?

Frameworks are useful once that decision is clear. Before then, configuration can give us a secure-looking application built on vague assumptions.

This article develops a mental model for finding those assumptions. We will use ordinary backend systems, HTTP endpoints, gateways, services, databases, and payment operations. The ideas apply whether the final implementation uses sessions, OAuth, an identity provider, a service mesh, or none of them.

## Start with what can be lost

Consider a banking API. Its assets include the obvious things: credentials, personal data, account balances, signing keys, and audit records. But data is only part of the picture.

`POST /transfer` is also an asset. More precisely, it is a capability. An attacker who can invoke it successfully may cause more harm than one who can read a database row.

The same is true in less dramatic systems. Changing a delivery address, issuing a refund, creating an administrator, or deploying to production are all capabilities worth protecting. Asking only “Which data is sensitive?” misses them.

Once the assets are visible, identify the actors that can affect them. A typical application has more actors than “user” and “attacker”:

```text
Human user              Administrator
Browser                 Mobile application
Backend service         External partner
Developer               Compromised internal service
```

The last one is easy to overlook. A service that is legitimate today can become a threat actor tomorrow because of a vulnerability, leaked credential, or bad deployment. Internal software should not receive unlimited trust simply because it lives on the company network.

Now draw the system and mark every place where identity, authority, ownership, or operational control changes:

```text
Browser / Mobile App
        │
        ▼
     API Gateway
        │
        ▼
   Order Service ──────► Payment Service
        │
        ▼
    Order Database
```

Each arrow crosses a trust boundary. So does a developer deploying to production, a pod calling the Kubernetes API, and a service sending data to an external payment provider.

A gateway may be one boundary, but it is not the end of trust decisions. If the gateway authenticates Alice and forwards her request, the Order Service still has to decide whether Alice owns the requested order. If the Order Service calls the Payment Service, the Payment Service may need to know both which service made the network call and which user caused it.

It is tempting to draw one box around the internal network and label everything inside it “trusted.” That label hides the questions we actually need to answer:

```text
Can traffic reach the service without passing through the gateway?
Can another workload forge the identity headers?
Which service accounts can open the connection?
What happens if one internal service is compromised?
Was the credential presented to the service actually meant for it?
```

Being inside Kubernetes does not answer any of these. Kubernetes changes how workloads are scheduled and connected. It does not automatically make one pod trustworthy to another, narrow a service account, or prove the origin of an HTTP header.

A trust boundary is more than a line between “outside” and “inside.” It appears wherever an assumption changes. The browser is untrusted input to the gateway. The gateway's statement about Alice is input to the Order Service. The Order Service's payment request is input to the Payment Service. Database credentials cross another boundary because they turn application code into database authority.

A component can be trusted for one purpose and still be the wrong place to make another decision. The gateway may be trusted to validate a token and reject malformed traffic. It usually lacks the order data required to decide whether Alice owns order `991`.

For any request, five questions provide a useful starting point:

```text
Who is making the request?
        ↓
How do we know?
        ↓
What are they allowed to do?
        ↓
Which resource are they acting on?
        ↓
What happens if our assumptions are wrong?
```

These questions lead to identity, authentication, authorization, the asset being protected, and the threat. A security framework helps with some of this work. It cannot decide what the business is willing to trust.

Return to `DELETE /users/91823`. A useful review would ask:

- Who is the caller, and how was that identity authenticated?
- Does this identity have permission to delete accounts?
- May it delete user `91823` specifically?
- May an administrator delete their own account?
- Does this action require recent or stronger authentication?
- What must be recorded for investigation and recovery?

One endpoint has already taken us beyond “authenticated or not” into permissions, object ownership, step-up authentication, policy, and auditability.

## Authentication is one link in a longer chain

Security vocabulary can feel pedantic until two similar words lead to different designs. Identity, credential, authentication, principal, session, and authorization are related, but they are not interchangeable.

An identity is the person or system we are talking about: `user-1842`, `vivek@example.com`, `order-service`, or perhaps a particular device.

A credential is evidence presented by a caller. Passwords, API keys, private keys, certificates, session cookies, access tokens, and passkeys are all credentials. A credential is not the identity. If somebody steals a bearer token, they may act as its subject without becoming that person.

Authentication is the process that decides whether the evidence is good enough to accept the claimed identity:

```text
Claimed identity + credential
              │
              ▼
      Authentication process
              │
              ▼
      Authenticated identity
```

“Good enough” depends on context. A password may be acceptable for viewing a profile but insufficient for changing an MFA device or transferring a large amount of money. Both requests can involve the same user while carrying different levels of authentication assurance.

That makes authentication more than a boolean in systems with sensitive operations. Two requests can have the same principal and different authentication histories:

```text
Alice + password
Alice + password + hardware-backed passkey
```

The application might allow both to view an account, while requiring the second for a large transfer. This is the basis of step-up authentication: the existing identity is not discarded, but the operation requires stronger or more recent evidence.

A role such as `ADMIN` describes authority; it says nothing about how confidently the identity was established for this request. Conversely, strong authentication does not grant permission. A user authenticated with a passkey does not become an administrator.

After authentication, application code needs a usable representation of the result. That representation is commonly called the principal. It may contain a subject identifier, username, tenant, roles, or claims. The identity might be managed by an external provider; the principal is what the application works with.

The application also needs a way to carry that authenticated state into later requests. In a traditional web application, the server might create a session and send a session cookie to the browser:

```text
username + password
        │
        ▼
Server authenticates user
        │
        ▼
Session created ──────► session cookie
```

The password established the initial authentication. The cookie later acts as a credential for the existing session. This difference is one reason browser security cannot be understood by treating passwords and cookies as the same thing.

It also changes the threat model. A stolen password can be used to create new sessions until it is changed or otherwise blocked. A stolen session cookie may let an attacker reuse one already-authenticated session without ever knowing the password. Session expiry, rotation, revocation, cookie attributes, and protection against cross-site requests address different parts of that problem.

A token-based API moves some responsibilities elsewhere:

```text
User authenticates with Identity Provider
                   │
                   ▼
             Token is issued
                   │
                   ▼
API validates issuer, signature, expiry, audience and claims
```

The API usually does not check the user's password. It decides whether to trust the authority that issued the token and whether the token is acceptable for this API.

That decision has several parts. A valid signature only proves that the token was signed by the corresponding key. The API still needs to decide whether it trusts the issuer, whether the token has expired, whether its audience includes this API, and whether the claims carry enough authority for the operation. A correctly signed token intended for a different service is not automatically acceptable here.

This separation is useful operationally. The identity provider owns the login ceremony and credential policy. The API owns the decision about access to its resources. Confusing those responsibilities often leads to APIs that accept any technically valid token without checking whether it was issued for the right audience or purpose.

Only then do we reach authorization: may this principal perform this action on this resource under the current conditions?

```text
Principal: user-1842
Action:    READ
Resource:  order-9981
Context:   tenant=acme
              │
              ▼
          ALLOW / DENY
```

That is richer than `hasRole("USER")`. A fully authenticated customer can still exploit an API that forgets to check order ownership.

The chain is worth keeping intact:

```text
Identity
   ↓
Credential
   ↓
Authentication
   ↓
Principal
   ↓
Session or token
   ↓
Authorization
```

OAuth and OIDC become easier to reason about when each part has a place in this chain. “Login” no longer has to carry the meaning of all six.

## A request can carry more than one identity

Suppose Service A receives Alice's token and calls Service B. Who is calling Service B?

There are several valid answers:

```text
Alice
Service A
Both Alice and Service A
Service A acting with delegated authority from Alice
```

Those are different architectures. Service B may care that Alice initiated the operation, that Service A made the connection, and that Service A is allowed to act for Alice.

This is where a simple “trusted internal service” model starts to fray. Imagine that a gateway authenticates a request and forwards these headers:

```http
X-User-Id: 1842
X-Role: ADMIN
```

Service A trusts the headers. It forwards them to Service B, which trusts Service A. The resulting chain looks like this:

```text
Gateway trusts the identity provider
Service A trusts the gateway
Service B trusts Service A
```

Service B is now trusting what Service A says about what the gateway said about the identity provider's decision. That may be acceptable, but it should be a deliberate architecture choice. A compromised Service A, an accidentally exposed route to Service B, or a caller able to forge the headers can break the chain.

An unsigned header is an assertion. A signed token can carry evidence that Service B validates independently:

```text
Who issued it?
Is the signature valid?
Has it expired?
Was it intended for this service?
Which subject and authority does it represent?
```

This does not mean every service should always receive the user's JWT. Independent validation improves isolation, but it also brings key discovery, issuer and audience configuration, token propagation, and policy consistency to every service. Sometimes a tightly isolated network and a trusted gateway are reasonable. In that design, the trust boundary has moved; it has not disappeared.

Compare the two choices directly.

If the gateway is the only component that validates end-user identity, downstream services depend on network isolation, correct routing, protected identity headers, and the absence of alternate ingress paths. Operations are simpler because token validation lives in one place. A gateway bypass or spoofed internal assertion has a larger impact.

If every service validates the end-user token, each service can establish the issuer, subject, audience, expiry, and claims for itself. A bypassed gateway does not automatically bypass identity validation. The cost is repeated configuration, consistent policy across services, dependency on keys or discovery metadata, and a plan for carrying an appropriate token through the call chain.

Neither choice removes the need for application authorization. A valid token can identify Alice and still say nothing about whether she owns order `991`.

There is another failure mode here. Service A may have powerful access to Service B while Alice has limited permissions. If Service A blindly performs Alice's requested operation using its own authority, Alice can indirectly exercise Service A's privilege. Service A has become a confused deputy.

For service-to-service traffic, it helps to inspect the identities separately:

```text
Network identity     Who opened the connection?
Workload identity    Which service is calling?
End-user identity    Which user initiated the work?
Delegated authority  What may the service do for that user?
Authorization        Is this action allowed on this resource?
```

For an Order Service calling a Payment Service, the decision may require all of the following:

1. The caller really is the Order Service.
2. The Order Service may call this payment operation.
3. The initiating user is authenticated.
4. The user owns the order.
5. The amount matches the order stored on the server.
6. The payment has not already been processed.

Security is rarely one check. It is a series of trust decisions made at different boundaries.

## Describe the failure before choosing the control

Four words are often mixed together in security discussions: threat, vulnerability, attack, and control. Separating them makes a design review much more concrete.

Suppose an API exposes `GET /orders/{id}`. It authenticates the user but does not verify ownership.

- The **threat actor** is a malicious customer with a legitimate account.
- The **vulnerability** is the missing object-level authorization check.
- The **attack** is changing `/orders/100` to `/orders/101`, `/orders/102`, and so on.
- The **impact** is exposure of another customer's order data.
- A **control** is an ownership check before returning the order.

The attacker is not the vulnerability, and the missing check is not the attack. This precision matters when teams discuss fixes. Rate limiting may slow enumeration, but it does not repair the missing authorization. Authentication proves the caller has an account, but that was already working.

Controls also serve different purposes. Preventive controls try to stop an event: authentication, authorization, CSRF protection, input validation, or network policy. Detective controls make suspicious activity visible: audit records, failed-login monitoring, or unusual privilege-use alerts. Responsive controls help contain and recover: revoke sessions, rotate credentials, disable an account, or roll back a compromised deployment.

A production system needs all three. Excellent login security with no useful audit trail leaves the team nearly blind when an account is abused.

The layers often look like this in practice:

```text
Identity provider   MFA and credential policy
Gateway             coarse route controls and rate limits
Application         resource and business authorization
Database            restricted database account
Infrastructure      network and workload restrictions
Monitoring          suspicious-access detection
Operations          revocation, rotation and recovery
```

No single layer is “the security layer.” Each sees a different part of the request and owns controls suited to that boundary. The application knows whether an order belongs to a customer. The database knows which tables a credential can modify. Monitoring can reveal repeated access attempts that each individual request handler would see only in isolation.

### Risk changes how much protection is justified

Consider two endpoints with the same authorization bug:

```http
GET  /profile/avatar
POST /payments/transfer
```

The vulnerability class may be identical. The risk is not. Risk is often summarized as likelihood multiplied by impact, but it is better treated as a prompt for judgment than as precise arithmetic.

The transfer operation may justify fine-grained authorization, transaction limits, stronger authentication, fraud detection, idempotency, and an audit trail. Applying the same controls to an avatar may add cost without reducing meaningful risk.

This is also why controls cannot be evaluated in isolation. Short-lived tokens reduce the useful life of a stolen token, but increase refresh traffic and dependence on identity infrastructure. Validating identity in every service limits reliance on the gateway, but spreads configuration and operational failure modes. MFA reduces account takeover risk, but creates recovery and support work.

The useful question is not “How do we add maximum security?” It is “Which control reduces this risk, and what new cost or failure mode does the control introduce?”

One way to keep the discussion grounded is to walk the chain in order:

```text
What asset or capability matters?
        ↓
Who or what could harm it?
        ↓
Which weakness would make that possible?
        ↓
How would the weakness be exploited?
        ↓
What would the impact be?
        ↓
Which control reduces the likelihood or impact?
        ↓
What cost or failure mode does that control add?
```

The final question is part of the security analysis, not an objection to it. A short token lifetime is less useful if an identity outage prevents every legitimate request from refreshing. MFA without a safe recovery path can lock out legitimate users or push support teams toward unsafe bypasses.

### The gateway example, examined properly

Suppose an Order Service is unreachable from the public internet, and the gateway already authenticates every customer. It is easy to conclude that the Order Service needs no authorization of its own.

The asset is customer order data and the ability to modify an order. Relevant threats include a compromised internal service, an accidental route that exposes the Order Service, a developer credential with excessive access, or a caller that reaches the service without the expected gateway checks.

The vulnerability is the assumption that any request reaching the service is entitled to act on any order. An attack might come from another internal workload asking to change a customer's delivery address or order state.

A sensible design could combine:

```text
Gateway authentication
Service or token identity validation
Order ownership checks in application code
Network restrictions
Narrow service permissions
Audit records for sensitive changes
```

The ownership check remains close to the order data. Network restrictions reduce which callers can reach the service. Caller validation makes the immediate workload visible. Audit records help when prevention fails. This is a real architecture discussion; asking only whether to add an annotation is too narrow.

## Design for a control to fail

Three principles turn that reasoning into architecture: least privilege, deny by default, and defense in depth.

Least privilege gives an identity only the authority it needs. An Order Service database account might read and update order tables; it should not administer the database cluster. A reporting token should not issue refunds. A pod should not receive cluster administrator access because it was convenient during development.

The principle applies to every form of authority:

```text
User account            only the required application permissions
Service account         only the APIs its workload calls
Database user           only the required tables and operations
Cloud role              only the required resources and actions
OAuth token             only the required audience and scopes
Filesystem access       only the required paths
```

Broad token scopes deserve the same scrutiny as broad database grants. A token with `scope="*"` is convenient during integration and extremely valuable when stolen. A client that reads and creates orders may need `orders:read` and `orders:create`; a refund operation can require a separate `payments:refund` authority and perhaps a stronger authentication context.

Roles, permissions, scopes, and claims are related but not identical. A role groups authority according to an application's model. A permission describes an allowed action. An OAuth scope limits what a client or token may request or exercise. A claim is an assertion carried in an identity or access token. Treating every one of these as a role usually produces policies that are either too coarse or difficult to interpret.

The goal is a smaller blast radius. If `report-service` is compromised, the attacker should not automatically gain the ability to delete users, rotate signing keys, or read every production secret.

Compare that with a service holding an administrator database account, a cluster-wide Kubernetes role, an all-purpose API token, unrestricted network access, and credentials for the production secret store. One application vulnerability now opens paths across the whole system.

A narrower design does not make the compromise harmless. It limits the available paths:

```text
Only its own database permissions
Only the downstream API it needs
Only narrow token scopes
Only required network destinations
Only its own runtime secrets
```

Containment matters because prevention is imperfect. Least privilege asks us to plan for the credential or workload being compromised, not merely for it behaving correctly.

Deny by default deals with future mistakes. Compare these two policies:

```text
Risky                               Safer

/public/**       permit             /public/**       explicitly public
/admin/**        ADMIN              /admin/**        explicit privilege
everything else permit             /api/**          authenticated
                                    everything else  deny
```

In the first policy, a new endpoint becomes public unless somebody remembers to protect it. In the second, access exists because somebody intended it.

Defense in depth assumes a control can be bypassed, misconfigured, or compromised. For a payment path, responsibilities might be distributed like this:

```text
Gateway
  authentication, coarse route policy, rate limiting
        │
        ▼
Payment Service
  caller validation, business authorization, ownership checks
        │
        ▼
Database
  restricted account and table permissions
```

This is not an invitation to repeat every check at every layer. A gateway is well placed to rate-limit a route. It usually cannot decide whether user `1842` owns order `991`, because that decision depends on domain data held by the service. Different layers protect different boundaries.

Secure defaults support the same goal. New endpoints should not become public accidentally. Cookies should receive appropriate security attributes. Sensitive operations should require explicit access. A safe system should not depend on every developer remembering a checklist for every change.

Secure defaults can feel inconvenient when a request gets a `403`, a CSRF token is required, or an endpoint unexpectedly requires authentication. Disabling the control may be correct for a particular architecture. First ask which threat motivated the default and whether the architecture actually removes that threat.

This is especially important with framework defaults. A default login page, a rejected unauthenticated request, or enabled CSRF protection can look like an obstacle while an application is being built. Removing the behavior without understanding it changes the threat model. The useful sequence is to identify the assumption behind the default, compare it with the actual client and credential flow, and then configure the framework deliberately.

The same reasoning prevents “secure by convention” from turning into “secure if every developer remembers.” Defaults should make the ordinary path safe and require an explicit decision to relax it.

## Threat-model a payment flow

We now have enough vocabulary to review a small system without reaching immediately for configuration:

```text
Browser
   │
   ▼
API Gateway
   │
   ├──────────────► Order Service ──────► Order DB
   │                       │
   │                       ▼
   └──────────────► Payment Service ────► Payment Provider

Identity Provider
       │
       └──── OAuth/OIDC ───► Browser / APIs
```

Start with the assets: user identity, tokens, order and payment data, refund and payment capabilities, administrator access, signing keys, database credentials, and audit records.

Some are data, some are credentials, and some are capabilities. That distinction changes priority. Compromising one payment record is different from obtaining the ability to call `POST /payments/refund` for any order. The second can repeatedly create new damage.

List the actors: customer, administrator, browser, gateway, both services, the identity provider, the payment provider, an attacker, and a compromised internal service.

Including the compromised service prevents the model from assuming every attack starts on the public internet. It also makes service identity, network restrictions, and narrow downstream permissions part of the design rather than optional hardening.

Then mark the boundaries:

```text
[ Public Internet ]
        │
        ▼
   API Gateway
──────── boundary ────────
        │
        ▼
[ Internal Services ]
        │
   ┌────┴─────┐
   ▼          ▼
Order      Payment
Service    Service
   │          │
── boundary ───────────────
   │          │
   ▼          ▼
 Databases / external systems
```

Do not stop at public HTTP endpoints when listing entry points. Webhooks, OAuth redirect URIs, file uploads, message consumers, internal endpoints, administrative APIs, and deployment access all allow input or control to enter the system.

For each boundary, ask what changes:

```text
Browser → Identity Provider       credentials and login state
Browser → Gateway                 untrusted input and user token
Gateway → Service                 forwarded identity and route policy
Service → Service                 workload and delegated user authority
Application → Database            database credential and data ownership
Service → Payment Provider        external authority and transaction state
Developer → Production            operational control
```

This step catches assumptions that an endpoint list alone misses. An internal message consumer may accept input that never passes through the HTTP gateway. A webhook may be public even when the main application is not. A deployment credential may have more power than any application user.

Now examine one path. The browser asks the Order Service to initiate a payment:

```json
{
  "orderId": "O-123",
  "amount": 100
}
```

Several things can go wrong. The user can change the amount, pay for somebody else's order, or replay the request. A compromised service can call the Payment Service directly. A retry can create a duplicate charge.

These are different failure classes. Changing the amount is tampering with untrusted input. Paying another customer's order is an ownership failure. A replay or retry is a transaction-state problem. A compromised caller raises workload identity and least-privilege questions. Treating all of them as “authorization” would hide the control each one needs.

The controls follow from those scenarios:

- Authenticate the user and the calling service where each identity matters.
- Check that the user owns the order and may pay for it.
- Look up the authoritative amount on the server instead of trusting the request body.
- Use an idempotency key and transaction state checks to prevent duplicate processing.
- Record enough context to investigate the operation.
- Apply rate limits where they reduce abuse without hiding authorization defects.

Some of these controls belong in authentication and authorization infrastructure. `requested amount == stored order amount` is business security logic. A framework cannot infer it from a role or scope.

### Use STRIDE to find the question you forgot

STRIDE is useful here as a checklist rather than a design method:

| Category | Question for `POST /payments/refund` |
|---|---|
| Spoofing | Can somebody impersonate an administrator or service? |
| Tampering | Can the order ID or refund amount be changed? |
| Repudiation | Can we establish who initiated the refund? |
| Information disclosure | Does the response expose payment details? |
| Denial of service | Can the operation or its dependencies be exhausted? |
| Elevation of privilege | Can an ordinary user trigger an administrator action? |

STRIDE will not choose the controls. It helps expose a category that the team may not have considered.

Authentication and authorization may address spoofing and elevation of privilege while leaving repudiation untouched. If refunds are sensitive, the system may need to record the initiating user, calling service, order, amount, authentication context, timestamp, and outcome. That audit record must itself be protected against tampering and excessive disclosure.

The architecture still determines which threats dominate. A server-rendered application using session cookies needs careful CSRF and session handling. A single-page application sending bearer tokens shifts attention toward token storage, XSS, audience and issuer validation, token lifetime, and refresh-token handling. The business feature may be the same; the trust boundaries are not.

A cookie sent automatically by the browser creates a different cross-site request risk from a bearer token that application code adds to a header. A token exposed to browser JavaScript creates a different theft path from an `HttpOnly` session cookie. Advice that ignores these differences can be correct for one architecture and dangerous for another.

## A review you can use in practice

For a feature, endpoint, or architecture change, write down the following:

```text
Actors          Who and what can influence the feature?
Assets          What data or capability matters?
Entry points    Where can input or control enter?
Boundaries      Where do identity, authority or assumptions change?
Threats         How could the feature fail or be abused?
Controls        What prevents, detects or contains that outcome?
Residual risk   What remains possible?
Trade-offs      What cost or new failure mode did the control add?
```

The exercise does not have to produce a large document. Its value is in making assumptions discussable. “The service is internal” becomes a claim that can be tested: Which network path enforces that? Which workloads can call it? How are those workloads identified? What happens if one is compromised?

Threat models should change with the system. Add a mobile client, move authorization into a gateway, introduce an external webhook, or let one service call another, and an old assumption may no longer hold. The model is useful when it follows architecture changes; it is much less useful as a document produced once for compliance and then forgotten.

The same habit improves code review. Instead of asking only whether an endpoint has an authorization annotation, ask which principal, action, resource, and context the decision uses. Instead of accepting a broad scope because it works, ask what a stolen token could do. Instead of assuming the gateway protects everything, look for alternate paths and domain checks that only the service can perform.

Framework settings are much easier to choose after this work. You know which identity must be established, which authority must be carried, where it must be checked, and which failures need to be visible.

Before approving a design, you should be able to answer a few plain questions:

1. What data or capability are we protecting?
2. Which people and workloads can affect it?
3. Where do identity and authority cross a boundary?
4. Which concrete failure are we trying to prevent, detect, or contain?
5. Is access limited to what each identity needs?
6. What happens when a trusted component or credential is compromised?
7. How will we investigate and recover?
8. Which assumption must be revisited when the system changes?

The framework and token format will change over the life of a system. The habit of tracing identity, authority, and trust across boundaries will keep paying for itself.
