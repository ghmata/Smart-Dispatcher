const fs = require('fs');
const logger = require('../utils/logger');
const ExcelParser = require('../parser/excelParser');
const Dispatcher = require('../dispatch/dispatcher');
const SessionManager = require('../whatsapp/sessionManager');
const LoadBalancer = require('../whatsapp/loadBalancer');
const PathHelper = require('../utils/pathHelper');
const {
  createCampaignId,
  createContactId,
  createMessageId,
  buildCorrelationId,
  formatCorrelationTag
} = require('../utils/correlation');

class CampaignManager {
  constructor() {
    this.sessionManager = new SessionManager();
    this.loadBalancer = new LoadBalancer(this.sessionManager);
    this.dispatcher = new Dispatcher(this.loadBalancer);
    this.parser = new ExcelParser();
    this.stateFile = PathHelper.resolve('data', 'campaign_state.json');
    this.statsFile = PathHelper.resolve('data', 'daily_stats.json'); // Persistent
    this.isPaused = false;
    this.eventEmitter = null;
    this.currentState = null;
    this.messageHandlers = new Map();
  }

  /**
   * Updates daily, persistent statistics.
   * @param {string} status 'SENT' | 'DELIVERED'
   */
  _updateDailyStats(status) {
      try {
          let stats = {};
          if (fs.existsSync(this.statsFile)) {
              stats = JSON.parse(fs.readFileSync(this.statsFile, 'utf8'));
          }

          const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
          
          // Reset if new day
          if (stats.date !== today) {
              stats = { date: today, totalSent: 0, totalDelivered: 0, hourly: {} };
          }

          // Increment Counts
          if (['SENT', 'DELIVERED', 'SERVER_ACK'].includes(status)) {
              stats.totalSent = (stats.totalSent || 0) + 1;
              
              // Update Hourly
              const hour = new Date().getHours();
              const hourKey = `${hour.toString().padStart(2, '0')}:00`;
              stats.hourly = stats.hourly || {};
              stats.hourly[hourKey] = (stats.hourly[hourKey] || 0) + 1;
          }
          
          fs.writeFileSync(this.statsFile, JSON.stringify(stats, null, 2));
          return stats;
      } catch (err) {
          logger.error(`Failed to update daily stats: ${err.message}`);
          return null;
      }
  }

  /**
   * Loads daily stats (for API).
   */
  getDailyStats() {
      try {
          if (fs.existsSync(this.statsFile)) {
               const stats = JSON.parse(fs.readFileSync(this.statsFile, 'utf8'));
               const today = new Date().toISOString().split('T')[0];
               if (stats.date === today) return stats;
          }
      } catch (err) { }
      return { date: new Date().toISOString().split('T')[0], totalSent: 0, totalDelivered: 0, hourly: {} };
  }

  /**
   * Loads state from disk or creates new.
   */
  loadState() {
    if (fs.existsSync(this.stateFile)) {
      try {
        return JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      } catch (err) {
        logger.error(`Failed to load state: ${err.message}`);
      }
    }
    return {
      campaignId: null,
      processedRows: [],
      failedRows: [],
      pendingRows: [],
      messageStatus: {}
    };
  }

  saveState(state) {
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
  }

  /**
   * Checks if a campaign is effectively active (not finished)
   */
  hasActiveCampaign() {
      const state = this.currentState || this.loadState();
      // If no state or no campaignId, inactive
      if (!state || !state.campaignId) return false;
      
      // If explicitly paused, we consider it "Active but Paused" (Still occupies the slot)
      // If we want to allow overwriting paused campaigns, we'd change this.
      // But usually "Restrict to one" means "Finish the current one first".
      
      // Check completion
      // Legacy states might not have totalContacts, so fallback to logic
      const total = state.totalContacts || 0;
      const processed = state.processedRows ? state.processedRows.length : 0;
      
      // If total is 0 (legacy/start) but we have a campaignId, it's active.
      if (total === 0 && state.pendingRows?.length > 0) return true; // Legacy queue check
      if (total > 0 && processed < total) return true;
      
      return false;
  }

  /**
   * Initializes connections.
   */
  async initialize() {
    logger.info('Initializing Campaign Manager...');
    await this.sessionManager.loadSessions();
    this._attachMessageHandlers();
  }

