import type { UserProfile } from '../types';

// In-memory storage
let profiles: UserProfile[] = [];

// Seed data
const seedProfiles: UserProfile[] = [
  {
    id: 'current-user',
    username: '@jon_doe',
    name: 'Jon Doe',
    avatar: undefined,
    title: 'Full Stack Developer',
    languages: ['English', 'Spanish'],
    skills: ['React', 'Node.js', 'TypeScript', 'Mobile Development'],
    joinDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
    bio: 'Passionate developer with 5+ years of experience building web and mobile applications.',
    verificationStatus: 'verified',
    followerCount: 127,
    followingCount: 89,
  },
  {
    id: 'user-1',
    username: '@olivia_grant',
    name: 'Olivia Grant',
    avatar: undefined,
    title: 'UI/UX Designer',
    languages: ['English', 'French'],
    skills: ['Figma', 'Adobe XD', 'Prototyping', 'User Research'],
    joinDate: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
    bio: 'Designer focused on creating beautiful and intuitive user experiences.',
    verificationStatus: 'verified',
    followerCount: 234,
    followingCount: 156,
  },
  {
    id: 'user-2',
    username: '@john_alfaro',
    name: 'John Alfaro',
    avatar: undefined,
    title: 'Backend Engineer',
    languages: ['English'],
    skills: ['Python', 'Django', 'PostgreSQL', 'AWS'],
    joinDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
    bio: 'Backend specialist with expertise in scalable systems.',
    verificationStatus: 'pending',
    followerCount: 89,
    followingCount: 67,
  },
];

// Initialize with seed data
const initializeData = () => {
  if (profiles.length === 0) {
    profiles = [...seedProfiles];
  }
};

export const userProfileService = {
  /**
   * Get profile by ID
   */
  getProfile: async (userId: string): Promise<UserProfile | null> => {
    initializeData();
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
    initializeData();
    const profile = profiles.find(p => p.id === userId);
    if (!profile) return null;

    Object.assign(profile, updates);
    return profile;
  },

  /**
   * Search profiles
   */
  searchProfiles: async (query: string): Promise<UserProfile[]> => {
    initializeData();
    const lowerQuery = query.toLowerCase();
    return profiles.filter(p => 
      p.username.toLowerCase().includes(lowerQuery) ||
      p.name?.toLowerCase().includes(lowerQuery) ||
      p.title?.toLowerCase().includes(lowerQuery)
    );
  },
};
