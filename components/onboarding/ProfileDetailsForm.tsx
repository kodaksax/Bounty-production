import { MaterialIcons } from '@expo/vector-icons';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { BrandingLogo } from '../ui/branding-logo';
import { OnboardingProgressDots } from './OnboardingProgressDots';
import { hapticFeedback } from '../../lib/haptic-feedback';
import type { OnboardingDetailsStyles } from '../../lib/onboarding/onboarding-details-styles';
import type { AppTheme } from '../../lib/themes/types';

export const COMMON_SKILLS = [
  'Handyman', 'Cleaning', 'Moving', 'Delivery', 'Pet Care',
  'Gardening', 'Photography', 'Tutoring', 'Tech Support', 'Design',
];

type ProfileDetailsFormProps = {
  theme: AppTheme;
  styles: OnboardingDetailsStyles;
  insets: { top: number; bottom: number };
  avatarUri: string | undefined;
  uploading: boolean;
  onPickAvatar: () => void;
  displayName: string;
  onChangeDisplayName: (value: string) => void;
  title: string;
  onChangeTitle: (value: string) => void;
  bio: string;
  onChangeBio: (value: string) => void;
  location: string;
  onChangeLocation: (value: string) => void;
  skills: string[];
  onToggleSkill: (skill: string) => void;
  onRemoveSkill: (skill: string) => void;
  customSkill: string;
  onChangeCustomSkill: (value: string) => void;
  onAddCustomSkill: () => void;
  onNext: () => void;
  onSkip: () => void;
  onBack: () => void;
  saving: boolean;
};

