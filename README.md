# Antigravity 2.0 Lite 🌌

Antigravity 2.0 Lite is a mobile companion app and synchronization system designed to let you control, monitor, and chat with your local **Antigravity AI coding agent** directly from your Android device.

Whether you are away from your desk or lounging on the couch, Antigravity 2.0 Lite syncs your conversation history, lets you start new coding projects, toggle **Turbo Mode**, and trigger **Auto-Implement Plan** remotely.

---

## Architecture Overview

The system consists of three main components:
1. **The Cloud Relay (Firebase)**: A free Firebase project acting as the real-time broker between your phone and your computer.
2. **Mac Sync Daemon (Node.js)**: A background service running on your Mac that watches local conversation files (`transcript.jsonl`), uploads them to Firestore, and listens for phone commands.
3. **Mobile App (React Native/Expo)**: A dark-themed, premium Android app that displays chats (with full markdown and code block support), tracks daemon heartbeats, and sends control commands.

---

## Quick Setup Guide (For Your AI Agent!)

This project is built to be **fully self-assembling**. If you are using an AI agent (like Antigravity) to manage your workspace, you can simply copy and paste the prompt below to have it set up the entire system for you:

### 🤖 Copy-Paste Setup Prompt:
```text
I want to set up the Antigravity 2.0 Lite Sync Daemon on this Mac. Please:
1. Inspect the `/daemon` folder in this workspace.
2. Install the Node.js dependencies (`npm install`).
3. Set up the local `.env` configuration file using `.env.example` as a template.
4. Ensure the TypeScript code compiles successfully using `npm run build`.
5. Guide me on where to place the Firebase `service-account.json` credential file.
6. Provide instructions to run the daemon in the background.
```

---

## Manual Installation Guide

If you prefer to configure the components manually:

### 1. Firebase Project Setup
1. Go to the [Firebase Console](https://console.firebase.google.com/) and create a new project.
2. Enable **Cloud Firestore** and select your database region.
3. Deploy the security rules defined in `firestore.rules` (which restrict all database access strictly to your authenticated email).
4. Register a **Web App** in your Firebase project settings to obtain your API configuration keys.
5. Enable **Google Authentication** (or Anonymous Sign-In) under *Authentication > Sign-in method*.

### 2. Mac Sync Daemon Configuration
1. Navigate into the `daemon` folder:
   ```bash
   cd daemon
   npm install
   ```
2. Create a `.env` file from the template:
   ```bash
   cp .env.example .env
   ```
   Open `.env` and fill in the paths for your local Antigravity brain and workspace folders.
3. Download your Google Service Account credential key JSON from the Firebase Settings Console.
4. Rename this file to `service-account.json` and save it inside the `/daemon` directory.
5. Compile and run the daemon:
   ```bash
   npm run build
   npm start
   ```

### 3. Android Client Configuration
1. Navigate into the `mobile` folder:
   ```bash
   cd mobile
   npm install
   ```
2. Create a `.env` file matching `.env.example` and input your Firebase Web App credentials:
   ```bash
   EXPO_PUBLIC_FIREBASE_API_KEY=your-api-key
   ...
   ```
3. Boot up the app on your phone or emulator:
   ```bash
   npx expo start
   ```

---

## Security & Sanitization
* All API keys, credential paths, and personal directory locations are stored strictly in ignored `.env` and `.json` files.
* Firestore Security Rules enforce authentication constraints so that only the authenticated project owner can read or write data to the Firestore databases.
