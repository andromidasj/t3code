import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ContextMenuSource, EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { PlusIcon } from "lucide-react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";

import { ProviderInstanceIcon } from "~/components/chat/ProviderInstanceIcon";
import { ProjectFavicon } from "~/components/ProjectFavicon";
import type { SidebarProviderEntry } from "~/components/sidebar/SidebarThreadRow";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { contextMenuSourceOf, openContextMenuFromKeyboard } from "~/contextMenuSource";
import { useNowMinute } from "~/hooks/useNowMinute";
import { readLocalApi } from "~/localApi";
import { cn } from "~/lib/utils";
import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";
import { useUiStateStore } from "~/uiStateStore";

import {
  buildBotDock,
  emptyBotDock,
  isScopedToTile,
  resolveBotDockClick,
  scopeForNewThread,
  type BotDockModel,
  type BotDockTile,
} from "./botDock.logic";
import { useForkSettings } from "./forkSettings";
import { isThreadRunning, threadNeedsMe } from "./sidebarHierarchy";
import { useSidebarLens } from "./useSidebarHierarchy";

type DockThread = EnvironmentThreadShell;
type DockGroup = SidebarProjectSnapshot;
type DockTile = BotDockTile<DockThread, DockGroup>;

/** The dock for this Mac's pinned projects; empty when the dock is off or nothing is pinned. */
export function useBotDock(input: {
  readonly groups: ReadonlyArray<DockGroup>;
  readonly threads: ReadonlyArray<DockThread>;
  readonly routeThreadKey: string | null;
  readonly projectScopeKeys: ReadonlyArray<string>;
}): BotDockModel<DockThread, DockGroup> {
  const { botDockEnabled, sidebarHierarchyEnabled, spacesEnabled } = useForkSettings();
  const [lens] = useSidebarLens();
  // `YYYY-MM-DDTHH:mm` in UTC; the dock only needs snooze wakes to the minute.
  const nowMinute = useNowMinute();
  const localLastVisitedAt = useUiStateStore((store) => store.threadLastVisitedAtById);
  // Spaces replace the dock with their own grid of pinned threads.
  if (!botDockEnabled || spacesEnabled) return emptyBotDock();
  return buildBotDock({
    ...input,
    lens: sidebarHierarchyEnabled ? lens : null,
    now: `${nowMinute}:00.000Z`,
    localLastVisitedAt,
  });
}

export interface BotDockProps {
  readonly dock: BotDockModel<DockThread, DockGroup>;
  readonly projectScopeKeys: ReadonlyArray<string>;
  readonly routeThreadKey: string | null;
  readonly providerEntriesByEnvironment: ReadonlyMap<
    string,
    ReadonlyMap<string, SidebarProviderEntry>
  >;
  readonly environmentLabelById: ReadonlyMap<EnvironmentId, string | null>;
  /** Projects span several environments, so the tooltip names the thread's. */
  readonly showEnvironments: boolean;
  readonly canUnpin: (group: DockGroup) => boolean;
  readonly onProjectScopeChange: (keys: readonly string[]) => void;
  readonly onOpenThread: (ref: ScopedThreadRef) => void;
  readonly onNewThread: (group: DockGroup) => void;
  readonly onOpenProjectSettings: (group: DockGroup) => void;
  readonly onUnpin: (group: DockGroup) => void;
}

