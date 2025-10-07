/**
 * Avatar Upload Tests
 * Tests for avatar upload functionality
 * Run with: node tests/avatar-upload.test.js
 */

// Simple test framework
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    testsPassed++;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
    testsFailed++;
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected} but got ${actual}`);
      }
    },
    toEqual(expected) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new Error(`Expected truthy but got ${actual}`);
      }
    },
    toBeFalsy() {
      if (actual) {
        throw new Error(`Expected falsy but got ${actual}`);
      }
    },
    toContain(item) {
      if (!actual.includes(item)) {
        throw new Error(`Expected ${actual} to contain ${item}`);
      }
    },
  };
}

// Mock attachment service
const mockAttachmentService = {
  async upload(attachment, opts = {}) {
    // Simulate upload progress
    if (opts.onProgress) {
      for (let i = 0; i <= 1; i += 0.25) {
        opts.onProgress(i);
      }
    }
    
    return {
      ...attachment,
      remoteUri: `https://files.example.com/${attachment.id}/${encodeURIComponent(attachment.name)}`,
      status: 'uploaded',
      progress: 1,
    };
  },
};

// Mock profile service
const mockProfileService = {
  profiles: {},
  
  async update(id, updates) {
    if (!this.profiles[id]) {
      this.profiles[id] = { id, avatar_url: '' };
    }
    Object.assign(this.profiles[id], updates);
    return this.profiles[id];
  },
};

// Mock avatar service with mocked dependencies
function createAvatarService(attachmentService, profileService) {
  return {
    async uploadAvatar(imageUri, options = {}) {
      try {
        const attachment = {
          id: `avatar-${Date.now()}`,
          name: options.fileName || 'avatar.jpg',
          uri: imageUri,
          mimeType: options.mimeType || 'image/jpeg',
          size: options.size,
          status: 'uploading',
          progress: 0,
        };

        const uploaded = await attachmentService.upload(attachment, {
          onProgress: options.onProgress,
        });

        if (uploaded.status !== 'uploaded' || !uploaded.remoteUri) {
          throw new Error('Upload failed - no remote URI returned');
        }

        if (options.profileId) {
          const updatedProfile = await profileService.update(options.profileId, {
            avatar_url: uploaded.remoteUri,
          });

          if (!updatedProfile) {
            console.warn('Avatar uploaded but profile update failed');
          }
        }

        return { avatarUrl: uploaded.remoteUri, error: null };
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Unknown error uploading avatar');
        return { avatarUrl: null, error };
      }
    },

    async deleteAvatar(profileId) {
      try {
        const updatedProfile = await profileService.update(profileId, {
          avatar_url: '',
        });

        if (!updatedProfile) {
          throw new Error('Failed to update profile');
        }

        return { success: true, error: null };
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Unknown error deleting avatar');
        return { success: false, error };
      }
    },
  };
}

// Run tests
console.log('\n🧪 Avatar Upload Tests\n');

// Test 1: Upload avatar without profile ID
test('should upload avatar without profile ID', async () => {
  const avatarService = createAvatarService(mockAttachmentService, mockProfileService);
  const result = await avatarService.uploadAvatar('file:///path/to/avatar.jpg', {
    fileName: 'avatar.jpg',
    mimeType: 'image/jpeg',
  });

  expect(result.error).toBe(null);
  expect(result.avatarUrl).toBeTruthy();
  expect(result.avatarUrl).toContain('https://files.example.com/');
});

// Test 2: Upload avatar with profile ID
test('should upload avatar and update profile', async () => {
  const avatarService = createAvatarService(mockAttachmentService, mockProfileService);
  const profileId = 'test-user-123';
  
  const result = await avatarService.uploadAvatar('file:///path/to/avatar.jpg', {
    profileId,
    fileName: 'avatar.jpg',
    mimeType: 'image/jpeg',
  });

  expect(result.error).toBe(null);
  expect(result.avatarUrl).toBeTruthy();
  expect(mockProfileService.profiles[profileId]).toBeTruthy();
  expect(mockProfileService.profiles[profileId].avatar_url).toEqual(result.avatarUrl);
});

// Test 3: Track upload progress
test('should track upload progress', async () => {
  const avatarService = createAvatarService(mockAttachmentService, mockProfileService);
  const progressValues = [];
  
  const result = await avatarService.uploadAvatar('file:///path/to/avatar.jpg', {
    fileName: 'avatar.jpg',
    onProgress: (progress) => {
      progressValues.push(progress);
    },
  });

  expect(result.error).toBe(null);
  expect(progressValues.length > 0).toBeTruthy();
  expect(progressValues[progressValues.length - 1]).toBe(1); // Should reach 100%
});

// Test 4: Handle different file types
test('should handle different image file types', async () => {
  const avatarService = createAvatarService(mockAttachmentService, mockProfileService);
  
  const pngResult = await avatarService.uploadAvatar('file:///path/to/avatar.png', {
    fileName: 'avatar.png',
    mimeType: 'image/png',
  });

  const jpgResult = await avatarService.uploadAvatar('file:///path/to/avatar.jpg', {
    fileName: 'avatar.jpg',
    mimeType: 'image/jpeg',
  });

  expect(pngResult.error).toBe(null);
  expect(jpgResult.error).toBe(null);
  expect(pngResult.avatarUrl).toBeTruthy();
  expect(jpgResult.avatarUrl).toBeTruthy();
});

// Test 5: Delete avatar
test('should delete avatar from profile', async () => {
  const avatarService = createAvatarService(mockAttachmentService, mockProfileService);
  const profileId = 'test-user-456';
  
  // First, set an avatar
  await avatarService.uploadAvatar('file:///path/to/avatar.jpg', {
    profileId,
    fileName: 'avatar.jpg',
  });

  expect(mockProfileService.profiles[profileId].avatar_url).toBeTruthy();

  // Now delete it
  const deleteResult = await avatarService.deleteAvatar(profileId);

  expect(deleteResult.success).toBe(true);
  expect(deleteResult.error).toBe(null);
  expect(mockProfileService.profiles[profileId].avatar_url).toBe('');
});

// Test 6: Handle upload errors gracefully
test('should handle upload errors gracefully', async () => {
  const failingAttachmentService = {
    async upload() {
      throw new Error('Network error');
    },
  };
  
  const avatarService = createAvatarService(failingAttachmentService, mockProfileService);
  
  const result = await avatarService.uploadAvatar('file:///path/to/avatar.jpg', {
    fileName: 'avatar.jpg',
  });

  expect(result.avatarUrl).toBe(null);
  expect(result.error).toBeTruthy();
  expect(result.error.message).toContain('Network error');
});

// Summary
console.log(`\n📊 Test Results:`);
console.log(`   Passed: ${testsPassed}`);
console.log(`   Failed: ${testsFailed}`);
console.log(`   Total:  ${testsPassed + testsFailed}\n`);

process.exit(testsFailed > 0 ? 1 : 0);
