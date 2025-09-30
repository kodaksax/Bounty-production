import { useEffect, useState } from 'react';
import type { PortfolioItem } from '../lib/types';
import { portfolioService } from '../lib/services/portfolio-service';

interface UsePortfolioResult {
  items: PortfolioItem[];
  loading: boolean;
  error: string | null;
  addItem: (item: Omit<PortfolioItem, 'id' | 'createdAt'>) => Promise<void>;
  deleteItem: (itemId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function usePortfolio(userId: string): UsePortfolioResult {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await portfolioService.getItems(userId);
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load portfolio');
    } finally {
      setLoading(false);
    }
  };

  const addItem = async (item: Omit<PortfolioItem, 'id' | 'createdAt'>) => {
    try {
      setError(null);
      const newItem = await portfolioService.addItem(item);
      
      // Optimistic update
      setItems(prev => [newItem, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add item');
      await fetchItems(); // Revert
    }
  };

  const deleteItem = async (itemId: string) => {
    const previousItems = [...items];

    try {
      setError(null);
      
      // Optimistic update
      setItems(prev => prev.filter(item => item.id !== itemId));

      const result = await portfolioService.deleteItem(itemId);

      if (!result.success) {
        // Rollback on failure
        setItems(previousItems);
        setError(result.error || 'Failed to delete item');
      }
    } catch (err) {
      // Rollback on error
      setItems(previousItems);
      setError(err instanceof Error ? err.message : 'Failed to delete item');
    }
  };

  const refresh = async () => {
    await fetchItems();
  };

  useEffect(() => {
    fetchItems();
  }, [userId]);

  return {
    items,
    loading,
    error,
    addItem,
    deleteItem,
    refresh,
  };
}
