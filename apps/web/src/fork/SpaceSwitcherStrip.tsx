import type { ContextMenuSource } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { PlusIcon } from "lucide-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { contextMenuSourceOf, openContextMenuFromKeyboard } from "~/contextMenuSource";
import { readLocalApi } from "~/localApi";
import { cn, isMacPlatform } from "~/lib/utils";

import { SpaceGlyph, tintedStyle } from "./spaceLook";
import { deleteSpace, moveSpace, setDefaultSpace, type SidebarSpace } from "./spaces.logic";
import type { ForkSidebarSpaces } from "./useSidebarSpaces";

// Each Space button is w-8 (8 * --spacing) with gap-1 (1 * --spacing); the pill slides by 9.
const pillTransform = (index: number) =>
  `translateX(calc(${Math.max(0, index)} * var(--spacing) * 9))`;

/** The Spaces as a row of icons above Settings, with a + to add one. */
export function SpaceSwitcherStrip(props: { readonly spaces: ForkSidebarSpaces }) {
  const gt = useGT();
  const { spaces } = props;
  const view = spaces.view;
  if (view === null) return null;
  const { resolved, shownSpace, stats } = view;
  const shownIndex = resolved.spaces.indexOf(shownSpace);
  const showShortcuts = isMacPlatform(navigator.platform);
  const allProjectKeys = [...view.projects.groupsBySpace.values()]
    .flat()
    .map((group) => group.projectKey);
  const showMenu = (
    space: SidebarSpace,
    position: { readonly x: number; readonly y: number },
    source: ContextMenuSource,
  ) => {
    const api = readLocalApi();
    if (!api) return;
    const index = resolved.spaces.indexOf(space);
    void (async () => {
      let clicked: string | null;
      try {
        clicked = await api.contextMenu.show(
          [
            { id: "edit", label: gt("Edit space"), icon: "pencil" },
            {
              id: "default",
              label: gt("Set as default for new projects"),
              icon: "check",
              disabled: resolved.defaultSpace.id === space.id,
            },
            { id: "left", label: gt("Move left"), disabled: index <= 0, separatorBefore: true },
            {
              id: "right",
              label: gt("Move right"),
              disabled: index >= resolved.spaces.length - 1,
            },
            {
              id: "delete",
              label: gt("Delete space"),
              icon: "trash",
              destructive: true,
              disabled: resolved.spaces.length <= 1,
              separatorBefore: true,
            },
          ],
          position,
          source,
        );
      } catch {
        return;
      }
      switch (clicked) {
        case "edit":
          spaces.switchTo(space.id);
          spaces.setEditorOpen(true);
          return;
        case "default":
          spaces.save(setDefaultSpace(spaces.state, space.id, allProjectKeys));
          return;
        case "left":
        case "right":
          spaces.save(moveSpace(spaces.state, space.id, clicked === "left" ? -1 : 1));
          return;
        case "delete":
          spaces.save(deleteSpace(spaces.state, space.id));
          return;
      }
    })();
  };
  return (
    <div
      data-testid="space-strip"
      className="relative grid h-10.5 shrink-0 grid-cols-[2rem_1fr_2rem] items-center px-2 before:absolute before:inset-x-3 before:top-0 before:h-px before:bg-sidebar-border"
    >
      <span />
      <div
        role="tablist"
        aria-label={gt("Spaces")}
        className="relative flex min-w-0 justify-center gap-1 justify-self-center"
      >
        <span
          aria-hidden
          data-testid="space-strip-pill"
          style={{
            ...tintedStyle(shownSpace.tint, { fill: 20, edge: 32 }),
            transform: pillTransform(shownIndex),
            transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
          }}
          className="pointer-events-none absolute top-0 left-0 h-7 w-8 rounded-lg transition-[transform,background-color,box-shadow] duration-220 motion-reduce:transition-none"
        />
        {resolved.spaces.map((space, index) => {
          const on = space.id === shownSpace.id;
          const stat = stats.get(space.id);
          const needs = stat?.needsCount ?? 0;
          const unread = stat?.unreadCount ?? 0;
          const dot = on ? null : needs > 0 ? "needs" : unread > 0 ? "unread" : null;
          const details = [
            gt("{count, plural, one {# project} other {# projects}}", {
              count: stat?.projectCount ?? 0,
            }),
            needs > 0 ? gt("{count} waiting", { count: needs }) : null,
            unread > 0 ? gt("{count} unread", { count: unread }) : null,
          ].filter((part): part is string => part !== null);
          return (
            <Tooltip key={space.id}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    role="tab"
                    aria-selected={on}
                    aria-label={[space.name, ...details].join(", ")}
                    data-testid={`space-strip-${space.id}`}
                    data-dot={dot ?? undefined}
                    style={on ? tintedStyle(space.tint, { text: 68 }) : undefined}
                    className={cn(
                      "relative flex h-7 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg outline-none transition-colors duration-220 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      !on &&
                        "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
                    )}
                    onClick={() => spaces.switchTo(space.id)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      showMenu(
                        space,
                        { x: event.clientX, y: event.clientY },
                        contextMenuSourceOf(event),
                      );
                    }}
                    onKeyDown={openContextMenuFromKeyboard}
                  />
                }
              >
                <SpaceGlyph icon={space.icon} className="size-4" />
                {dot !== null ? (
                  <span
                    aria-hidden
                    data-testid="space-strip-dot"
                    className={cn(
                      "absolute top-0.5 right-1 size-1.75 rounded-full ring-2 ring-sidebar",
                      dot === "needs"
                        ? "animate-pulse bg-warning motion-reduce:animate-none"
                        : "bg-info",
                    )}
                  />
                ) : null}
              </TooltipTrigger>
              <TooltipPopup side="top">
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold">
                    {showShortcuts && index < 9
                      ? gt("{space} (⌃{number})", { space: space.name, number: index + 1 })
                      : space.name}
                  </span>
                  <span className="text-muted-foreground text-xs">{details.join(" · ")}</span>
                </div>
              </TooltipPopup>
            </Tooltip>
          );
        })}
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={gt("New Space")}
              data-testid="space-strip-add"
              className="flex h-7 w-8 cursor-pointer items-center justify-center justify-self-end rounded-lg text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={spaces.addSpace}
            />
          }
        >
          <PlusIcon className="size-4" />
        </TooltipTrigger>
        <TooltipPopup side="top">{gt("New Space")}</TooltipPopup>
      </Tooltip>
    </div>
  );
}
