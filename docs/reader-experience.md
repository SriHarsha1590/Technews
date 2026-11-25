# Reader and administrator experience

Visitors can browse categories and open shared `/story?id=...` links. Signed-in readers with no saved topics see `/welcome`, where they can save their stack or skip onboarding. Completion is remembered per account on the device; saved topics live on the server.

Personal queries include the reader UID. Authentication transitions cancel pending queries and clear browser query data, and the reader interface remounts when the account changes. Sign-out removes the browser notification subscription and resets the session interface.

The account menu shows **Admin dashboard** only when `/api/v1/me/capabilities` reports an administrator. `/api/v1/me/admin` independently checks the verified UID against `REFRESH_ADMIN_UIDS`. An empty allowlist grants no dashboard access. The dashboard displays Mongo and Redis health, pipeline state and timing, feed publication time, and refresh controls. Ordinary readers use **Latest stories** to reload published cards without starting ingestion.

Story sharing uses the native browser share sheet where supported, clipboard otherwise, and a visible link if clipboard access fails. Shared links open a story page with Watch, Try it and Ask. Expired stories display an unavailable message.

The manifest enables a standalone browser installation. Profile includes an install button and browser-specific instructions. Production registers the service worker; install prompts require HTTPS and browser eligibility. iPhone uses Safari's Add to Home Screen flow. This is a responsive web application, not an App Store or Play Store native package. Offline reading is not implemented.

Set the Firebase build settings and API settings before deployment. Test real sign-in, native sharing, push delivery and installation on physical Android/iPhone devices; automated Chromium emulation cannot establish those platform behaviors.
