import { T, useGT } from "gt-react";

import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";

import { normalizeBoardSource, updateForkSettings, useForkSettings } from "./forkSettings";

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
        title={gt("Board view")}
        description={gt(
          "Show a Board row at the top of the sidebar with what needs you and what is running.",
        )}
        control={
          <Switch
            checked={settings.boardEnabled}
            onCheckedChange={(checked) => updateForkSettings({ boardEnabled: Boolean(checked) })}
            aria-label={gt("Board view")}
          />
        }
      />
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
    </SettingsSection>
  );
}
