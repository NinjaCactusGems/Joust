// Team play: exotic, cute animals you can rally behind. Each team has a unique
// color in the app's earthy / aged-paper palette — muted but clearly distinct
// from one another, and from the jousting "out" red (#8A2B22) and burgundy
// accent (#7A2E2E), so a team's color reads at a glance on the roster and the
// winner screen.
//
// Colors are kept as hex strings and applied via inline styles. Dynamic Tailwind
// classes like `bg-team-${id}` would be purged by the v4 JIT scanner, so we
// don't go that route.

export type TeamId =
  | 'axolotl'
  | 'quokka'
  | 'pangolin'
  | 'fennec'
  | 'redpanda'
  | 'sugarglider'
  | 'capybara'
  | 'narwhal';

export type Team = {
  id: TeamId;
  label: string;
  color: string;
};

export const TEAMS: Team[] = [
  { id: 'axolotl', label: 'Axolotl', color: '#C97BA0' }, // soft rose pink
  { id: 'quokka', label: 'Quokka', color: '#B8895A' }, // warm sand
  { id: 'pangolin', label: 'Pangolin', color: '#7E6B4A' }, // bronze clay
  { id: 'fennec', label: 'Fennec Fox', color: '#C9A227' }, // dusty gold
  { id: 'redpanda', label: 'Red Panda', color: '#C56A2E' }, // russet orange
  { id: 'sugarglider', label: 'Sugar Glider', color: '#5C6B8A' }, // slate blue
  { id: 'capybara', label: 'Capybara', color: '#6E4F3A' }, // tawny brown
  { id: 'narwhal', label: 'Narwhal', color: '#3F7A78' }, // deep teal
];

export const TEAM_IDS: TeamId[] = TEAMS.map((t) => t.id);

const TEAM_BY_ID = new Map<TeamId, Team>(TEAMS.map((t) => [t.id, t]));

export function teamById(id: TeamId | null): Team | undefined {
  return id ? TEAM_BY_ID.get(id) : undefined;
}
