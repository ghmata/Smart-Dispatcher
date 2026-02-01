const EventEmitter = require('events');
const qrcode = require('qrcode-terminal');
const config = require('../../../config.json');
const logger = require('../utils/logger');

const STATES = {
  INIT: 'INIT',
  AUTHENTICATING: 'AUTHENTICATING',
  CONNECTED: 'CONNECTED',
  READY: 'READY',
  IDLE: 'IDLE',
  SENDING: 'SENDING',
  COOLDOWN: 'COOLDOWN',
  DISCONNECTED: 'DISCONNECTED',
  ERROR: 'ERROR'
};

class WhatsAppClient extends EventEmitter {
  constructor(id, options = {}) {
    super();
    this.id = id;
    this.status = STATES.INIT;
    this.lastStatusChangeAt = Date.now();
    this.lastQr = null;
    this.cooldownUntil = null;
    this.sendHistory = [];
    this.reconnectAttempts = 0;
    this.idleTimer = null;
    this.idleTimer = null;
    this.messageTracker = new Map();
    this.persistedInfo = null; // Store info read from disk

    this.complianceConfig = {
      maxMessagesPerHour: config.compliance.maxMessagesPerHour || 50,
      maxMessagesPerDay: config.compliance.maxMessagesPerDay || 300,
      minDelay: config.compliance.minDelay || 30000,
      maxDelay: config.compliance.maxDelay || 90000,
      ...options.complianceConfig
    };

    this.maxReconnects = options.maxReconnects || 5;
    this.provider = options.provider || this._buildDefaultProvider(options.providerOptions);
    this._bindProviderEvents();
  }

  _buildDefaultProvider(providerOptions) {
    // Lazy require to avoid loading Baileys in unit tests that inject a mock provider.
    // eslint-disable-next-line global-require
    const BaileysProvider = require('./providers/baileysProvider');
    return new BaileysProvider(this.id, providerOptions);
  }

  _bindProviderEvents() {
    this.provider.on('qr', (qr) => {
      this.lastQr = qr;
      this._transition(STATES.AUTHENTICATING, 'qr_received');
      logger.info(`[${this.id}] QR Code received. Please scan.`);
      qrcode.generate(qr, { small: true });
      this.emit('qr', qr);
    });

    this.provider.on('creds.update', () => {
      logger.info(`[${this.id}] Credentials updated.`);
    });

    this.provider.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === 'open') {
        this.reconnectAttempts = 0;
        this.lastQr = null; // Clear QR on success
        this._transition(STATES.CONNECTED, 'connection_open');
        this._transition(STATES.READY, 'ready');
        this._scheduleIdle();
      }

