/**
 * Feedback Service
 *
 * Centralized service layer for the "Feedback & Support" section of Settings.
 * Handles bug reports and feature requests (persisted to Supabase), and provides
 * helpers for contacting support (mailto fallback) and rating the app (store links).
 */

import { Platform } from 'react-native';
import { supabase } from '../supabase';
import { storageService } from './storage-service';
import { authProfileService } from './auth-profile-service';

export type FeedbackReportStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type FeatureRequestStatus =
  | 'submitted'
  | 'planned'
  | 'in_progress'
  | 'completed'
  | 'declined';

/** Default recipient + subject for the Contact Support flow. */
export const SUPPORT_REQUEST_EMAIL = 'support@bountyapp.com';
export const SUPPORT_REQUEST_SUBJECT = 'Bounty Support Request';

/**
 * Public store listings used by the "Rate Bounty" action.
 * NOTE: `APP_STORE_URL` contains a placeholder App Store ID that must be
 * replaced with the real numeric app ID before production release.
 */
export const APP_STORE_URL = 'https://apps.apple.com/app/id0000000000';
export const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.bountyapp.app';

/** Private storage bucket for optional bug-report screenshots. */
const SCREENSHOT_BUCKET = 'feedback-screenshots';

/** Lifetime of generated screenshot signed URLs (1 hour, in seconds). */
const SCREENSHOT_URL_EXPIRY_SECONDS = 60 * 60;

/** Window during which an identical submission is treated as a duplicate. */
const DUPLICATE_WINDOW_MS = 5000;

export interface SubmitBugReportInput {
  subject: string;
  description: string;
  /** Optional local URI of a screenshot to attach. */
  screenshotUri?: string | null;
}

export interface SubmitFeatureRequestInput {
  title: string;
  description: string;
}

export interface SubmitResult {
  success: boolean;
  id?: string;
  error?: string;
}

/** Tracks recently-completed and in-flight submissions to prevent duplicates. */
const recentSubmissions = new Map<string, number>();
const inFlight = new Set<string>();

/** Reset the duplicate-prevention guards. Exposed for testing. */
export function __resetFeedbackGuards(): void {
  recentSubmissions.clear();
  inFlight.clear();
}

function isDuplicate(key: string): boolean {
  const now = Date.now();
  for (const [submissionKey, lastSubmittedAt] of recentSubmissions.entries()) {
    if (now - lastSubmittedAt >= DUPLICATE_WINDOW_MS) {
      recentSubmissions.delete(submissionKey);
    }
  }

  if (inFlight.has(key)) return true;
  const last = recentSubmissions.get(key);
  return typeof last === 'number' && now - last < DUPLICATE_WINDOW_MS;
}

/** Best-effort retrieval of the installed app version. */
function getAppVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Application = require('expo-application');
    return Application?.nativeApplicationVersion || 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Current device platform (ios/android/web). */
function getPlatform(): string {
  return Platform?.OS || 'unknown';
}

/**
 * Upload an optional screenshot to the private feedback bucket and return a
 * signed URL. Best-effort: returns null on any failure so the report can still
 * be submitted without the attachment.
 */
async function uploadScreenshot(uri: string, userId: string): Promise<string | null> {
  try {
    const path = `${userId}/${Date.now()}-screenshot.jpg`;
    const result = await storageService.uploadFile(uri, {
      bucket: SCREENSHOT_BUCKET,
      path,
    });

    if (!result.success) {
      return null;
    }

    // Bucket is private — prefer a signed URL so admins can view the screenshot.
    try {
      const { data } = await supabase.storage
        .from(SCREENSHOT_BUCKET)
        .createSignedUrl(path, SCREENSHOT_URL_EXPIRY_SECONDS);
      return data?.signedUrl || result.url || null;
    } catch {
      return result.url || null;
    }
  } catch (error) {
    console.error('[FeedbackService] Screenshot upload failed:', error);
    return null;
  }
}

