/**
 * Unit tests for ReceiptService
 * Tests receipt generation and sharing functionality without real external calls
 */

import { ReceiptService } from '../../../lib/services/receipt-service';
import type { WalletTransactionRecord } from '../../../lib/wallet-context';

// Mock expo-sharing before importing
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

// Mock react-native Share
const mockReactNativeShare = {
  share: jest.fn().mockResolvedValue({ action: 'sharedAction' }),
};
jest.mock('react-native', () => ({
  Share: mockReactNativeShare,
}));

import * as Sharing from 'expo-sharing';

describe('ReceiptService', () => {
  let receiptService: ReceiptService;

  beforeEach(() => {
    receiptService = new ReceiptService();
    jest.clearAllMocks();
  });

  describe('generateReceiptText', () => {
    it('should generate a text receipt with all required fields', () => {
      const transaction: WalletTransactionRecord = {
        id: 'tx-123',
        type: 'deposit',
        amount: 100.50,
        date: new Date('2024-01-15T10:30:00Z'),
        details: {
          title: 'Test Deposit',
          method: 'Credit Card',
          status: 'completed',
        },
      };

      const receipt = receiptService.generateReceiptText(transaction);

      expect(receipt).toContain('BOUNTY RECEIPT');
      expect(receipt).toContain('Transaction Type: Deposit');
      expect(receipt).toContain('+$100.50');
      expect(receipt).toContain('Transaction ID: tx-123');
      expect(receipt).toContain('Description: Test Deposit');
      expect(receipt).toContain('Method: Credit Card');
      expect(receipt).toContain('Status: completed');
    });

    it('should handle negative amounts correctly', () => {
      const transaction: WalletTransactionRecord = {
        id: 'tx-456',
        type: 'withdrawal',
        amount: -50.25,
        date: new Date('2024-01-16T14:00:00Z'),
        details: {},
      };

      const receipt = receiptService.generateReceiptText(transaction);

      expect(receipt).toContain('-$50.25');
      expect(receipt).toContain('Transaction Type: Withdrawal');
    });

    it('should handle optional fields gracefully', () => {
      const transaction: WalletTransactionRecord = {
        id: 'tx-789',
        type: 'bounty_posted',
        amount: -200,
        date: new Date('2024-01-17T09:00:00Z'),
        details: {},
      };

      const receipt = receiptService.generateReceiptText(transaction);

      expect(receipt).toContain('BOUNTY RECEIPT');
      expect(receipt).toContain('-$200.00');
      expect(receipt).not.toContain('Description:');
      expect(receipt).not.toContain('Method:');
    });

    it('should include escrow status when present', () => {
      const transaction: WalletTransactionRecord = {
        id: 'tx-escrow-1',
        type: 'escrow',
        amount: -150,
        date: new Date('2024-01-18T12:00:00Z'),
        details: {
          title: 'Fix Bug #123',
        },
        escrowStatus: 'funded',
      };

      const receipt = receiptService.generateReceiptText(transaction);

      expect(receipt).toContain('Escrow Status: funded');
    });

    it('should include dispute status when not "none"', () => {
      const transaction: WalletTransactionRecord = {
        id: 'tx-dispute-1',
        type: 'release',
        amount: 150,
        date: new Date('2024-01-19T15:00:00Z'),
        details: {},
        disputeStatus: 'pending',
      };

      const receipt = receiptService.generateReceiptText(transaction);

      expect(receipt).toContain('Dispute Status: pending');
    });

    it('should not include dispute status when "none"', () => {
      const transaction: WalletTransactionRecord = {
        id: 'tx-no-dispute',
        type: 'release',
        amount: 150,
        date: new Date('2024-01-19T15:00:00Z'),
        details: {},
        disputeStatus: 'none',
      };

      const receipt = receiptService.generateReceiptText(transaction);

      expect(receipt).not.toContain('Dispute Status:');
    });

    it('should include counterparty when present', () => {
      const transaction: WalletTransactionRecord = {
        id: 'tx-counterparty',
        type: 'bounty_received',
        amount: 250,
        date: new Date('2024-01-20T10:00:00Z'),
        details: {
          counterparty: 'john.doe@example.com',
        },
      };

      const receipt = receiptService.generateReceiptText(transaction);

      expect(receipt).toContain('Counterparty: john.doe@example.com');
    });
  });

  describe('getTypeLabel', () => {
    it('should return correct labels for all transaction types', () => {
      const testCases: Array<[WalletTransactionRecord['type'], string]> = [
        ['deposit', 'Deposit'],
        ['withdrawal', 'Withdrawal'],
        ['bounty_posted', 'Bounty Posted'],
        ['bounty_completed', 'Bounty Completed'],
        ['bounty_received', 'Bounty Payment Received'],
        ['escrow', 'Escrow Hold'],
        ['release', 'Escrow Released'],
        ['refund', 'Refund'],
      ];

      testCases.forEach(([type, expectedLabel]) => {
        const transaction: WalletTransactionRecord = {
          id: `tx-${type}`,
          type,
          amount: 100,
          date: new Date(),
          details: {},
        };

        const receipt = receiptService.generateReceiptText(transaction);
        expect(receipt).toContain(`Transaction Type: ${expectedLabel}`);
      });
    });

    it('should handle unknown transaction types gracefully', () => {
      const transaction = {
        id: 'tx-unknown',
        type: 'unknown_type' as any,
        amount: 100,
        date: new Date(),
        details: {},
      };

      const receipt = receiptService.generateReceiptText(transaction);
      expect(receipt).toContain('Transaction Type: Transaction');
    });
  });

  describe('generateReceiptHTML', () => {
    it('should generate valid HTML receipt', () => {
      const transaction: WalletTransactionRecord = {
        id: 'tx-html-1',
        type: 'deposit',
        amount: 100.50,
        date: new Date('2024-01-15T10:30:00Z'),
        details: {
          title: 'Test Deposit',
        },
      };

      const html = receiptService.generateReceiptHTML(transaction);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<title>BOUNTY Receipt</title>');
      expect(html).toContain('BOUNTY');
      expect(html).toContain('+$100.50');
      expect(html).toContain('Transaction Type');
      expect(html).toContain('Deposit');
      expect(html).toContain('tx-html-1');
    });

    it('should use green color for positive amounts', () => {
      const transaction: WalletTransactionRecord = {
        id: 'tx-positive',
        type: 'deposit',
        amount: 100,
        date: new Date(),
        details: {},
      };

      const html = receiptService.generateReceiptHTML(transaction);
      expect(html).toContain('#10b981'); // Green color
    });

    it('should use red color for negative amounts', () => {
      const transaction: WalletTransactionRecord = {
        id: 'tx-negative',
        type: 'withdrawal',
        amount: -100,
        date: new Date(),
        details: {},
      };

      const html = receiptService.generateReceiptHTML(transaction);
      expect(html).toContain('#ef4444'); // Red color
    });

    it('should include optional fields in HTML when present', () => {
      const transaction: WalletTransactionRecord = {
        id: 'tx-html-full',
        type: 'bounty_completed',
        amount: 500,
        date: new Date(),
        details: {
          title: 'Website Design',
          method: 'Stripe',
          status: 'completed',
        },
        escrowStatus: 'released',
      };

      const html = receiptService.generateReceiptHTML(transaction);
      expect(html).toContain('Website Design');
      expect(html).toContain('Stripe');
      expect(html).toContain('completed');
      expect(html).toContain('released');
    });
  });

  describe('shareReceipt', () => {
    it('should successfully share receipt when sharing is available', async () => {
      const transaction: WalletTransactionRecord = {
        id: 'tx-share-1',
        type: 'deposit',
        amount: 100,
        date: new Date(),
        details: { title: 'Test' },
      };

      const result = await receiptService.shareReceipt(transaction);

      expect(result).toBe(true);
      expect(Sharing.isAvailableAsync).toHaveBeenCalled();
      expect(mockReactNativeShare.share).toHaveBeenCalledWith({
        message: expect.stringContaining('BOUNTY RECEIPT'),
        title: 'Transaction Receipt',
      });
    });

    it('should return false when sharing is not available', async () => {
      (Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);

      const transaction: WalletTransactionRecord = {
        id: 'tx-share-2',
        type: 'deposit',
        amount: 100,
        date: new Date(),
        details: {},
      };

      const result = await receiptService.shareReceipt(transaction);

      expect(result).toBe(false);
      expect(Sharing.isAvailableAsync).toHaveBeenCalled();
      expect(mockReactNativeShare.share).not.toHaveBeenCalled();
    });

    it('should handle sharing errors gracefully', async () => {
      mockReactNativeShare.share.mockRejectedValueOnce(new Error('Share failed'));

      const transaction: WalletTransactionRecord = {
        id: 'tx-share-error',
        type: 'deposit',
        amount: 100,
        date: new Date(),
        details: {},
      };

      const result = await receiptService.shareReceipt(transaction);

      expect(result).toBe(false);
    });

    it('should handle Sharing.isAvailableAsync errors', async () => {
      (Sharing.isAvailableAsync as jest.Mock).mockRejectedValueOnce(
        new Error('Check failed')
      );

      const transaction: WalletTransactionRecord = {
        id: 'tx-share-check-error',
        type: 'deposit',
        amount: 100,
        date: new Date(),
        details: {},
      };

      const result = await receiptService.shareReceipt(transaction);

      expect(result).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle zero amount', () => {
      const transaction: WalletTransactionRecord = {
        id: 'tx-zero',
        type: 'deposit',
        amount: 0,
        date: new Date(),
        details: {},
      };

      const receipt = receiptService.generateReceiptText(transaction);
      expect(receipt).toContain('+$0.00');
    });

    it('should handle very large amounts', () => {
      const transaction: WalletTransactionRecord = {
        id: 'tx-large',
        type: 'deposit',
        amount: 999999.99,
        date: new Date(),
        details: {},
      };

      const receipt = receiptService.generateReceiptText(transaction);
      expect(receipt).toContain('+$999999.99');
    });

    it('should format dates consistently', () => {
      const testDate = new Date('2024-06-15T14:30:00Z');
      const transaction: WalletTransactionRecord = {
        id: 'tx-date',
        type: 'deposit',
        amount: 100,
        date: testDate,
        details: {},
      };

      const receipt = receiptService.generateReceiptText(transaction);
      
      // Check that date and time are present in some format
      expect(receipt).toContain('Date:');
      expect(receipt).toContain('Time:');
    });

    it('should handle special characters in transaction details', () => {
      const transaction: WalletTransactionRecord = {
        id: 'tx-special',
        type: 'bounty_posted',
        amount: 100,
        date: new Date(),
        details: {
          title: 'Fix "bug" with <script> tags & symbols',
          counterparty: 'user@example.com',
        },
      };

      const receipt = receiptService.generateReceiptText(transaction);
      expect(receipt).toContain('Fix "bug" with <script> tags & symbols');
    });
  });
});
