import type { MaterialIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

type IconName = ComponentProps<typeof MaterialIcons>['name'];

export interface TaskTemplate {
  id: string;
  title: string;
  /** One of lib/constants/bounty-categories.ts's BOUNTY_CATEGORIES ids —
   * keeps template-originated bounties filterable in the feed the same way
   * as hand-picked categories. */
  category: string;
  amount: number;
  icon: IconName;
  /** Example answer to "What exactly, and when?" for this template. Shown as
   * the details field's placeholder only — never written into the draft. */
  detailExample: string;
}

// A curated set of one-tap starting points, chosen to signal the odd-jobs range
// of the marketplace — the errands people don't expect to be able to hand off —
// rather than to cover every BOUNTY_CATEGORIES bucket. Prices are rough market
// anchors, not quotes, and StepPay shows them as an editable, pre-filled amount.
export const TASK_TEMPLATES: TaskTemplate[] = [
  { id: 'hold_merch_line', title: 'Hold my spot in the merch line', category: 'other', amount: 25, icon: 'confirmation-number', detailExample: 'Saturday from 9am at the arena box office, until doors open at noon' },
  { id: 'lecture_notes', title: 'Take lecture notes for me', category: 'writing', amount: 20, icon: 'description', detailExample: 'BIO 101 on Tuesday 10-11:15am, typed notes sent the same day' },
  { id: 'home_haircut', title: 'Cut my hair at my place', category: 'other', amount: 65, icon: 'content-cut', detailExample: 'Short fade and beard trim, Sunday afternoon, I have clippers' },
  { id: 'mount_tv', title: 'Mount my TV', category: 'labor', amount: 35, icon: 'tv', detailExample: '55-inch TV on drywall, mount included, any weekday after 5pm' },
  { id: 'explain_insurance', title: 'Explain my insurance policy', category: 'other', amount: 30, icon: 'shield', detailExample: 'A 30-minute call to walk through my renters policy this week' },
  { id: 'hem_gown', title: 'Hem my gown', category: 'other', amount: 45, icon: 'checkroom', detailExample: 'Take a floor-length gown up about 2 inches, needed by Friday' },
  { id: 'tagalog_grocery_run', title: 'Tagalog language translator', category: 'other', amount: 55, icon: 'translate', detailExample: 'Translate at a 1-hour doctor visit, Monday at 10am' },
  { id: 'walk_dog', title: 'Walk my dog', category: 'other', amount: 20, icon: 'pets', detailExample: 'One 30-minute walk for a friendly lab, Saturday morning' },
  { id: 'clean_closet', title: 'Clean out my closet', category: 'labor', amount: 60, icon: 'cleaning-services', detailExample: 'Sort and bag one walk-in closet, about 2 hours, this weekend' },
  { id: 'help_move_in', title: 'Help me move in', category: 'labor', amount: 90, icon: 'local-shipping', detailExample: 'Carry boxes and a couch up 2 flights, Saturday 10am to 1pm' },
  { id: 'design_artwork', title: 'Design an artwork', category: 'design', amount: 100, icon: 'brush', detailExample: 'A square logo for my bakery, 2 drafts, final files by next Friday' },
  { id: 'assemble_furniture', title: 'Assemble my furniture', category: 'labor', amount: 40, icon: 'handyman', detailExample: 'One IKEA dresser and a bed frame, Sunday after 2pm' },
];

/** The template this title came from, derived so it survives drafts and Back. */
export function findTaskTemplateByTitle(title: string | undefined | null): TaskTemplate | undefined {
  const trimmed = (title || '').trim();
  return TASK_TEMPLATES.find((t) => t.title === trimmed);
}
