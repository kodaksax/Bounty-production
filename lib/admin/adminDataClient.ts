// lib/admin/adminDataClient.ts - Mock data client for admin operations
import type {
  AdminBounty,
  AdminBountyFilters,
  AdminMetrics,
  AdminTransaction,
  AdminTransactionFilters,
  AdminUserFilters,
  AdminUserSummary,
} from '../types-admin';

// Debug flag to simulate failures for testing error states
const DEBUG_SIMULATE_FAILURES = false;

// Simulate network delay
function simulateNetwork<T>(data: T, delayMs = 500): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (DEBUG_SIMULATE_FAILURES && Math.random() > 0.8) {
        reject(new Error('Simulated network error'));
      } else {
        resolve(data);
      }
    }, delayMs);
  });
}

// In-memory mock data stores
const mockBounties: AdminBounty[] = [
  {
    id: '1',
    user_id: 'user-001',
    title: 'Build React Native Component',
    description: 'Need a custom carousel component for mobile app',
    amount: 250,
    location: 'Remote',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    status: 'open',
    flaggedCount: 0,
  },
  {
    id: '2',
    user_id: 'user-002',
    title: 'Fix Backend API Bug',
    description: 'Authentication endpoint returning 500 errors',
    amount: 150,
    location: 'New York, NY',
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    status: 'in_progress',
    acceptedBy: 'user-003',
    flaggedCount: 0,
  },
  {
    id: '3',
    user_id: 'user-004',
    title: 'Design Mobile Onboarding Flow',
    isForHonor: true,
    description: 'Create wireframes and mockups for new user experience',
    location: 'San Francisco, CA',
    createdAt: new Date(Date.now() - 86400000 * 10).toISOString(),
    status: 'completed',
    acceptedBy: 'user-005',
    flaggedCount: 0,
  },
  {
    id: '4',
    user_id: 'user-001',
    title: 'Help move furniture',
    description: 'Need help moving a couch up three flights of stairs',
    amount: 50,
    location: 'Austin, TX',
    createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
    status: 'archived',
    acceptedBy: 'user-006',
    flaggedCount: 0,
  },
  {
    id: '5',
    user_id: 'user-007',
    title: 'Review my resume',
    isForHonor: true,
    description: 'Looking for feedback on tech resume',
    location: 'Remote',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    status: 'open',
    flaggedCount: 2,
  },
];

const mockUsers: AdminUserSummary[] = [
  {
    id: 'user-001',
    username: '@techguru',
    email: 'tech@example.com',
    avatar: '/placeholder.svg?height=40&width=40',
    joinDate: new Date(Date.now() - 86400000 * 365).toISOString(),
    verificationStatus: 'verified',
    bountiesPosted: 5,
    bountiesAccepted: 12,
    bountiesCompleted: 10,
    totalSpent: 1200,
    totalEarned: 3400,
    balance: 450,
    status: 'active',
  },
  {
    id: 'user-002',
    username: '@designpro',
    email: 'design@example.com',
    joinDate: new Date(Date.now() - 86400000 * 200).toISOString(),
    verificationStatus: 'verified',
    bountiesPosted: 8,
    bountiesAccepted: 15,
    bountiesCompleted: 14,
    totalSpent: 2100,
    totalEarned: 4200,
    balance: 890,
    status: 'active',
  },
  {
    id: 'user-003',
    username: '@newbie',
    email: 'new@example.com',
    joinDate: new Date(Date.now() - 86400000 * 30).toISOString(),
    verificationStatus: 'pending',
    bountiesPosted: 1,
    bountiesAccepted: 2,
    bountiesCompleted: 1,
    totalSpent: 100,
    totalEarned: 150,
    balance: 50,
    status: 'active',
  },
  {
    id: 'user-004',
    username: '@spammer',
    email: 'spam@example.com',
    joinDate: new Date(Date.now() - 86400000 * 60).toISOString(),
    verificationStatus: 'unverified',
    bountiesPosted: 0,
    bountiesAccepted: 0,
    bountiesCompleted: 0,
    totalSpent: 0,
    totalEarned: 0,
    balance: 0,
    status: 'suspended',
  },
];

