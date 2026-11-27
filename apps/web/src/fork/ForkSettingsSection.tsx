import { T, useGT } from "gt-react";
import { ArrowDownIcon, ArrowUpIcon, XIcon } from "lucide-react";

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
  type SidebarFilterPreset,
  type SidebarPage,
} from "./forkSettings";
import { removeSidebarFilterPreset, renameSidebarFilterPreset } from "./sidebarHierarchy";
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
      <SettingsRow
        devicePreference
        title={gt("Sidebar filter and Bot / Background")}
        description={gt(
          "Show All and Needs me above the thread list, and fold threads bots started on their own (that you never wrote in) into a collapsible Bot / Background section.",
        )}
        control={
          <Switch
            checked={settings.sidebarHierarchyEnabled}
            onCheckedChange={(checked) =>
              updateForkSettings({ sidebarHierarchyEnabled: Boolean(checked) })
            }
            aria-label={gt("Sidebar filter and Bot / Background")}
          />
        }
      />
      <SettingsRow
        devicePreference
        title={gt("Bot Dock (pinned projects grid)")}
        description={gt(
          "Shows pinned projects in an avatar grid at the top of the sidebar; pin projects from the project menu.",
        )}
        control={
          <Switch
            checked={settings.botDockEnabled}
            onCheckedChange={(checked) => updateForkSettings({ botDockEnabled: Boolean(checked) })}
            aria-label={gt("Bot Dock (pinned projects grid)")}
          />
        }
      />
      <SettingsRow
        devicePreference
        title={gt("Arc-style Spaces sidebar")}
        description={gt(
          "Organize projects into swipeable Spaces with a per-Space pinned thread grid (Ctrl+1–9). Replaces saved views and the project menu while on.",
        )}
        control={
          <Switch
            checked={settings.spacesEnabled}
            onCheckedChange={(checked) => updateForkSettings({ spacesEnabled: Boolean(checked) })}
            aria-label={gt("Arc-style Spaces sidebar")}
          />
        }
      />
      <SettingsRow
        devicePreference
        title={gt("Show projects & bots in @ mentions")}
        description={gt(
          "List projects first in the composer's @ menu; picking one types @Name so the agent knows which bot you mean.",
        )}
        control={
          <Switch
            checked={settings.composerProjectMentions}
            onCheckedChange={(checked) =>
              updateForkSettings({ composerProjectMentions: Boolean(checked) })
            }
            aria-label={gt("Show projects & bots in @ mentions")}
          />
        }
      />
      <SettingsRow
        devicePreference
        title={gt("Hide workspace files from @ mentions")}
        description={gt(
          "Leave files and folders out of the composer's @ menu; threads, machines and models stay.",
        )}
        control={
          <Switch
            checked={settings.hideComposerWorkspaceFiles}
            onCheckedChange={(checked) =>
              updateForkSettings({ hideComposerWorkspaceFiles: Boolean(checked) })
            }
            aria-label={gt("Hide workspace files from @ mentions")}
          />
        }
      />
      <SettingsRow
        devicePreference
        title={gt("Disable swipe-to-navigate back/forward")}
        description={gt(
          "Stops two-finger horizontal swipes from triggering browser-style back/forward navigation. Keyboard shortcuts and header arrows still work.",
        )}
        control={
          <Switch
            checked={settings.disableHistorySwipeNavigation}
            onCheckedChange={(checked) =>
              updateForkSettings({ disableHistorySwipeNavigation: Boolean(checked) })
            }
            aria-label={gt("Disable swipe-to-navigate back/forward")}
          />
        }
      />
      {settings.sidebarFilterPresets.length > 0 ? (
        <SettingsRow
          devicePreference
          title={gt("Saved sidebar views")}
          description={gt(
            "Project selections saved from the sidebar. Rename or delete them here; save new ones from the sidebar with Save view.",
          )}
        >
          <SidebarFilterPresetsControl presets={settings.sidebarFilterPresets} />
        </SettingsRow>
      ) : null}
    </SettingsSection>
  );
}

function SidebarFilterPresetsControl(props: { presets: ReadonlyArray<SidebarFilterPreset> }) {
  const gt = useGT();
  const { presets } = props;
  return (
    <ul className="mt-1 mb-2 flex flex-col gap-0.5" aria-label={gt("Saved sidebar views")}>
      {presets.map((preset) => (
        <li key={preset.id} className="flex items-center gap-2 rounded-md px-1 py-1">
          <Input
            size="sm"
            className="min-w-0 flex-1"
            defaultValue={preset.name}
            aria-label={gt("Name of view {name}", { name: preset.name })}
            onBlur={(event) =>
              updateForkSettings({
                sidebarFilterPresets: renameSidebarFilterPreset(
                  presets,
                  preset.id,
                  event.target.value,
                ),
              })
            }
          />
          <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
            {gt("{count, plural, one {# project} other {# projects}}", {
              count: preset.projectKeys.length,
            })}
          </span>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={gt("Delete view {name}", { name: preset.name })}
            onClick={() =>
              updateForkSettings({
                sidebarFilterPresets: removeSidebarFilterPreset(presets, preset.id),
              })
            }
          >
            <XIcon />
          </Button>
        </li>
      ))}
    </ul>
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
