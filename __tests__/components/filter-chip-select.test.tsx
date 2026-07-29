/**
 * Tests for FilterChipSelect — the reusable "chip that opens a sheet of
 * options" that replaced the bounty feed's standalone distance carousel.
 *
 * The contract these lock in is what the feed depends on: the chip labels
 * itself with the active option, the sheet only exists once opened, and
 * choosing an option both reports the new value and closes the sheet.
 */
import { fireEvent, render } from '@testing-library/react-native';
import { FilterChipSelect, type FilterChipOption } from '../../components/ui/filter-chip-select';

// Hoisted above the imports by ts-jest, so the sheet's useSafeAreaInsets()
// resolves without a provider.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

type Distance = 'off' | number | null;

const OPTIONS: FilterChipOption<Distance>[] = [
  { label: 'Any distance', value: 'off', description: 'Browse every open bounty' },
  { label: 'Within 5 miles', value: 5, chipLabel: '5 mi' },
  { label: 'Within 10 miles', value: 10, chipLabel: '10 mi' },
  { label: 'Anywhere', value: null },
];

function renderChip(value: Distance, onChange = jest.fn()) {
  const utils = render(
    <FilterChipSelect<Distance>
      label="Distance"
      value={value}
      neutralValue="off"
      options={OPTIONS}
      onChange={onChange}
      icon="near-me"
    />
  );
  return { ...utils, onChange };
}

describe('FilterChipSelect', () => {
  it('shows the neutral label while the filter is off', () => {
    const { getByText, getByLabelText } = renderChip('off');
    expect(getByText('Distance')).toBeTruthy();
    expect(getByLabelText('Distance filter, off')).toBeTruthy();
  });

  it('labels the chip with the selected option, preferring its short chipLabel', () => {
    const { getByText, queryByText } = renderChip(10);
    expect(getByText('10 mi')).toBeTruthy();
    // The neutral label is replaced, not appended.
    expect(queryByText('Distance')).toBeNull();
  });

  it('falls back to the full label for options without a chipLabel', () => {
    const { getByText } = renderChip(null);
    expect(getByText('Anywhere')).toBeTruthy();
  });

  it('keeps the sheet unmounted until the chip is pressed, then shows every option', () => {
    const { getByLabelText, queryByText, getByText } = renderChip('off');
    expect(queryByText('Within 5 miles')).toBeNull();

    fireEvent.press(getByLabelText('Distance filter, off'));

    expect(getByText('Within 5 miles')).toBeTruthy();
    expect(getByText('Within 10 miles')).toBeTruthy();
    expect(getByText('Browse every open bounty')).toBeTruthy();
  });

  it('reports the new value and closes the sheet when an option is chosen', () => {
    const { getByLabelText, queryByText, onChange } = renderChip('off');
    fireEvent.press(getByLabelText('Distance filter, off'));

    fireEvent.press(getByLabelText('Within 10 miles'));

    expect(onChange).toHaveBeenCalledWith(10);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(queryByText('Within 5 miles')).toBeNull();
  });

  it('closes without re-reporting when the already-selected option is chosen', () => {
    const { getByLabelText, queryByText, onChange } = renderChip(10);
    fireEvent.press(getByLabelText('Distance filter, Within 10 miles selected'));

    fireEvent.press(getByLabelText('Within 10 miles'));

    expect(onChange).not.toHaveBeenCalled();
    expect(queryByText('Within 5 miles')).toBeNull();
  });

  it('marks the active option as checked for screen readers', () => {
    const { getByLabelText } = renderChip(5);
    fireEvent.press(getByLabelText('Distance filter, Within 5 miles selected'));

    expect(getByLabelText('Within 5 miles').props.accessibilityState).toMatchObject({ checked: true });
    expect(getByLabelText('Within 10 miles').props.accessibilityState).toMatchObject({ checked: false });
  });

  it('renders the hint only when one is supplied', () => {
    const { getByLabelText, queryByText, rerender, getByText } = render(
      <FilterChipSelect<Distance>
        label="Distance"
        value="off"
        neutralValue="off"
        options={OPTIONS}
        onChange={jest.fn()}
      />
    );
    fireEvent.press(getByLabelText('Distance filter, off'));
    expect(queryByText('Location access is off.')).toBeNull();

    rerender(
      <FilterChipSelect<Distance>
        label="Distance"
        value="off"
        neutralValue="off"
        options={OPTIONS}
        onChange={jest.fn()}
        hint="Location access is off."
      />
    );
    expect(getByText('Location access is off.')).toBeTruthy();
  });
});
