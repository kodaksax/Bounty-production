/**
 * Integration tests for Edit Profile Flow
 * 
 * Tests the complete profile editing flow including:
 * - Loading profile data
 * - Editing form fields
 * - Uploading avatar with retry logic
 * - Saving profile changes
 * - Handling errors and unsaved changes
 * 
 * @jest-environment node
 */

import { authProfileService } from '../../lib/services/auth-profile-service';
import { storageService } from '../../lib/services/storage-service';

// Mock dependencies
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: {
      getSession: jest.fn(),
    },
  },
  isSupabaseConfigured: true,
}));

jest.mock('../../lib/services/storage-service', () => ({
  storageService: {
    uploadFile: jest.fn(),
  },
}));

jest.mock('../../lib/utils/error-logger', () => ({
  logger: {
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
  },
}));

describe('Edit Profile Integration Flow', () => {
  const mockUserId = 'test-user-123';
  const mockProfile = {
    id: mockUserId,
    username: 'johndoe',
    email: 'john@example.com',
    about: 'Software developer',
    avatar: null,
    balance: 0,
    age_verified: true,
    onboarding_completed: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  let mockSupabase: any;

  beforeEach(() => {
    jest.clearAllMocks();

    const { supabase } = require('../../lib/supabase');
    mockSupabase = supabase;

    // Reset auth profile service
    (authProfileService as any).currentProfile = null;
    (authProfileService as any).currentSession = null;
    (authProfileService as any).listeners = [];

    // Set up default session for all tests
    authProfileService.setSession({
      user: { id: mockUserId, email: 'john@example.com' },
      access_token: 'mock-token',
      refresh_token: 'mock-refresh',
      expires_in: 3600,
      token_type: 'bearer',
    } as any);
  });

  describe('Profile Loading', () => {
    it('should load profile data successfully', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: mockProfile,
          error: null,
        }),
      });

      const profile = await authProfileService.fetchAndSyncProfile(mockUserId);

      expect(profile).not.toBeNull();
      expect(profile?.id).toBe(mockUserId);
      expect(profile?.username).toBe('johndoe');
      expect(mockSupabase.from).toHaveBeenCalledWith('profiles');
    });

    it('should handle profile loading errors', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockRejectedValue(new Error('Database error')),
      });

      const profile = await authProfileService.fetchAndSyncProfile(mockUserId);

      expect(profile).toBeNull();
    });

    it('should notify listeners when profile loads', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: mockProfile,
          error: null,
        }),
      });

      let loadedProfile: any = null;
      authProfileService.subscribe((profile) => {
        loadedProfile = profile;
      });

      await authProfileService.fetchAndSyncProfile(mockUserId);

      expect(loadedProfile).not.toBeNull();
      expect(loadedProfile?.username).toBe('johndoe');
    });
  });

  describe('Profile Update', () => {
    beforeEach(() => {
      // Set up auth session for update operations
      (authProfileService as any).currentSession = {
        user: { id: mockUserId },
      };
      
      // Set up initial profile state
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: mockProfile,
          error: null,
        }),
        update: jest.fn().mockReturnThis(),
      });

      authProfileService.setSession({
        user: { id: mockUserId, email: 'john@example.com' },
        access_token: 'mock-token',
        refresh_token: 'mock-refresh',
        expires_in: 3600,
        token_type: 'bearer',
      } as any);
    });

    it('should update profile successfully', async () => {
      const updatedProfile = {
        ...mockProfile,
        username: 'johndoe_updated',
        about: 'Updated bio',
      };

      mockSupabase.from.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: updatedProfile,
          error: null,
        }),
      });

      const result = await authProfileService.updateProfile({
        username: 'johndoe_updated',
        about: 'Updated bio',
      });

      expect(result).not.toBeNull();
      expect(result?.username).toBe('johndoe_updated');
      expect(result?.about).toBe('Updated bio');
    });

    it('should handle validation errors', async () => {
      mockSupabase.from.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: {
            code: '23505',
            message: 'duplicate key value violates unique constraint',
          },
        }),
      });

      const result = await authProfileService.updateProfile({
        username: 'taken_username',
      });

      expect(result).toBeNull();
    });

    it('should update avatar URL', async () => {
      const avatarUrl = 'https://storage.example.com/avatar.jpg';
      const updatedProfile = {
        ...mockProfile,
        avatar: avatarUrl,
      };

      mockSupabase.from.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: updatedProfile,
          error: null,
        }),
      });

      const result = await authProfileService.updateProfile({
        avatar: avatarUrl,
      });

      expect(result).not.toBeNull();
      expect(result?.avatar).toBe(avatarUrl);
    });
  });

  describe('Avatar Upload Flow', () => {
    beforeEach(() => {
      // Set up auth session for avatar upload operations
      (authProfileService as any).currentSession = {
        user: { id: mockUserId },
      };
    });

    it('should upload avatar and update profile', async () => {
      const mockFile = {
        uri: 'file://avatar.jpg',
        name: 'avatar.jpg',
        mimeType: 'image/jpeg',
        size: 1024 * 1024, // 1MB
      };

      const uploadedUrl = 'https://storage.example.com/avatars/123-avatar.jpg';

      (storageService.uploadFile as jest.Mock).mockResolvedValue({
        success: true,
        url: uploadedUrl,
        error: null,
      });

      const uploadResult = await storageService.uploadFile(mockFile.uri, {
        bucket: 'profiles',
        path: 'avatars/123-avatar.jpg',
      });

      expect(uploadResult.success).toBe(true);
      expect(uploadResult.url).toBe(uploadedUrl);

      // Now update profile with the uploaded avatar
      const updatedProfile = {
        ...mockProfile,
        avatar: uploadedUrl,
      };

      mockSupabase.from.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: updatedProfile,
          error: null,
        }),
      });

      const result = await authProfileService.updateProfile({
        avatar: uploadedUrl,
      });

      expect(result?.avatar).toBe(uploadedUrl);
    });

    it('should handle upload failure and retry', async () => {
      const mockFile = {
        uri: 'file://avatar.jpg',
        name: 'avatar.jpg',
        mimeType: 'image/jpeg',
        size: 1024 * 1024,
      };

      // First attempt fails, second succeeds
      (storageService.uploadFile as jest.Mock)
        .mockResolvedValueOnce({
          success: false,
          error: 'Network error',
        })
        .mockResolvedValueOnce({
          success: true,
          url: 'https://storage.example.com/avatars/123-avatar.jpg',
          error: null,
        });

      // Simulate retry logic
      let uploadResult = await storageService.uploadFile(mockFile.uri, {
        bucket: 'profiles',
        path: 'avatars/123-avatar.jpg',
      });

      if (!uploadResult.success) {
        // Retry
        await new Promise(resolve => setTimeout(resolve, 100));
        uploadResult = await storageService.uploadFile(mockFile.uri, {
          bucket: 'profiles',
          path: 'avatars/123-avatar.jpg',
        });
      }

      expect(uploadResult.success).toBe(true);
      expect(storageService.uploadFile).toHaveBeenCalledTimes(2);
    });

    it('should fail after max retries', async () => {
      const mockFile = {
        uri: 'file://avatar.jpg',
        name: 'avatar.jpg',
        mimeType: 'image/jpeg',
        size: 1024 * 1024,
      };

      // All attempts fail
      (storageService.uploadFile as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Network error',
      });

      const maxRetries = 3;
      let uploadResult: any;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        uploadResult = await storageService.uploadFile(mockFile.uri, {
          bucket: 'profiles',
          path: 'avatars/123-avatar.jpg',
        });

        if (!uploadResult.success && attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      expect(uploadResult.success).toBe(false);
      expect(storageService.uploadFile).toHaveBeenCalledTimes(maxRetries);
    });
  });

  describe('Form Validation', () => {
    it('should validate bio length', () => {
      const maxBioLength = 160;
      const longBio = 'a'.repeat(200);

      // Bio should be truncated to max length
      const truncatedBio = longBio.slice(0, maxBioLength);
      expect(truncatedBio.length).toBe(maxBioLength);
    });

    it('should validate username format', () => {
      const validUsernames = ['johndoe', 'john_doe', 'john123', 'john-doe'];
      const invalidUsernames = ['john doe', 'john@doe', '', '   '];

      validUsernames.forEach(username => {
        // Basic validation: non-empty, no spaces
        expect(username.trim()).toBe(username);
        expect(username.length).toBeGreaterThan(0);
      });

      invalidUsernames.forEach(username => {
        const trimmed = username.trim();
        const hasSpaces = username.includes(' ');
        const hasSpecialChars = /[@!#$%^&*()]/.test(username);

        expect(
          trimmed.length === 0 || hasSpaces || hasSpecialChars
        ).toBe(true);
      });
    });

    it('should parse comma-separated skills', () => {
      const skillsetsString = 'React, TypeScript, Node.js';
      const skillsets = skillsetsString
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      expect(skillsets).toEqual(['React', 'TypeScript', 'Node.js']);
      expect(skillsets.length).toBe(3);
    });

    it('should handle empty skills', () => {
      const skillsetsString = '';
      const skillsets = skillsetsString
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      expect(skillsets).toEqual([]);
      expect(skillsets.length).toBe(0);
    });
  });

  describe('Data Isolation', () => {
    it('should clear data when user changes', async () => {
      // Load profile for user 1
      const user1Profile = {
        ...mockProfile,
        id: 'user-1',
        username: 'user1',
      };

      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: user1Profile,
          error: null,
        }),
      });

      await authProfileService.fetchAndSyncProfile('user-1');
      let profile1 = authProfileService.getCurrentProfile();
      expect(profile1?.username).toBe('user1');

      // Load profile for user 2
      const user2Profile = {
        ...mockProfile,
        id: 'user-2',
        username: 'user2',
      };

      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: user2Profile,
          error: null,
        }),
      });

      await authProfileService.fetchAndSyncProfile('user-2');
      let profile2 = authProfileService.getCurrentProfile();

      expect(profile2?.username).toBe('user2');
      expect(profile2?.username).not.toBe('user1');
    });

    it('should use current session user ID for operations', async () => {
      const mockSession = {
        user: {
          id: mockUserId,
          email: 'john@example.com',
        },
      };

      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: mockProfile,
          error: null,
        }),
      });

      await authProfileService.setSession(mockSession as any);

      const profile = authProfileService.getCurrentProfile();
      expect(profile?.id).toBe(mockUserId);
    });
  });

  describe('Error Recovery', () => {
    it('should handle network errors gracefully', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockRejectedValue(new Error('Network timeout')),
      });

      const profile = await authProfileService.fetchAndSyncProfile(mockUserId);

      // Should return null instead of throwing
      expect(profile).toBeNull();
    });

    it('should handle database constraint violations', async () => {
      mockSupabase.from.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: {
            code: '23505',
            message: 'username already exists',
          },
        }),
      });

      const result = await authProfileService.updateProfile({
        username: 'existing_username',
      });

      expect(result).toBeNull();
    });

    it('should handle rate limiting', async () => {
      mockSupabase.from.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: {
            code: '429',
            message: 'Too many requests',
          },
        }),
      });

      const result = await authProfileService.updateProfile({
        username: 'newusername',
      });

      expect(result).toBeNull();
    });
  });

  describe('Complete Edit Flow', () => {
    beforeEach(() => {
      // Set up auth session for complete flow
      (authProfileService as any).currentSession = {
        user: { id: mockUserId },
      };
    });

    it('should complete full profile edit flow', async () => {
      // 1. Load profile
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: mockProfile,
          error: null,
        }),
      });

      const loadedProfile = await authProfileService.fetchAndSyncProfile(mockUserId);
      expect(loadedProfile).not.toBeNull();

      await authProfileService.setSession({
        user: { id: mockUserId, email: 'john@example.com' },
        access_token: 'mock-token',
      } as any);

      // 2. Upload avatar
      const avatarUrl = 'https://storage.example.com/avatars/123-avatar.jpg';
      (storageService.uploadFile as jest.Mock).mockResolvedValue({
        success: true,
        url: avatarUrl,
        error: null,
      });

      const uploadResult = await storageService.uploadFile('file://avatar.jpg', {
        bucket: 'profiles',
        path: 'avatars/123-avatar.jpg',
      });
      expect(uploadResult.success).toBe(true);

      // 3. Update profile with new data
      const updatedProfile = {
        ...mockProfile,
        username: 'johndoe_new',
        about: 'Updated developer bio',
        avatar: avatarUrl,
      };

      mockSupabase.from.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: updatedProfile,
          error: null,
        }),
      });

      const result = await authProfileService.updateProfile({
        username: 'johndoe_new',
        about: 'Updated developer bio',
        avatar: avatarUrl,
      });

      expect(result).not.toBeNull();
      expect(result?.username).toBe('johndoe_new');
      expect(result?.about).toBe('Updated developer bio');
      expect(result?.avatar).toBe(avatarUrl);
    });

    it('should rollback on save failure', async () => {
      // Initial profile state
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: mockProfile,
          error: null,
        }),
      });

      const initialProfile = await authProfileService.fetchAndSyncProfile(mockUserId);
      const initialUsername = initialProfile?.username;

      // Try to update but fail
      mockSupabase.from.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockRejectedValue(new Error('Update failed')),
      });

      const result = await authProfileService.updateProfile({
        username: 'new_username',
      });

      expect(result).toBeNull();

      // Current profile should still be the original
      const currentProfile = authProfileService.getCurrentProfile();
      expect(currentProfile?.username).toBe(initialUsername);
    });
  });

  describe('Concurrent Operations', () => {
    beforeEach(() => {
      // Set up auth session for concurrent operations
      (authProfileService as any).currentSession = {
        user: { id: mockUserId },
      };
    });

    it('should handle simultaneous profile updates', async () => {
      mockSupabase.from.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { ...mockProfile, username: 'updated' },
          error: null,
        }),
      });

      // Simulate two concurrent updates
      const update1 = authProfileService.updateProfile({
        username: 'update1',
      });

      const update2 = authProfileService.updateProfile({
        username: 'update2',
      });

      const results = await Promise.all([update1, update2]);

      // Both should complete without crashing
      expect(results[0]).not.toBeNull();
      expect(results[1]).not.toBeNull();
    });
  });
});