/** Pinned projects as avatars above the sidebar's filter. */
export function BotDock(props: BotDockProps) {
  const gt = useGT();
  const tiles = props.dock.tiles.filter((tile) => !tile.hidden);
  if (tiles.length === 0) return null;
  const startThread = (group: DockGroup) => {
    const scope = scopeForNewThread(group.projectKey, props.projectScopeKeys);
    if (scope !== null) props.onProjectScopeChange([...scope]);
    props.onNewThread(group);
  };
  const activate = (tile: DockTile) => {
    const click = resolveBotDockClick(tile, {
      projectScopeKeys: props.projectScopeKeys,
      routeThreadKey: props.routeThreadKey,
    });
    if (click.scope !== null) props.onProjectScopeChange([...click.scope]);
    if (click.open !== null) {
      props.onOpenThread(scopeThreadRef(click.open.environmentId, click.open.id));
    }
  };
  const showMenu = (
    tile: DockTile,
    position: { readonly x: number; readonly y: number },
    source: ContextMenuSource,
  ) => {
    const api = readLocalApi();
    if (!api) return;
    const { group } = tile;
    const scoped = isScopedToTile(tile.key, props.projectScopeKeys);
    void (async () => {
      let clicked: string | null;
      try {
        clicked = await api.contextMenu.show(
          [
            {
              id: "new-thread",
              label: gt("New thread in {project}", { project: group.displayName }),
              icon: "message-square-plus",
            },
            scoped
              ? { id: "show-all", label: gt("Show all projects"), icon: "folder-tree" }
              : {
                  id: "filter",
                  label: gt("Filter to {project}", { project: group.displayName }),
                  icon: "folder",
                },
            { id: "project-settings", label: gt("Project settings"), icon: "settings" },
            ...(props.canUnpin(group)
              ? [{ id: "unpin", label: gt("Unpin from Bot Dock"), icon: "pin-off" }]
              : []),
          ],
          position,
          source,
        );
      } catch {
        return;
      }
      switch (clicked) {
        case "new-thread":
          startThread(group);
          return;
        case "show-all":
          props.onProjectScopeChange([]);
          return;
        case "filter":
          props.onProjectScopeChange([tile.key]);
          return;
        case "project-settings":
          props.onOpenProjectSettings(group);
          return;
        case "unpin":
          props.onUnpin(group);
          return;
      }
    })();
  };
  return (
    <div
      role="group"
      aria-label={gt("Bot Dock")}
      data-testid="bot-dock"
      className="flex flex-wrap justify-center gap-x-2 gap-y-0.5 px-2 pt-1.5 pb-1"
    >
      {tiles.map((tile) => (
        <BotDockTileView
          key={tile.key}
          tile={tile}
          providerEntry={
            tile.provider === null
              ? null
              : (props.providerEntriesByEnvironment
                  .get(tile.provider.environmentId)
                  ?.get(tile.provider.instanceId) ?? null)
          }
          environmentLabel={
            props.showEnvironments && tile.featuredThread !== null
              ? (props.environmentLabelById.get(tile.featuredThread.environmentId) ?? null)
              : null
          }
          onActivate={() => activate(tile)}
          onNewThread={() => startThread(tile.group)}
          onContextMenu={(event) => {
            event.preventDefault();
            showMenu(tile, { x: event.clientX, y: event.clientY }, contextMenuSourceOf(event));
          }}
        />
      ))}
    </div>
  );
}

// The badge and pills cut into the avatar with a ring in the tile's own color.
const TILE_BG_CLASS =
  "[--tile-bg:var(--sidebar)] hover:bg-sidebar-row-hover hover:[--tile-bg:var(--sidebar-row-hover)] has-focus-visible:bg-sidebar-row-hover has-focus-visible:[--tile-bg:var(--sidebar-row-hover)]";

const RING_MASK: CSSProperties = {
  maskImage:
    "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1.5px))",
  WebkitMaskImage:
    "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1.5px))",
};

const WORKING_RING: CSSProperties = {
  ...RING_MASK,
  animationDuration: "1.6s",
  background:
    "conic-gradient(from 0deg, transparent 0 38%, var(--info) 93%, transparent 93.5%), color-mix(in oklab, var(--info) 16%, transparent)",
};

