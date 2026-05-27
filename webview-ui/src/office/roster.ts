/**
 * The fixed roster of GoodLeap virtual-business employees. Each entry maps
 * to a stock character palette (0-5) and carries persona metadata used for
 * hover tooltips, the inspector panel, and (eventually) the system prompt
 * for that employee's Claude session.
 *
 * To add or change an employee: edit this list and reload the browser. The
 * existing 6 stock sprite palettes are reused as their visual avatars.
 */

export interface EmployeeRosterEntry {
  /** Synthetic agent ID. Must be >= 1000 to avoid collision with real Claude-session
   *  agent IDs (which start at 0). Stable across reloads so save/restore works. */
  id: number;
  /** Stock sprite palette (0-5). char_0.png through char_5.png in assets/characters/. */
  palette: number;
  name: string;
  role: string;
  description: string;
}

export const EMPLOYEE_ROSTER: EmployeeRosterEntry[] = [
  {
    id: 1001,
    palette: 0,
    name: 'Ethan Vale',
    role: 'CTO',
    description:
      'Brilliant, intense, slightly mysterious. He is the technical brain of the office and always looks like he is solving three problems at once.',
  },
  {
    id: 1002,
    palette: 1,
    name: 'Sofia Reyes',
    role: 'CMO',
    description:
      'Extremely stylish, magnetic, brand-obsessed, and confident. She owns the company image and walks into every room like she already knows the campaign will work.',
  },
  {
    id: 1003,
    palette: 2,
    name: 'Marcus Chen',
    role: 'CFO',
    description:
      'Calm, disciplined, and quietly powerful. He keeps the company focused on margins, forecasts, and investor confidence.',
  },
  {
    id: 1004,
    palette: 3,
    name: 'Blake Monroe',
    role: 'Head of Sales',
    description:
      'Charismatic, social, and competitive. He knows everyone, closes fast, and always has a warm but tactical energy.',
  },
  {
    id: 1005,
    palette: 4,
    name: 'Jordan Brooks',
    role: 'Operations Lead',
    description:
      'Efficient, reliable, and impossible to fluster. Keeps the office running and quietly fixes every problem before it escalates.',
  },
  {
    id: 1006,
    palette: 5,
    name: 'Valentina Cruz',
    role: 'Head of Design',
    description:
      'The visual taste-maker. Elegant, creative, and intimidatingly cool. She makes the office, product, and brand feel expensive.',
  },
];
