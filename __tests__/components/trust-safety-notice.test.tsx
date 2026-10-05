import React from 'react';
import { render } from '@testing-library/react-native';
import { TrustSafetyNotice } from '../../components/ui/trust-safety-notice';
import { trustSafetyStrings } from '../../lib/strings/trust-safety';

jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));

it('keeps the full warning readable without line or font-scaling restrictions', () => {
  const { getByText } = render(<TrustSafetyNotice message={trustSafetyStrings.beforeAcceptance} urgent />);
  const text = getByText(trustSafetyStrings.beforeAcceptance);
  expect(text.props.accessibilityRole).toBe('text');
  expect(text.props.numberOfLines).toBeUndefined();
  expect(text.props.allowFontScaling).not.toBe(false);
  expect(text.props.style).toEqual(expect.arrayContaining([
    expect.objectContaining({ fontSize: 14, lineHeight: 21, flex: 1 }),
  ]));
});
