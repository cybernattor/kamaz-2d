import {
  loadUserPreferences,
  saveUserPreferences,
  USER_PREFERENCES_STORAGE_KEY,
} from '../src/game/userPreferences';

const data = new Map<string, string>();
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    },
  },
});

if (loadUserPreferences().muted) throw new Error('New players must start with audio enabled');
saveUserPreferences({
  muted: true,
  zoom: 1.25,
  isNight: true,
  playerName: 'Водитель',
  roomId: 'урал',
  vehicleType: 'kamaz_flatbed',
  vehicleColor: '#0284c7',
});
const restored = loadUserPreferences();
if (!restored.muted || restored.zoom !== 1.25 || !restored.isNight || restored.playerName !== 'Водитель' || restored.roomId !== 'урал' || restored.vehicleType !== 'kamaz_flatbed') {
  throw new Error('Saved preferences were not restored');
}

data.set(USER_PREFERENCES_STORAGE_KEY, '{bad json');
if (loadUserPreferences().muted) throw new Error('Malformed stored preferences must fall back to safe defaults');

console.log('user-preferences: OK - mute preference survives reload and malformed storage is safe');
