/**
 * The app's pure rules, as the website's server code uses them.
 *
 * This file is the entry point of the bundle that Supabase Edge Functions
 * import (supabase/functions/_shared/generated/app-rules.js, built by
 * `node scripts/build-web-app-rules.mjs`). Edge Functions can't import the
 * app's lib/ directly — its relative imports have no `.ts` extension — so the
 * rules are bundled into one dependency-free ES module instead of copied.
 *
 * Keep this list to pure, UI-free code: no React, no Supabase, no app config.
 * The bundle test (__tests__/unit/web/app-rules-bundle.test.ts) fails if the
 * generated file is stale or pulls in anything else.
 */
export { assembleWebMyJobs, webHref } from './my-jobs-web';
export type { WebMyJobs, WebMyJobsRows, WebJob, WebOffer, WebApplicant, WebPerson } from './my-jobs-web';
export { describeWebThread } from './thread-web';
export type { WebThreadInput, WebThreadView } from './thread-web';
