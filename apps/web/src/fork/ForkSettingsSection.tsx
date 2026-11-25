import { T, useGT } from "gt-react";

import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";

import { normalizeBoardUrl, updateForkSettings, useForkSettings } from "./forkSettings";

/** Settings this fork adds, saved on this Mac only. Shown under Settings, Labs. */
export function ForkSettingsSection() {
  const gt = useGT();
  const settings = useForkSettings();
  const boardUrlInvalid =
    settings.boardUrl.trim() !== "" && normalizeBoardUrl(settings.boardUrl) === null;
  return (
    <SettingsSection id="fork-customizations" title={gt("Customizations")}>
      <SettingsRow
        devicePreference
        title={gt("Board view")}
        description={gt(
          "Show a Board button in the sidebar with threads that need you and threads that are running.",
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
        title={gt("Board web page")}
        description={gt("An http or https page to embed in the Board, saved on this device only.")}
        status={
          boardUrlInvalid ? (
            <span className="text-destructive-foreground">
              <T>Use an address that starts with http:// or https://.</T>
            </span>
          ) : null
        }
        control={
          <div className="flex w-full items-center gap-1 sm:w-80">
            <Input
              size="sm"
              type="url"
              value={settings.boardUrl}
              placeholder="https://host:8447/"
              spellCheck={false}
              aria-invalid={boardUrlInvalid || undefined}
              aria-label={gt("Board web page address")}
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
