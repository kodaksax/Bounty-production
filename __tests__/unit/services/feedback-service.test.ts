/**
 * Unit tests for Feedback Service
 * Covers bug-report and feature-request submission, validation, duplicate
 * prevention, authentication/RLS expectations, and support-contact helpers.
 */

// Mock supabase before importing the service
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    storage: {
      from: jest.fn(),
    },
  },
}));

// Mock storage service (screenshot upload)
jest.mock('../../../lib/services/storage-service', () => ({
  storageService: {
    uploadFile: jest.fn(),
  },
}));

// Mock data-utils
jest.mock('../../../lib/utils/data-utils', () => ({
  getCurrentUserId: jest.fn(),
}));

import {
  feedbackService,
  __resetFeedbackGuards,
  SUPPORT_REQUEST_EMAIL,
  SUPPORT_REQUEST_SUBJECT,
  APP_STORE_URL,
  PLAY_STORE_URL,
} from '../../../lib/services/feedback-service';

const { supabase } = require('../../../lib/supabase');
const { storageService } = require('../../../lib/services/storage-service');
const { getCurrentUserId } = require('../../../lib/utils/data-utils');
const { Platform } = require('react-native');

/** Build a Supabase query chain for `.insert(...).select(...).single()`. */
const createInsertChain = (finalResult: any) => {
  const chain: any = {};
  chain.insert = jest.fn().mockReturnValue(chain);
  chain.select = jest.fn().mockReturnValue(chain);
  chain.single = jest.fn().mockResolvedValue(finalResult);
  return chain;
};

describe('Feedback Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetFeedbackGuards();
    getCurrentUserId.mockReturnValue('user-123');
    Platform.OS = 'ios';
  });

  describe('submitBugReport', () => {
    it('successfully submits a bug report with diagnostic context and default status', async () => {
      const chain = createInsertChain({ data: { id: 'report-1' }, error: null });
      supabase.from.mockReturnValue(chain);

      const result = await feedbackService.submitBugReport({
        subject: 'App crashes',
        description: 'It crashes on launch',
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe('report-1');
      expect(supabase.from).toHaveBeenCalledWith('feedback_reports');
      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-123',
          subject: 'App crashes',
          description: 'It crashes on launch',
          status: 'open',
          platform: 'ios',
          app_version: '1.0.0',
        })
      );
      // Auto-included timestamp
      expect(chain.insert.mock.calls[0][0]).toHaveProperty('created_at');
    });

    it('uploads a screenshot and stores a signed URL when provided', async () => {
      const chain = createInsertChain({ data: { id: 'report-2' }, error: null });
      supabase.from.mockReturnValue(chain);
      storageService.uploadFile.mockResolvedValue({ success: true, url: 'https://public/x.jpg' });
      const signedChain = {
        createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed/x.jpg' } }),
      };
      supabase.storage.from.mockReturnValue(signedChain);

      const result = await feedbackService.submitBugReport({
        subject: 'Bug',
        description: 'Details',
        screenshotUri: 'file:///tmp/shot.jpg',
      });

      expect(result.success).toBe(true);
      expect(storageService.uploadFile).toHaveBeenCalled();
      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ screenshot_url: 'https://signed/x.jpg' })
      );
    });

    it('still submits when the screenshot upload fails', async () => {
      const chain = createInsertChain({ data: { id: 'report-3' }, error: null });
      supabase.from.mockReturnValue(chain);
      storageService.uploadFile.mockResolvedValue({ success: false, error: 'upload failed' });

      const result = await feedbackService.submitBugReport({
        subject: 'Bug',
        description: 'Details',
        screenshotUri: 'file:///tmp/shot.jpg',
      });

      expect(result.success).toBe(true);
      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ screenshot_url: null })
      );
    });

    it('returns an error when the database insert fails', async () => {
      const chain = createInsertChain({ data: null, error: { message: 'DB error' } });
      supabase.from.mockReturnValue(chain);

      const result = await feedbackService.submitBugReport({
        subject: 'Bug',
        description: 'Details',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('DB error');
    });

    it('validates that subject is required', async () => {
      const result = await feedbackService.submitBugReport({ subject: '   ', description: 'x' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Subject is required');
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('validates that description is required', async () => {
      const result = await feedbackService.submitBugReport({ subject: 'x', description: '' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Description is required');
    });

    it('requires authentication (RLS: user must own the submission)', async () => {
      getCurrentUserId.mockReturnValue(null);
      const result = await feedbackService.submitBugReport({ subject: 'x', description: 'y' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('User not authenticated');
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('prevents duplicate submissions within the dedupe window', async () => {
      const chain = createInsertChain({ data: { id: 'report-4' }, error: null });
      supabase.from.mockReturnValue(chain);

      const first = await feedbackService.submitBugReport({ subject: 'Dup', description: 'Same' });
      const second = await feedbackService.submitBugReport({ subject: 'Dup', description: 'Same' });

      expect(first.success).toBe(true);
      expect(second.success).toBe(false);
      expect(second.error).toBe('Duplicate submission ignored');
      // Only the first submission hit the database.
      expect(chain.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe('submitFeatureRequest', () => {
    it('successfully submits a feature request with default status', async () => {
      const chain = createInsertChain({ data: { id: 'feat-1' }, error: null });
      supabase.from.mockReturnValue(chain);

      const result = await feedbackService.submitFeatureRequest({
        title: 'Dark mode',
        description: 'Please add dark mode',
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe('feat-1');
      expect(supabase.from).toHaveBeenCalledWith('feature_requests');
      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-123',
          title: 'Dark mode',
          description: 'Please add dark mode',
          status: 'submitted',
        })
      );
    });

    it('validates that the feature title is required', async () => {
      const result = await feedbackService.submitFeatureRequest({ title: '', description: 'x' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Feature title is required');
    });

    it('requires authentication', async () => {
      getCurrentUserId.mockReturnValue(null);
      const result = await feedbackService.submitFeatureRequest({
        title: 'x',
        description: 'y',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('User not authenticated');
    });

    it('returns an error when the database insert fails', async () => {
      const chain = createInsertChain({ data: null, error: { message: 'insert failed' } });
      supabase.from.mockReturnValue(chain);

      const result = await feedbackService.submitFeatureRequest({
        title: 'Feature',
        description: 'Details',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('insert failed');
    });
  });

  describe('support contact helpers', () => {
    it('builds a mailto URL with the correct recipient and subject (fallback behavior)', () => {
      const url = feedbackService.getSupportMailtoUrl();
      expect(url).toContain(`mailto:${SUPPORT_REQUEST_EMAIL}`);
      expect(url).toContain(encodeURIComponent(SUPPORT_REQUEST_SUBJECT));
    });

    it('exposes the plain support email for the copy-to-clipboard fallback', () => {
      expect(feedbackService.getSupportEmail()).toBe(SUPPORT_REQUEST_EMAIL);
    });
  });

  describe('getStoreUrl', () => {
    it('returns the App Store URL on iOS', () => {
      Platform.OS = 'ios';
      expect(feedbackService.getStoreUrl()).toBe(APP_STORE_URL);
    });

    it('returns the Play Store URL on Android', () => {
      Platform.OS = 'android';
      expect(feedbackService.getStoreUrl()).toBe(PLAY_STORE_URL);
    });

    it('returns null when no store link is available for the platform', () => {
      Platform.OS = 'web';
      expect(feedbackService.getStoreUrl()).toBeNull();
    });
  });
});
