import type { UserProfile } from '../types';

// In-memory storage - no seed data to avoid showing hardcoded profiles
let profiles: UserProfile[] = [];

export const userProfileService = {
  /**
   * Get profile by ID
   */
  getProfile: async (userId: string): Promise<UserProfile | null> => {
    return profiles.find(p => p.id === userId) || null;
  },

  /**
   * Get current user profile
   */
  getCurrentProfile: async (): Promise<UserProfile | null> => {
    return userProfileService.getProfile('current-user');
  },

  /**
   * Update profile
   */
  updateProfile: async (userId: string, updates: Partial<UserProfile>): Promise<UserProfile | null> => {
    const profile = profiles.find(p => p.id === userId);
    if (!profile) {
      // Create new profile if it doesn't exist
      const newProfile: UserProfile = {
        id: userId,
        username: updates.username || '',
        avatar: updates.avatar,
        title: updates.title,
        languages: updates.languages || [],
        skills: updates.skills || [],
        joinDate: new Date().toISOString(),
        bio: updates.bio,
        verificationStatus: 'unverified',
        followerCount: 0,
        followingCount: 0,
        ...updates,
      } as UserProfile;
      profiles.push(newProfile);
      return newProfile;
    }

    Object.assign(profile, updates);
    return profile;
  },

  /**
   * Search profiles
   */
  searchProfiles: async (query: string): Promise<UserProfile[]> => {
    const lowerQuery = query.toLowerCase();
    return profiles.filter(p => 
      p.username.toLowerCase().includes(lowerQuery) ||
      p.name?.toLowerCase().includes(lowerQuery) ||
      p.title?.toLowerCase().includes(lowerQuery)
    );
  },
};
