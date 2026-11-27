import { HistorySwipeNavigation } from "~/components/HistorySwipeNavigation";

import { useForkSettings } from "./forkSettings";

/** Upstream's swipe back/forward, unless this Mac turned it off under Labs, Customizations. */
export function ForkHistorySwipeNavigation() {
  return useForkSettings().disableHistorySwipeNavigation ? null : <HistorySwipeNavigation />;
}
