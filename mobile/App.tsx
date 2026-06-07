import React, { useState, useEffect } from 'react';
import { StyleSheet, View, ActivityIndicator } from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './src/config/firebase';
import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import ChatScreen from './src/screens/ChatScreen';

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [initializing, setInitializing] = useState(true);
  
  // Navigation states
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  const [activeConvoTitle, setActiveConvoTitle] = useState<string>('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (usr) => {
      setUser(usr);
      if (initializing) setInitializing(false);
    });

    return () => unsubscribe();
  }, [initializing]);

  if (initializing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  // Simple routing engine
  return (
    <View style={styles.container}>
      {!user ? (
        <LoginScreen onLoginSuccess={() => {}} />
      ) : activeConvoId ? (
        <ChatScreen 
          conversationId={activeConvoId} 
          title={activeConvoTitle} 
          onBack={() => setActiveConvoId(null)} 
        />
      ) : (
        <DashboardScreen 
          onSelectConversation={(id, title) => {
            setActiveConvoId(id);
            setActiveConvoTitle(title);
          }} 
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#030712',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#030712',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
