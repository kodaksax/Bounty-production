import { MaterialIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { cn } from 'lib/utils';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, FlatList, Image, KeyboardAvoidingView, Modal, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHapticFeedback } from '../lib/haptic-feedback';

export interface Attachment {
  uri: string;
  mimeType?: string | null;
  name?: string | null;
  size?: number | null;
}

export interface ChatMessage {
  id: string;
  text: string;
  isUser: boolean;
  createdAt: number; // epoch ms
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  attachments?: Attachment[];
}

interface StickyMessageInterfaceProps {
  messages: ChatMessage[];
  onSend: (text: string, attachments?: Attachment[]) => void;
  isSending?: boolean;
  placeholder?: string;
  topInset?: number;
  bottomInset?: number;
  accentColor?: string; // defaults to emerald
  isOtherUserTyping?: boolean; // for typing indicator
  onTypingChange?: (isTyping: boolean) => void; // notify parent when user starts/stops typing
  typingTimeout?: number; // milliseconds to wait before stopping typing indicator (default: 2000)
}

/**
 * Reusable sticky messaging interface: scrollable message list with pinned composer.
 * Keeps Bounty aesthetic: emerald background, rounded bubbles, subtle translucency.
 * Features: animated message entry, read receipts, typing indicators.
 */
export const StickyMessageInterface: React.FC<StickyMessageInterfaceProps> = ({
  messages,
  onSend,
  isSending = false,
  placeholder = 'Message',
  topInset = 0,
  bottomInset = 0,
  accentColor = '#059669',
  isOtherUserTyping = false,
  onTypingChange,
  typingTimeout = 2000,
}) => {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [expanded, setExpanded] = useState(false); // controls typing modal
  const expandedInputRef = useRef<TextInput | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { triggerHaptic } = useHapticFeedback()
  const insets = useSafeAreaInsets()

  // Ensure we reserve space for a bottom navigation bar and safe area.
  // Many parents pass bottomInset=0; choose a sensible minimum so the composer isn't hidden.
  // Raise the estimate so the composer clears a taller BottomNav (and floating central button).
  const BOTTOM_NAV_ESTIMATE = 96
  const effectiveBottomInset = Math.max(bottomInset || 0, insets.bottom || 0, BOTTOM_NAV_ESTIMATE)


  useEffect(() => {
    if (atBottom) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages, atBottom]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    triggerHaptic('medium'); // Medium haptic for sending message
    onSend(trimmed, attachments.length ? attachments : undefined);
    setText('');
    setAttachments([]);
    if (expanded) setExpanded(false);
    // Stop typing when message is sent
    if (onTypingChange) {
      onTypingChange(false);
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  };

  const handlePickImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return;
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, quality: 0.8, allowsEditing: false });
      const picked = (res as any).assets?.[0] ?? res;
      if ((res as any).cancelled) return;
      const attachment: Attachment = { uri: picked.uri, mimeType: (picked as any).type ?? null, name: (picked as any).fileName ?? null, size: (picked as any).fileSize ?? null };
      setAttachments(prev => [...prev, attachment]);
    } catch (e) {
      // ignore permission or picker errors
    }
  };

  const handlePickDocument = async () => {
    try {
      const res: any = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: false });
      if (res.type === 'cancel') return;
      const attachment: Attachment = { uri: res.uri, name: res.name ?? null, size: res.size ?? null, mimeType: res.mimeType ?? null };
      setAttachments(prev => [...prev, attachment]);
    } catch (e) {
      // ignore
    }
  };

  const handleShareAttachment = async (att: Attachment) => {
    if (!att.uri) return;
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(att.uri);
      }
    } catch (e) {
      // ignore
    }
  };

  const handleTextChange = (newText: string) => {
    setText(newText);
    
    // Notify parent about typing status
    if (onTypingChange) {
      if (newText.length > 0) {
        onTypingChange(true);
        
        // Reset timeout - if user stops typing for configured duration, mark as stopped
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
        }
        typingTimeoutRef.current = setTimeout(() => {
          onTypingChange(false);
        }, typingTimeout);
      } else {
        onTypingChange(false);
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = null;
        }
      }
    }
  };

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    setAtBottom(distanceFromBottom < 24); // threshold
  };

  const renderItem = ({ item, index }: { item: ChatMessage; index: number }) => {
    // Only animate messages added in the last 500ms
    const isNewMessage = Date.now() - item.createdAt < 500;
    
    return (
      <AnimatedMessage 
        message={item} 
        isNewMessage={isNewMessage}
      />
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.select({ ios: 'padding', android: undefined })}>
      <View className="flex-1">
        <FlatList
          ref={listRef}
          data={messages}
          renderItem={renderItem}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingTop: topInset + 8, paddingBottom: effectiveBottomInset + 110, paddingHorizontal: 12 }}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={isOtherUserTyping ? <TypingIndicator /> : null}
        />

        {/* Sticky composer */}
        <View className="absolute left-0 right-0" style={{ bottom: 0, paddingBottom: effectiveBottomInset }}>
          <View className="px-3 pb-3">
            <View className="flex-row items-end gap-2 bg-emerald-700/30 rounded-2xl px-3 pt-2 pb-2 border border-emerald-500/30">
              <TouchableOpacity className="h-9 w-9 rounded-full bg-emerald-700/60 items-center justify-center mt-auto" onPress={handlePickImage}>
                  <MaterialIcons name="add" size={22} color="#ffffff" />
                </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.9} onPress={() => setExpanded(true)}>
                <View pointerEvents="none">
                  <Text numberOfLines={2} style={{ color: text ? '#ffffff' : '#c7f9d7', minHeight: 24 }}>
                    {text || placeholder}
                  </Text>
                </View>
              </TouchableOpacity>
              {text.length > 0 ? (
                <TouchableOpacity onPress={handleSend} disabled={isSending} className="h-9 w-9 rounded-full bg-emerald-500 items-center justify-center mb-1">
                  <MaterialIcons name={isSending ? 'hourglass-empty' : 'send'} size={18} color="#000" />
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity className="h-9 w-9 rounded-full bg-emerald-700/60 items-center justify-center mb-1">
                    <MaterialIcons name="photo-camera" size={18} color="#c7f9d7" />
                  </TouchableOpacity>
                  <TouchableOpacity className="h-9 w-9 rounded-full bg-emerald-700/60 items-center justify-center mb-1">
                    <MaterialIcons name="mic" size={18} color="#c7f9d7" />
                  </TouchableOpacity>
                </>
              )}
            </View>
            {!atBottom && (
              <TouchableOpacity onPress={() => listRef.current?.scrollToEnd({ animated: true })} className="self-center mt-2 px-3 py-1 bg-emerald-700/40 rounded-full">
                <Text className="text-xs text-emerald-100">Scroll to latest</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Expanded typing modal */}
        <Modal
          visible={expanded}
          animationType="fade"
          transparent
          onShow={() => requestAnimationFrame(() => expandedInputRef.current?.focus())}
        >
            <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.45)', justifyContent:'flex-end' }}>
            <Pressable style={{ flex:1 }} onPress={()=> setExpanded(false)} />
            <KeyboardAvoidingView behavior={Platform.select({ ios:'padding', android: undefined })}>
              <View style={{ backgroundColor:'#065f46', paddingTop:16, paddingHorizontal:12, paddingBottom: effectiveBottomInset + 16, borderTopLeftRadius:24, borderTopRightRadius:24 }}>
                <View style={{ alignSelf:'center', width:48, height:4, backgroundColor:'rgba(255,255,255,0.3)', borderRadius:2, marginBottom:12 }} />
                <View style={{ maxHeight: 220, borderRadius:16, borderWidth:1, borderColor:'rgba(16,185,129,0.4)', backgroundColor:'rgba(6,95,70,0.4)', paddingHorizontal:12, paddingVertical:8 }}>
                  <TextInput
                    ref={expandedInputRef}
                    value={text}
                    onChangeText={handleTextChange}
                    placeholder={placeholder}
                    placeholderTextColor="#c7f9d7"
                    multiline
                    style={{ color:'#ffffff', fontSize:15, minHeight:80, textAlignVertical:'top' }}
                    returnKeyType="default"
                  />
                </View>
                <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginTop:16 }}>
                  <View style={{ flexDirection:'row', gap:12 }}>
                    <TouchableOpacity style={{ height:42, width:42, borderRadius:21, backgroundColor:'rgba(16,185,129,0.25)', alignItems:'center', justifyContent:'center' }}>
                      <MaterialIcons name="photo-camera" size={22} color="#c7f9d7" />
                    </TouchableOpacity>
                    <TouchableOpacity style={{ height:42, width:42, borderRadius:21, backgroundColor:'rgba(16,185,129,0.25)', alignItems:'center', justifyContent:'center' }}>
                      <MaterialIcons name="mic" size={22} color="#c7f9d7" />
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    disabled={!text.trim() || isSending}
                    onPress={handleSend}
                    style={{ backgroundColor: text.trim()? '#10b981':'rgba(16,185,129,0.35)', paddingHorizontal:24, height:44, borderRadius:22, alignItems:'center', justifyContent:'center', flexDirection:'row', gap:6 }}>
                    <MaterialIcons name={isSending? 'hourglass-empty':'send'} size={20} color={text.trim()? '#052e1b':'#c7f9d7'} />
                    <Text style={{ fontWeight:'600', color: text.trim()? '#052e1b':'#c7f9d7' }}>{isSending? 'Sending':'Send Message'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAvoidingView>
          </View>
        </Modal>
      </View>
    </KeyboardAvoidingView>
  );
};

