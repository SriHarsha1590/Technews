# TechNews UI production readiness research

> **Implementation update (25 November 2026):** The UI findings below describe the original review. The phone story actions now stay visible on long cards, feed snapping uses proximity, the signed-out header fits a 320 px phone and a desktop without wrapping, route titles identify the view or story, feed errors use reader-facing copy, and the remaining loading animations respect reduced motion. Focused Chromium checks cover those layouts and titles. The format gate now passes. The remaining release checks are a human accessibility review at 200–400% zoom and with a screen reader, physical iOS/Android checks, and live-service verification. These changes do not establish a 10/10 score or production sign-off by themselves.

**Reviewed:** 25 November 2026. **Scope:** the current `apps/web` source, rendered Chromium screens, and browser tests, judged against official accessibility guidance. This is not a WCAG conformance audit or a physical-device test.

## Assessment

**UI assessment: 7/10, suitable for a limited beta, not yet for an unqualified production UI sign-off.** The production bundle builds, and the app has several sound foundations: native buttons and links, a `main` landmark, named story articles, visible keyboard focus, a reduced-motion rule for most transitions, and native modal dialogs. Rendered mobile and desktop layouts have a consistent visual language and readable typography. The remaining concerns below affect the visibility of core actions and orientation between views. Physical-device and assistive-technology behavior still needs validation. The overall application remains below production readiness for reasons beyond the UI.

## UI findings

### P1 — Core story actions can start below the phone viewport

