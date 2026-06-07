import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, FlatList, TouchableOpacity, Switch, TextInput, Modal, Alert, ScrollView } from 'react-native';
import { collection, query, orderBy, onSnapshot, addDoc, doc, serverTimestamp } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { db, auth } from '../config/firebase';
import { Ionicons } from '@expo/vector-icons';

interface Conversation {
  id: string;
  conversationId: string;
  title: string;
  updated_at: any;
  messageCount: number;
}

interface DashboardScreenProps {
  onSelectConversation: (convoId: string, title: string) => void;
}

export default function DashboardScreen({ onSelectConversation }: DashboardScreenProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [daemonOnline, setDaemonOnline] = useState(false);
  const [daemonHeartbeat, setDaemonHeartbeat] = useState<string | null>(null);
  
  // Settings / Command States
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [newProjectModalVisible, setNewProjectModalVisible] = useState(false);
  const [projectName, setProjectName] = useState('');
  
  // Settings values
  const [turboMode, setTurboMode] = useState(false);
  const [autoImplement, setAutoImplement] = useState(false);
  const [modelSelection, setModelSelection] = useState('Gemini 3.1 Pro (High)');

  // 1. Listen to Conversations
  useEffect(() => {
    const q = query(collection(db, 'conversations'), orderBy('updated_at', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const convos: Conversation[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        convos.push({
          id: doc.id,
          conversationId: data.conversationId,
          title: data.title || data.conversationId,
          updated_at: data.updated_at,
          messageCount: data.messageCount || 0
        });
      });
      setConversations(convos);
    });

    return () => unsubscribe();
  }, []);

  // 2. Listen to Daemon Status
  useEffect(() => {
    const docRef = doc(db, 'status', 'mac_daemon');
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const heartbeat = data.heartbeat?.toDate();
        if (heartbeat) {
          const diffMs = Date.now() - heartbeat.getTime();
          const isOnline = data.status === 'online' && Math.abs(diffMs) < 300000; // Online if pinged in last 5m (handles clock skew)
          setDaemonOnline(isOnline);
          setDaemonHeartbeat(heartbeat.toLocaleTimeString());
        } else {
          setDaemonOnline(false);
        }
      } else {
        setDaemonOnline(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // 3. Handle Sign Out
  const handleSignOut = () => {
    signOut(auth);
  };

  // 4. Send Settings Change Command
  const applySettings = async () => {
    if (!daemonOnline) {
      Alert.alert('Mac is Offline', 'Cannot apply settings while your Mac is offline.');
      return;
    }
    
    try {
      await addDoc(collection(db, 'commands'), {
        command: 'change_settings',
        args: {
          modelSelection,
          turboMode,
          autoImplement
        },
        status: 'pending',
        created_at: serverTimestamp()
      });
      setSettingsModalVisible(false);
      Alert.alert('Success', 'Settings modification command sent to Mac!');
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Failed to send settings command.');
    }
  };

  // 5. Send Create Project Command
  const createProject = async () => {
    if (!projectName.trim()) {
      Alert.alert('Input Error', 'Please enter a project name.');
      return;
    }
    if (!daemonOnline) {
      Alert.alert('Mac is Offline', 'Cannot create a project while your Mac is offline.');
      return;
    }

    try {
      await addDoc(collection(db, 'commands'), {
        command: 'new_project',
        args: {
          name: projectName.trim()
        },
        status: 'pending',
        created_at: serverTimestamp()
      });
      setProjectName('');
      setNewProjectModalVisible(false);
      Alert.alert('Success', 'Project creation command sent to Mac!');
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Failed to trigger project creation.');
    }
  };

  return (
    <View style={styles.container}>
      {/* Header Bar */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Antigravity 2.0</Text>
          <Text style={styles.headerSubtitle}>Lite Controller</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.iconButton} onPress={() => setSettingsModalVisible(true)}>
            <Ionicons name="settings-outline" size={24} color="#a855f7" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconButton} onPress={handleSignOut}>
            <Ionicons name="log-out-outline" size={24} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Daemon Status Bar */}
      <View style={[styles.statusBanner, daemonOnline ? styles.statusOnline : styles.statusOffline]}>
        <View style={styles.statusLeft}>
          <View style={[styles.statusDot, daemonOnline ? styles.dotOnline : styles.dotOffline]} />
          <Text style={styles.statusText}>
            Mac Daemon: {daemonOnline ? 'Online' : 'Offline'}
          </Text>
        </View>
        {daemonOnline && (
          <Text style={styles.heartbeatText}>Last Ping: {daemonHeartbeat}</Text>
        )}
      </View>

      {/* Quick Actions Card */}
      <View style={styles.actionsCard}>
        <Text style={styles.cardTitle}>Quick Orchestration</Text>
        <TouchableOpacity 
          style={styles.actionRowButton} 
          onPress={() => setNewProjectModalVisible(true)}
          disabled={!daemonOnline}
        >
          <Ionicons name="add-circle-outline" size={22} color="#fff" />
          <Text style={styles.actionButtonText}>Create New Sync Workspace</Text>
        </TouchableOpacity>
      </View>

      {/* Conversation List */}
      <Text style={styles.listHeader}>Conversations</Text>
      {conversations.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="chatbubbles-outline" size={48} color="#4b5563" />
          <Text style={styles.emptyText}>No synced conversations found</Text>
          <Text style={styles.emptySubtext}>Chats will appear here automatically when the Mac Daemon detects edits in your brains.</Text>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContainer}
          renderItem={({ item }) => (
            <TouchableOpacity 
              style={styles.convoCard}
              onPress={() => onSelectConversation(item.conversationId, item.title)}
            >
              <View style={styles.convoLeft}>
                <Ionicons name="terminal-outline" size={24} color="#6366f1" />
                <View style={styles.convoMeta}>
                  <Text style={styles.convoTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.convoSub}>{item.messageCount} messages</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward-outline" size={20} color="#6b7280" />
            </TouchableOpacity>
          )}
        />
      )}

      {/* Modal 1: Settings */}
      <Modal visible={settingsModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Global Settings</Text>
            
            <ScrollView style={styles.modalScroll}>
              <Text style={styles.label}>AI Core Model</Text>
              <View style={styles.pickerContainer}>
                {['Gemini 3.5 Flash (Low)', 'Gemini 3.1 Pro (High)'].map((model) => (
                  <TouchableOpacity
                    key={model}
                    style={[styles.pickerItem, modelSelection === model && styles.pickerItemActive]}
                    onPress={() => setModelSelection(model)}
                  >
                    <Text style={[styles.pickerText, modelSelection === model && styles.pickerTextActive]}>
                      {model}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.switchRow}>
                <View>
                  <Text style={styles.switchLabel}>Turbo Mode</Text>
                  <Text style={styles.switchDesc}>Speeds up inference iterations</Text>
                </View>
                <Switch 
                  value={turboMode} 
                  onValueChange={setTurboMode}
                  trackColor={{ false: '#374151', true: '#a855f7' }}
                  thumbColor={turboMode ? '#fff' : '#9ca3af'}
                />
              </View>

              <View style={styles.switchRow}>
                <View>
                  <Text style={styles.switchLabel}>Auto-Implement</Text>
                  <Text style={styles.switchDesc}>Approves implementation plans automatically</Text>
                </View>
                <Switch 
                  value={autoImplement} 
                  onValueChange={setAutoImplement}
                  trackColor={{ false: '#374151', true: '#a855f7' }}
                  thumbColor={autoImplement ? '#fff' : '#9ca3af'}
                />
              </View>
            </ScrollView>

            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalButton, styles.cancelBtn]} 
                onPress={() => setSettingsModalVisible(false)}
              >
                <Text style={styles.cancelBtnText}>Dismiss</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalButton, styles.confirmBtn]} 
                onPress={applySettings}
              >
                <Text style={styles.confirmBtnText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal 2: Create Project */}
      <Modal visible={newProjectModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Sync Project</Text>
            
            <Text style={styles.inputLabel}>Workspace Project Name</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. awesome-agentic-app"
              placeholderTextColor="#6b7280"
              value={projectName}
              onChangeText={setProjectName}
              autoCapitalize="none"
            />
            <Text style={styles.inputDesc}>
              This will create a directory on your Mac hard drive inside your projects container folder.
            </Text>

            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalButton, styles.cancelBtn]} 
                onPress={() => setNewProjectModalVisible(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalButton, styles.confirmBtn]} 
                onPress={createProject}
              >
                <Text style={styles.confirmBtnText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#030712',
    paddingTop: 48,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 1,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#a855f7',
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  headerActions: {
    flexDirection: 'row',
  },
  iconButton: {
    marginLeft: 16,
    padding: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
  },
  statusBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  statusOnline: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  statusOffline: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  dotOnline: {
    backgroundColor: '#10b981',
  },
  dotOffline: {
    backgroundColor: '#ef4444',
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#f3f4f6',
  },
  heartbeatText: {
    fontSize: 12,
    color: '#9ca3af',
  },
  actionsCard: {
    margin: 20,
    padding: 20,
    backgroundColor: 'rgba(17, 24, 39, 0.6)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f3f4f6',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  actionRowButton: {
    backgroundColor: '#6366f1',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 8,
  },
  listHeader: {
    fontSize: 16,
    fontWeight: '800',
    color: '#9ca3af',
    marginHorizontal: 24,
    marginTop: 8,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  listContainer: {
    paddingHorizontal: 20,
  },
  convoCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(17, 24, 39, 0.4)',
    padding: 16,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.03)',
  },
  convoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  convoMeta: {
    marginLeft: 14,
    flex: 1,
  },
  convoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  convoSub: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#9ca3af',
    marginTop: 16,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 12,
    color: '#4b5563',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 18,
  },
  // Modals styling
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#111827',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 20,
    textAlign: 'center',
  },
  modalScroll: {
    maxHeight: 300,
  },
  label: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  pickerContainer: {
    flexDirection: 'row',
    marginBottom: 20,
    justifyContent: 'space-between',
  },
  pickerItem: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  pickerItemActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderColor: '#6366f1',
  },
  pickerText: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '600',
  },
  pickerTextActive: {
    color: '#a5b4fc',
    fontWeight: '700',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  switchLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  switchDesc: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
  },
  modalButtons: {
    flexDirection: 'row',
    marginTop: 24,
    justifyContent: 'space-between',
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginHorizontal: 6,
  },
  cancelBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  cancelBtnText: {
    color: '#d1d5db',
    fontSize: 15,
    fontWeight: '700',
  },
  confirmBtn: {
    backgroundColor: '#6366f1',
  },
  confirmBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  inputLabel: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderRadius: 10,
    color: '#fff',
    fontSize: 16,
    padding: 14,
    marginBottom: 10,
  },
  inputDesc: {
    color: '#4b5563',
    fontSize: 12,
    lineHeight: 16,
  },
});
