const WhatsAppClient = require('./whatsappClient');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const pathHelper = require('../utils/pathHelper');
const FileLockHelper = require('../utils/fileLockHelper');

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.startingSessions = new Map();
    this.nextDisplayOrder = 1;
    this.isLoaded = false;
  }

  async startSession(id) {
    if (this.sessions.has(id)) {
      return this.sessions.get(id);
    }

    logger.info(`Starting session: ${id}`);
    const client = new WhatsAppClient(id);
    client.displayOrder = this.nextDisplayOrder;
    this.nextDisplayOrder += 1;
    this.sessions.set(id, client);

    // Initialize async (don't block)
    const initPromise = client.initialize().catch(err => {
      logger.error(`Failed to start session ${id}: ${err.message}`);
    }).finally(() => {
      this.startingSessions.delete(id);
    });
    this.startingSessions.set(id, initPromise);

    return client;
  }

  getSession(id) {
    return this.sessions.get(id);
  }

  getAllSessions() {
    return Array.from(this.sessions.values());
  }

  getActiveSessions() {
    return this.getAllSessions().filter(client => client.isReady());
  }

  async waitForReady({ minReady = 1, timeoutMs = 60000 } = {}) {
    const hasEnoughReady = () => this.getActiveSessions().length >= minReady;
    if (hasEnoughReady()) {
      return this.getActiveSessions();
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error(`No sessions READY after ${timeoutMs}ms (minReady=${minReady}).`));
      }, timeoutMs);

      const handleStatus = () => {
        if (hasEnoughReady()) {
          cleanup();
          resolve(this.getActiveSessions());
        }
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        this.getAllSessions().forEach(client => {
          if (client.removeListener) {
            client.removeListener('status', handleStatus);
          }
        });
      };

      this.getAllSessions().forEach(client => {
        if (client.on) {
          client.on('status', handleStatus);
        }
      });
    });
  }
  
  async stopSession(id) {
    const client = this.sessions.get(id);
    if (!client) return;
    
    // Aggressive cleanup to ensure no lingering events or file locks
    try {
      client.removeAllListeners(); // Stop api.js from reacting
      
      if (typeof client.shutdown === 'function') {
        await client.shutdown();
      }
    } catch (err) {
      logger.error(`Error destroying session ${id}: ${err.message}`);
    }
    this.sessions.delete(id);
    this.startingSessions.delete(id);
    logger.info(`Session ${id} stopped.`);
  }

  async removeSession(id) {
    const client = this.sessions.get(id); // Capture client before removing it
    const targetDir = pathHelper.resolve('data', 'sessions', `session-${id}`); // Define targetDir
    
    await this.stopSession(id);
    
    // Tiny delay to ensure Windows releases file locks
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Attempt 1: Use Provider's built-in robust cleaner (handles backups/renames)
    if (client && client.provider && typeof client.provider.clearState === 'function') {
        try {
            await client.provider.clearState();
            // If clearState succeeded, the folder is gone or renamed.
            // Check if directory still exists to confirm
            if (!fs.existsSync(targetDir)) {
                 logger.info(`Session ${id} cleared via Provider.`);
                 return true;
            }
        } catch (providerErr) {
            logger.warn(`Provider clearState failed for ${id}: ${providerErr.message}, falling back to fs.rm...`);
        }
    }

    // Attempt 2: Manual Force Delete (Fallback)
    const maxRetries = 3;
    for (let i = 0; i < maxRetries; i++) {
        try {
            if (fs.existsSync(targetDir)) {
                fs.rmSync(targetDir, { recursive: true, force: true });
                logger.info(`Session files force-deleted for ${id}`);
            }
            return true;
        } catch (error) {
            const isLastAttempt = i === maxRetries - 1;
            logger.warn(`Attempt ${i + 1}/${maxRetries} to delete ${id} failed: ${error.message}`);
            
            if (isLastAttempt) {
                logger.error(`Final failure deleting session files for ${id}: ${error.message}`);
                // Try Rename as Last Resort if Delete Fails (Windows EBUSY Trick)
                try {
                     const trashPath = pathHelper.resolve('data', 'sessions', `trash_${id}_${Date.now()}`);
                     fs.renameSync(targetDir, trashPath);
                     logger.info(`Moved locked session ${id} to trash: ${trashPath}`);
                     return true;
                } catch (renameErr) {
                     logger.error(`Rename also failed: ${renameErr.message}`);
                     return false;
                }
            }
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    return false;
  }

  async stopAllSessions() {
    logger.info('Stopping ALL sessions (Graceful Shutdown)...');
    const promises = [];
    for (const id of this.sessions.keys()) {
        promises.push(this.stopSession(id));
    }
    await Promise.allSettled(promises);
    logger.info('All sessions stopped.');
  }

  async loadSessions() {
    if (this.isLoaded) return;

    try {
        const sessionsDir = pathHelper.getSessionsDir();
        if (!fs.existsSync(sessionsDir)) return;

        const entries = fs.readdirSync(sessionsDir, { withFileTypes: true })
          .filter(entry => entry.isDirectory() && entry.name.startsWith('session-'))
          .sort((a, b) => a.name.localeCompare(b.name));
        
        for (const entry of entries) {
            const id = entry.name.replace('session-', '');
            if (this.sessions.has(id)) continue;

            const sessionDir = path.join(sessionsDir, entry.name);
            const credsPath = path.join(sessionDir, 'creds.json');
            
            // 1. Validar existência e integridade básica do creds.json
            const creds = await FileLockHelper.safeReadJson(credsPath);
            
            if (!creds) {
                const reason = !fs.existsSync(credsPath) ? 'Missing creds.json' : 'Invalid/Empty JSON';
                logger.warn(`Session ${id} is invalid (${reason}). Moving to Quarantine.`);
                
                const quarantineDir = pathHelper.resolve('data', 'sessions_quarantine', `${id}_${Date.now()}`);
                await FileLockHelper.safeMove(sessionDir, quarantineDir);
                continue;
            }

            // 2. Tentar restaurar sessão válida
            logger.info(`Found saved session: ${id}, restoring...`);
            await this.startSession(id);
        }
        this.isLoaded = true;
    } catch (error) {
        logger.error(`Error loading saved sessions: ${error.message}`);
    }
  }
}

module.exports = SessionManager;