/**
 * Animated message component with slide-in effect and read receipts
 */
const AnimatedMessage: React.FC<{ message: ChatMessage; isNewMessage: boolean }> = ({ message, isNewMessage }) => {
  const slideAnim = useRef(new Animated.Value(isNewMessage ? 20 : 0)).current;
  const fadeAnim = useRef(new Animated.Value(isNewMessage ? 0 : 1)).current;

  useEffect(() => {
    if (isNewMessage) {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isNewMessage, slideAnim, fadeAnim]);

  // Render read receipt icon for sent messages
  const renderReadReceipt = () => {
    if (!message.isUser || !message.status) return null;

    let iconName: any = 'check';
    let iconColor = '#6ee7b7'; // emerald-300

    switch (message.status) {
      case 'sending':
        iconName = 'schedule';
        iconColor = '#a7f3d0'; // emerald-200
        break;
      case 'sent':
        iconName = 'check';
        iconColor = '#6ee7b7'; // emerald-300
        break;
      case 'delivered':
        iconName = 'done-all';
        iconColor = '#6ee7b7'; // emerald-300
        break;
      case 'read':
        iconName = 'done-all';
        iconColor = '#10b981'; // emerald-500 (brighter for read)
        break;
      case 'failed':
        iconName = 'error';
        iconColor = '#f87171'; // red-400
        break;
    }

    return (
      <View className="flex-row items-center mt-0.5">
        <MaterialIcons name={iconName} size={14} color={iconColor} />
      </View>
    );
  };

  return (
    <Animated.View 
      className={cn('mb-3 px-3 max-w-[80%]', message.isUser ? 'ml-auto' : 'mr-auto')}
      style={{ 
        opacity: fadeAnim,
        transform: [{ translateY: slideAnim }]
      }}
    >
      <View className={cn('px-3 py-2 rounded-2xl', message.isUser ? 'bg-white rounded-br-none' : 'bg-emerald-700/60 rounded-bl-none')}> 
        <Text className={cn('text-sm', message.isUser ? 'text-gray-900' : 'text-white')}>{message.text}</Text>
        {message.attachments && message.attachments.length > 0 && (
          <View className="mt-2">
            {message.attachments.map((att, i) => (
              <View key={att.uri + i} className="mt-2">
                {att.mimeType && att.mimeType.startsWith?.('image') ? (
                  <Image source={{ uri: att.uri }} style={{ width: 220, height: 140, borderRadius: 10 }} />
                ) : (
                  <View className="bg-emerald-700/30 rounded-md px-3 py-2">
                    <Text className={cn('text-sm', message.isUser ? 'text-gray-900' : 'text-white')}>{att.name ?? 'attachment'}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}
      </View>
      {renderReadReceipt()}
    </Animated.View>
  );
};

/**
 * Typing indicator component with animated dots
 */
const TypingIndicator: React.FC = () => {
  const dot1Anim = useRef(new Animated.Value(0)).current;
  const dot2Anim = useRef(new Animated.Value(0)).current;
  const dot3Anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const createAnimation = (anim: Animated.Value, delay: number) => 
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, {
            toValue: -5,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: 400,
            useNativeDriver: true,
          }),
        ])
      );

    const anim1 = createAnimation(dot1Anim, 0);
    const anim2 = createAnimation(dot2Anim, 150);
    const anim3 = createAnimation(dot3Anim, 300);

    anim1.start();
    anim2.start();
    anim3.start();

    return () => {
      anim1.stop();
      anim2.stop();
      anim3.stop();
    };
  }, [dot1Anim, dot2Anim, dot3Anim]);

  return (
    <View className="mb-3 px-3 max-w-[80%] mr-auto">
      <View className="px-4 py-3 rounded-2xl bg-emerald-700/60 rounded-bl-none flex-row gap-1.5">
        <Animated.View 
          style={{ 
            width: 8, 
            height: 8, 
            borderRadius: 4, 
            backgroundColor: '#d1fae5',
            transform: [{ translateY: dot1Anim }]
          }} 
        />
        <Animated.View 
          style={{ 
            width: 8, 
            height: 8, 
            borderRadius: 4, 
            backgroundColor: '#d1fae5',
            transform: [{ translateY: dot2Anim }]
          }} 
        />
        <Animated.View 
          style={{ 
            width: 8, 
            height: 8, 
            borderRadius: 4, 
            backgroundColor: '#d1fae5',
            transform: [{ translateY: dot3Anim }]
          }} 
        />
      </View>
    </View>
  );
};
