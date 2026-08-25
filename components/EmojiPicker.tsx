import { MaterialIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';

/**
 * Emoji categories. Kept as a static, dependency-free list: every emoji here is
 * covered by the system font on iOS 13+ / Android 10+, which is the app's
 * supported floor, so nothing needs to be bundled or downloaded.
 */
const EMOJI_CATEGORIES: { key: string; icon: keyof typeof MaterialIcons.glyphMap; emojis: string[] }[] = [
  {
    key: 'Smileys',
    icon: 'sentiment-satisfied-alt',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃',
      '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙',
      '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔',
      '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😮',
      '😯', '😴', '🤤', '😪', '😵', '🤯', '🤠', '🥳', '😎', '🤓',
      '🧐', '😕', '😟', '🙁', '😮‍💨', '😢', '😭', '😤', '😠', '😡',
      '🤬', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '🤗', '🤝',
    ],
  },
  {
    key: 'Gestures',
    icon: 'thumb-up',
    emojis: [
      '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉',
      '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤛', '🤜',
      '👏', '🙌', '👐', '🤲', '🙏', '💪', '🦾', '✍️', '💅', '👀',
      '🫡', '🫰', '🤌', '🫶', '🖕', '✊', '👊',
    ],
  },
  {
    key: 'Hearts',
    icon: 'favorite',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '💌',
      '💯', '💢', '💥', '💫', '💦', '💨', '✨', '⭐', '🌟', '🔥',
    ],
  },
  {
    key: 'Bounty',
    icon: 'work-outline',
    emojis: [
      '💰', '💵', '💸', '💳', '🏆', '🥇', '🎯', '📦', '📸', '📍',
      '🗓️', '⏰', '⏳', '✅', '❌', '⚠️', '❗', '❓', '🔒', '🔑',
      '🔨', '🧰', '🧹', '🧼', '🚗', '🚚', '🏠', '🌱', '🐕', '🐈',
      '🛠️', '📝', '📋', '📄', '🔍', '🚀', '🎉', '🙌', '👷', '🧑‍🔧',
    ],
  },
  {
    key: 'Objects',
    icon: 'emoji-objects',
    emojis: [
      '📱', '💻', '⌨️', '🖥️', '🖨️', '☎️', '📞', '📷', '🎥', '🔋',
      '💡', '🔦', '🕯️', '🧭', '⚖️', '🎁', '🎈', '🎂', '☕', '🍕',
      '🍔', '🌮', '🍎', '🍺', '🥤', '⚽', '🏀', '🎮', '🎧', '🎵',
      '☀️', '🌙', '⛅', '🌧️', '❄️', '🌈', '🌊', '🌴', '🍀', '🌸',
    ],
  },
];

export interface EmojiPickerProps {
  visible: boolean;
  /** Called with the selected emoji; the composer appends it to its text. */
  onSelect: (emoji: string) => void;
  onClose: () => void;
  /** Safe-area bottom inset, so the last row of emoji clears the home indicator. */
  bottomInset?: number;
}

/**
 * Inline emoji keyboard for the message composer. Renders as a panel below the
 * composer (rather than a modal) so the message list stays visible while
 * picking, matching how the system keyboard behaves.
 */
export function EmojiPicker({ visible, onSelect, onClose, bottomInset = 0 }: EmojiPickerProps) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [activeCategory, setActiveCategory] = useState(0);

  if (!visible) return null;

  const category = EMOJI_CATEGORIES[activeCategory] ?? EMOJI_CATEGORIES[0];

  return (
    <View
      style={[s.container, { height: 250 + bottomInset, paddingBottom: bottomInset }]}
      accessibilityLabel="Emoji picker"
    >
      <View style={s.tabRow}>
        {EMOJI_CATEGORIES.map((cat, index) => (
          <TouchableOpacity
            key={cat.key}
            onPress={() => setActiveCategory(index)}
            style={[s.tab, index === activeCategory && s.tabActive]}
            accessibilityRole="button"
            accessibilityLabel={`${cat.key} emoji`}
            accessibilityState={{ selected: index === activeCategory }}
          >
            <MaterialIcons
              name={cat.icon}
              size={20}
              color={index === activeCategory ? theme.primary : theme.textSecondary}
            />
          </TouchableOpacity>
        ))}
        <View style={s.tabSpacer} />
        <TouchableOpacity
          onPress={onClose}
          style={s.tab}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Close emoji picker"
        >
          <MaterialIcons name="keyboard-hide" size={20} color={theme.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={s.grid}
        contentContainerStyle={s.gridContent}
        keyboardShouldPersistTaps="always"
      >
        {category.emojis.map((emoji, index) => (
          <TouchableOpacity
            key={`${category.key}-${index}`}
            onPress={() => onSelect(emoji)}
            style={s.emojiCell}
            accessibilityRole="button"
            accessibilityLabel={`Insert ${emoji}`}
          >
            <Text style={s.emoji}>{emoji}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

export default EmojiPicker;

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    container: {
      height: 250,
      backgroundColor: t.surfaceSecondary,
      borderTopWidth: 1,
      borderTopColor: t.border,
    },
    tabRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    tab: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
    },
    tabActive: {
      backgroundColor: t.background,
    },
    tabSpacer: {
      flex: 1,
    },
    grid: {
      flex: 1,
    },
    gridContent: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: 8,
      paddingVertical: 8,
      paddingBottom: 16,
    },
    emojiCell: {
      width: '12.5%',
      aspectRatio: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emoji: {
      fontSize: 26,
      lineHeight: 32,
    },
  });
}