const mockTransactions: AdminTransaction[] = [
  {
    id: 'tx-001',
    type: 'escrow',
    amount: 250,
    bountyId: '1',
    fromUserId: 'user-001',
    status: 'completed',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    description: 'Escrow for bounty: Build React Native Component',
  },
  {
    id: 'tx-002',
    type: 'escrow',
    amount: 150,
    bountyId: '2',
    fromUserId: 'user-002',
    status: 'completed',
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    description: 'Escrow for bounty: Fix Backend API Bug',
  },
  {
    id: 'tx-003',
    type: 'release',
    amount: 200,
    bountyId: '3',
    fromUserId: 'user-004',
    toUserId: 'user-005',
    status: 'completed',
    createdAt: new Date(Date.now() - 86400000 * 9).toISOString(),
    description: 'Release for bounty completion: Design Mobile Onboarding Flow',
  },
  {
    id: 'tx-004',
    type: 'deposit',
    amount: 500,
    fromUserId: 'user-001',
    status: 'completed',
    createdAt: new Date(Date.now() - 86400000 * 15).toISOString(),
    description: 'Wallet deposit',
  },
];

// Admin data client methods
export const adminDataClient = {
  // Fetch admin dashboard metrics
  async fetchAdminMetrics(): Promise<AdminMetrics> {
    const metrics: AdminMetrics = {
      totalBounties: mockBounties.length,
      openBounties: mockBounties.filter((b) => b.status === 'open').length,
      inProgressBounties: mockBounties.filter((b) => b.status === 'in_progress').length,
      completedBounties: mockBounties.filter((b) => b.status === 'completed').length,
      archivedBounties: mockBounties.filter((b) => b.status === 'archived').length,
      totalUsers: mockUsers.length,
      totalEscrowVolume: mockTransactions
        .filter((t) => t.type === 'escrow' && t.status === 'completed')
        .reduce((sum, t) => sum + t.amount, 0),
      totalTransactions: mockTransactions.length,
    };
    return simulateNetwork(metrics);
  },

  // Fetch bounties with filters
  async fetchAdminBounties(filters?: AdminBountyFilters): Promise<AdminBounty[]> {
    let filtered = [...mockBounties];

    if (filters?.status && filters.status !== 'all') {
      filtered = filtered.filter((b) => b.status === filters.status);
    }

    if (filters?.flaggedOnly) {
      filtered = filtered.filter((b) => (b.flaggedCount || 0) > 0);
    }

    // Sort by createdAt desc
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return simulateNetwork(filtered);
  },

  // Fetch single bounty by ID
  async fetchAdminBountyById(id: string): Promise<AdminBounty | null> {
    const bounty = mockBounties.find((b) => b.id === id);
    return simulateNetwork(bounty || null);
  },

  // Update bounty status
  async updateBountyStatus(id: string, status: AdminBounty['status']): Promise<AdminBounty> {
    const bounty = mockBounties.find((b) => b.id === id);
    if (!bounty) {
      throw new Error('Bounty not found');
    }
    bounty.status = status;
    bounty.lastModified = new Date().toISOString();
    return simulateNetwork({ ...bounty });
  },

  // Fetch users with filters
  async fetchAdminUsers(filters?: AdminUserFilters): Promise<AdminUserSummary[]> {
    let filtered = [...mockUsers];

    if (filters?.status && filters.status !== 'all') {
      filtered = filtered.filter((u) => u.status === filters.status);
    }

    if (filters?.verificationStatus && filters.verificationStatus !== 'all') {
      filtered = filtered.filter((u) => u.verificationStatus === filters.verificationStatus);
    }

    // Sort by joinDate desc
    filtered.sort((a, b) => new Date(b.joinDate).getTime() - new Date(a.joinDate).getTime());

    return simulateNetwork(filtered);
  },

  // Fetch single user by ID
  async fetchAdminUserById(id: string): Promise<AdminUserSummary | null> {
    const user = mockUsers.find((u) => u.id === id);
    return simulateNetwork(user || null);
  },

  // Fetch transactions with filters
  async fetchAdminTransactions(filters?: AdminTransactionFilters): Promise<AdminTransaction[]> {
    let filtered = [...mockTransactions];

    if (filters?.type && filters.type !== 'all') {
      filtered = filtered.filter((t) => t.type === filters.type);
    }

    if (filters?.status && filters.status !== 'all') {
      filtered = filtered.filter((t) => t.status === filters.status);
    }

    // Sort by createdAt desc
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return simulateNetwork(filtered);
  },
};
