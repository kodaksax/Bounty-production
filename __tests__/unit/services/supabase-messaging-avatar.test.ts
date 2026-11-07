/**
 * profiles.avatar stores a full URL. Treating it as a bucket path produced
 * `.../object/public/Profilepictures/https:/...`, which storage rejects with a
 * 400, so no conversation row could show an avatar.
 */
import { getProfileAvatarUrl } from '../../../lib/services/supabase-messaging';

const getPublicUrl = jest.fn((path: string) => ({
  data: { publicUrl: `https://project.supabase.co/storage/v1/object/public/Profilepictures/${path}` },
}));

jest.mock('../../../lib/supabase', () => ({
  supabase: { storage: { from: jest.fn(() => ({ getPublicUrl })) } },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

jest.mock('../../../lib/services/monitoring', () => ({
  logClientError: jest.fn(),
  logClientInfo: jest.fn(),
}));

describe('getProfileAvatarUrl', () => {
  beforeEach(() => getPublicUrl.mockClear());

  it('returns a stored absolute URL unchanged', () => {
    const stored =
      'https://project.supabase.co/storage/v1/object/public/profiles/avatars/1792771375606-photo.jpg';

    expect(getProfileAvatarUrl(stored)).toBe(stored);
    expect(getPublicUrl).not.toHaveBeenCalled();
  });

  it('accepts http and is case-insensitive about the scheme', () => {
    expect(getProfileAvatarUrl('http://cdn.example.com/a.png')).toBe('http://cdn.example.com/a.png');
    expect(getProfileAvatarUrl('HTTPS://cdn.example.com/a.png')).toBe(
      'HTTPS://cdn.example.com/a.png'
    );
  });

  it('still resolves a bucket-relative path through storage', () => {
    expect(getProfileAvatarUrl('avatars/me.png')).toBe(
      'https://project.supabase.co/storage/v1/object/public/Profilepictures/avatars/me.png'
    );
    expect(getPublicUrl).toHaveBeenCalledWith('avatars/me.png');
  });

  it('returns undefined when there is no avatar', () => {
    expect(getProfileAvatarUrl(null)).toBeUndefined();
    expect(getProfileAvatarUrl(undefined)).toBeUndefined();
    expect(getProfileAvatarUrl('')).toBeUndefined();
  });
});
