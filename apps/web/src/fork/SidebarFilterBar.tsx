import { T, useGT } from "gt-react";
import { PlusIcon, XIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { CollapsibleSectionHeader } from "~/components/ui/collapsible-section-header";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { SortableSidebarMarker } from "~/components/sidebar/SidebarListMarkers";
import { cn, isMacPlatform } from "~/lib/utils";

import { updateForkSettings, useForkSettings, type SidebarFilterPreset } from "./forkSettings";
import {
  addSidebarFilterPreset,
  findSidebarFilterPreset,
  isSidebarFilterLens,
  removeSidebarFilterPreset,
  sameProjectKeys,
  toggledPresetScope,
  type SidebarBotDrawer,
} from "./sidebarHierarchy";
import { useSidebarLens } from "./useSidebarHierarchy";

// One person saves views by hand on one Mac, so the time is unique enough.
const newPresetId = () => `view-${Date.now().toString(36)}`;

/**
 * All | Mine | Needs me under the sidebar's pages, and this Mac's saved project views. Hidden
 * while searching and when the hierarchy is off.
 */
export function SidebarFilterBar(props: {
  readonly needsMeCount: number;
  readonly hidden: boolean;
  readonly projectScopeKeys: ReadonlyArray<string>;
  readonly onProjectScopeChange: (keys: readonly string[]) => void;
}) {
  const gt = useGT();
  const { sidebarHierarchyEnabled, sidebarFilterPresets } = useForkSettings();
  const [lens, setLens] = useSidebarLens();
  if (!sidebarHierarchyEnabled || props.hidden) return null;
  const { projectScopeKeys } = props;
  const canSave =
    projectScopeKeys.length > 0 &&
    findSidebarFilterPreset(sidebarFilterPresets, projectScopeKeys) === null;
  return (
    <div className="mt-1.5 flex flex-col gap-1 px-2" data-testid="sidebar-filter-bar">
      <div className="flex items-center gap-1">
        <ToggleGroup
          aria-label={gt("Filter threads")}
          className="flex w-full"
          value={[lens]}
          onValueChange={(next) => {
            const value = next[0];
            if (isSidebarFilterLens(value)) setLens(value);
          }}
        >
          <Toggle value="all" className={LENS_CLASS}>
            <T context="sidebar thread filter">All</T>
          </Toggle>
          <Toggle value="mine" className={LENS_CLASS}>
            <T context="sidebar thread filter, the user's own threads">Mine</T>
          </Toggle>
          <Toggle
            value="needs-me"
            className={LENS_CLASS}
            aria-label={
              props.needsMeCount > 0
                ? gt("Needs me, {count} waiting", { count: props.needsMeCount })
                : undefined
            }
          >
            <span className="flex items-center gap-1">
              <T context="sidebar thread filter">Needs me</T>
              {props.needsMeCount > 0 ? (
                <span
                  aria-hidden
                  className="flex h-4 min-w-4 items-center justify-center rounded-full bg-warning/16 px-1 font-semibold text-2xs tabular-nums leading-none text-warning-foreground ring-1 ring-warning/40"
                >
                  {props.needsMeCount > 99 ? "99+" : props.needsMeCount}
                </span>
              ) : null}
            </span>
          </Toggle>
        </ToggleGroup>
      </div>
      {sidebarFilterPresets.length > 0 || canSave ? (
        <SidebarProjectViews
          presets={sidebarFilterPresets}
          projectScopeKeys={projectScopeKeys}
          canSave={canSave}
          onProjectScopeChange={props.onProjectScopeChange}
        />
      ) : null}
    </div>
  );
}

// Each option takes the room its label needs, so "Needs me 12" fits a narrow sidebar.
const LENS_CLASS = "flex-auto shrink whitespace-nowrap";

const CHIP_CLASS =
  "inline-flex h-6 max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-full border px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

function SidebarProjectViews(props: {
  readonly presets: ReadonlyArray<SidebarFilterPreset>;
  readonly projectScopeKeys: ReadonlyArray<string>;
  readonly canSave: boolean;
  readonly onProjectScopeChange: (keys: readonly string[]) => void;
}) {
  const gt = useGT();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const { presets, projectScopeKeys } = props;
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === "") return;
    updateForkSettings({
      sidebarFilterPresets: addSidebarFilterPreset(
        presets,
        { name, projectKeys: projectScopeKeys },
        newPresetId,
      ),
    });
    setName("");
    setNaming(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-1" aria-label={gt("Saved views")} role="group">
      {presets.map((preset) => {
        const active = sameProjectKeys(preset.projectKeys, projectScopeKeys);
        return (
          <span key={preset.id} className="group/chip relative inline-flex max-w-full min-w-0">
            <button
              type="button"
              aria-pressed={active}
              className={cn(
                CHIP_CLASS,
                active
                  ? "border-primary/40 bg-primary/10 text-sidebar-foreground"
                  : "border-sidebar-border text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
              )}
              onClick={() =>
                props.onProjectScopeChange([...toggledPresetScope(preset, projectScopeKeys)])
              }
            >
              <span className="truncate">{preset.name}</span>
            </button>
            {/* Floats over the chip's corner, so the label stays centered and nothing shifts. */}
            <button
              type="button"
              aria-label={gt("Delete view {name}", { name: preset.name })}
              className="absolute -end-1 -top-1 flex size-4 cursor-pointer items-center justify-center rounded-full border border-sidebar-border bg-popover text-muted-foreground opacity-0 shadow-xs outline-none hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring group-hover/chip:opacity-100 group-focus-within/chip:opacity-100"
              onClick={() =>
                updateForkSettings({
                  sidebarFilterPresets: removeSidebarFilterPreset(presets, preset.id),
                })
              }
            >
              <XIcon className="size-2.5" />
            </button>
          </span>
        );
      })}
      {props.canSave && !naming ? (
        <button
          type="button"
          className={cn(
            CHIP_CLASS,
            "border-dashed border-sidebar-border text-sidebar-muted-foreground hover:text-sidebar-foreground",
          )}
          onClick={() => setNaming(true)}
        >
          <PlusIcon className="size-3" />
          <T>Save view</T>
        </button>
      ) : null}
      {props.canSave && naming ? (
        <form className="flex w-full items-center gap-1" onSubmit={save}>
          <Input
            size="sm"
            autoFocus
            value={name}
            placeholder={gt("View name")}
            aria-label={gt("View name")}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setNaming(false);
                setName("");
              }
            }}
          />
          <button
            type="submit"
            disabled={name.trim() === ""}
            className={cn(
              CHIP_CLASS,
              "shrink-0 border-sidebar-border text-sidebar-foreground disabled:cursor-default disabled:opacity-60",
            )}
          >
            <T>Save</T>
          </button>
        </form>
      ) : null}
    </div>
  );
}

