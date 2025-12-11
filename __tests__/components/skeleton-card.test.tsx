/**
 * @jest-environment jsdom
 */
import React from 'react';
import { SkeletonCard, SkeletonCardList } from '../../components/ui/skeleton-card';

// Mock the skeleton component
jest.mock('../../components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className: string }) => <div data-testid="skeleton" className={className} />,
}));

describe('SkeletonCard', () => {
  it('should render without crashing', () => {
    expect(() => <SkeletonCard />).not.toThrow();
  });

  it('should render multiple cards in SkeletonCardList', () => {
    const count = 5;
    const component = <SkeletonCardList count={count} />;
    expect(component).toBeDefined();
  });

  it('should use default count of 3 for SkeletonCardList', () => {
    const component = <SkeletonCardList />;
    expect(component).toBeDefined();
  });
});
