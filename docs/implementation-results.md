# Implementation results

The implementation spec is [security-reliability-spec.md](security-reliability-spec.md). No tickets were created. Changes remain uncommitted for review.

## Delivered

- Shared bounded HTTPS transport with public DNS validation, address pinning and redirect checks for page, feed and link requests; parse5 article extraction and entity decoding.
- Separate public/worker AI budgets, controlled Redis failure behavior, route limits, local single-flight generation and browser outbound URL validation.
- Shared retention index definitions, bookmark snapshots and Mongo lease serialization of per-reader capped writes.
- Stricter link success and namespace checks, model/version identity checks, structured events, API metrics and monitoring rules.
- Compiled Node 24 production images, digest pins, health checks, restricted Mongo application credentials, separate backup credentials, off-host backup scripts, CSP/header fixes, CI gates and MIT license.

## Verification

- Unit tests: 85 passed (shared 13, API 35, web 7, worker 30).
- Real Mongo integration: 3 passed, covering concurrent capped writes, saved-card survival and TTL metadata.
- Temporal integration: 1 passed, covering exhausted allocation and feed rebuild behavior.
- Workspace typecheck, configured lint and formatting checks, web build and diff whitespace check passed.
- Coverage gate passed: 87.81% lines, 88.53% branches, 85.29% functions. These Node coverage numbers cover loaded files and include tests; they are not whole-repository coverage.
- Live npm audit: zero vulnerabilities after the gRPC override.
- API, worker and web Docker targets built during integration; compiled runtime imports and nginx syntax were smoke-tested. Later review fixes passed source checks; final CI must rebuild the images.
- Production Compose configuration validated using placeholder credentials.

## Independent review

Standards review found two issues: insufficient error context and duplicated TTL definitions. Both were addressed. Spec review found feed transport bypass, concurrent cap races, code-host subdomain trust, incomplete model variants and narrow lint scope. Feed transport, serialized capped writes, host policy, identity regression cases and application-wide security lint rules were added in response.

## Remaining limits

- No live deployment, backup upload/restore drill, alert delivery, Firebase sign-in or public browser smoke test was performed. Those require the target environment.
- CodeQL, gitleaks and Trivy are configured in CI but were not executed locally. Playwright was not run.
- Single-flight is process-local. Distinct API replicas can still generate the same story concurrently.
- Collection serialization uses an expiring Mongo lease; operations that stall beyond its two-minute lifetime need further fencing or transaction support.
- Title matching remains a conservative heuristic with a curated identity vocabulary, not a complete product entity resolver.
- Formatting has an incremental baseline. Security lint covers application source; full recommended Biome rules are not enabled.
- Existing bookmarks without snapshots can only fall back to stories that still exist. A migration before retention activation is needed to preserve every legacy bookmark.
- Production now requires managed Temporal and operator-provided S3 and monitoring destinations.

## Contributors and assessment

Three isolated implementers handled transport/parser, API/database and deployment/CI. Two independent agents reviewed standards and spec. The QA agent stopped on a usage limit; the primary agent completed and ran its Mongo fixture and the Temporal test. Worktrees remain under `/tmp/technews-*` with intermediate work preserved.

Implementation quality assessment: **7/10**. The main security boundaries and verification improved substantially; the operational checks and remaining distributed concurrency limitations prevent a production-readiness claim.
