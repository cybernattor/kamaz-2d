export const USER_PREFERENCES_STORAGE_KEY = 'kamaz-city-simulator.preferences.v1';

export interface UserPreferences {
  muted: boolean;
}

const DEFAULT_PREFERENCES: UserPreferences = { muted: false };

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Private browsing and restrictive browser settings can deny storage.
    // The game remains fully usable with in-memory defaults in that case.
    return null;
  }
}

export function loadUserPreferences(): UserPreferences {
  try {
    const saved = getStorage()?.getItem(USER_PREFERENCES_STORAGE_KEY);
    if (!saved) return DEFAULT_PREFERENCES;
    const value: unknown = JSON.parse(saved);
    if (typeof value !== 'object' || value === null) return DEFAULT_PREFERENCES;
    const muted = (value as { muted?: unknown }).muted;
    return { muted: typeof muted === 'boolean' ? muted : DEFAULT_PREFERENCES.muted };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function saveUserPreferences(preferences: UserPreferences) {
  try {
    getStorage()?.setItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify({ muted: preferences.muted }));
  } catch {
    // Saving a cosmetic preference must never block gameplay.
  }
}
