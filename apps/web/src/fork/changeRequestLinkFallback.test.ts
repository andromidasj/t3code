import {
  EnvironmentId,
  ProjectId,
  type RepositoryIdentity,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveChangeRequestLinkTargetAnywhere } from "./changeRequestLinkFallback";

describe("resolveChangeRequestLinkTargetAnywhere", () => {
  const bots = EnvironmentId.make("bots");
  const dev = EnvironmentId.make("dev");
  const mac = EnvironmentId.make("mac");
  const project = (id: string, environmentId: EnvironmentId, canonicalKey: string | null) => ({
    id: ProjectId.make(id),
    environmentId,
    repositoryIdentity:
      canonicalKey === null
        ? null
        : ({
            canonicalKey,
            provider: SourceControlProviderKind.make("github"),
            displayName: canonicalKey.split("/").slice(1).join("/"),
            locator: {
              source: "git-remote",
              remoteName: "origin",
              remoteUrl: `https://${canonicalKey}`,
            },
          } satisfies RepositoryIdentity),
  });
  const desk = project("desk", bots, null);
  const devCheckout = project("app", dev, "github.com/acme/app");
  const macCheckout = project("app-mac", mac, "github.com/acme/app");
  const url = "https://github.com/acme/app/pull/42";
  const base = {
    url,
    configLoaded: () => true,
    lendHostProject: true,
  };

  it("keeps the link's own environment when it has the repository", () => {
    const target = resolveChangeRequestLinkTargetAnywhere({
      ...base,
      projects: [desk, devCheckout, project("own", bots, "github.com/acme/app")],
      environmentId: bots,
    });
    expect(target?.project.id).toBe("own");
  });

  it("falls back to another environment's checkout when the link's has none", () => {
    const target = resolveChangeRequestLinkTargetAnywhere({
      ...base,
      projects: [desk, devCheckout],
      environmentId: bots,
    });
    expect(target).toMatchObject({ project: devCheckout, repository: "acme/app", number: 42 });
  });

  it("prefers the primary environment among the fallbacks", () => {
    const target = resolveChangeRequestLinkTargetAnywhere({
      ...base,
      projects: [desk, devCheckout, macCheckout],
      environmentId: bots,
      primaryEnvironmentId: mac,
    });
    expect(target?.project).toBe(macCheckout);
  });

  it("skips environments whose server config has not loaded", () => {
    const target = resolveChangeRequestLinkTargetAnywhere({
      ...base,
      projects: [desk, devCheckout],
      environmentId: bots,
      configLoaded: (environmentId) => environmentId !== dev,
    });
    expect(target).toBeNull();
  });

  it("still leaves a link no environment can read for the browser", () => {
    expect(
      resolveChangeRequestLinkTargetAnywhere({
        ...base,
        url: "https://example.com/acme/app/pull/42",
        projects: [desk, devCheckout],
        environmentId: bots,
      }),
    ).toBeNull();
  });
});
