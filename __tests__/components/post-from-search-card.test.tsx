/**
 * PostFromSearchCard: the accessibility floor it was built to: a 48 dp
 * button, no text below 16 sp, and nothing that stops the text growing
 * with the system font size or cuts it off when it does.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  POST_FROM_SEARCH_BUTTON,
  POST_FROM_SEARCH_HEADING,
  PostFromSearchCard,
} from 'components/search/post-from-search-card';

const TITLE = 'Remove home trash to apt.';

// jest.setup's StyleSheet.flatten is the identity, so merge style arrays here.
function flatten(style: unknown): Record<string, any> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
  return style && typeof style === 'object' ? (style as Record<string, any>) : {};
}

function allTextNodes() {
  return screen.UNSAFE_root.findAll(
    (node) => typeof node.type === 'string' && node.type === 'Text'
  );
}

describe.each(['prominent', 'compact'] as const)('%s card', (variant) => {
  it('shows the heading, the quoted query and the button', () => {
    render(<PostFromSearchCard variant={variant} title={TITLE} onPost={jest.fn()} />);
    expect(screen.getByText(POST_FROM_SEARCH_HEADING)).toBeTruthy();
    expect(screen.getByText(`“${TITLE}”`)).toBeTruthy();
    expect(screen.getByText(POST_FROM_SEARCH_BUTTON)).toBeTruthy();
  });

  it('has a button at least 48 dp tall', () => {
    render(<PostFromSearchCard variant={variant} title={TITLE} onPost={jest.fn()} />);
    const style = flatten(screen.getByTestId('post-from-search-button').props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(48);
    // Fixed heights would clip the label at large font sizes.
    expect(style.height).toBeUndefined();
  });

  it('sets no text below 16 sp, and lets every line grow and wrap', () => {
    render(<PostFromSearchCard variant={variant} title={TITLE} onPost={jest.fn()} />);
    const texts = allTextNodes();
    expect(texts.length).toBeGreaterThanOrEqual(3);
    for (const node of texts) {
      const style = flatten(node.props.style);
      expect(style.fontSize).toBeGreaterThanOrEqual(16);
      // 200% system font must reach the text, uncut.
      expect(node.props.maxFontSizeMultiplier).toBeUndefined();
      expect(node.props.allowFontScaling).not.toBe(false);
      expect(node.props.numberOfLines).toBeUndefined();
    }
  });

  it('presses through, and not while busy', () => {
    const onPost = jest.fn();
    const { rerender } = render(<PostFromSearchCard variant={variant} title={TITLE} onPost={onPost} />);
    fireEvent.press(screen.getByTestId('post-from-search-button'));
    expect(onPost).toHaveBeenCalledTimes(1);

    rerender(<PostFromSearchCard variant={variant} title={TITLE} onPost={onPost} busy />);
    expect(screen.getByTestId('post-from-search-button').props.disabled).toBe(true);
  });
});

it('names the query in the button for screen readers', () => {
  render(<PostFromSearchCard variant="prominent" title={TITLE} onPost={jest.fn()} />);
  expect(screen.getByLabelText(`Post this: ${TITLE}`)).toBeTruthy();
});
