import { T, useGT } from "gt-react";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";

import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";

import {
  moveSidebarPage,
  normalizeBoardSource,
  setSidebarPageVisible,
  updateForkSettings,
  useForkSettings,
  type SidebarPage,
} from "./forkSettings";
import { SIDEBAR_PAGE_ICONS, useSidebarPageLabels } from "./sidebarPages";

/** Settings this fork adds, saved on this Mac only. Shown under Settings, Labs. */
export function ForkSettingsSection() {
  const gt = useGT();
  const settings = useForkSettings();
  const boardUrlInvalid =
    settings.boardUrl.trim() !== "" && normalizeBoardSource(settings.boardUrl) === null;
  return (
    <SettingsSection id="fork-customizations" title={gt("Customizations")}>
      <SettingsRow
        devicePreference
        title={gt("Sidebar pages")}
        description={gt(
          "Which pages sit at the top of the sidebar, and in what order. Pull requests and Issues show only when a connected server supports them.",
        )}
      >
        <SidebarPagesControl pages={settings.sidebarPages} />
      </SettingsRow>
      <SettingsRow
        devicePreference
        title={gt("Bot board")}
        description={gt(
          "Where bot-desk's board lives: its web address, or its folder or data.json on this Mac. Saved on this device only.",
        )}
        status={
          boardUrlInvalid ? (
            <span className="text-destructive-foreground">
              <T>Use an http://, https:// or file:// address, or a path starting with / or ~/.</T>
            </span>
          ) : null
        }
        control={
          <div className="flex w-full items-center gap-1 sm:w-80">
            <Input
              size="sm"
              type="text"
              value={settings.boardUrl}
              placeholder="https://host:8447/ or ~/dev/bot/.board"
              spellCheck={false}
              aria-invalid={boardUrlInvalid || undefined}
              aria-label={gt("Bot board address or path")}
              onChange={(event) => updateForkSettings({ boardUrl: event.target.value })}
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={settings.boardUrl === ""}
              onClick={() => updateForkSettings({ boardUrl: "" })}
            >
              <T>Clear</T>
            </Button>
          </div>
        }
      />
      <SettingsRow
        devicePreference
        title={gt("Open Board on launch")}
        description={gt("Start on the Board instead of a new thread when the app opens.")}
        control={
          <Switch
            checked={settings.openBoardOnLaunch}
            disabled={!settings.boardEnabled}
            onCheckedChange={(checked) =>
              updateForkSettings({ openBoardOnLaunch: Boolean(checked) })
            }
            aria-label={gt("Open Board on launch")}
          />
        }
      />
      <SettingsRow
        devicePreference
        title={gt("Collapse routine bot updates")}
        description={gt(
          "Fold consecutive agent-to-agent and automation turns in a thread into a single expandable strip, keeping approvals, errors, and 👉 Needs you messages expanded.",
        )}
        control={
          <Switch
            checked={settings.collapseAgentTurns}
            onCheckedChange={(checked) =>
              updateForkSettings({ collapseAgentTurns: Boolean(checked) })
            }
            aria-label={gt("Collapse routine bot updates")}
          />
        }
      />
    </SettingsSection>
  );
}

function SidebarPagesControl(props: { pages: ReadonlyArray<SidebarPage> }) {
  const gt = useGT();
  const labels = useSidebarPageLabels();
  const { pages } = props;
  return (
    <ol className="mt-1 mb-2 flex flex-col gap-0.5" aria-label={gt("Sidebar pages")}>
      {pages.map((page, index) => {
        const Icon = SIDEBAR_PAGE_ICONS[page.id];
        const label = labels[page.id];
        return (
          <li key={page.id} className="flex items-center gap-2 rounded-md px-1 py-1">
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={index === 0}
              aria-label={gt("Move {page} up", { page: label })}
              onClick={() =>
                updateForkSettings({ sidebarPages: moveSidebarPage(pages, page.id, -1) })
              }
            >
              <ArrowUpIcon />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={index === pages.length - 1}
              aria-label={gt("Move {page} down", { page: label })}
              onClick={() =>
                updateForkSettings({ sidebarPages: moveSidebarPage(pages, page.id, 1) })
              }
            >
              <ArrowDownIcon />
            </Button>
            <Switch
              checked={page.visible}
              onCheckedChange={(checked) =>
                updateForkSettings({
                  sidebarPages: setSidebarPageVisible(pages, page.id, Boolean(checked)),
                })
              }
              aria-label={gt("Show {page} in the sidebar", { page: label })}
            />
          </li>
        );
      })}
    </ol>
  );
}
