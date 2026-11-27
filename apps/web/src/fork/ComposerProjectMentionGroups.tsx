import { useGT } from "gt-react";
import type { ReactNode } from "react";

import { CommandGroup, CommandGroupLabel } from "~/components/ui/command";

import { splitComposerProjectMentions } from "./composerProjectMentions";

/** The composer menu's rows, with project mentions under their own heading at the top. */
export function ComposerProjectMentionGroups<T extends { readonly type: string }>(props: {
  readonly items: ReadonlyArray<T>;
  readonly renderItem: (item: T) => ReactNode;
}) {
  const gt = useGT();
  const { projects, rest } = splitComposerProjectMentions(props.items);
  if (projects.length === 0) return <CommandGroup>{rest.map(props.renderItem)}</CommandGroup>;
  return (
    <>
      <CommandGroup data-composer-project-mentions="true">
        <CommandGroupLabel>{gt("Projects & bots")}</CommandGroupLabel>
        {projects.map(props.renderItem)}
      </CommandGroup>
      {rest.length > 0 ? <CommandGroup>{rest.map(props.renderItem)}</CommandGroup> : null}
    </>
  );
}
