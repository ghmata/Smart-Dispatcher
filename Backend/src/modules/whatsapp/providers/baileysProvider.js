const P = require('pino');
const logger = require('../../utils/logger');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  jidNormalizedUser
} = require('@whiskeysockets/baileys');

const pathHelper = require('../../utils/pathHelper');
const WhatsAppProvider = require('./whatsAppProvider');
const FileLockHelper = require('../../utils/fileLockHelper');
const path = require('path');


class BaileysProvider extends WhatsAppProvider {
  constructor(id, options = {}) {
    super(id);
    this.socket = null;
    this.options = options;
    this.disconnectReason = null;
  }

  async initialize() {
    const sessionDir = pathHelper.ensureDir(
      pathHelper.resolve('data', 'sessions', `session-${this.id}`)
    );
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    this.socket = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
      logger: P({ level: 'silent' }),
      browser: ['SmartDispatcher', 'Chrome', '1.0.0'],
      syncFullHistory: false
    });

    this.socket.ev.on('creds.update', saveCreds);
    this.socket.ev.on('connection.update', (update) => {
      if (update.lastDisconnect?.error) {
        const statusCode = update.lastDisconnect.error?.output?.statusCode;
        this.disconnectReason = statusCode;
      }
      if (update.qr) {
        this.emit('qr', update.qr);
      }
      this.emit('connection.update', update);
    });
    this.socket.ev.on('creds.update', () => {
      this.emit('creds.update');
    });

    this.socket.ev.on('messages.update', (updates) => {
      updates.forEach((update) => {
        const messageId = update.key?.id;
        const status = update.update?.status;
        if (!messageId || typeof status === 'undefined') {
          return;
        }
        const mapped = this._mapReceiptStatus(status);
        if (mapped) {
          this.emit('message.status', {
            messageId,
            status: mapped,
            timestamp: Date.now()
          });
        }
      });
    });
  }

  getDisconnectReason() {
    return this.disconnectReason;
  }

  async validateNumber(rawNumber) {
    if (!this.socket) {
      throw new Error('Provider not initialized');
    }
    const normalized = this._normalizeNumber(rawNumber);
    const constructedJid = jidNormalizedUser(`${normalized}@s.whatsapp.net`);
    
    const result = await this.socket.onWhatsApp(constructedJid);

    if (result && result[0] && result[0].exists) {
      const correctJid = result[0].jid;
      if (correctJid !== constructedJid) {
        logger.info(`[FIX] JID corrigido de ${constructedJid} para ${correctJid}`);
      }
      return { jid: correctJid, exists: true };
    }

    return { jid: constructedJid, exists: false };
  }

  async sendMessage(jid, message) {
    if (!this.socket) {
      throw new Error('Provider not initialized');
    }
    return this.socket.sendMessage(jid, { text: message });
  }

  async getPersistedSessionInfo() {
    try {
        const sessionDir = pathHelper.resolve('data', 'sessions', `session-${this.id}`);
        const credsPath = path.join(sessionDir, 'creds.json');
        
        const creds = await FileLockHelper.safeReadJson(credsPath);
        if (creds && creds.me) {
            return {
                id: jidNormalizedUser(creds.me.id).split('@')[0],
                name: creds.me.name
            };
        }
    } catch (e) {
        // Ignore errors, just fallback
    }
    return null;
  }

  getPhoneNumber() {
    const id = this.socket?.user?.id;
    if (id) return jidNormalizedUser(id).split('@')[0];
    return null; 
  }

  getDisplayName() {
    return this.socket?.user?.name || this.socket?.user?.verifiedName || null;
  }

  async destroy() {
    if (this.socket) {
        logger.info(`[BaileysProvider] Destroying session ${this.id}...`);
        try {
            // 1. SILENCE EVERYONE
            if (this.socket.ev) {
                this.socket.ev.removeAllListeners();
            }

            // 2. HARD KILL (Scorched Earth)
            // preventing any graceful close handshakes that might trigger writes
            if (this.socket.ws && typeof this.socket.ws.terminate === 'function') {
                this.socket.ws.terminate();
            } else if (this.socket.end) {
                this.socket.end(new Error('Session killed'));
            } else if (this.socket.logout) {
                // Last resort
                await this.socket.logout();
            }
            
            this.socket = null;
            logger.info(`[BaileysProvider] Session ${this.id} killed (Hard/Safe).`);
        } catch (err) {
            logger.error(`[BaileysProvider] Destroy error: ${err.message}`);
        }
    }
  }

  isLoggedOut() {
    return this.disconnectReason === DisconnectReason.loggedOut;
  }

  _normalizeNumber(rawNumber) {
    const digits = String(rawNumber || '').replace(/\D/g, '');
    if (!digits) {
      throw new Error('Invalid phone number');
    }
    return digits;
  }

  _mapReceiptStatus(status) {
    const mapping = {
      1: 'SENT',
      2: 'SERVER_ACK',
      3: 'DELIVERED',
      4: 'READ',
      5: 'PLAYED'
    };
    return mapping[status] || null;
  }
  async clearState() {
    const fs = require('fs');
    const path = require('path');
    const sessionDir = pathHelper.resolve('data', 'sessions', `session-${this.id}`);
    
    console.log(`[BaileysProvider] Clearing state at: ${sessionDir}`);
    
    if (!fs.existsSync(sessionDir)) {
         console.log(`[BaileysProvider] Directory already missing: ${sessionDir}`);
         return;
    }

    const deleteFolderRecursive = (dirPath, retries = 3) => {
        if (fs.existsSync(dirPath)) {
            const files = fs.readdirSync(dirPath);
            for (const file of files) {
                const curPath = path.join(dirPath, file);
                if (fs.lstatSync(curPath).isDirectory()) {
                    deleteFolderRecursive(curPath);
                } else {
                    try {
                        fs.unlinkSync(curPath);
                    } catch (err) {
                        console.error(`[BaileysProvider] Failed to delete file ${file}: ${err.message}`);
                    }
                }
            }
            // Try to remove the dir itself
            try {
                fs.rmdirSync(dirPath);
            } catch (err) {
                 if (retries > 0) {
                     console.log(`[BaileysProvider] Retrying dir delete... ${retries}`);
                     const start = Date.now();
                     while (Date.now() - start < 500); // sync sleep 500ms
                     deleteFolderRecursive(dirPath, retries - 1);
                 } else {
                    console.error(`[BaileysProvider] FAILED to remove dir: ${err.message}`);
                 }
            }
        }
    };

    try {
        deleteFolderRecursive(sessionDir);
        
        // Final Verification
        if (fs.existsSync(sessionDir)) {
             const remaining = fs.readdirSync(sessionDir);
             console.error(`[BaileysProvider] CRITICAL: Directory still exists with ${remaining.length} files. Force Renaming...`);
             try {
                const trashDir = pathHelper.resolve('data', 'sessions', `trash-${this.id}-${Date.now()}`);
                fs.renameSync(sessionDir, trashDir);
                console.log(`[BaileysProvider] Moved locked session to trash: ${trashDir}`);
             } catch(renameErr) {
                console.error(`[BaileysProvider] Rename failed: ${renameErr.message}`);
             }
        } else {
             console.log(`[BaileysProvider] Cleared state for ${this.id} (Verified)`);
        }
    } catch (e) {
        console.error(`[BaileysProvider] General Clean Error: ${e.message}`);
    }
  }
}

module.exports = BaileysProvider;
