/** Where a "Post again" tap came from — post_again_tapped's `source`. */
export const POST_AGAIN_SOURCES = ['bounty_detail', 'my_bounties', 'home_card', 'email'] as const;
export type PostAgainSource = (typeof POST_AGAIN_SOURCES)[number];

export function isPostAgainSource(value: unknown): value is PostAgainSource {
  return typeof value === 'string' && (POST_AGAIN_SOURCES as readonly string[]).includes(value);
}
