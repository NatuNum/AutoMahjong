import type { GameState } from './types';

export const STORAGE_KEY = 'automahjong_save_v1';
export const SAVE_VERSION = 1;

export function saveGameState(state: GameState): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore quota/storage errors in private browsing
  }
}

export function loadGameState(): GameState | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameState;
    if (!parsed || parsed.version !== SAVE_VERSION || !Array.isArray(parsed.tiles)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearSavedGameState(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}
