import { expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import { ForkHistorySwipeNavigation } from "./ForkHistorySwipeNavigation";
import { updateForkSettings } from "./forkSettings";

const navigateHistory = vi.hoisted(() => vi.fn());
vi.mock("../navigationHistory", () => ({ canNavigateHistory: () => true, navigateHistory }));

function swipeBack(target: Element) {
  for (const deltaX of [-130, 0]) {
    target.dispatchEvent(new WheelEvent("wheel", { deltaX, bubbles: true, composed: true }));
  }
}

it.each([
  [true, 0],
  [false, 1],
] as const)(
  "with disableHistorySwipeNavigation %s, a swipe back navigates %i times",
  async (disabled, navigations) => {
    navigateHistory.mockReset();
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    updateForkSettings({ disableHistorySwipeNavigation: disabled });
    await using screen = await render(<ForkHistorySwipeNavigation />);
    const panel = screen.container.appendChild(document.createElement("div"));
    panel.style.cssText = "width: 200px; height: 20px";

    swipeBack(panel);

    expect(navigateHistory).toHaveBeenCalledTimes(navigations);
  },
);
