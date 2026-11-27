import { useGT } from "gt-react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  EllipsisIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useRef, useState, type RefObject } from "react";

import { ProjectEnvironmentBadge } from "~/components/ProjectEnvironmentBadge";
import { ProjectFavicon } from "~/components/ProjectFavicon";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";
import { useEnvironmentMachines, usePrimaryEnvironmentId } from "~/state/environments";

import { SpaceBadge, SpaceGlyph, spaceTintColor, tintedStyle } from "./spaceLook";
import {
  deleteSpace,
  moveProjectToSpace,
  moveSpace,
  removeProjectFromSpace,
  setDefaultSpace,
  SPACE_ICON_IDS,
  SPACE_TINT_IDS,
  updateSpace,
  type SidebarSpace,
  type SpaceIconId,
  type SpaceTintId,
} from "./spaces.logic";
import type { ForkSidebarSpaces, SpacesGroup } from "./useSidebarSpaces";

/** The Space header's ••• button and the editor it opens: name, look, projects and order. */
export function SpaceEditorPopover(props: {
  readonly spaces: ForkSidebarSpaces;
  readonly space: SidebarSpace;
  /** Projects span several environments, so rows name theirs. */
  readonly showEnvironments: boolean;
}) {
  const gt = useGT();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const { spaces, space } = props;
  return (
    <Popover open={spaces.editorOpen} onOpenChange={spaces.setEditorOpen}>
      <PopoverTrigger
        render={
          <button
            ref={triggerRef}
            type="button"
            aria-label={gt("Edit {space} Space", { space: space.name })}
            data-testid="space-editor-trigger"
            className={cn(
              "flex size-6.5 shrink-0 cursor-pointer items-center justify-center rounded-lg text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              spaces.editorOpen && "bg-sidebar-row-hover text-sidebar-foreground",
            )}
          />
        }
      >
        <EllipsisIcon className="size-4" />
      </PopoverTrigger>
      <PopoverPopup
        anchor={triggerRef}
        side="bottom"
        align="end"
        width="sm"
        padding="compact"
        initialFocus={nameRef}
        collisionAvoidance={{ side: "flip", align: "shift" }}
        aria-label={gt("{space} Space settings", { space: space.name })}
      >
        {/* Keyed by Space, so the name field starts from the Space it edits. */}
        <SpaceEditor
          key={space.id}
          spaces={spaces}
          space={space}
          nameRef={nameRef}
          showEnvironments={props.showEnvironments}
        />
      </PopoverPopup>
    </Popover>
  );
}

