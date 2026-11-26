import {
  BriefcaseIcon,
  EyeIcon,
  FolderIcon,
  GlobeIcon,
  HouseIcon,
  LayersIcon,
  StarIcon,
  TerminalIcon,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";

import { cn } from "~/lib/utils";

import type { SpaceIconId, SpaceTintId } from "./spaces.logic";

const SPACE_ICONS: Readonly<Record<SpaceIconId, LucideIcon>> = {
  home: HouseIcon,
  eye: EyeIcon,
  briefcase: BriefcaseIcon,
  star: StarIcon,
  terminal: TerminalIcon,
  layers: LayersIcon,
  folder: FolderIcon,
  globe: GlobeIcon,
};

// Mid-tone hues that read on light and dark sidebars; every use mixes them down to a wash.
const TINT_COLORS: Readonly<Record<Exclude<SpaceTintId, "none">, string>> = {
  indigo: "#7c6cf0",
  sky: "#3b8fd9",
  emerald: "#12a383",
  amber: "#d9952b",
  rose: "#df5f7f",
};

/** The tint's color; "none" is the text color, so its pills stay neutral. */
export function spaceTintColor(tint: SpaceTintId): string {
  return tint === "none" ? "var(--foreground)" : TINT_COLORS[tint];
}

/**
 * A surface washed in the tint: `fill`% background, an optional `edge`% inset outline, and text
 * `text`% of the way to the tint. Inline, since the theme has no token per Space.
 */
export function tintedStyle(
  tint: SpaceTintId,
  input: { readonly fill?: number; readonly edge?: number; readonly text?: number },
): CSSProperties {
  const color = spaceTintColor(tint);
  return {
    ...(input.fill === undefined
      ? {}
      : { backgroundColor: `color-mix(in oklab, ${color} ${input.fill}%, transparent)` }),
    ...(input.edge === undefined
      ? {}
      : { boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} ${input.edge}%, transparent)` }),
    ...(input.text === undefined
      ? {}
      : { color: `color-mix(in oklab, ${color} ${input.text}%, var(--foreground))` }),
  };
}

export function SpaceGlyph(props: { readonly icon: SpaceIconId; readonly className?: string }) {
  const Icon = SPACE_ICONS[props.icon];
  return <Icon aria-hidden className={props.className} />;
}

/** The Space's icon in its tinted rounded square, as the header and the editor show it. */
export function SpaceBadge(props: {
  readonly icon: SpaceIconId;
  readonly tint: SpaceTintId;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden
      style={tintedStyle(props.tint, { fill: 19, edge: 30, text: 66 })}
      className={cn(
        "flex size-6.5 shrink-0 items-center justify-center rounded-lg transition-colors duration-300",
        props.className,
      )}
    >
      <SpaceGlyph icon={props.icon} className="size-3.75" />
    </span>
  );
}
