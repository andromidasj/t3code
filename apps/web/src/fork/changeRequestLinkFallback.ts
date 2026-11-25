import { resolveChangeRequestLinkTarget } from "@t3tools/client-runtime/change-request-links";

/**
 * resolveChangeRequestLinkTarget, except that a link from an environment with no checkout of its
 * repository (a bot desk on a VM, with the repos on another machine) opens through any connected
 * environment that has one instead of leaving the app for the browser.
 */
export function resolveChangeRequestLinkTargetAnywhere<
  Project extends Parameters<typeof resolveChangeRequestLinkTarget>[0]["projects"][number],
>(input: Parameters<typeof resolveChangeRequestLinkTarget<Project>>[0]) {
  return (
    resolveChangeRequestLinkTarget(input) ??
    (input.environmentId === undefined
      ? null
      : resolveChangeRequestLinkTarget({ ...input, environmentId: undefined }))
  );
}
