import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { ArrowUpRightIcon, CheckIcon, CopyIcon, TriangleAlertIcon } from "lucide-react";

import ChatMarkdown from "~/components/ChatMarkdown";
import { RelativeTime } from "~/components/RelativeTime";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";

import { findBoardItemById, rewriteBoardThreadLinks, type BoardItemRow } from "./board.logic";
import { DeskBadge, ItemTypeBadge, NotReadyBadge, WhenBadge } from "./boardBadges";
import type { BoardData } from "./boardData";
import { IconAction } from "./boardPanels";

/**
 * A Board item's Details tab: who it belongs to, its id, a way into the desk's bot thread, and
 * the item itself. `row` is null while the board loads or after the item closed on the desk.
 */
export function BoardItemDetailPanel(props: {
  itemKey: string;
  row: BoardItemRow | null;
  data: BoardData | null;
  deskColor: string | undefined;
  /** Opens the desk's bot thread full screen; null when the desk has no thread here. */
  onOpenDesk: (() => void) | null;
  /** For links in the item's Markdown; null when no environment is connected. */
  markdownEnvironmentId: EnvironmentId | null;
  /** The Board panel's entry that pull request links open in. */
  panelRef: ScopedThreadRef | null;
  onSelectItem: (key: string) => void;
}) {
  const gt = useGT();
  const { row } = props;
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const itemId = row?.item.id ?? props.itemKey;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-4 py-1.5">
        {row ? <DeskBadge desk={row.desk} color={props.deskColor} /> : null}
        <span className="min-w-0 truncate font-mono text-muted-foreground text-xs">{itemId}</span>
        <IconAction
          label={isCopied ? gt("Copied") : gt("Copy item id")}
          onClick={() => copyToClipboard(itemId, undefined)}
        >
          {isCopied ? <CheckIcon /> : <CopyIcon />}
        </IconAction>
        <div className="min-w-0 flex-1" />
        {row !== null && props.onOpenDesk !== null ? (
          <Button size="sm" variant="outline" className="shrink-0" onClick={props.onOpenDesk}>
            <ArrowUpRightIcon />
            {gt("Open in {desk}", { desk: row.desk.name })}
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">
        {row === null ? (
          <p className="p-4 text-muted-foreground text-sm">
            {props.data === null
              ? gt("Loading the board…")
              : gt("This item is no longer on the board.")}
          </p>
        ) : (
          <BoardItemDetails
            row={row}
            data={props.data}
            markdownEnvironmentId={props.markdownEnvironmentId}
            panelRef={props.panelRef}
            onSelectItem={props.onSelectItem}
          />
        )}
      </div>
    </div>
  );
}

function BoardItemDetails(props: {
  row: BoardItemRow;
  data: BoardData | null;
  markdownEnvironmentId: EnvironmentId | null;
  panelRef: ScopedThreadRef | null;
  onSelectItem: (key: string) => void;
}) {
  const { item, desk } = props.row;
  const environmentId = props.markdownEnvironmentId ?? undefined;
  const pullRequestPanelRef = props.panelRef ?? undefined;
  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-4 p-4">
        {item.banner === null ? null : (
          <div
            role="note"
            className="flex gap-2 rounded-lg border border-warning/32 bg-warning/8 px-3 py-2 text-sm text-warning-foreground"
          >
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <span className="font-medium">
                <T context="board item banner prefix">Not ready:</T>
              </span>{" "}
              <ChatMarkdown
                inline
                text={rewriteBoardThreadLinks(item.banner)}
                cwd={undefined}
                environmentId={environmentId}
                pullRequestPanelRef={pullRequestPanelRef}
              />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="font-medium text-base leading-snug">
            <ChatMarkdown
              inline
              text={rewriteBoardThreadLinks(item.ask)}
              cwd={undefined}
              environmentId={environmentId}
              pullRequestPanelRef={pullRequestPanelRef}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
            <ItemTypeBadge type={item.type} />
            <WhenBadge when={item.when} />
            {item.banner === null ? null : <NotReadyBadge />}
            {item.checked === null ? null : (
              <span>
                <T context="board item, followed by how long ago a bot last checked it">Checked</T>{" "}
                <RelativeTime timestamp={item.checked} />
              </span>
            )}
          </div>
        </div>

        {item.unblocks.length === 0 ? null : (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">
              <T context="board item, followed by the items it unblocks">Unblocks</T>
            </span>
            {item.unblocks.map((ref) => {
              const target = findBoardItemById(props.data, ref, desk.slug);
              return target === null ? (
                <Badge key={ref} size="sm" variant="outline">
                  <span className="font-mono">{ref}</span>
                </Badge>
              ) : (
                <Badge
                  key={ref}
                  size="sm"
                  variant="outline"
                  className="cursor-pointer"
                  render={<button type="button" onClick={() => props.onSelectItem(target.key)} />}
                >
                  <span className="font-mono">{ref}</span>
                </Badge>
              );
            })}
          </div>
        )}

        {item.body.trim() === "" ? null : (
          <div className="border-border border-t pt-4">
            <ChatMarkdown
              text={rewriteBoardThreadLinks(item.body)}
              cwd={undefined}
              environmentId={environmentId}
              pullRequestPanelRef={pullRequestPanelRef}
            />
          </div>
        )}

        {item.path === "" ? null : (
          <p className="break-all font-mono text-2xs text-muted-foreground">{item.path}</p>
        )}
      </div>
    </div>
  );
}