      if (connection === 'close') {
        const reason = lastDisconnect?.error?.output?.statusCode;
        // If 401 (Logged Out), go to DISCONNECTED/ERROR.
        // For 515 (Restart) or others, go to AUTHENTICATING to keep "Syncing" UI.
        const nextState = (reason === 401 || reason === 403) ? STATES.DISCONNECTED : STATES.AUTHENTICATING;
        
        this._transition(nextState, `connection_close:${reason || 'unknown'}`);
        this._handleReconnect(reason);
      }
    });

    this.provider.on('message.status', (update) => {
      const tracked = this.messageTracker.get(update.messageId);
      const payload = {
        ...tracked,
        ...update,
        chipId: this.id
      };
      this.emit('message_status', payload);
    });
  }

  async _handleReconnect(reason) {
    if (this.provider.isLoggedOut && this.provider.isLoggedOut()) {
      this._transition(STATES.DISCONNECTED, 'logged_out');
      logger.error(`[${this.id}] Logged out. Session invalidated.`);
      
      // AUTO-CLEANUP: Clear invalid auth data immediately
      if (typeof this.provider.clearState === 'function') {
        try {
          await this.provider.clearState();
          logger.info(`[${this.id}] Auto-cleaned invalid session data.`);
        } catch (e) {
          logger.error(`[${this.id}] Failed to auto-clean session: ${e.message}`);
        }
      }
      return;
    }

    this.reconnectAttempts += 1;
    if (this.reconnectAttempts > this.maxReconnects) {
      this._transition(STATES.ERROR, 'reconnect_exceeded');
      logger.error(`[${this.id}] Reconnect attempts exceeded. Blocking sends.`);
      return;
    }

    const jitter = this._randomDelay(5000, 15000);
    logger.warn(`[${this.id}] Reconnecting in ${jitter}ms (attempt ${this.reconnectAttempts}).`);
    setTimeout(() => {
      this.initialize().catch((error) => {
        logger.error(`[${this.id}] Reconnect failed: ${error.message}`);
      });
    }, jitter);
  }

  _transition(nextState, reason = 'manual') {
    if (this.status === nextState) return;

    const allowed = {
      [STATES.INIT]: [STATES.AUTHENTICATING, STATES.ERROR],
      [STATES.AUTHENTICATING]: [STATES.CONNECTED, STATES.ERROR, STATES.DISCONNECTED],
      [STATES.CONNECTED]: [STATES.READY, STATES.ERROR, STATES.DISCONNECTED, STATES.AUTHENTICATING],
      [STATES.READY]: [STATES.SENDING, STATES.IDLE, STATES.COOLDOWN, STATES.ERROR, STATES.DISCONNECTED, STATES.AUTHENTICATING],
      [STATES.IDLE]: [STATES.READY, STATES.SENDING, STATES.COOLDOWN, STATES.ERROR, STATES.DISCONNECTED, STATES.AUTHENTICATING],
      [STATES.SENDING]: [STATES.COOLDOWN, STATES.READY, STATES.ERROR, STATES.DISCONNECTED],
      [STATES.COOLDOWN]: [STATES.READY, STATES.IDLE, STATES.ERROR, STATES.DISCONNECTED],
      [STATES.DISCONNECTED]: [STATES.AUTHENTICATING, STATES.ERROR],
      [STATES.ERROR]: [STATES.AUTHENTICATING, STATES.DISCONNECTED]
    };

    if (!allowed[this.status]?.includes(nextState)) {
      logger.warn(`[${this.id}] Invalid transition ${this.status} -> ${nextState} (${reason}).`);
      this.status = STATES.ERROR;
      this.lastStatusChangeAt = Date.now();
      this.emit('status', { id: this.id, status: this.status, reason: 'invalid_transition' });
      return;
    }

    const previous = this.status;
    this.status = nextState;
    this.lastStatusChangeAt = Date.now();
    logger.info(`[${this.id}] State change ${previous} -> ${nextState} (${reason}).`);
    this.emit('status', { id: this.id, status: nextState, reason });
  }

  _scheduleIdle() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      if (this.status === STATES.READY) {
        this._transition(STATES.IDLE, 'idle_timeout');
      }
    }, 15000);
  }

  _randomDelay(min, max) {
    return Math.floor(min + Math.random() * (max - min));
  }

  async initialize() {
    logger.info(`[${this.id}] Initializing...`);
    
    // Load persisted info first for visibility
    if (this.provider.getPersistedSessionInfo) {
        this.persistedInfo = await this.provider.getPersistedSessionInfo();
    }

    this._transition(STATES.AUTHENTICATING, 'initialize');
    try {
      await this.provider.initialize();
    } catch (error) {
      logger.error(`[${this.id}] Init error: ${error.message}`);
      this._transition(STATES.ERROR, 'init_error');
    }
  }

  waitUntilReady({ timeoutMs = 60000 } = {}) {
    if (this.status === STATES.READY || this.status === STATES.IDLE) {
      return Promise.resolve(true);
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.removeListener('status', handleStatus);
        reject(new Error(`Client ${this.id} did not reach READY within ${timeoutMs}ms`));
      }, timeoutMs);

      const handleStatus = ({ status }) => {
        if (status === STATES.READY || status === STATES.IDLE) {
          clearTimeout(timeoutId);
          this.removeListener('status', handleStatus);
          resolve(true);
        }
      };

      this.on('status', handleStatus);
    });
  }

  async sendMessage(rawNumber, message, correlation = {}) {
    if (this.status === STATES.IDLE) {
      this._transition(STATES.READY, 'send_prepare');
    }

    if (this.status !== STATES.READY) {
      const error = new Error(`Client ${this.id} is not ready (Status: ${this.status})`);
      logger.warn(`[${this.id}] Send blocked: ${error.message}`);
      throw error;
    }

    this._enforceCooldown();
    this._enforceRateLimit();

    this._transition(STATES.SENDING, 'send_attempt');
    logger.info(`[${this.id}] Sending attempt to ${rawNumber}.`);

    try {
      const { jid, exists } = await this.provider.validateNumber(rawNumber);
      if (!exists) {
        this._transition(STATES.ERROR, 'number_not_registered');
        throw new Error(`Number ${rawNumber} is not registered on WhatsApp`);
      }

      // STRICT JID USAGE: Use the verified JID from onWhatsApp, not the user input
      const result = await this.provider.sendMessage(jid, message);
      const messageId = result?.key?.id || result?.key?.id;
      const remoteJid = jid; // Always use the validated JID

      if (messageId) {
        this.messageTracker.set(messageId, {
          ...correlation,
          phone: rawNumber,
          jid: remoteJid,
          sentAt: Date.now()
        });
        this.emit('message_status', {
          ...correlation,
          messageId,
          jid: remoteJid,
          status: 'SERVER_ACK',
          phone: rawNumber,
          chipId: this.id
        });
      }
      this._registerSend();
      this._transition(STATES.READY, 'send_success');
      this._scheduleIdle();
      logger.info(`[${this.id}] Message sent to ${jid}.`);
      return { messageId, jid: remoteJid, providerResult: result };
    } catch (error) {
      this._transition(STATES.ERROR, 'send_failure');
      if (correlation && Object.keys(correlation).length > 0) {
        this.emit('message_status', {
          ...correlation,
          status: 'FAILED',
          phone: rawNumber,
          chipId: this.id,
          error: error.message
        });
      }
      logger.error(`[${this.id}] Send error: ${error.message}`);
      throw error;
    }
  }

  _enforceCooldown() {
    if (!this.cooldownUntil) return;
    const now = Date.now();
    if (now < this.cooldownUntil) {
      const remaining = this.cooldownUntil - now;
      this._transition(STATES.COOLDOWN, 'cooldown_active');
      logger.warn(`[${this.id}] Cooldown active for ${remaining}ms. Blocking send.`);
      throw new Error(`Cooldown active (${remaining}ms remaining)`);
    }
    this.cooldownUntil = null;
    if (this.status === STATES.COOLDOWN) {
      this._transition(STATES.READY, 'cooldown_complete');
    }
  }

  _enforceRateLimit() {
    const now = Date.now();
    const hourWindow = now - 60 * 60 * 1000;
    const dayWindow = now - 24 * 60 * 60 * 1000;

    this.sendHistory = this.sendHistory.filter((ts) => ts >= dayWindow);
    const hourlyCount = this.sendHistory.filter((ts) => ts >= hourWindow).length;
    const dailyCount = this.sendHistory.length;

    if (hourlyCount >= this.complianceConfig.maxMessagesPerHour) {
      const oldest = this.sendHistory.filter((ts) => ts >= hourWindow)[0];
      const nextAllowed = oldest + 60 * 60 * 1000;
      this._setCooldownUntil(nextAllowed, 'rate_limit_hour');
      throw new Error('Hourly rate limit reached');
    }

    if (dailyCount >= this.complianceConfig.maxMessagesPerDay) {
      const oldest = this.sendHistory[0];
      const nextAllowed = oldest + 24 * 60 * 60 * 1000;
      this._setCooldownUntil(nextAllowed, 'rate_limit_day');
      throw new Error('Daily rate limit reached');
    }
  }

  _setCooldownUntil(timestamp, reason) {
    const jitter = this._randomDelay(3000, 12000);
    this.cooldownUntil = timestamp + jitter;
    this._transition(STATES.COOLDOWN, reason);
    logger.warn(`[${this.id}] Cooldown engaged until ${new Date(this.cooldownUntil).toISOString()} (${reason}).`);
  }

  _registerSend() {
    this.sendHistory.push(Date.now());
  }

  async enterCooldown(durationMs, reason = 'post_send_cooldown') {
    if (!durationMs) return;
    const now = Date.now();
    this.cooldownUntil = Math.max(this.cooldownUntil || 0, now + durationMs);
    this._transition(STATES.COOLDOWN, reason);
    logger.info(`[${this.id}] Cooldown for ${durationMs}ms (${reason}).`);
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    if (this.status === STATES.COOLDOWN) {
      this._transition(STATES.READY, 'cooldown_complete');
      this._scheduleIdle();
    }
  }

  isReady() {
    return this.status === STATES.READY || this.status === STATES.IDLE;
  }

  getPhoneNumber() {
    return this.provider.getPhoneNumber() || this.persistedInfo?.id || null;
  }

  getDisplayName() {
    return this.provider.getDisplayName() || this.persistedInfo?.name || null;
  }

  async waitForDelivery(messageId, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Delivery Timed Out'));
      }, timeoutMs);

      const statusListener = (update) => {
        if (update.messageId === messageId && this._isDelivered(update.status)) {
          cleanup();
          resolve(true);
        }
      };

      const connectionListener = ({ status }) => {
        if (status === STATES.DISCONNECTED || status === STATES.ERROR) {
          cleanup();
          reject(new Error('Connection dropped during delivery wait'));
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.removeListener('message_status', statusListener);
        this.removeListener('status', connectionListener);
      };

      this.on('message_status', statusListener);
      this.on('status', connectionListener);
    });
  }

  _isDelivered(status) {
    return ['DELIVERED', 'READ', 'PLAYED'].includes(status);
  }

  async shutdown() {
    try {
      await this.provider.destroy();
    } catch (error) {
      logger.error(`[${this.id}] Shutdown error: ${error.message}`);
    }
    this._transition(STATES.DISCONNECTED, 'shutdown');
  }
}

module.exports = WhatsAppClient;
