/**
 * Support Contact Constants
 * 
 * Centralized support contact information for use across the app.
 * This ensures consistent support information in dispute resolution,
 * cancellation flows, and help screens.
 */

/**
 * Primary support email address for user inquiries
 */
export const SUPPORT_EMAIL = 'Support@bountyfinder.app';

/**
 * Support phone number for urgent inquiries
 */
export const SUPPORT_PHONE = '+1 (949) 370-0909';

/**
 * Company mailing address for legal correspondence
 */
export const SUPPORT_ADDRESS = {
  street: '25552 Adriana st',
  city: 'Mission Viejo',
  state: 'CA',
  zip: '92691',
  country: 'United States',
  formatted: '25552 Adriana st, Mission Viejo, CA 92691, United States',
};

/**
 * Support response time expectations
 */
export const SUPPORT_RESPONSE_TIMES = {
  email: '24-48 hours',
  dispute: '24-48 hours',
  urgent: '24 hours',
};

/**
 * Help URLs (can be updated when web portal is available)
 */
export const HELP_URLS = {
  faq: 'https://bountyfinder.app/faq',
  termsOfService: 'https://bountyfinder.app/terms',
  privacyPolicy: 'https://bountyfinder.app/privacy',
  disputePolicy: 'https://bountyfinder.app/disputes',
};

/**
 * Subject line prefixes for support emails
 */
export const EMAIL_SUBJECTS = {
  dispute: (bountyTitle: string) => `Dispute: ${bountyTitle}`,
  cancellation: (bountyTitle: string) => `Cancellation Request: ${bountyTitle}`,
  general: 'Support Request',
  urgent: 'URGENT: ',
};

/**
 * Helper to generate a mailto link with proper encoding
 */
export const createSupportMailto = (
  subject: string,
  body?: string
): string => {
  const params = new URLSearchParams();
  params.set('subject', subject);
  if (body) {
    params.set('body', body);
  }
  return `mailto:${SUPPORT_EMAIL}?${params.toString()}`;
};

/**
 * Helper to generate a tel link
 */
export const createSupportTel = (): string => {
  return `tel:${SUPPORT_PHONE.replace(/[^+\d]/g, '')}`;
};