  /**
   * Resumes an active campaign if one exists.
   */
  async resumeCampaign() {
      if (!this.hasActiveCampaign()) {
          logger.info('Resume: No active campaign to resume.');
          return false;
      }

      const state = this.currentState || this.loadState();
      logger.info(`Resume: Resuming campaign ${state.campaignId}...`);

      if (!state.config || !state.config.excelPath) {
          logger.error('Resume: Valid configuration not found in state. Cannot resume.');
          return false;
      }

      const { messageTemplate, excelPath, originalFilename, delayConfig } = state.config;

      // Ensure file exists
      if (!fs.existsSync(excelPath)) {
          logger.error(`Resume: Input file not found at ${excelPath}. Cannot resume.`);
          return false;
      }

      // Re-trigger startCampaign (it will detect existing state/processedRows and skip them)
      try {
        // Find last successful message for logging
        let lastSuccessPhone = 'N/A';
        if (state.messageStatus) {
            const successes = Object.values(state.messageStatus)
                .filter(m => ['SENT', 'DELIVERED', 'READ', 'PLAYED'].includes(m.status))
                .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)); // Newest first
            
        if (successes.length > 0) {
            lastSuccessPhone = successes[0].phone;
        }
    }

    const warnMsg = `⚠️ Houve uma interrupção abrupta. Continuaremos de onde parou.`;
    const infoMsg = `A última mensagem enviada com sucesso foi para o n° ${lastSuccessPhone}. Continuaremos a partir desse número.`;

    logger.warn(warnMsg);
    logger.info(infoMsg);
    
    // Emit to Frontend
    this._emitEvent('log', warnMsg);
    this._emitEvent('log', infoMsg);

