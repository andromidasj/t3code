import { createFileRoute } from "@tanstack/react-router";

import { BoardPage } from "../fork/BoardPage";
import { boardSearchFromUrl } from "../fork/board.logic";

export const Route = createFileRoute("/_chat/board")({
  validateSearch: boardSearchFromUrl,
  component: BoardPage,
});
