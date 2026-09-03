/**
 * Every driver used to spawn as the same hardcoded "Дальнобойщик", which made
 * the online player list and chat unreadable once more than one person
 * joined. Names are now drawn from a pool, and each player's name renders in
 * a color derived from their own id - the same hash on every client, so two
 * viewers agree on what color a given driver is without the server having to
 * broadcast one.
 */

const DRIVER_NAMES = [
  'Дальнобойщик',
  'Степаныч',
  'Батя',
  'Механик',
  'Шумахер',
  'Ветеран Трассы',
  'Морозов',
  'Сибиряк',
  'Профессор',
  'Гонщик',
  'Ковалёв',
  'Дядя Вася',
  'Атаман',
  'Скиф',
  'Гром',
  'Буран',
  'Странник',
  'Капитан',
  'Урал',
  'Партизан',
  'Тайфун',
  'Каскадёр',
  'Рулевой',
  'Магистраль',
  'Волк',
  'Ас',
  'Ямщик',
  'Егерь',
  'Флагман',
  'Барс',
];

// Distinct, readable against both the dark HUD chrome and the green world -
// no near-black or near-white entries, nothing too close to the red used for
// damage/warning indicators elsewhere in the HUD.
const NAME_COLORS = [
  '#38bdf8', // sky
  '#22d3ee', // cyan
  '#34d399', // emerald
  '#a3e635', // lime
  '#fbbf24', // amber
  '#fb923c', // orange
  '#f472b6', // pink
  '#c084fc', // purple
  '#818cf8', // indigo
  '#2dd4bf', // teal
  '#facc15', // yellow
  '#e879f9', // fuchsia
];

export function randomDriverName(): string {
  return DRIVER_NAMES[Math.floor(Math.random() * DRIVER_NAMES.length)];
}

export function nameColorForId(id: string | null | undefined): string {
  if (!id) return NAME_COLORS[0];
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return NAME_COLORS[Math.abs(hash) % NAME_COLORS.length];
}