    await this.startCampaign(excelPath, messageTemplate, originalFilename, {
        campaignId: state.campaignId, // Vital: Pass same ID to trigger resume logic
        delayMin: delayConfig?.delayMin,
        delayMax: delayConfig?.delayMax
    });
        return true;
      } catch (err) {
          logger.error(`Resume Failed: ${err.message}`);
          return false;
      }
  }
    


  /**
   * Starts or Resumes a campaign.
   * @param {string} excelPath 
   * @param {string} messageTemplate 
   */
  async startCampaign(excelPath, messageTemplate, originalFilename, options = {}) {
    const campaignId = options.campaignId || createCampaignId();
    const delayConfig = {
      minDelay: options.delayMin,
      maxDelay: options.delayMax
    };
    let state = this.loadState();
    
    // NEW: Check if we are starting a fresh campaign with a different ID
    if (state.campaignId && state.campaignId !== campaignId) {
        logger.info(`Switching Campaign: ${state.campaignId} -> ${campaignId}. Resetting state.`);
        state = {
            campaignId: campaignId,
            totalContacts: 0,
            processedRows: [],
            failedRows: [],
            pendingRows: [],
            messageStatus: {},
            // Persist Context for Resume
            config: {
                messageTemplate,
                excelPath,
                originalFilename,
                delayConfig
            }
        };
    }

    state.campaignId = campaignId;
    // Ensure config is updated if restarting with same ID (edge case) but usually new ID.
    state.config = { messageTemplate, excelPath, originalFilename, delayConfig };

    this.currentState = state;
    
    // 1. Parse Excel
    const parseResult = await this.parser.parse(excelPath, originalFilename);
    if (parseResult.errors.length > 0) {
      logger.warn(`Found ${parseResult.errors.length} formatting errors in Excel. Check logs.`);
    }

    const allContacts = parseResult.contacts;
    state.totalContacts = allContacts.length; // Store total
    this.saveState(state); // Persist totals immediately
    
    // 2. Filter already processed
    const toProcess = allContacts.filter(c => !state.processedRows.includes(c.row));
    this._emitEvent('campaign_started', {
      campaignId,
      totalContacts: allContacts.length,
      remaining: toProcess.length
    });
    logger.info(`${formatCorrelationTag(campaignId)} Starting campaign. Total: ${allContacts.length}, Remaining: ${toProcess.length}`);

    // NEW: Wait for Active Sessions (Race Condition Fix)
    // Only wait if we actually have things to process
    if (toProcess.length > 0) {
        logger.info("Waiting for active sessions to be READY...");
        try {
            await this.sessionManager.waitForReady({ minReady: 1, timeoutMs: 120000 }); // Wait up to 2 mins
            logger.info("Active session detected. Starting dispatch...");
        } catch (err) {
            logger.error(`Campaign Aborted: ${err.message}`);
            this._emitEvent('log', `[ERROR] Cancelado: Nenhuma conexão ativa encontrada em 2 minutos.`);
            return { campaignId, error: err.message };
        }
    }

    // 3. Process Loop
    this.isPaused = false; // Ensure unpaused
    for (const contact of toProcess) {
       if (this.isPaused) {
         logger.info('Campaign PAUSED.');
         break;
       }

       let contactId, clientMessageId, correlationId, correlationTag;
       
       try {
         contactId = createContactId(contact.row);
         clientMessageId = createMessageId();
         correlationId = buildCorrelationId({
           campaignId,
           contactId,
           messageId: clientMessageId
         });
         correlationTag = formatCorrelationTag(correlationId);

         const variables = {
           nome: contact.name,
           telefone: contact.phone,
           ...contact
         };

         // EMIT SENDING (Start Progress)
         this._emitEvent('message_status', {
           campaignId,
           contactId,
           clientMessageId,
           correlationId,
           status: 'SENDING',
           phone: contact.phone
         });

         const result = await this.dispatcher.dispatch({
           phone: contact.phone,
           messageTemplate,
           variables,
           correlation: {
             campaignId,
             contactId,
             clientMessageId,
             correlationId
           },
           delayConfig
         });

         state.messageStatus[clientMessageId] = {
           campaignId,
           contactId,
           phone: contact.phone,
           status: result.status,
           updatedAt: new Date().toISOString()
         };

         this._emitEvent('message_status', {
           campaignId,
           contactId,
           clientMessageId,
           correlationId,
           status: result.status,
           phone: contact.phone
         });
         
         // Accept SENT (Soft Success) OR DELIVERED (Hard Success)
         if (result.status === 'DELIVERED' || result.status === 'SENT') {
            state.processedRows.push(contact.row);
            logger.info(`${correlationTag} Row ${contact.row} SUCCESS (${result.status}) -> ${contact.phone}`);
            
            // Persist state immediately to update UI/API visibility
            this.saveState(state);
            this._updateDailyStats(result.status); // Update Daily Stats Persistently
            
            // Force Queue Update on Frontend
            this._emitEvent('queue_update', {
                current: state.processedRows.length,
                total: state.totalContacts
            });
            
             // NEW: Emit Cooldown Event if not the last item
             const isLastItem = toProcess.indexOf(contact) === toProcess.length - 1;
             
             if (!isLastItem && result.delays && result.delays.wait > 0) {
                 this._emitEvent('cooldown_wait', {
                     campaignId,
                     duration: result.delays.wait,
                     // Pass configured range in SECONDS for UI 
                     // (delayConfig is in ms from API, so we divide by 1000)
                     min: delayConfig.minDelay ? Math.round(delayConfig.minDelay / 1000) : undefined,
                     max: delayConfig.maxDelay ? Math.round(delayConfig.maxDelay / 1000) : undefined
                 });
             }
         }
       } catch (err) {
         const contactId = createContactId(contact.row);
         logger.error(`${formatCorrelationTag(buildCorrelationId({ campaignId, contactId }))} Failed Row ${contact.row} (${contact.phone}): ${err.message}`);
          state.failedRows.push({ row: contact.row, error: err.message });
          
          // CRITICAL FIX: Record failure in messageStatus for Dashboard accuracy
          if (clientMessageId) {
             state.messageStatus[clientMessageId] = {
               campaignId,
               contactId,
               phone: contact.phone,
               status: 'FAILED',
               error: err.message,
               updatedAt: new Date().toISOString()
             };
             
             // Emit FAILED event for Frontend Log Terminal
             this._emitEvent('message_status', {
                campaignId,
                contactId,
                clientMessageId,
                correlationId: correlationTag, // simplified
                status: 'FAILED',
                phone: contact.phone,
                error: err.message
             });
          }

          // We might mark as processed to skip next time, or keep to retry. 
          // For now, let's mark processed so we don't loop forever on bad numbers.
          state.processedRows.push(contact.row); 
       }

       // Save state after each step for resilience
       this.saveState(state);
    }

    this._emitEvent('campaign_finished', {
      campaignId,
      processed: state.processedRows.length,
      failed: state.failedRows.length
    });
    logger.info(`${formatCorrelationTag(campaignId)} Campaign execution finished or paused.`);
    return { campaignId };
  }

  setEventEmitter(emitter) {
    this.eventEmitter = emitter;
  }

  _emitEvent(event, payload) {
    if (this.eventEmitter && typeof this.eventEmitter.emit === 'function') {
      this.eventEmitter.emit(event, payload);
    }
  }

  _attachMessageHandlers() {
    this.sessionManager.getAllSessions().forEach((client) => {
      this.registerSessionClient(client);
    });
  }

  registerSessionClient(client) {
    if (!client || this.messageHandlers.has(client.id)) {
      return;
    }

    const handler = (update) => {
      const key = update.clientMessageId || update.messageId;
      if (key && this.currentState?.messageStatus?.[key]) {
        this.currentState.messageStatus[key] = {
          ...this.currentState.messageStatus[key],
          status: update.status,
          updatedAt: new Date().toISOString()
        };
        this.saveState(this.currentState);
      }
      this._emitEvent('message_status', update);
    };

    client.on('message_status', handler);
    this.messageHandlers.set(client.id, handler);
  }
}

module.exports = CampaignManager;