A rendered 393×852 Chromium screen with a roughly 100-word, text-only story showed the Try it, Watch, and Ask controls at the bottom edge or below the first visible screen. The `.actions` row is pushed down by `margin-top: auto` ([styles.css](../apps/web/src/styles.css#L251-L260)), while the card includes a large headline and long summary ([StoryCard.tsx](../apps/web/src/components/StoryCard.tsx#L90-L125)). Images and shorter viewports increase the distance to these controls. This is a discoverability and task-completion concern for the app's main promise, not evidence that the controls cannot be reached.

**Change:** test representative 80–150-word stories with and without images on short phones and at enlarged text sizes. Keep the primary actions visible or add an obvious cue that more of the card is below. Confirm the entire summary and all actions remain reachable.

### P2 — Mandatory feed snapping needs zoom and input testing

The feed uses `scroll-snap-type: y mandatory` ([styles.css](../apps/web/src/styles.css#L141-L147)); each card snaps to its start and has `min-height: 100%` ([styles.css](../apps/web/src/styles.css#L155-L163)). Cards can exceed the visible feed height. MDN warns against mandatory snapping for overflowing children ([MDN scroll snap guide](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll_snap/Basic_concepts)), and W3C's [Reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow) calls for zoomed-layout checks. **In a 393×650 Chromium viewport, a long card did scroll: the feed moved from `scrollTop: 0` to `1269`, bringing the action row into the viewport. The suspected trap was not reproduced.** Browser zoom, touch, and keyboard behavior remain untested.

**Change:** test cards with and without images at narrow widths, short heights, 200% and 400% zoom, and enlarged text. If snapping prevents access under any of those conditions, switch to proximity snapping or disable it for oversized cards.

### P1 — Desktop header wraps the Sign in control

In a rendered 1440×900 Chromium view, the `Sign in` label wrapped to two lines in its pill while the header's content was constrained to `max-width: 600px` ([styles.css](../apps/web/src/styles.css#L87-L94)). The brand, two feed actions, and sign-in control compete for that width ([App.tsx](../apps/web/src/App.tsx#L185-L210)); the sign-in control has no no-wrap rule ([styles.css](../apps/web/src/styles.css#L477-L487)). This is a visible polish defect in a primary action.

**Change:** give the header enough room, use a compact action layout at intermediate widths, and prevent the sign-in label from wrapping. Verify signed-out and signed-in headers at desktop and tablet widths.

### P1 — The browser title does not identify the current view

The sole document title is `TechNews` ([index.html](../apps/web/index.html#L11)). The app renders distinct feed, story, sign-in, saved, history, profile, welcome, and admin views from client-side location state ([App.tsx](../apps/web/src/App.tsx#L128-L188)), but the reviewed web source contains no `document.title` update. W3C's [Page Titled guidance](https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html) specifically advises that a single-page app update its title as views change. A constant title makes tabs and browser history harder to distinguish and leaves the current topic or purpose unclear.

**Change:** set a descriptive title on each route and category, such as `Saved stories · TechNews` or the story headline; verify it on direct links and client-side navigation.

### P1 — Production feed errors tell readers to run a developer command

When the first feed request fails, the visible error instructs the reader to check that the API is running with `npm run api` ([Feed.tsx](../apps/web/src/components/Feed.tsx#L87-L94)). A deployed reader cannot perform that step. The retry control is useful, but the diagnosis and remedy are development-specific. The UI also exposes raw `query.error.message`, whose wording depends on the API/client error path.

**Change:** show a reader-facing explanation and retry path; keep technical diagnostics in logs or an operator surface. Check offline, timeout, 5xx, and invalid-response states in a production-like build.

### P2 — Motion preference is respected inconsistently

Smooth feed scrolling, dialog entry, skeleton pulse, and slideshow image motion are guarded by `prefers-reduced-motion: no-preference` ([styles.css](../apps/web/src/styles.css#L347-L351), [styles.css](../apps/web/src/styles.css#L462-L473), [styles.css](../apps/web/src/styles.css#L908-L912), [styles.css](../apps/web/src/styles.css#L1004-L1030)). The loading spinner ([styles.css](../apps/web/src/styles.css#L920-L927)) and Ask typing dots ([styles.css](../apps/web/src/styles.css#L1252-L1271)) animate regardless. MDN explains that `prefers-reduced-motion` conveys a request to remove, reduce, or replace nonessential motion ([MDN reduced motion reference](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion)); this is a polish and accessibility improvement, **not a claim of WCAG failure**.

**Change:** gate those remaining animations and provide static loading indicators for reduced-motion users.

## What the source does well

- Story actions are native buttons with text labels ([StoryCard.tsx](../apps/web/src/components/StoryCard.tsx#L109-L125)); the main action targets are at least 44 CSS px high ([styles.css](../apps/web/src/styles.css#L248-L271)). The global `:focus-visible` rule provides a 3 px outline ([styles.css](../apps/web/src/styles.css#L65-L69)). These choices support W3C's [focus visibility](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html) and [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) goals, though the smaller chips and icon buttons still need measured testing.
- The shared sheet uses `<dialog>` and `showModal()`, includes an explicit Close button, and labels the dialog ([Sheet.tsx](../apps/web/src/components/Sheet.tsx#L12-L48)). These match [MDN's native dialog guidance](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog) for modal focus and dismissal; real assistive-technology behavior remains unverified.
- Default theme colors checked from the CSS tokens in [styles.css](../apps/web/src/styles.css#L4-L39): light body text `#14213d` on white is about 16:1; muted `#5b6478` on white is about 5.9:1; white on primary blue `#2f5bea` is about 5.5:1. These exceed W3C's [4.5:1 normal-text threshold](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). This token calculation does not establish contrast for every rendered state, gradient, image overlay, or custom user setting.

## Application-wide production gates beyond UI

- **The configured CI gate is red.** `npm run format:check` fails on one quote in [safe-fetch.ts](../packages/shared/src/safe-fetch.ts#L74). This is easy to fix, but a release should not proceed with a known failing gate. The [CI workflow](../.github/workflows/ci.yml) runs it.
- **The content queue needs a fairness and backlog check.** The worker selects at most 40 pending articles in newest-first order ([summarize.ts](../apps/worker/src/activities/summarize.ts#L58-L65), [workflows.ts](../apps/worker/src/workflows.ts#L60-L65)). If new intake consistently exceeds processing, older items may remain pending. Measure the actual backlog and change selection if that occurs before claiming comprehensive coverage.
- **Digest delivery can be lost on transient push errors.** The sender catches non-expired push failures, then still marks the user done and increments `sent` ([digest.ts](../apps/worker/src/activities/digest.ts#L60-L75)). Retry transient failures and count only successfully delivered digests.
- **Operations have not been demonstrated.** The existing [implementation results](implementation-results.md) say live deployment, off-host restore, alert delivery, and real Firebase sign-in were not verified. The [deployment guide](06-deploy.md) specifies how to perform these checks; complete them before public launch.

These gates explain why a visually competent frontend does not by itself make the application production ready.

## Verification and limits

- `npm run build -w @technews/web` **passed** on 25 November 2026. Vite emitted a nonfatal ineffective dynamic import warning for `src/push.ts`.
- The first sandboxed `npm run e2e -w @technews/web` could not bind its Vite server. An approved local-browser run using system Chromium (`PW_CHROMIUM_PATH=/snap/bin/chromium`) ran all 60 mobile/desktop cases: 58 passed, and two failed on the same stale assertion after the empty-feed copy had changed. The assertion was updated, and the complete rerun **passed all 60 tests** on 25 November 2026.
- The Playwright configuration covers Chromium at Pixel 7 and desktop sizes ([playwright.config.ts](../apps/web/playwright.config.ts#L11-L14)). The checked tests exercise feed and account flows ([feed.spec.ts](../apps/web/e2e/feed.spec.ts), [accounts.spec.ts](../apps/web/e2e/accounts.spec.ts)); they do not establish screen-reader usability, focus order, 320 CSS px reflow, 200–400% zoom, text spacing, physical iOS/Android install or sharing, or production API behavior. [W3C's accessibility evaluation guidance](https://www.w3.org/WAI/test-evaluate/) calls for multiple evaluation methods, including human review.
- Source and docs contain ongoing local edits. This report describes the working tree as inspected, not a tagged release. Before launch, complete manual checks on supported browsers and devices; then resolve the P1 findings or document evidence that the resulting UI meets the intended release bar.