function SpaceEditor({
  spaces,
  space,
  nameRef,
  showEnvironments,
}: {
  readonly spaces: ForkSidebarSpaces;
  readonly space: SidebarSpace;
  readonly nameRef: RefObject<HTMLInputElement | null>;
  readonly showEnvironments: boolean;
}) {
  const gt = useGT();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const machineByEnvironmentId = useEnvironmentMachines();
  const [name, setName] = useState(space.name);
  const view = spaces.view;
  if (view === null) return null;
  const { resolved, projects } = view;
  const isDefault = resolved.defaultSpace.id === space.id;
  const index = resolved.spaces.findIndex((candidate) => candidate.id === space.id);
  const mine = projects.groupsBySpace.get(space.id) ?? [];
  const others = resolved.spaces
    .filter((candidate) => candidate.id !== space.id)
    .flatMap((candidate) =>
      (projects.groupsBySpace.get(candidate.id) ?? []).map((group) => ({
        group,
        space: candidate,
      })),
    );
  const allProjectKeys = [...projects.groupsBySpace.values()]
    .flat()
    .map((group) => group.projectKey);
  const save = spaces.save;
  const state = spaces.state;
  const iconLabels: Readonly<Record<SpaceIconId, string>> = {
    home: gt("Home", { $context: "space icon" }),
    eye: gt("Eye", { $context: "space icon" }),
    briefcase: gt("Briefcase", { $context: "space icon" }),
    star: gt("Star", { $context: "space icon" }),
    terminal: gt("Terminal", { $context: "space icon" }),
    layers: gt("Layers", { $context: "space icon" }),
    folder: gt("Folder", { $context: "space icon" }),
    globe: gt("Globe", { $context: "space icon" }),
  };
  const tintLabels: Readonly<Record<SpaceTintId, string>> = {
    none: gt("No tint", { $context: "space tint" }),
    indigo: gt("Indigo", { $context: "space tint" }),
    sky: gt("Sky", { $context: "space tint" }),
    emerald: gt("Emerald", { $context: "space tint" }),
    amber: gt("Amber", { $context: "space tint" }),
    rose: gt("Rose", { $context: "space tint" }),
  };
  const environmentBadge = (group: SpacesGroup) =>
    showEnvironments ? (
      <ProjectEnvironmentBadge
        group={group}
        primaryEnvironmentId={primaryEnvironmentId}
        machineByEnvironmentId={machineByEnvironmentId}
      />
    ) : null;

  return (
    <div className="flex flex-col gap-1 text-sm" data-testid="space-editor">
      <div className="mb-1 flex items-center gap-2">
        <SpaceBadge icon={space.icon} tint={space.tint} />
        <input
          ref={nameRef}
          // A Space added from the editor remounts it, and its name is the next thing to set.
          autoFocus
          value={name}
          maxLength={24}
          spellCheck={false}
          aria-label={gt("Space name")}
          placeholder={gt("Space name")}
          className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-semibold text-sm outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-inset focus:ring-ring"
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setName(next);
            if (next.trim() !== "") save(updateSpace(state, space.id, { name: next.trim() }));
          }}
          onBlur={() => setName(space.name)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              spaces.setEditorOpen(false);
            }
          }}
        />
      </div>
      <div className="flex h-7.5 items-center gap-1.5">
        <span className="w-7 shrink-0 text-muted-foreground text-xs">{gt("Icon")}</span>
        <div className="flex gap-0.5" role="group" aria-label={gt("Space icon")}>
          {SPACE_ICON_IDS.map((icon) => (
            <button
              key={icon}
              type="button"
              aria-label={iconLabels[icon]}
              aria-pressed={space.icon === icon}
              style={
                space.icon === icon
                  ? tintedStyle(space.tint, { fill: 20, edge: 34, text: 68 })
                  : undefined
              }
              className={cn(
                "flex h-6.5 w-5.5 cursor-pointer items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                space.icon !== icon &&
                  "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              onClick={() => save(updateSpace(state, space.id, { icon }))}
            >
              <SpaceGlyph icon={icon} className="size-3.75" />
            </button>
          ))}
        </div>
      </div>
      <div className="flex h-7.5 items-center gap-1.5">
        <span className="w-7 shrink-0 text-muted-foreground text-xs">{gt("Tint")}</span>
        <div className="flex gap-2.5 pl-1.5" role="group" aria-label={gt("Space tint")}>
          {SPACE_TINT_IDS.map((tint) => (
            <button
              key={tint}
              type="button"
              aria-label={tintLabels[tint]}
              aria-pressed={space.tint === tint}
              style={{
                background: tint === "none" ? undefined : spaceTintColor(tint),
                // The chosen swatch gets a ring with a gap, drawn as shadows so it needs no offset.
                boxShadow:
                  space.tint === tint
                    ? `0 0 0 2px var(--popover), 0 0 0 3.5px ${spaceTintColor(tint)}`
                    : undefined,
              }}
              className={cn(
                "size-4 cursor-pointer rounded-full outline-none transition-[box-shadow,scale] hover:scale-112 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                tint === "none"
                  ? "border border-dashed border-foreground/40"
                  : "ring-1 ring-black/15 ring-inset",
              )}
              onClick={() => save(updateSpace(state, space.id, { tint }))}
            />
          ))}
        </div>
      </div>

      <div className="-mx-3 my-1.5 h-px bg-border" />
      <div className="flex items-center justify-between gap-2 px-0.5 pb-0.5 font-semibold text-muted-foreground text-xs">
        <span className="truncate">{gt("Projects in {space}", { space: space.name })}</span>
        <span className="font-normal tabular-nums">{mine.length}</span>
      </div>
      {mine.length === 0 ? (
        <div className="px-1.5 py-1 text-muted-foreground text-xs">
          {gt("No projects yet. Move some in below.")}
        </div>
      ) : (
        mine.map((group) => (
          <label
            key={group.projectKey}
            data-testid={`space-editor-project-${group.projectKey}`}
            className={cn(
              "flex h-7 items-center gap-2 rounded-md px-1.5 text-sm",
              isDefault ? "cursor-default" : "cursor-pointer hover:bg-accent",
            )}
          >
            <Checkbox
              checked
              disabled={isDefault}
              aria-label={gt("{project} in {space}", {
                project: group.displayName,
                space: space.name,
              })}
              onCheckedChange={(checked) => {
                if (!checked) save(removeProjectFromSpace(state, group.projectKey, space.id));
              }}
            />
            <ProjectFavicon project={group} className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{group.displayName}</span>
            {environmentBadge(group)}
          </label>
        ))
      )}
      {isDefault && mine.length > 0 ? (
        <div className="px-1.5 text-muted-foreground text-xs">
          {gt("New and unassigned projects land here. Move one out from another Space.")}
        </div>
      ) : null}
      {others.length > 0 ? (
        <>
          <div className="mt-1.5 flex items-center justify-between gap-2 px-0.5 pb-0.5 font-semibold text-muted-foreground text-xs">
            <span>{gt("Move from another Space")}</span>
          </div>
          <div className="flex max-h-40 flex-col overflow-y-auto">
            {others.map(({ group, space: from }) => (
              <button
                key={group.projectKey}
                type="button"
                data-testid={`space-editor-move-${group.projectKey}`}
                aria-label={gt("Move {project} from {from} to {space}", {
                  project: group.displayName,
                  from: from.name,
                  space: space.name,
                })}
                className="group/move flex h-7 shrink-0 cursor-pointer items-center gap-2 rounded-md px-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={() => save(moveProjectToSpace(state, group.projectKey, space.id))}
              >
                <PlusIcon className="size-3.5 shrink-0 text-muted-foreground group-hover/move:text-foreground" />
                <ProjectFavicon project={group} className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{group.displayName}</span>
                {environmentBadge(group)}
                <span
                  style={tintedStyle(from.tint, { fill: 15, text: 58 })}
                  className="flex h-4 max-w-20 shrink-0 items-center gap-1 rounded-full px-1.5 font-semibold text-3xs"
                >
                  <SpaceGlyph icon={from.icon} className="size-2.5 shrink-0" />
                  <span className="truncate">{from.name}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      <div className="-mx-3 my-1.5 h-px bg-border" />
      <label className="flex h-7 cursor-pointer items-center justify-between gap-2 px-0.5 text-sm">
        <span>{gt("Default for new projects")}</span>
        <Switch
          checked={isDefault}
          disabled={isDefault}
          aria-label={gt("Default for new projects")}
          onCheckedChange={(checked) => {
            if (checked) save(setDefaultSpace(state, space.id, allProjectKeys));
          }}
        />
      </label>
      <div className="mt-1 flex items-center gap-1">
        <Button
          size="xs"
          variant="ghost"
          disabled={index <= 0}
          aria-label={gt("Move left")}
          onClick={() => save(moveSpace(state, space.id, -1))}
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={index >= resolved.spaces.length - 1}
          aria-label={gt("Move right")}
          onClick={() => save(moveSpace(state, space.id, 1))}
        >
          <ChevronRightIcon />
        </Button>
        <Button
          size="xs"
          variant="ghost-destructive"
          className="ml-auto"
          disabled={resolved.spaces.length <= 1}
          onClick={() => {
            spaces.setEditorOpen(false);
            save(deleteSpace(state, space.id));
          }}
        >
          <Trash2Icon />
          {gt("Delete Space")}
        </Button>
      </div>
      <Button size="xs" variant="ghost" className="self-start" onClick={spaces.addSpace}>
        <PlusIcon />
        {gt("New Space")}
      </Button>
    </div>
  );
}
