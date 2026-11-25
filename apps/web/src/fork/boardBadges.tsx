import { T } from "gt-react";
import type { CSSProperties } from "react";

import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

import type { BoardDesk, BoardItem } from "./boardData";

export function DeskBadge(props: {
  desk: BoardDesk;
  color: string | undefined;
  className?: string;
}) {
  return (
    <Badge
      size="sm"
      variant="label"
      className={cn("shrink-0", props.className)}
      style={{ "--label": props.color ?? "#8b8b93" } as CSSProperties}
    >
      {props.desk.name}
    </Badge>
  );
}

export function ItemTypeBadge({ type }: { type: string }) {
  const label =
    type === "send" ? (
      <T context="board item type">Send</T>
    ) : type === "decide" ? (
      <T context="board item type">Decide</T>
    ) : type === "do" ? (
      <T context="board item type">Do</T>
    ) : (
      type
    );
  if (type === "") return null;
  return (
    <Badge size="sm" variant="outline" className="shrink-0">
      {label}
    </Badge>
  );
}

export function WhenBadge({ when }: { when: BoardItem["when"] }) {
  switch (when) {
    case "now":
      return (
        <Badge size="sm" variant="info" className="shrink-0">
          <T context="board item timing">Now</T>
        </Badge>
      );
    case "anytime":
      return (
        <Badge size="sm" variant="secondary" className="shrink-0">
          <T context="board item timing">Anytime</T>
        </Badge>
      );
    case "later":
      return (
        <Badge size="sm" variant="secondary" className="shrink-0">
          <T context="board item timing">Later</T>
        </Badge>
      );
    default:
      return null;
  }
}

export function NotReadyBadge() {
  return (
    <Badge size="sm" variant="warning" className="shrink-0">
      <T context="board item that has nothing for the user to do yet">Not ready</T>
    </Badge>
  );
}
