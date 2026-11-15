import { T, useMessages } from "gt-react";
import {
  getClientSettings,
  updateClientSettings,
  useClientSettings,
} from "../../hooks/useSettings";
import { MenuCheckboxItem, MenuGroup, MenuGroupLabel, MenuItem, MenuSeparator } from "../ui/menu";
import {
  isDefaultThreadDetailsVisibility,
  resolveThreadDetailsVisibility,
  RESET_THREAD_DETAILS_ITEMS,
  setThreadDetailsItem,
  THREAD_DETAILS_ITEMS,
} from "./threadDetailsItems";

/** Menu body that shows and hides thread details items. The card's context menu and Settings share it. */
export function ThreadDetailsItemsMenuItems() {
  const visibility = useClientSettings(resolveThreadDetailsVisibility);
  const m = useMessages();
  const openByDefault = useClientSettings((settings) => settings.threadDetailsOpenByDefault);
  return (
    <>
      <MenuCheckboxItem
        checked={openByDefault}
        onCheckedChange={(checked) => updateClientSettings({ threadDetailsOpenByDefault: checked })}
      >
        <T>Open in new threads</T>
      </MenuCheckboxItem>
      <MenuSeparator />
      <MenuGroup>
        <MenuGroupLabel>
          <T>Show in thread details</T>
        </MenuGroupLabel>
        {THREAD_DETAILS_ITEMS.map((item) => (
          <MenuCheckboxItem
            key={item.id}
            checked={visibility[item.id]}
            onCheckedChange={(checked) =>
              updateClientSettings({
                threadDetailsItems: setThreadDetailsItem(getClientSettings(), item, checked),
              })
            }
          >
            {m(item.label)}
          </MenuCheckboxItem>
        ))}
      </MenuGroup>
      <MenuSeparator />
      <MenuItem
        disabled={openByDefault && isDefaultThreadDetailsVisibility(visibility)}
        onClick={() => updateClientSettings(RESET_THREAD_DETAILS_ITEMS)}
      >
        <T>Reset to default</T>
      </MenuItem>
    </>
  );
}
