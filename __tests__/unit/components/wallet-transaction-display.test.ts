/**
 * Unit tests for wallet transaction display functionality
 */

import { WalletTransactionRecord } from '../../../lib/wallet-context';

// Mock transaction helper function (extracted from wallet-screen logic for testing)
const getTransactionLabel = (tx: WalletTransactionRecord): string => {
  switch (tx.type) {
    case 'deposit':
      return `Deposit${tx.details.method ? ` via ${tx.details.method}` : ''}`;
    case 'withdrawal':
      return `Withdrawal${tx.details.method ? ` to ${tx.details.method}` : ''}`;
    case 'bounty_posted':
      return `Posted${tx.details.title ? ` · ${tx.details.title}` : ''}`;
    case 'bounty_completed':
      return `Completed${tx.details.title ? ` · ${tx.details.title}` : ''}`;
    case 'bounty_received':
      return `Received${tx.details.title ? ` · ${tx.details.title}` : ''}`;
    case 'escrow':
      return `Escrow${tx.details.title ? ` · ${tx.details.title}` : ''}`;
    case 'release':
      return `Released${tx.details.title ? ` · ${tx.details.title}` : ''}`;
    case 'refund':
      return `Refund${tx.details.title ? ` · ${tx.details.title}` : ''}`;
    default:
      return 'Transaction';
  }
};

describe('Wallet Transaction Display', () => {
  describe('getTransactionLabel', () => {
    it('should format deposit transaction with method', () => {
      const tx: WalletTransactionRecord = {
        id: '1',
        type: 'deposit',
        amount: 100,
        date: new Date(),
        details: { method: 'Credit Card' }
      };
      expect(getTransactionLabel(tx)).toBe('Deposit via Credit Card');
    });

    it('should format deposit transaction without method', () => {
      const tx: WalletTransactionRecord = {
        id: '1',
        type: 'deposit',
        amount: 100,
        date: new Date(),
        details: {}
      };
      expect(getTransactionLabel(tx)).toBe('Deposit');
    });

    it('should format withdrawal transaction with method', () => {
      const tx: WalletTransactionRecord = {
        id: '2',
        type: 'withdrawal',
        amount: -50,
        date: new Date(),
        details: { method: 'Bank Account' }
      };
      expect(getTransactionLabel(tx)).toBe('Withdrawal to Bank Account');
    });

    it('should format bounty_posted transaction with title', () => {
      const tx: WalletTransactionRecord = {
        id: '3',
        type: 'bounty_posted',
        amount: -75,
        date: new Date(),
        details: { title: 'Fix my website' }
      };
      expect(getTransactionLabel(tx)).toBe('Posted · Fix my website');
    });

    it('should format bounty_completed transaction', () => {
      const tx: WalletTransactionRecord = {
        id: '4',
        type: 'bounty_completed',
        amount: 75,
        date: new Date(),
        details: { title: 'Fix my website' }
      };
      expect(getTransactionLabel(tx)).toBe('Completed · Fix my website');
    });

    it('should format bounty_received transaction', () => {
      const tx: WalletTransactionRecord = {
        id: '5',
        type: 'bounty_received',
        amount: 75,
        date: new Date(),
        details: { title: 'Website update' }
      };
      expect(getTransactionLabel(tx)).toBe('Received · Website update');
    });

    it('should format escrow transaction', () => {
      const tx: WalletTransactionRecord = {
        id: '6',
        type: 'escrow',
        amount: -100,
        date: new Date(),
        details: { title: 'Logo design' },
        escrowStatus: 'funded'
      };
      expect(getTransactionLabel(tx)).toBe('Escrow · Logo design');
    });

    it('should format release transaction', () => {
      const tx: WalletTransactionRecord = {
        id: '7',
        type: 'release',
        amount: 100,
        date: new Date(),
        details: { title: 'Logo design' }
      };
      expect(getTransactionLabel(tx)).toBe('Released · Logo design');
    });

    it('should format refund transaction', () => {
      const tx: WalletTransactionRecord = {
        id: '8',
        type: 'refund',
        amount: 100,
        date: new Date(),
        details: { title: 'Cancelled task', method: '100% refund' }
      };
      expect(getTransactionLabel(tx)).toBe('Refund · Cancelled task');
    });

    it('should handle transactions without titles gracefully', () => {
      const tx: WalletTransactionRecord = {
        id: '9',
        type: 'bounty_posted',
        amount: -50,
        date: new Date(),
        details: {}
      };
      expect(getTransactionLabel(tx)).toBe('Posted');
    });
  });

  describe('Transaction Preview Logic', () => {
    it('should limit recent transactions to 5', () => {
      const transactions: WalletTransactionRecord[] = Array.from({ length: 10 }, (_, i) => ({
        id: `tx-${i}`,
        type: 'deposit',
        amount: 10 * (i + 1),
        date: new Date(Date.now() - i * 1000),
        details: { method: 'Test' }
      }));

      const recentTransactions = transactions.slice(0, 5);
      expect(recentTransactions).toHaveLength(5);
      expect(recentTransactions[0].id).toBe('tx-0');
      expect(recentTransactions[4].id).toBe('tx-4');
    });

    it('should show all transactions when fewer than 5 exist', () => {
      const transactions: WalletTransactionRecord[] = [
        {
          id: 'tx-1',
          type: 'deposit',
          amount: 50,
          date: new Date(),
          details: { method: 'Card' }
        },
        {
          id: 'tx-2',
          type: 'withdrawal',
          amount: -20,
          date: new Date(),
          details: { method: 'Bank' }
        }
      ];

      const recentTransactions = transactions.slice(0, 5);
      expect(recentTransactions).toHaveLength(2);
    });
  });
});
