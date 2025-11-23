import { MaterialIcons } from '@expo/vector-icons';
import { cn } from 'lib/utils';
import { useHapticFeedback } from 'lib/haptic-feedback';
import React, { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, Text, TextInput, TouchableOpacity, View } from 'react-native';

export interface ChatMessage {
  id: string;
  text: string;
  isUser: boolean;
  createdAt: number; // epoch ms
}

interface StickyMessageInterfaceProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  isSending?: boolean;
  placeholder?: string;
  topInset?: number;
  bottomInset?: number;
  accentColor?: string; // defaults to emerald
}

/**
 * Reusable sticky messaging interface: scrollable message list with pinned composer.
 * Keeps Bounty aesthetic: emerald background, rounded bubbles, subtle translucency.
 */
export const StickyMessageInterface: React.FC<StickyMessageInterfaceProps> = ({
  messages,
  onSend,
  isSending = false,
  placeholder = 'Message',
  topInset = 0,
  bottomInset = 0,
  accentColor = '#059669',
}) => {
  const [text, setText] = useState('');
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [expanded, setExpanded] = useState(false); // controls typing modal
  const expandedInputRef = useRef<TextInput | null>(null)
  const { triggerHaptic } = useHapticFeedback()

  useEffect(() => {
    if (atBottom) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages, atBottom]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    triggerHaptic('medium'); // Medium haptic for sending message
    onSend(trimmed);
    setText('');
    if (expanded) setExpanded(false)
  };

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    setAtBottom(distanceFromBottom < 24); // threshold
  };

  const renderItem = ({ item }: { item: ChatMessage }) => (
    <View className={cn('mb-3 px-3 max-w-[80%]', item.isUser ? 'ml-auto' : 'mr-auto')}
      style={{ opacity: 1 }}>
      <View className={cn('px-3 py-2 rounded-2xl', item.isUser ? 'bg-white rounded-br-none' : 'bg-emerald-700/60 rounded-bl-none')}> 
        <Text className={cn('text-sm', item.isUser ? 'text-gray-900' : 'text-white')}>{item.text}</Text>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.select({ ios: 'padding', android: undefined })}>
      <View className="flex-1">
        <FlatList
          ref={listRef}
          data={messages}
          renderItem={renderItem}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingTop: topInset + 8, paddingBottom: bottomInset + 110, paddingHorizontal: 12 }}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        />

        {/* Sticky composer */}
        <View className="absolute left-0 right-0" style={{ bottom: 0, paddingBottom: bottomInset }}>
          <View className="px-3 pb-3">
            <View className="flex-row items-end gap-2 bg-emerald-700/30 rounded-2xl px-3 pt-2 pb-2 border border-emerald-500/30">
              <TouchableOpacity className="h-9 w-9 rounded-full bg-emerald-700/60 items-center justify-center mt-auto">
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
              <View style={{ backgroundColor:'#065f46', paddingTop:16, paddingHorizontal:12, paddingBottom: bottomInset + 16, borderTopLeftRadius:24, borderTopRightRadius:24 }}>
                <View style={{ alignSelf:'center', width:48, height:4, backgroundColor:'rgba(255,255,255,0.3)', borderRadius:2, marginBottom:12 }} />
                <View style={{ maxHeight: 220, borderRadius:16, borderWidth:1, borderColor:'rgba(16,185,129,0.4)', backgroundColor:'rgba(6,95,70,0.4)', paddingHorizontal:12, paddingVertical:8 }}>
                  <TextInput
                    ref={expandedInputRef}
                    value={text}
                    onChangeText={setText}
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
                    <Text style={{ fontWeight:'600', color: text.trim()? '#052e1b':'#c7f9d7' }}>{isSending? 'Sending':'Send'}</Text>
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
