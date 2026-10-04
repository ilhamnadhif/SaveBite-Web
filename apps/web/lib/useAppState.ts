"use client";

import { useSyncExternalStore } from "react";
import { appState, type AppState } from "./appState";

/**
 * `ListenableBuilder(listenable: appState, ...)`: re-renders the caller on
 * every `notifyListeners()` and returns the shared state to read from.
 */
export function useAppState(): AppState {
  useSyncExternalStore(appState.subscribe, appState.getVersion, appState.getVersion);
  return appState;
}
