# Security and reliability implementation spec

## Problem

TechNews fetches untrusted pages, serves on-demand AI features, and stores reader data without several limits needed for an internet-facing deployment. An earlier audit identified network, parser, quota, retention, observability, deployment, and verification gaps. This spec defines the intended behavior for the implementation; it does not treat historical test results from that audit as current evidence.

## User-visible outcome

- Feed and article fetching cannot reach internal services, follow unsafe redirects, or consume unbounded response bodies.
- Article text and preview images are extracted from bounded HTML with correct entity decoding.
- Scheduled ingestion retains an AI allocation even when public features are busy. Public AI failures produce controlled responses and concurrent requests for the same generation share work.
- Readers can save a bounded set of stories and still view the saved card after the source story ages out. History and push subscriptions have explicit limits.
- "Verified" links reflect successful checks of the exact path, and unrelated product or version announcements do not merge.
- Operators can see pipeline failures, stale feeds, and quota exhaustion and have a documented route to alerts and recovery.

## Implementation decisions

1. Use one server-side HTTPS fetch module for the API and worker. Validate scheme and credentials, resolve every hostname to public addresses, connect only to a validated address, revalidate each redirect, restrict redirects, and stop streaming at a byte limit. Fail closed on resolution or validation errors. Reject invalid article URLs before storage.
2. Parse bounded HTML with a maintained DOM parser. Extract description, paragraphs, and preview image by element and attribute semantics. Decode named and numeric entities, including hexadecimal references. Preserve the existing public extraction functions.
3. Give worker and public AI distinct Redis budget keys and configurable caps. A failed budget store denies an AI call. Apply global route limits and stricter public AI limits, with per-user limits for authenticated operations. Share in-flight explainer and guide creation by story and operation.
4. Add Mongo TTL indexes for article and story retention using stable timestamps, without expiring reader records. Save a card snapshot with each bookmark and use it when the story has expired. Bound bookmarks, history, and subscriptions per reader at their persistence boundary.
5. Allow only known push service endpoint hosts. Require a successful HTTP result for link verification and apply path-level trust rules for user-content hosts. Require product, model, and version agreement before merging title-similar stories. Validate story outbound links in the web UI.
6. Emit structured operational events and metrics for request errors, quota hits, pipeline failures, and feed freshness. Configure an error sink and alert thresholds without exposing secrets in logs.
7. Compile server packages to JavaScript for production and install production dependencies in runtime images. Use a least-privilege application Mongo user, healthy dependency ordering, supported Temporal deployment, off-host backup configuration and restore instructions, secure web headers, and Node 24. Pin deployment images to immutable versions or digests.
8. Add a CI gate for typecheck, tests, build, lint and format, coverage, dependency audit, Docker build, secret scan, container scan, and CodeQL. Add Dependabot and security policy. The owner selected the MIT license.
9. Update deployment and API documentation to match the implemented behavior and limits.

## Test seams and acceptance

- **Fetch boundary:** exercise the exported safe fetch function with controlled DNS and HTTP fixtures. Cover private and link-local answers, redirects, mixed DNS answers, byte caps, and protocol rejection.
- **HTML boundary:** exercise public extraction functions with malformed markup, attribute order, script-like content, entity references, and oversized input.
- **API boundary:** use `createApp` with fakes to verify status codes, quotas, saved-card behavior, and concurrent generation. This catches request contracts but not live database behavior.
- **Persistence boundary:** verify TTL/index setup and per-user caps against Mongo integration fixtures. This catches races and query behavior that route fakes cannot.
- **Workflow boundary:** use Temporal test tooling where available to verify failure and capped paths; verify activity behavior through its public functions.
- **Delivery boundary:** run typecheck, unit and integration tests, web build, lint, audit, Docker build, and security scans where tools and network are available. Record unavailable checks explicitly.

## External decisions and operational acceptance

Real off-host backup delivery, restore drills, alert routing, and disclosure contact require deployment credentials or an operator-provided destination. Configuration, examples, and runbooks must be usable before production deployment; live delivery must be verified in the target environment.
