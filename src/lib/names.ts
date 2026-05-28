// Friendly player names: a musical adjective + a vegetable, e.g. "Melodic Paprika".

const MUSICAL_ADJECTIVES = [
  'Melodic',
  'Harmonic',
  'Rhythmic',
  'Syncopated',
  'Mellow',
  'Vibrant',
  'Lyrical',
  'Resonant',
  'Upbeat',
  'Sonorous',
  'Jazzy',
  'Funky',
  'Soulful',
  'Bluesy',
  'Operatic',
  'Acoustic',
  'Groovy',
  'Punchy',
];

const VEGETABLES = [
  'Paprika',
  'Aubergine',
  'Radish',
  'Parsnip',
  'Shallot',
  'Fennel',
  'Kohlrabi',
  'Endive',
  'Okra',
  'Artichoke',
  'Courgette',
  'Beetroot',
  'Pumpkin',
  'Leek',
  'Turnip',
  'Chard',
  'Squash',
  'Pak Choi',
];

function pick<T>(list: T[]): T {
  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  return list[bytes[0] % list.length];
}

export function generateRandomName(): string {
  return `${pick(MUSICAL_ADJECTIVES)} ${pick(VEGETABLES)}`;
}
