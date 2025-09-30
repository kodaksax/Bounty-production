import type { PortfolioItem } from '../types';

// In-memory storage
let portfolioItems: PortfolioItem[] = [];

// Seed data
const seedPortfolioItems: PortfolioItem[] = [
  {
    id: 'p1',
    userId: 'current-user',
    type: 'image',
    url: 'https://via.placeholder.com/400x300/059669/FFFFFF?text=Project+1',
    thumbnail: 'https://via.placeholder.com/150x150/059669/FFFFFF?text=Project+1',
    title: 'E-commerce Platform',
    description: 'Full-stack e-commerce solution built with React and Node.js',
    createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'p2',
    userId: 'current-user',
    type: 'image',
    url: 'https://via.placeholder.com/400x300/047857/FFFFFF?text=Project+2',
    thumbnail: 'https://via.placeholder.com/150x150/047857/FFFFFF?text=Project+2',
    title: 'Mobile App Design',
    description: 'Cross-platform mobile app with React Native',
    createdAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'p3',
    userId: 'current-user',
    type: 'video',
    url: 'https://via.placeholder.com/400x300/065f46/FFFFFF?text=Video+Demo',
    thumbnail: 'https://via.placeholder.com/150x150/065f46/FFFFFF?text=Video+Demo',
    title: 'App Demo Video',
    description: 'Demo of the bounty tracking application',
    createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

// Initialize with seed data
const initializeData = () => {
  if (portfolioItems.length === 0) {
    portfolioItems = [...seedPortfolioItems];
  }
};

export const portfolioService = {
  /**
   * Get portfolio items for a user
   */
  getItems: async (userId: string): Promise<PortfolioItem[]> => {
    initializeData();
    return portfolioItems
      .filter(item => item.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  /**
   * Get a specific portfolio item
   */
  getItem: async (itemId: string): Promise<PortfolioItem | null> => {
    initializeData();
    return portfolioItems.find(item => item.id === itemId) || null;
  },

  /**
   * Add a portfolio item
   */
  addItem: async (item: Omit<PortfolioItem, 'id' | 'createdAt'>): Promise<PortfolioItem> => {
    initializeData();
    
    const newItem: PortfolioItem = {
      ...item,
      id: `p${Date.now()}`,
      createdAt: new Date().toISOString(),
    };

    portfolioItems.push(newItem);
    return newItem;
  },

  /**
   * Update a portfolio item
   */
  updateItem: async (itemId: string, updates: Partial<PortfolioItem>): Promise<PortfolioItem | null> => {
    initializeData();
    
    const item = portfolioItems.find(i => i.id === itemId);
    if (!item) return null;

    Object.assign(item, updates);
    return item;
  },

  /**
   * Delete a portfolio item (optimistic update)
   */
  deleteItem: async (itemId: string): Promise<{ success: boolean; error?: string }> => {
    initializeData();
    
    const index = portfolioItems.findIndex(i => i.id === itemId);
    if (index === -1) {
      return { success: false, error: 'Item not found' };
    }

    const deletedItem = portfolioItems[index];
    portfolioItems.splice(index, 1);

    // Simulate network delay - could fail in real scenario
    return new Promise((resolve) => {
      setTimeout(() => {
        // Simulate 5% failure rate
        if (Math.random() < 0.05) {
          // Rollback
          portfolioItems.push(deletedItem);
          resolve({ success: false, error: 'Network error' });
        } else {
          resolve({ success: true });
        }
      }, 300);
    });
  },
};
