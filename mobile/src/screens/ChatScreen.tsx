import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { collection, query, orderBy, onSnapshot, addDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';

interface Message {
  id: string;
  index: number;
  step_index: number;
  source: string;
  type: string;
  content: string;
  timestamp: string;
  status: string;
}

interface ChatScreenProps {
  conversationId: string;
  title: string;
  onBack: () => void;
}

export default function ChatScreen({ conversationId, title, onBack }: ChatScreenProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [daemonOnline, setDaemonOnline] = useState(true);
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  // 1. Listen to Messages
  useEffect(() => {
    const docRef = doc(db, 'conversations', conversationId);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const msgs = (data.messages || []).map((msg: any) => ({
          id: String(msg.index),
          index: msg.index,
          step_index: msg.step_index ?? msg.index,
          source: msg.source,
          type: msg.type,
          content: msg.content,
          timestamp: msg.timestamp,
          status: msg.status
        }));
        setMessages(msgs);
      }
    });

    return () => unsubscribe();
  }, [conversationId]);

  // 2. Listen to Daemon Status
  useEffect(() => {
    const docRef = doc(db, 'status', 'mac_daemon');
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const heartbeat = data.heartbeat?.toDate();
        if (heartbeat) {
          const diffMs = Date.now() - heartbeat.getTime();
          setDaemonOnline(data.status === 'online' && diffMs < 60000);
        } else {
          setDaemonOnline(false);
        }
      } else {
        setDaemonOnline(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // 3. Send Message Command
  const handleSendMessage = async () => {
    if (!inputText.trim()) return;
    if (!daemonOnline) return;

    setSending(true);
    const textToSend = inputText.trim();
    setInputText('');

    try {
      // Create a pending command in Firestore
      await addDoc(collection(db, 'commands'), {
        command: 'send_message',
        args: {
          conversationId,
          messageContent: textToSend
        },
        status: 'pending',
        created_at: serverTimestamp()
      });
    } catch (err) {
      console.error(err);
      setInputText(textToSend); // restore on fail
    } finally {
      setSending(false);
    }
  };

  const renderMessageItem = ({ item }: { item: Message }) => {
    const isUser = item.source === 'USER_EXPLICIT';
    const isSystemLog = item.type === 'LOG' || item.source === 'SYSTEM';

    if (isSystemLog) {
      return (
        <View style={styles.logContainer}>
          <Text style={styles.logText}>
            [SYSTEM] {item.type}: {item.content}
          </Text>
        </View>
      );
    }

    return (
      <View style={[styles.bubbleWrapper, isUser ? styles.userWrapper : styles.agentWrapper]}>
        <View style={[styles.bubble, isUser ? styles.userBubble : styles.agentBubble]}>
          <Text style={styles.senderHeader}>{isUser ? 'USER' : 'ANTIGRAVITY AGENT'}</Text>
          {isUser ? (
            <Text style={styles.userText}>{item.content}</Text>
          ) : (
            <Markdown style={markdownStyles}>
              {item.content}
            </Markdown>
          )}
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back-outline" size={24} color="#6366f1" />
        </TouchableOpacity>
        <View style={styles.titleWrapper}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={styles.subtitle}>Synced Workspace Convo</Text>
        </View>
      </View>

      {/* Offline Status Alert */}
      {!daemonOnline && (
        <View style={styles.offlineAlert}>
          <Ionicons name="warning-outline" size={16} color="#fff" />
          <Text style={styles.offlineText}>
            Mac Daemon Offline. Message processing paused.
          </Text>
        </View>
      )}

      {/* Message List */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessageItem}
        contentContainerStyle={styles.listContainer}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      {/* Input Bar */}
      <View style={styles.inputBar}>
        <TextInput
          style={[styles.textInput, !daemonOnline && styles.disabledInput]}
          placeholder={daemonOnline ? "Direct prompt to Antigravity..." : "Offline - Wake up Mac to chat"}
          placeholderTextColor="#6b7280"
          value={inputText}
          onChangeText={setInputText}
          editable={daemonOnline && !sending}
          multiline
        />
        <TouchableOpacity 
          style={[styles.sendButton, (!daemonOnline || !inputText.trim()) && styles.disabledSendButton]}
          onPress={handleSendMessage}
          disabled={!daemonOnline || !inputText.trim() || sending}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="send" size={18} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#030712',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 48,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  backButton: {
    padding: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    marginRight: 14,
  },
  titleWrapper: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  subtitle: {
    fontSize: 11,
    color: '#a855f7',
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  offlineAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ef4444',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  offlineText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 6,
  },
  listContainer: {
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  bubbleWrapper: {
    width: '100%',
    marginVertical: 6,
    flexDirection: 'row',
  },
  userWrapper: {
    justifyContent: 'flex-end',
  },
  agentWrapper: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  userBubble: {
    backgroundColor: '#6366f1',
    borderBottomRightRadius: 4,
  },
  agentBubble: {
    backgroundColor: 'rgba(17, 24, 39, 0.7)',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  senderHeader: {
    fontSize: 9,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.5)',
    marginBottom: 4,
    letterSpacing: 1,
  },
  userText: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 22,
  },
  logContainer: {
    backgroundColor: 'rgba(31, 41, 55, 0.3)',
    borderRadius: 8,
    padding: 10,
    marginVertical: 4,
    borderLeftWidth: 3,
    borderColor: '#4b5563',
  },
  logText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#9ca3af',
    fontSize: 11,
    lineHeight: 16,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    backgroundColor: '#090d16',
  },
  textInput: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    color: '#fff',
    fontSize: 15,
    maxHeight: 120,
    minHeight: 40,
    marginRight: 12,
  },
  disabledInput: {
    opacity: 0.5,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  disabledSendButton: {
    backgroundColor: '#1f2937',
    opacity: 0.4,
  },
});

// Markdown Styles specifically matching the dark theme of the app
const markdownStyles = {
  body: {
    color: '#e5e7eb',
    fontSize: 15,
    lineHeight: 22,
  },
  code_inline: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    color: '#ec4899',
    borderRadius: 4,
    paddingHorizontal: 4,
  },
  code_block: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    color: '#34d399',
    padding: 12,
    borderRadius: 8,
    marginVertical: 8,
    fontSize: 13,
  },
  fence: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    color: '#34d399',
    padding: 12,
    borderRadius: 8,
    marginVertical: 8,
    fontSize: 13,
  },
  link: {
    color: '#60a5fa',
  },
  heading1: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    marginVertical: 8,
  },
  heading2: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginVertical: 6,
  },
};