function BotDockTileView(props: {
  readonly tile: DockTile;
  readonly providerEntry: SidebarProviderEntry | null;
  readonly environmentLabel: string | null;
  readonly onActivate: () => void;
  readonly onNewThread: () => void;
  readonly onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const gt = useGT();
  const { tile, providerEntry } = props;
  const { group } = tile;
  const statusLabel =
    tile.status === "needs"
      ? gt("Needs you", { $context: "bot dock status" })
      : tile.status === "working"
        ? gt("Working", { $context: "bot dock status" })
        : null;
  const label = [
    group.displayName,
    statusLabel,
    tile.unread ? gt("unread", { $context: "bot dock status" }) : null,
    tile.topicCount !== null
      ? gt("{count, plural, one {# thread} other {# threads}}", { count: tile.topicCount })
      : null,
  ]
    .filter((part) => part !== null)
    .join(", ");
  return (
    <div
      data-testid={`bot-dock-tile-${group.projectKey}`}
      data-selected={tile.selected || undefined}
      data-status={tile.status}
      className={cn(
        "group/tile relative w-[calc((100%-1rem)/3)] rounded-xl transition-colors duration-200",
        TILE_BG_CLASS,
        tile.selected &&
          "bg-sidebar-row-selected [--tile-bg:var(--sidebar-row-selected)] ring-1 ring-foreground/5 ring-inset hover:bg-sidebar-row-selected hover:[--tile-bg:var(--sidebar-row-selected)]",
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={label}
              aria-current={tile.selected ? "true" : undefined}
              className="flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-xl px-1 pt-2 pb-1.5 outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={props.onActivate}
              onContextMenu={props.onContextMenu}
              onKeyDown={openContextMenuFromKeyboard}
            />
          }
        >
          <span className="relative size-12 shrink-0 transition-transform duration-100 group-active/tile:scale-96">
            {tile.status === "working" ? (
              <span
                aria-hidden
                data-testid="bot-dock-ring-working"
                className="pointer-events-none absolute -inset-1 animate-spin rounded-full motion-reduce:animate-none"
                style={WORKING_RING}
              />
            ) : tile.status === "needs" ? (
              <span
                aria-hidden
                data-testid="bot-dock-ring-needs"
                className="pointer-events-none absolute -inset-1 animate-pulse rounded-full bg-warning motion-reduce:animate-none"
                style={RING_MASK}
              />
            ) : null}
            <BotDockAvatar group={group} />
            {providerEntry !== null ? (
              <span
                aria-hidden
                className="absolute -right-0.75 -bottom-0.75 flex size-5 items-center justify-center rounded-full bg-sidebar-control-surface ring-2 ring-(--tile-bg) transition-shadow duration-150"
              >
                <ProviderInstanceIcon
                  driverKind={providerEntry.driverKind}
                  displayName={providerEntry.displayName}
                  accentColor={providerEntry.accentColor}
                  acpRegistryAgentId={providerEntry.acpRegistryAgentId}
                  acpRegistryIconUrl={providerEntry.acpRegistryIconUrl}
                  iconClassName="size-3"
                />
              </span>
            ) : null}
            {tile.topicCount !== null ? (
              <span
                aria-hidden
                data-testid="bot-dock-count"
                className="absolute -top-0.75 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-sidebar-control-surface px-1 font-semibold text-2xs tabular-nums leading-none text-sidebar-foreground ring-2 ring-(--tile-bg) transition-[opacity,scale] duration-150 group-hover/tile:scale-60 group-hover/tile:opacity-0 group-has-focus-visible/tile:opacity-0"
              >
                {tile.topicCount > 99 ? "99+" : tile.topicCount}
              </span>
            ) : null}
          </span>
          <span
            className={cn(
              "flex h-3.5 max-w-full items-center justify-center px-1 text-2xs leading-3.5",
              tile.selected || tile.unread
                ? "text-sidebar-foreground"
                : "text-sidebar-foreground/80",
              tile.unread ? "font-semibold" : tile.selected ? "font-medium" : "font-normal",
            )}
          >
            {/* The dot hangs outside the label, so the name stays centered. */}
            <span className="relative min-w-0">
              {tile.unread ? (
                <span
                  aria-hidden
                  data-testid="bot-dock-unread"
                  className="absolute top-1/2 -left-2.5 size-1.5 -translate-y-1/2 rounded-full bg-info"
                />
              ) : null}
              <span className="block truncate">{group.displayName}</span>
            </span>
          </span>
        </TooltipTrigger>
        <TooltipPopup side="top" className="max-w-60">
          <BotDockTooltip
            tile={tile}
            providerName={providerEntry?.displayName ?? null}
            environmentLabel={props.environmentLabel}
          />
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={gt("New thread in {project}", { project: group.displayName })}
              data-testid="bot-dock-new-thread"
              className="absolute top-1 left-[calc(50%+0.6875rem)] flex size-5 scale-55 cursor-pointer items-center justify-center rounded-full bg-sidebar-foreground text-sidebar opacity-0 shadow-sm ring-2 ring-(--tile-bg) outline-none transition-[opacity,scale,background-color] duration-150 group-hover/tile:scale-100 group-hover/tile:opacity-100 group-has-focus-visible/tile:scale-100 group-has-focus-visible/tile:opacity-100 hover:bg-primary hover:text-primary-foreground focus-visible:ring-ring"
              onClick={(event) => {
                event.stopPropagation();
                props.onNewThread();
              }}
            />
          }
        >
          <PlusIcon aria-hidden className="size-3" strokeWidth={2.8} />
        </TooltipTrigger>
        <TooltipPopup side="top">
          {gt("New thread in {project}", { project: group.displayName })}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

/**
 * The project's icon at avatar size. Monograms fill the disc; images, emoji and icons sit
 * inside a quiet disc so every kind reads at the same weight.
 */
function BotDockAvatar(props: { readonly group: DockGroup }) {
  const kind = props.group.projectIcon?.kind;
  return (
    <span
      aria-hidden
      className="relative flex size-12 items-center justify-center overflow-hidden rounded-full bg-sidebar-control-surface ring-1 ring-foreground/10 ring-inset [&_[data-slot=project-monogram]]:size-full [&_[data-slot=project-monogram]_svg]:rounded-none"
    >
      <ProjectFavicon
        project={props.group}
        className={
          kind === "lucide" ? "size-6" : kind === "emoji" ? "size-7" : "size-[86%] rounded-lg"
        }
      />
    </span>
  );
}

function BotDockTooltip(props: {
  readonly tile: DockTile;
  readonly providerName: string | null;
  readonly environmentLabel: string | null;
}) {
  const gt = useGT();
  const { tile } = props;
  const thread = tile.featuredThread;
  const threadStatus =
    thread === null
      ? null
      : threadNeedsMe(thread)
        ? gt("Needs you", { $context: "bot dock status" })
        : isThreadRunning(thread)
          ? gt("Working", { $context: "bot dock status" })
          : tile.unread && tile.mainThread !== null
            ? gt("New reply", { $context: "bot dock status" })
            : gt("Idle", { $context: "bot dock status" });
  const meta = [threadStatus, props.providerName, props.environmentLabel].filter(
    (part): part is string => part !== null,
  );
  return (
    <div className="flex min-w-0 flex-col gap-0.5 py-0.5">
      <div className="truncate font-semibold">
        {thread?.title ?? tile.group.displayName}
        {tile.topicCount !== null ? (
          <span className="font-normal text-muted-foreground">
            {" · "}
            {gt("{count, plural, one {# thread} other {# threads}}", { count: tile.topicCount })}
          </span>
        ) : null}
      </div>
      {meta.length > 0 ? (
        <div className="truncate text-muted-foreground text-xs">{meta.join(" · ")}</div>
      ) : null}
      {tile.mainThread === null ? (
        <div className="text-muted-foreground text-xs">
          {tile.selected
            ? gt("Click to show all projects")
            : gt("Click to filter to {project}", { project: tile.group.displayName })}
        </div>
      ) : null}
    </div>
  );
}
