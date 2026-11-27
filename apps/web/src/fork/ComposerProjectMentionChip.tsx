import { useGT } from "gt-react";
import type { ComponentProps } from "react";

import { ContextChipShell } from "~/components/contextChipParts";
import { ProjectFavicon } from "~/components/ProjectFavicon";

import type { ComposerProjectMentionItem } from "./composerProjectMentions";

/** An `@Name` project mention drawn as one chip: the project's icon and its full name. */
export function ComposerProjectMentionChip({
  mention,
  inert = false,
  ...props
}: {
  readonly mention: ComposerProjectMentionItem;
  /** No tooltip or focus stop, for chips inside another control. */
  readonly inert?: boolean;
} & Omit<ComponentProps<typeof ContextChipShell>, "icon" | "label" | "tooltip" | "kind">) {
  const gt = useGT();
  return (
    <ContextChipShell
      {...props}
      kind="mention"
      data-fork-project-mention={mention.projectKey}
      icon={<ProjectFavicon project={mention.project} className="size-[1em] shrink-0" />}
      label={mention.label}
      tooltip={
        inert
          ? undefined
          : mention.description
            ? gt("Project {name} on {machines}", {
                name: mention.label,
                machines: mention.description,
              })
            : gt("Project {name}", { name: mention.label })
      }
    />
  );
}