export const feedbackService = {
  /**
   * Submit a bug report. Automatically attaches app version, platform, and user id
   * (if authenticated). Stores the row in `feedback_reports`
   * with a default status of "open".
   */
  async submitBugReport(input: SubmitBugReportInput): Promise<SubmitResult> {
    const subject = (input.subject || '').trim();
    const description = (input.description || '').trim();

    if (!subject) {
      return { success: false, error: 'Subject is required' };
    }
    if (!description) {
      return { success: false, error: 'Description is required' };
    }

    const userId = authProfileService.getAuthUserId();
    if (!userId) {
      return { success: false, error: 'User not authenticated' };
    }

    const dedupeKey = `bug:${userId}:${subject}:${description}`;
    if (isDuplicate(dedupeKey)) {
      return { success: false, error: 'Duplicate submission ignored' };
    }
    inFlight.add(dedupeKey);

    try {
      let screenshotUrl: string | null = null;
      if (input.screenshotUri) {
        screenshotUrl = await uploadScreenshot(input.screenshotUri, userId);
      }

      const { data, error } = await supabase
        .from('feedback_reports')
        .insert({
          user_id: userId,
          subject,
          description,
          screenshot_url: screenshotUrl,
          app_version: getAppVersion(),
          platform: getPlatform(),
          status: 'open',
        })
        .select('id')
        .single();

      if (error) {
        console.error('[FeedbackService] Bug report submission failed:', error);
        return { success: false, error: error.message };
      }

      recentSubmissions.set(dedupeKey, Date.now());
      return { success: true, id: data?.id };
    } catch (error) {
      console.error('[FeedbackService] Bug report submission error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to submit bug report',
      };
    } finally {
      inFlight.delete(dedupeKey);
    }
  },

  /**
   * Submit a feature request. Stores the row in `feature_requests` with a
   * default status of "submitted".
   */
  async submitFeatureRequest(
    input: SubmitFeatureRequestInput
  ): Promise<SubmitResult> {
    const title = (input.title || '').trim();
    const description = (input.description || '').trim();

    if (!title) {
      return { success: false, error: 'Feature title is required' };
    }
    if (!description) {
      return { success: false, error: 'Description is required' };
    }

    const userId = authProfileService.getAuthUserId();
    if (!userId) {
      return { success: false, error: 'User not authenticated' };
    }

    const dedupeKey = `feature:${userId}:${title}:${description}`;
    if (isDuplicate(dedupeKey)) {
      return { success: false, error: 'Duplicate submission ignored' };
    }
    inFlight.add(dedupeKey);

    try {
      const { data, error } = await supabase
        .from('feature_requests')
        .insert({
          user_id: userId,
          title,
          description,
          status: 'submitted',
        })
        .select('id')
        .single();

      if (error) {
        console.error('[FeedbackService] Feature request submission failed:', error);
        return { success: false, error: error.message };
      }

      recentSubmissions.set(dedupeKey, Date.now());
      return { success: true, id: data?.id };
    } catch (error) {
      console.error('[FeedbackService] Feature request submission error:', error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to submit feature request',
      };
    } finally {
      inFlight.delete(dedupeKey);
    }
  },

  /** Build the mailto: URL used to contact support. */
  getSupportMailtoUrl(): string {
    return `mailto:${SUPPORT_REQUEST_EMAIL}?subject=${encodeURIComponent(
      SUPPORT_REQUEST_SUBJECT
    )}`;
  },

  /** The plain support email address (used for the copy-to-clipboard fallback). */
  getSupportEmail(): string {
    return SUPPORT_REQUEST_EMAIL;
  },

  /**
   * Resolve the app-store listing URL for the current platform.
   * Returns null when no store link is available for the platform.
   */
  getStoreUrl(): string | null {
    const os = getPlatform();
    if (os === 'ios') return APP_STORE_URL;
    if (os === 'android') return PLAY_STORE_URL;
    return null;
  },
};
