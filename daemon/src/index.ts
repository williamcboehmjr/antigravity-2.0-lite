import * as admin from 'firebase-admin';
import * as chokidar from 'chokidar';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

dotenv.config();

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH || 'service-account.json';
const brainPath = process.env.ANTIGRAVITY_BRAIN_PATH || path.join(process.env.HOME || '', '.gemini/antigravity/brain');
const projectsPath = process.env.ANTIGRAVITY_PROJECTS_PATH || path.join(process.env.HOME || '', 'Documents/antigravity');

console.log('--- Antigravity Sync Daemon Starting ---');
console.log(`Watching brain directory: ${brainPath}`);
console.log(`Projects workspace: ${projectsPath}`);
console.log(`Service Account Key: ${serviceAccountPath}`);

// Initialize Firebase Admin
try {
  const serviceAccount = require(path.resolve(serviceAccountPath));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} catch (error) {
  console.error('FATAL: Could not initialize Firebase Admin. Please verify service-account.json path.');
  console.error(error);
  process.exit(1);
}

const db = admin.firestore();

// ----------------------------------------------------
// 1. Heartbeat System
// ----------------------------------------------------
function startHeartbeat() {
  const statusRef = db.collection('status').doc('mac_daemon');
  
  const updateHeartbeat = async () => {
    try {
      await statusRef.set({
        heartbeat: admin.firestore.FieldValue.serverTimestamp(),
        status: 'online',
        last_checked: new Date().toISOString()
      }, { merge: true });
      console.log(`[Heartbeat] Ping sent at ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      console.error('[Heartbeat] Error updating heartbeat:', err);
    }
  };

  // Run immediately and then every 30s
  updateHeartbeat();
  return setInterval(updateHeartbeat, 30000);
}

// Set daemon status offline on graceful shutdown
async function handleShutdown() {
  console.log('\nShutting down daemon...');
  clearInterval(heartbeatInterval);
  try {
    await db.collection('status').doc('mac_daemon').set({
      status: 'offline',
      heartbeat: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    console.log('Daemon status set to offline.');
  } catch (err) {
    console.error('Error setting offline status during shutdown:', err);
  }
  process.exit(0);
}

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

const heartbeatInterval = startHeartbeat();

// ----------------------------------------------------
// 2. Directory Watcher & Sync to Firestore
// ----------------------------------------------------
// Map to throttle multiple fast writes to the same transcript
const syncTimeoutMap = new Map<string, NodeJS.Timeout>();

function watchBrain() {
  // Watch all transcript.jsonl files under brain/
  const watcher = chokidar.watch(path.join(brainPath, '**/transcript.jsonl'), {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100
    }
  });

  const handleFile = (filePath: string) => {
    // Extract conversationId from path: .../brain/<conversationId>/.system_generated/logs/transcript.jsonl
    const parts = filePath.split(path.sep);
    // Find index of 'brain' and get the next directory name
    const brainIdx = parts.indexOf('brain');
    if (brainIdx === -1 || brainIdx + 1 >= parts.length) return;
    const conversationId = parts[brainIdx + 1];

    console.log(`[Watcher] Event triggered for conversation: ${conversationId}`);
    
    // Throttle sync to avoid flooding Firebase on successive line additions
    if (syncTimeoutMap.has(conversationId)) {
      clearTimeout(syncTimeoutMap.get(conversationId)!);
    }
    
    const timeout = setTimeout(() => {
      syncConversation(conversationId, filePath);
      syncTimeoutMap.delete(conversationId);
    }, 1500);

    syncTimeoutMap.set(conversationId, timeout);
  };

  watcher.on('add', handleFile);
  watcher.on('change', handleFile);

  watcher.on('error', (error) => {
    console.error('[Watcher] Watcher error:', error);
  });

  console.log('[Watcher] File watcher initialized.');
}

async function syncConversation(conversationId: string, filePath: string) {
  try {
    console.log(`[Sync] Syncing conversation: ${conversationId}`);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    
    const parsedMessages = lines.map((line, idx) => {
      try {
        const obj = JSON.parse(line);
        return {
          index: idx,
          step_index: obj.step_index ?? idx,
          source: obj.source || 'SYSTEM',
          type: obj.type || 'LOG',
          content: obj.content || '',
          timestamp: obj.timestamp || new Date().toISOString(),
          status: obj.status || ''
        };
      } catch {
        return {
          index: idx,
          step_index: idx,
          source: 'SYSTEM',
          type: 'ERROR',
          content: `Failed to parse log line: ${line}`,
          timestamp: new Date().toISOString(),
          status: 'ERROR'
        };
      }
    });

    // Check metadata like task title or plan status in sibling files
    const parentDir = path.dirname(path.dirname(path.dirname(filePath))); // up to brain/<conversationId>
    let title = conversationId;
    
    try {
      const taskPath = path.join(parentDir, 'task.md');
      if (fs.existsSync(taskPath)) {
        const firstLine = fs.readFileSync(taskPath, 'utf8').split('\n')[0];
        if (firstLine.startsWith('# ')) {
          title = firstLine.replace('# ', '').trim();
        }
      }
    } catch (e) {
      // ignore
    }

    // Write to Firestore (save messages directly as an array on the conversation document)
    await db.collection('conversations').doc(conversationId).set({
      conversationId,
      title,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
      messageCount: parsedMessages.length,
      messages: parsedMessages
    }, { merge: true });

    console.log(`[Sync] Successfully synced ${parsedMessages.length} messages on document for ${conversationId}`);
  } catch (error) {
    console.error(`[Sync] Error syncing conversation ${conversationId}:`, error);
  }
}

watchBrain();

// ----------------------------------------------------
// 3. Command Listener System
// ----------------------------------------------------
function listenForCommands() {
  console.log('[Command Listener] Listening for incoming phone commands...');
  
  db.collection('commands')
    .where('status', '==', 'pending')
    .orderBy('created_at', 'asc')
    .onSnapshot(async (snapshot) => {
      if (snapshot.empty) return;

      for (const change of snapshot.docChanges()) {
        if (change.type === 'added') {
          const doc = change.doc;
          const commandData = doc.data();
          const commandId = doc.id;
          
          console.log(`[Command Listener] Received command: ${commandData.command} (${commandId})`);
          
          // Set status to processing
          await doc.ref.update({
            status: 'processing',
            started_at: admin.firestore.FieldValue.serverTimestamp()
          });

          try {
            await executeCommand(commandData.command, commandData.args, doc.ref);
          } catch (err: any) {
            console.error(`[Command Listener] Execution failed for command ${commandId}:`, err);
            await doc.ref.update({
              status: 'failed',
              error: err.message || 'Unknown execution error',
              ended_at: admin.firestore.FieldValue.serverTimestamp()
            });
          }
        }
      }
    }, (error) => {
      console.error('[Command Listener] Snapshot listener error:', error);
    });
}

async function executeCommand(command: string, args: any, docRef: admin.firestore.DocumentReference) {
  switch (command) {
    case 'new_project': {
      const projectName = args.name;
      if (!projectName) throw new Error('Missing project name in args');
      
      const newProjectPath = path.join(projectsPath, projectName);
      console.log(`[Command: New Project] Creating workspace at: ${newProjectPath}`);
      
      if (fs.existsSync(newProjectPath)) {
        throw new Error(`Directory already exists: ${newProjectPath}`);
      }

      fs.mkdirSync(newProjectPath, { recursive: true });
      
      // Optionally write some boilerplate or initialize git
      exec('git init', { cwd: newProjectPath }, (error) => {
        if (error) console.error('[Command: New Project] Git init failed:', error);
      });

      await docRef.update({
        status: 'completed',
        result: { path: newProjectPath },
        ended_at: admin.firestore.FieldValue.serverTimestamp()
      });
      break;
    }
    
    case 'send_message': {
      const { conversationId, messageContent } = args;
      if (!conversationId || !messageContent) {
        throw new Error('Missing conversationId or messageContent');
      }

      console.log(`[Command: Send Message] Writing user input for conversation: ${conversationId}`);
      
      // Antigravity watches conversation transcripts or system pipes to receive user input.
      // Since Antigravity takes user input via the host IDE / CLI agent shell, we can append a user message block
      // to the transcript.jsonl file so the active agent processes it.
      // Format of USER_INPUT: {"step_index": X, "source": "USER_EXPLICIT", "type": "USER_INPUT", "content": "message", "timestamp": "...", "status": "DONE"}
      const transcriptPath = path.join(brainPath, conversationId, '.system_generated', 'logs', 'transcript.jsonl');
      
      if (!fs.existsSync(transcriptPath)) {
        throw new Error(`Conversation file not found at: ${transcriptPath}`);
      }

      const content = fs.readFileSync(transcriptPath, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      const nextIndex = lines.length;

      const userLogLine = {
        step_index: nextIndex,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        content: messageContent,
        timestamp: new Date().toISOString(),
        status: 'DONE'
      };

      // Append to local log
      fs.appendFileSync(transcriptPath, '\n' + JSON.stringify(userLogLine));
      console.log(`[Command: Send Message] Appended message to ${transcriptPath}`);

      await docRef.update({
        status: 'completed',
        ended_at: admin.firestore.FieldValue.serverTimestamp()
      });
      break;
    }

    case 'change_settings': {
      // Modify Antigravity settings configuration on disk
      const { modelSelection, turboMode, autoImplement } = args;
      console.log('[Command: Change Settings] Modifying Antigravity global options:', args);
      
      const configPath = path.join(path.dirname(brainPath), 'settings.json'); // Adjust to actual settings.json location
      
      let config: any = {};
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
      
      if (modelSelection !== undefined) config.modelSelection = modelSelection;
      if (turboMode !== undefined) config.turboMode = turboMode;
      if (autoImplement !== undefined) config.autoImplement = autoImplement;

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(`[Command: Change Settings] Wrote updated settings to: ${configPath}`);

      await docRef.update({
        status: 'completed',
        ended_at: admin.firestore.FieldValue.serverTimestamp()
      });
      break;
    }

    default:
      throw new Error(`Unknown command type: ${command}`);
  }
}

listenForCommands();