// Reached when no poster/hunter intent was picked on welcome.tsx — a
// role-neutral "tell us about you" step. 3 steps total: sign in -> [this] -> done.
export function ProfileDetailsForm({
  theme,
  styles,
  insets,
  avatarUri,
  uploading,
  onPickAvatar,
  displayName,
  onChangeDisplayName,
  title,
  onChangeTitle,
  bio,
  onChangeBio,
  location,
  onChangeLocation,
  skills,
  onToggleSkill,
  onRemoveSkill,
  customSkill,
  onChangeCustomSkill,
  onAddCustomSkill,
  onNext,
  onSkip,
  onBack,
  saving,
}: ProfileDetailsFormProps) {
  const handleNext = () => {
    hapticFeedback.light();
    onNext();
  };

  const handleToggleSkill = (skill: string) => {
    hapticFeedback.light();
    onToggleSkill(skill);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header with Back Button and Branding */}
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={onBack}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <MaterialIcons name="arrow-back" size={24} color={theme.textSecondary} />
          </TouchableOpacity>
          <View style={styles.brandingHeader}>
            <BrandingLogo size="small" />
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* Avatar picker - Prominent placement at top */}
        <View style={styles.avatarSection}>
          <TouchableOpacity
            style={styles.avatarContainer}
            onPress={onPickAvatar}
            disabled={uploading}
            accessibilityRole="button"
            accessibilityLabel="Add a profile photo"
            accessibilityState={{ disabled: uploading, busy: uploading }}
          >
            {avatarUri ? (
              <View style={styles.avatarImageWrapper}>
                <Image source={{ uri: avatarUri }} style={styles.avatarImage} resizeMode="cover" />
              </View>
            ) : (
              <View style={styles.avatarPlaceholder}>
                <MaterialIcons name="account-circle" size={80} color={theme.textDisabled} />
              </View>
            )}
            <View style={styles.avatarEditBadge}>
              <MaterialIcons name="camera-alt" size={18} color="#052e1b" />
            </View>
          </TouchableOpacity>
          <Text style={styles.avatarHint}>
            {uploading ? 'Uploading…' : 'Tap to add a profile photo'}
          </Text>
          <Text style={styles.avatarSubhint}>
            Profiles with a photo get matched and hired faster
          </Text>
        </View>

        {/* Title */}
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">Tell Us About Yourself</Text>
          <Text style={styles.subtitle}>
            These details help others learn more about you. All fields are optional.
          </Text>
        </View>

        {/* Inputs */}
        <View style={styles.inputSection}>
          {/* Display Name */}
          <View style={styles.field}>
            <Text style={styles.label}>Display Name</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={onChangeDisplayName}
              placeholder="e.g., John Doe"
              placeholderTextColor={theme.textDisabled}
              autoCapitalize="words"
              accessibilityLabel="Display name"
            />
            <Text style={styles.hint}>How you&rsquo;d like to be called</Text>
          </View>

          {/* Title/Profession */}
          <View style={styles.field}>
            <Text style={styles.label}>Title/Profession</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={onChangeTitle}
              placeholder="e.g., Full Stack Developer"
              placeholderTextColor={theme.textDisabled}
              autoCapitalize="words"
              accessibilityLabel="Title or profession"
            />
            <Text style={styles.hint}>Your professional title or role</Text>
          </View>

          {/* Bio */}
          <View style={styles.field}>
            <Text style={styles.label}>Bio</Text>
            <TextInput
              style={[styles.input, styles.bioInput]}
              value={bio}
              onChangeText={onChangeBio}
              placeholder="Tell others about yourself..."
              placeholderTextColor={theme.textDisabled}
              multiline
              numberOfLines={3}
              maxLength={200}
              accessibilityLabel="Bio"
            />
            <Text style={styles.hint}>{bio.length}/200 characters</Text>
          </View>

          {/* Location */}
          <View style={styles.field}>
            <Text style={styles.label}>Location</Text>
            <TextInput
              style={styles.input}
              value={location}
              onChangeText={onChangeLocation}
              placeholder="e.g., San Francisco, CA"
              placeholderTextColor={theme.textDisabled}
              autoCapitalize="words"
              accessibilityLabel="Location"
            />
            <Text style={styles.hint}>City and state/country</Text>
          </View>

          {/* Skills */}
          <View style={styles.field}>
            <Text style={styles.label}>Skills</Text>
            <Text style={styles.hintWithMargin}>
              What can you help with? This is how we match you with the right bounties.
            </Text>

            {/* Common skills as chips */}
            <View style={styles.skillsContainer}>
              {COMMON_SKILLS.map((skill) => (
                <TouchableOpacity
                  key={skill}
                  style={[
                    styles.skillChip,
                    skills.includes(skill) && styles.skillChipSelected,
                  ]}
                  onPress={() => handleToggleSkill(skill)}
                  accessibilityRole="button"
                  accessibilityLabel={skill}
                  accessibilityState={{ selected: skills.includes(skill) }}
                >
                  <Text
                    style={[
                      styles.skillChipText,
                      skills.includes(skill) && styles.skillChipTextSelected,
                    ]}
                  >
                    {skill}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Custom skills */}
            {skills.filter(s => !COMMON_SKILLS.includes(s)).length > 0 && (
              <View style={styles.customSkillsContainer}>
                {skills.filter(s => !COMMON_SKILLS.includes(s)).map((skill) => (
                  <View key={skill} style={styles.customSkillChip}>
                    <Text style={styles.customSkillText}>{skill}</Text>
                    <TouchableOpacity
                      onPress={() => onRemoveSkill(skill)}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${skill}`}
                    >
                      <MaterialIcons name="close" size={16} color={theme.textSecondary} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* Add custom skill */}
            <View style={styles.customSkillInput}>
              <TextInput
                style={styles.input}
                value={customSkill}
                onChangeText={onChangeCustomSkill}
                placeholder="Add another skill..."
                placeholderTextColor={theme.textDisabled}
                onSubmitEditing={onAddCustomSkill}
                returnKeyType="done"
                accessibilityLabel="Add another skill"
              />
              {customSkill.trim() && (
                <TouchableOpacity
                  style={styles.addSkillButton}
                  onPress={onAddCustomSkill}
                  accessibilityRole="button"
                  accessibilityLabel="Add skill"
                >
                  <MaterialIcons name="add" size={20} color="#052e1b" />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.nextButton}
            onPress={handleNext}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Next"
            accessibilityState={{ disabled: saving, busy: saving }}
          >
            <Text style={styles.nextButtonText}>
              {saving ? 'Saving...' : 'Next'}
            </Text>
            <MaterialIcons name="arrow-forward" size={20} color="#052e1b" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onSkip}
            style={styles.skipButton}
            accessibilityRole="button"
            accessibilityLabel="Skip for now"
          >
            <Text style={styles.skipButtonText}>Skip for now</Text>
          </TouchableOpacity>
        </View>

        <OnboardingProgressDots total={3} activeIndex={1} style={styles.progressContainer} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
