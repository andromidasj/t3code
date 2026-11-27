import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ContextMenuSource, EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { MessageSquareIcon } from "lucide-react";
import { useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";

import { ProviderInstanceIcon } from "~/components/chat/ProviderInstanceIcon";
import { ProjectFavicon } from "~/components/ProjectFavicon";
import { JumpHintBadge, type SidebarProviderEntry } from "~/components/sidebar/SidebarThreadRow";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { contextMenuSourceOf, openContextMenuFromKeyboard } from "~/contextMenuSource";
import { readLocalApi } from "~/localApi";
import { cn } from "~/lib/utils";

import { setGridLabel, setGridThread } from "./spaces.logic";
import type { SpaceGridTile } from "./spacesView.logic";
import type { ForkSidebarSpaces, SpacesGroup, SpacesThread } from "./useSidebarSpaces";

type GridTile = SpaceGridTile<SpacesThread, SpacesGroup>;

export interface SpacePinnedGridProps {
  readonly spaces: ForkSidebarSpaces;
  readonly providerEntriesByEnvironment: ReadonlyMap<
    string,
    ReadonlyMap<string, SidebarProviderEntry>
  >;
  readonly environmentLabelById: ReadonlyMap<EnvironmentId, string | null>;
  /** Projects span several environments, so the tooltip names the thread's. */
  readonly showEnvironments: boolean;
  /** The ⌘1–9 labels by thread key while ⌘ is held; null otherwise. */
  readonly jumpLabelByKey: ReadonlyMap<string, string> | null;
  readonly onOpenThread: (ref: ScopedThreadRef) => void;
  readonly onNewThread: (group: SpacesGroup) => void;
}

/** The shown Space's pinned threads as avatars, three across; nothing at all when it has none. */
export function SpacePinnedGrid(props: SpacePinnedGridProps) {
  const gt = useGT();
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const { spaces } = props;
  const view = spaces.view;
  if (view === null || view.tiles.length === 0) return null;
  const space = view.shownSpace;
  const commitLabel = (tile: GridTile, value: string) => {
    setRenamingKey(null);
    const label = value.trim() === tile.defaultLabel ? "" : value;
    if ((space.gridLabels[tile.key] ?? "") === label.trim()) return;
    spaces.save(setGridLabel(spaces.state, space.id, tile.key, label));
  };
  const showMenu = (
    tile: GridTile,
    position: { readonly x: number; readonly y: number },
    source: ContextMenuSource,
  ) => {
    const api = readLocalApi();
    if (!api) return;
    const { group } = tile;
    void (async () => {
      let clicked: string | null;
      try {
        clicked = await api.contextMenu.show(
          [
            { id: "rename", label: gt("Rename tile label"), icon: "pencil" },
            { id: "unpin", label: gt("Move back to list"), icon: "pin-off" },
            ...(group === null
              ? []
              : [
                  {
                    id: "new-thread",
                    label: gt("New thread in {project}", { project: group.displayName }),
                    icon: "message-square-plus",
                  },
                ]),
          ],
          position,
          source,
        );
      } catch {
        return;
      }
      switch (clicked) {
        case "rename":
          setRenamingKey(tile.key);
          return;
        case "unpin":
          spaces.save(setGridThread(spaces.state, space.id, tile.key, false));
          return;
        case "new-thread":
          if (group !== null) props.onNewThread(group);
          return;
      }
    })();
  };
  return (
    <div
      role="group"
      aria-label={gt("Pinned threads in {space}", { space: space.name })}
      data-testid="space-grid"
      className="flex flex-wrap justify-center gap-x-2 gap-y-0.5 px-2 pb-1"
    >
      {view.tiles.map((tile) => (
        <SpaceGridTileView
          key={tile.key}
          tile={tile}
          jumpLabel={props.jumpLabelByKey?.get(tile.key) ?? null}
          renaming={renamingKey === tile.key}
          providerEntry={
            props.providerEntriesByEnvironment
              .get(tile.thread.environmentId)
              ?.get(tile.thread.providerInstanceId) ?? null
          }
          environmentLabel={
            props.showEnvironments
              ? (props.environmentLabelById.get(tile.thread.environmentId) ?? null)
              : null
          }
          onOpen={() =>
            props.onOpenThread(scopeThreadRef(tile.thread.environmentId, tile.thread.id))
          }
          onRename={() => setRenamingKey(tile.key)}
          onCommitLabel={(value) => commitLabel(tile, value)}
          onCancelRename={() => setRenamingKey(null)}
          onContextMenu={(event) => {
            event.preventDefault();
            showMenu(tile, { x: event.clientX, y: event.clientY }, contextMenuSourceOf(event));
          }}
        />
      ))}
    </div>
  );
}

// The badge sits in a hole cut out of the avatar and its ring, so it stays crisp on any tint.
const AVATAR_CUTOUT = "radial-gradient(circle at 42px 42px, transparent 11px, #000 11.5px)";
const RING_CUTOUT = "radial-gradient(circle at 46px 46px, transparent 11px, #000 11.5px)";
const RING_BAND =
  "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1.5px))";

const maskStyle = (...layers: string[]): CSSProperties => {
  const image = layers.join(", ");
  return {
    maskImage: image,
    WebkitMaskImage: image,
    ...(layers.length > 1 ? { maskComposite: "intersect", WebkitMaskComposite: "source-in" } : {}),
  };
};

const WORKING_SWEEP: CSSProperties = {
  animationDuration: "1.6s",
  background:
    "conic-gradient(from 0deg, transparent 0 38%, var(--info) 93%, transparent 93.5%), color-mix(in oklab, var(--info) 16%, transparent)",
};

function SpaceGridTileView(props: {
  readonly tile: GridTile;
  readonly jumpLabel: string | null;
  readonly renaming: boolean;
  readonly providerEntry: SidebarProviderEntry | null;
  readonly environmentLabel: string | null;
  readonly onOpen: () => void;
  readonly onRename: () => void;
  readonly onCommitLabel: (value: string) => void;
  readonly onCancelRename: () => void;
  readonly onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const gt = useGT();
  const { tile, providerEntry } = props;
  const statusLabel =
    tile.status === "needs"
      ? gt("Needs you", { $context: "space grid status" })
      : tile.status === "working"
        ? gt("Working", { $context: "space grid status" })
        : tile.unread
          ? gt("New reply", { $context: "space grid status" })
          : gt("Idle", { $context: "space grid status" });
  const avatar = (
    <span className="relative size-12 shrink-0 transition-transform duration-100 group-active/tile:scale-96">
      {tile.status === "working" ? (
        <span
          aria-hidden
          data-testid="space-grid-ring-working"
          className="pointer-events-none absolute -inset-1 rounded-full"
          style={maskStyle(RING_BAND, ...(providerEntry === null ? [] : [RING_CUTOUT]))}
        >
          <span
            className="absolute inset-0 animate-spin rounded-full motion-reduce:animate-none"
            style={WORKING_SWEEP}
          />
        </span>
      ) : tile.status === "needs" ? (
        <span
          aria-hidden
          data-testid="space-grid-ring-needs"
          className="pointer-events-none absolute -inset-1 animate-pulse rounded-full bg-warning motion-reduce:animate-none"
          style={maskStyle(RING_BAND, ...(providerEntry === null ? [] : [RING_CUTOUT]))}
        />
      ) : null}
      <span
        aria-hidden
        className="relative flex size-12 items-center justify-center overflow-hidden rounded-full bg-sidebar-control-surface ring-1 ring-foreground/10 ring-inset [&_[data-slot=project-monogram]]:size-full [&_[data-slot=project-monogram]_svg]:rounded-none"
        style={providerEntry === null ? undefined : maskStyle(AVATAR_CUTOUT)}
      >
        {tile.group !== null ? (
          <ProjectFavicon
            project={tile.group}
            className={
              tile.group.projectIcon?.kind === "lucide"
                ? "size-6"
                : tile.group.projectIcon?.kind === "emoji"
                  ? "size-7"
                  : "size-[86%] rounded-lg"
            }
          />
        ) : (
          <MessageSquareIcon className="size-5 text-sidebar-muted-foreground" />
        )}
      </span>
      {providerEntry !== null ? (
        <span
          aria-hidden
          data-testid="space-grid-provider"
          className="absolute -right-0.75 -bottom-0.75 flex size-4.5 items-center justify-center rounded-full bg-sidebar-control-surface ring-1 ring-foreground/10 ring-inset"
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
    </span>
  );
  const tileClass = "flex w-full flex-col items-center gap-1.5 rounded-xl px-1 pt-2 pb-1.5";
  return (
    <div
      data-testid={`space-grid-tile-${tile.key}`}
      data-selected={tile.selected || undefined}
      data-status={tile.status}
      className={cn(
        "group/tile relative w-[calc((100%-1rem)/3)] rounded-xl transition-colors duration-150",
        !props.renaming && "hover:bg-sidebar-row-hover has-focus-visible:bg-sidebar-row-hover",
        tile.selected &&
          "bg-sidebar-row-selected ring-1 ring-foreground/5 ring-inset hover:bg-sidebar-row-selected",
      )}
    >
      {props.renaming ? (
        <div className={tileClass}>
          {avatar}
          <input
            autoFocus
            defaultValue={tile.label}
            maxLength={40}
            aria-label={gt("Tile label")}
            spellCheck={false}
            data-testid="space-grid-rename"
            className="h-4 w-full rounded-sm border border-ring bg-background px-1 text-center text-2xs leading-3.5 text-foreground outline-none ring-3 ring-ring/20"
            onFocus={(event) => event.currentTarget.select()}
            onBlur={(event) => props.onCommitLabel(event.currentTarget.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                props.onCommitLabel(event.currentTarget.value);
              } else if (event.key === "Escape") {
                event.preventDefault();
                props.onCancelRename();
              }
            }}
          />
        </div>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={gt("{label}: {title}, {status}", {
                  label: tile.label,
                  title: tile.thread.title,
                  status: statusLabel,
                })}
                aria-current={tile.selected ? "true" : undefined}
                className={cn(
                  tileClass,
                  "cursor-pointer outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                )}
                onClick={props.onOpen}
                onContextMenu={props.onContextMenu}
                onKeyDown={(event) => {
                  if (event.key === "F2") {
                    event.preventDefault();
                    props.onRename();
                    return;
                  }
                  openContextMenuFromKeyboard(event);
                }}
              />
            }
          >
            {avatar}
            {props.jumpLabel !== null ? (
              <span className="pointer-events-none absolute top-1 right-0.5">
                <JumpHintBadge label={props.jumpLabel} />
              </span>
            ) : null}
            <span
              className={cn(
                "flex h-3.5 max-w-full items-center justify-center px-1.5 text-2xs leading-3.5",
                tile.selected || tile.unread
                  ? "text-sidebar-foreground"
                  : "text-sidebar-foreground/80",
                tile.unread ? "font-semibold" : tile.selected ? "font-medium" : "font-normal",
              )}
            >
              {/* The dot hangs outside the label, so the label stays centered. */}
              <span className="relative min-w-0">
                {tile.unread ? (
                  <span
                    aria-hidden
                    data-testid="space-grid-unread"
                    className="absolute top-1/2 -left-2.5 size-1.5 -translate-y-1/2 rounded-full bg-info"
                  />
                ) : null}
                <span className="block truncate">{tile.label}</span>
              </span>
            </span>
          </TooltipTrigger>
          <TooltipPopup side="top" className="max-w-64">
            <div className="flex min-w-0 flex-col gap-0.5 py-0.5">
              <div className="font-semibold">{tile.thread.title}</div>
              <div className="truncate text-muted-foreground text-xs">
                {[statusLabel, providerEntry?.displayName ?? null, props.environmentLabel]
                  .filter((part): part is string => part !== null)
                  .join(" · ")}
              </div>
            </div>
          </TooltipPopup>
        </Tooltip>
      )}
    </div>
  );
}
