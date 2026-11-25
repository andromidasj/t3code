import { create } from "zustand";

import {
  boardPanelHostThreadId,
  sameBoardPanelSelection,
  type BoardPanelSelection,
  type BoardTabChoice,
} from "./boardPanel.logic";

interface BoardPanelState {
  readonly open: boolean;
  /** Kept while the panel is closed, so the toggle reopens what it showed. */
  readonly selection: BoardPanelSelection | null;
  /** The tab picked in each selection, by its host thread id. */
  readonly choices: Readonly<Record<string, BoardTabChoice>>;
}

/**
 * The Board's right panel. Session state, not the URL: opening, switching and closing it never
 * adds a history entry, so Back leaves the Board instead of stepping through panels.
 */
export const useBoardPanelStore = create<BoardPanelState>(() => ({
  open: false,
  selection: null,
  choices: {},
}));

/** Shows `selection`, on `tab` when given (a fresh pick from the list starts on its first tab). */
export function openBoardPanel(selection: BoardPanelSelection, tab?: BoardTabChoice): void {
  useBoardPanelStore.setState((state) => ({
    open: true,
    selection: sameBoardPanelSelection(state.selection, selection) ? state.selection : selection,
    choices:
      tab === undefined
        ? state.choices
        : { ...state.choices, [boardPanelHostThreadId(selection)]: tab },
  }));
}

export function chooseBoardTab(selection: BoardPanelSelection, tab: BoardTabChoice): void {
  useBoardPanelStore.setState((state) => ({
    choices: { ...state.choices, [boardPanelHostThreadId(selection)]: tab },
  }));
}

export function closeBoardPanel(): void {
  useBoardPanelStore.setState({ open: false });
}

/** Reopens the last selection; false when there is none to show. */
export function reopenBoardPanel(): boolean {
  if (useBoardPanelStore.getState().selection === null) return false;
  useBoardPanelStore.setState({ open: true });
  return true;
}
