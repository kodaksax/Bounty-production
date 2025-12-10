/**
 * Security Integration Examples
 * 
 * This file demonstrates how to integrate the security utilities
 * into your React Native components and API calls.
 */

import React, { useState } from 'react';
import { View, TextInput, Button, Text } from 'react-native';
import { 
  sanitizeBountyData,
  sanitizeMessageData,
  sanitizeUserProfileData,
  SecureStorage,
  DataSensitivity,
  storeAuthToken,
  getAuthToken,
} from '../lib/security';

/**
 * Example 1: Sanitizing Bounty Form Input
 */
export function BountyFormExample() {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    amount: '',
    location: '',
  });

  const handleSubmit = async () => {
    // Sanitize all inputs before submitting
    const sanitized = sanitizeBountyData({
      title: formData.title,
      description: formData.description,
      amount: parseFloat(formData.amount) || 0,
      location: formData.location,
    });

    // Validate sanitized data
    if (!sanitized.title || sanitized.title.length === 0) {
      alert('Title is required');
      return;
    }

    if (!sanitized.description || sanitized.description.length === 0) {
      alert('Description is required');
      return;
    }

    // Submit to API
    try {
      const response = await fetch('https://api.example.com/bounties', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await getAuthToken()}`,
        },
        body: JSON.stringify(sanitized),
      });

      if (response.ok) {
        alert('Bounty created successfully!');
      }
    } catch (error) {
      console.error('Failed to create bounty:', error);
      alert('Failed to create bounty');
    }
  };

  return (
    <View>
      <TextInput
        placeholder="Title"
        value={formData.title}
        onChangeText={(text) => setFormData({ ...formData, title: text })}
      />
      <TextInput
        placeholder="Description"
        value={formData.description}
        onChangeText={(text) => setFormData({ ...formData, description: text })}
        multiline
      />
      <TextInput
        placeholder="Amount"
        value={formData.amount}
        onChangeText={(text) => setFormData({ ...formData, amount: text })}
        keyboardType="numeric"
      />
      <TextInput
        placeholder="Location"
        value={formData.location}
        onChangeText={(text) => setFormData({ ...formData, location: text })}
      />
      <Button title="Create Bounty" onPress={handleSubmit} />
    </View>
  );
}

/**
 * Example 2: Sanitizing Message Input
 */
export function MessageInputExample({ conversationId }: { conversationId: string }) {
  const [message, setMessage] = useState('');

  const handleSend = async () => {
    // Sanitize message before sending
    const sanitized = sanitizeMessageData({
      text: message,
      conversationId,
    });

    if (!sanitized.text) {
      alert('Message cannot be empty');
      return;
    }

    try {
      const response = await fetch('https://api.example.com/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await getAuthToken()}`,
        },
        body: JSON.stringify(sanitized),
      });

      if (response.ok) {
        setMessage(''); // Clear input
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  return (
    <View>
      <TextInput
        placeholder="Type a message..."
        value={message}
        onChangeText={setMessage}
        multiline
      />
      <Button title="Send" onPress={handleSend} />
    </View>
  );
}

/**
 * Example 3: Secure Storage for Auth Tokens
 */
export async function authenticationExample() {
  // After successful login, store token securely
  const token = 'jwt-token-here';
  await storeAuthToken(token);

  // Later, retrieve token for API calls
  const storedToken = await getAuthToken();
  
  // Use token in API requests
  const response = await fetch('https://api.example.com/me', {
    headers: {
      'Authorization': `Bearer ${storedToken}`,
    },
  });
}

/**
 * Example 4: Secure Storage for User Preferences
 */
export async function userPreferencesExample(userId: string) {
  // Store non-sensitive preferences (uses AsyncStorage)
  await SecureStorage.setJSON(
    `preferences_${userId}`,
    {
      theme: 'dark',
      language: 'en',
      notifications: true,
    },
    DataSensitivity.PUBLIC
  );

  // Store sensitive profile data (uses SecureStore)
  await SecureStorage.setJSON(
    `sensitive_profile_${userId}`,
    {
      phoneNumber: '+1234567890',
      email: 'user@example.com',
    },
    DataSensitivity.SENSITIVE
  );

  // Retrieve later
  const preferences = await SecureStorage.getJSON(
    `preferences_${userId}`,
    DataSensitivity.PUBLIC
  );

  const sensitiveData = await SecureStorage.getJSON(
    `sensitive_profile_${userId}`,
    DataSensitivity.SENSITIVE
  );
}

/**
 * Example 5: API Request with Input Sanitization
 */
export async function updateProfileExample() {
  const userInput = {
    username: 'user<script>alert("xss")</script>name',
    displayName: 'John Doe',
    bio: 'Software developer interested in...',
    website: 'https://example.com',
  };

  // Sanitize before sending
  const sanitized = sanitizeUserProfileData(userInput);

  try {
    const response = await fetch('https://api.example.com/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await getAuthToken()}`,
      },
      body: JSON.stringify(sanitized),
    });

    if (response.ok) {
      alert('Profile updated successfully!');
    }
  } catch (error) {
    console.error('Failed to update profile:', error);
  }
}

/**
 * Example 6: Real-time Form Validation with Sanitization
 */
export function ValidatedFormExample() {
  const [username, setUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');

  const handleUsernameChange = (text: string) => {
    setUsername(text);

    // Real-time validation
    if (text.length < 3) {
      setUsernameError('Username must be at least 3 characters');
    } else if (text.length > 50) {
      setUsernameError('Username must be less than 50 characters');
    } else if (!/^[a-zA-Z0-9_-]+$/.test(text)) {
      setUsernameError('Username can only contain letters, numbers, underscores, and hyphens');
    } else {
      setUsernameError('');
    }
  };

  return (
    <View>
      <TextInput
        placeholder="Username"
        value={username}
        onChangeText={handleUsernameChange}
      />
      {usernameError ? <Text style={{ color: 'red' }}>{usernameError}</Text> : null}
    </View>
  );
}

/**
 * Best Practices Checklist:
 * 
 * 1. Always sanitize user input before:
 *    - Storing in database
 *    - Displaying to other users
 *    - Using in API calls
 * 
 * 2. Use SecureStore for sensitive data:
 *    - Auth tokens
 *    - Encryption keys
 *    - Personal information
 * 
 * 3. Use AsyncStorage for non-sensitive data:
 *    - UI preferences
 *    - Cached public data
 *    - Non-critical settings
 * 
 * 4. Validate input on both client and server:
 *    - Client-side for UX
 *    - Server-side for security
 * 
 * 5. Implement proper error handling:
 *    - Don't expose sensitive errors to users
 *    - Log errors securely
 *    - Provide helpful feedback
 * 
 * 6. Use HTTPS for all API calls:
 *    - Never send sensitive data over HTTP
 *    - Validate SSL certificates
 *    - Implement certificate pinning for critical apps
 */

export default {
  BountyFormExample,
  MessageInputExample,
  authenticationExample,
  userPreferencesExample,
  updateProfileExample,
  ValidatedFormExample,
};
