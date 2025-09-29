// Example usage of domain types and validation schemas
import {
  Bounty,
  BountySchema,
  UserProfile,
  UserProfileSchema,
  WalletTransaction,
  WalletTransactionSchema,
  Conversation,
  ConversationSchema,
  Money,
} from '../src/index';

// Example bounty data
const exampleBounty: Bounty = {
  id: 'bounty-123',
  user_id: 'user-456',
  title: 'Build a React Native Component',
  description: 'Need help creating a custom calendar component for mobile app',
  amount: 150.00,
  location: 'Remote',
  status: 'open',
  createdAt: new Date().toISOString(),
};

// Validate bounty with Zod schema
try {
  const validatedBounty = BountySchema.parse(exampleBounty);
  console.log('✅ Bounty validation passed:', validatedBounty.title);
} catch (error) {
  console.error('❌ Bounty validation failed:', error);
}

// Example user profile
const exampleUser: UserProfile = {
  id: 'user-456',
  username: 'dev_alice',
  email: 'alice@example.com',
  displayName: 'Alice Developer',
  bio: 'Full-stack developer with 5 years experience in React and Node.js',
  location: 'San Francisco, CA',
  skills: ['React', 'Node.js', 'TypeScript', 'React Native'],
  rating: 4.8,
  totalBountiesCompleted: 23,
  totalBountiesPosted: 5,
};

// Validate user profile
try {
  const validatedUser = UserProfileSchema.parse(exampleUser);
  console.log('✅ User profile validation passed:', validatedUser.username);
} catch (error) {
  console.error('❌ User profile validation failed:', error);
}

// Example wallet transaction
const exampleTransaction: WalletTransaction = {
  id: 'tx-789',
  user_id: 'user-456',
  type: 'escrow',
  amount: 150.00,
  bountyId: 'bounty-123',
  description: 'Escrow for React Native component bounty',
  status: 'completed',
  createdAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
};

// Validate wallet transaction
try {
  const validatedTransaction = WalletTransactionSchema.parse(exampleTransaction);
  console.log('✅ Transaction validation passed:', validatedTransaction.type);
} catch (error) {
  console.error('❌ Transaction validation failed:', error);
}

// Example conversation
const exampleConversation: Conversation = {
  id: 'conv-101',
  bountyId: 'bounty-123',
  isGroup: false,
  name: 'React Native Component Discussion',
  lastMessage: 'Thanks for accepting the bounty! When can we start?',
  participants: ['user-456', 'user-789'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// Validate conversation
try {
  const validatedConversation = ConversationSchema.parse(exampleConversation);
  console.log('✅ Conversation validation passed:', validatedConversation.name);
} catch (error) {
  console.error('❌ Conversation validation failed:', error);
}

// Example of handling validation errors
function createBountyWithValidation(data: unknown): Bounty | null {
  try {
    return BountySchema.parse(data);
  } catch (error) {
    if (error instanceof Error) {
      console.error('Bounty validation error:', error.message);
    }
    return null;
  }
}

// Example invalid data (missing required fields)
const invalidBountyData = {
  title: '', // Invalid: empty title
  description: 'Some description',
  amount: -50, // Invalid: negative amount
};

const result = createBountyWithValidation(invalidBountyData);
console.log('Validation result:', result); // Should be null due to errors

export {
  exampleBounty,
  exampleUser,
  exampleTransaction,
  exampleConversation,
  createBountyWithValidation,
};