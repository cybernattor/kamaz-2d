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
saveUserPreferences({ muted: true });
if (data.get(USER_PREFERENCES_STORAGE_KEY) !== '{"muted":true}') {
  throw new Error('Mute setting was not written to local storage');
}
if (!loadUserPreferences().muted) throw new Error('Saved mute setting was not restored');

data.set(USER_PREFERENCES_STORAGE_KEY, '{bad json');
if (loadUserPreferences().muted) throw new Error('Malformed stored preferences must fall back to safe defaults');

console.log('user-preferences: OK - mute preference survives reload and malformed storage is safe');
