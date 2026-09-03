export const USER_PREFERENCES_STORAGE_KEY = 'kamaz-city-simulator.preferences.v1';

export interface UserPreferences {
  muted: boolean;
  zoom: number;
  isNight: boolean;
  playerName?: string;
  roomId?: string;
  vehicleType?: string;
  vehicleColor?: string;
}

const DEFAULT_PREFERENCES: UserPreferences = { muted: false, zoom: 1, isNight: false };

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
    const savedValue = value as Record<string, unknown>;
    const zoom = typeof savedValue.zoom === 'number' && Number.isFinite(savedValue.zoom)
      ? Math.min(1.5, Math.max(0.6, savedValue.zoom))
      : DEFAULT_PREFERENCES.zoom;
    return {
      muted: typeof muted === 'boolean' ? muted : DEFAULT_PREFERENCES.muted,
      zoom,
      isNight: typeof savedValue.isNight === 'boolean' ? savedValue.isNight : DEFAULT_PREFERENCES.isNight,
      playerName: typeof savedValue.playerName === 'string' ? savedValue.playerName.slice(0, 18) : undefined,
      roomId: typeof savedValue.roomId === 'string' ? savedValue.roomId.slice(0, 40) : undefined,
      vehicleType: typeof savedValue.vehicleType === 'string' ? savedValue.vehicleType.slice(0, 40) : undefined,
      vehicleColor: typeof savedValue.vehicleColor === 'string' ? savedValue.vehicleColor.slice(0, 20) : undefined,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function saveUserPreferences(preferences: UserPreferences) {
  try {
    getStorage()?.setItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Saving a cosmetic preference must never block gameplay.
  }
}