/** The Bot / Background drawer's header, styled as the sidebar's shelves. */
export function SidebarBotDrawerHeader(props: {
  readonly drawer: SidebarBotDrawer<unknown>;
  /** The first of the bottom shelves, which takes the list's free space above it. */
  readonly anchored: boolean;
  readonly onToggle: () => void;
}) {
  const gt = useGT();
  const { drawer } = props;
  return (
    <SortableSidebarMarker
      marker="bot-header"
      data-testid="sidebar-bot-header"
      className={cn("relative mx-0.5 h-8", props.anchored && "mt-auto")}
    >
      <CollapsibleSectionHeader
        data-sidebar-row="shelf:bot"
        onClick={props.onToggle}
        expanded={drawer.expanded}
        tone="muted"
        data-testid="sidebar-bot-shelf-toggle"
        accessory={
          <span className="flex items-center gap-1.5 font-normal">
            {drawer.failedCount > 0 ? (
              <span
                className="size-1.5 rounded-full bg-destructive"
                role="img"
                aria-label={gt("{count} failed", { count: drawer.failedCount })}
              />
            ) : null}
            {drawer.runningCount > 0 ? (
              <span role="img" aria-label={gt("{count} running", { count: drawer.runningCount })}>
                <Spinner size="xs" tone="muted" />
              </span>
            ) : null}
            <span className="tabular-nums">{drawer.threads.length}</span>
          </span>
        }
      >
        {gt("Bot / Background", { $context: "sidebar section of threads bots started" })}
      </CollapsibleSectionHeader>
    </SortableSidebarMarker>
  );
}

/** The project menu's footer: how to pick more than one project. */
export function ProjectScopeMultiSelectHint() {
  return (
    <div
      className="border-t border-border px-3 py-1.5 text-muted-foreground text-xs"
      data-testid="project-scope-multi-select-hint"
    >
      {isMacPlatform(navigator.platform) ? (
        <T context="project menu hint">Shift or ⌘-click to select multiple</T>
      ) : (
        <T context="project menu hint">Shift or Ctrl-click to select multiple</T>
      )}
    </div>
  );
}
