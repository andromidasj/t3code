import { SpaceEditorPopover } from "./SpaceEditorPopover";
import { SpacePinnedGrid, type SpacePinnedGridProps } from "./SpacePinnedGrid";
import { SpaceBadge } from "./spaceLook";

/**
 * The shown Space at the top of the sidebar, under its pages: icon, name and editor, then its
 * pinned threads. Nothing when Spaces are off.
 */
export function SpaceHeader(props: SpacePinnedGridProps) {
  const view = props.spaces.view;
  if (view === null) return null;
  const space = view.shownSpace;
  return (
    <div data-fork-space-slide data-testid="space-section" className="flex flex-col">
      <div data-testid="space-header" className="flex h-10 items-center gap-2 pr-0.5 pl-1.5">
        <SpaceBadge icon={space.icon} tint={space.tint} />
        <span className="min-w-0 flex-1 truncate font-semibold text-sm tracking-tight text-sidebar-foreground">
          {space.name}
        </span>
        <SpaceEditorPopover
          spaces={props.spaces}
          space={space}
          showEnvironments={props.showEnvironments}
        />
      </div>
      <SpacePinnedGrid {...props} />
    </div>
  );
}
