const express = require('express');
const QRCode = require('qrcode');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const logger = require('../modules/utils/logger');
const CampaignManager = require('../modules/campaign/campaignManager');
const PathHelper = require('../modules/utils/pathHelper');
const { createCampaignId } = require('../modules/utils/correlation');

// --- SINGLETONS ---
// In a real app, we might use dependency injection, but here we instantiate singletons.
// const sessionManager = new SessionManager(); // Removed unused instance
const campaignManager = new CampaignManager(); 
// Note: CampaignManager internally creates its own SessionManager. 
// For this simple architecture, we will share instances or rely on file-system state.
// Ideally, CampaignManager should accept a sessionManager instance.
// Let's patch CampaignManager runtime to use our shared sessionManager if needed, 
// or just use campaignManager's internal one for Simplicity. 
// BETTER: Let's use campaignManager's sessionManager to ensure consistency.

class ApiServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: "*", // Allow all for dev (localhost:3000)
        methods: ["GET", "POST"]
      }
    });

    this.upload = multer({ dest: PathHelper.resolve('data', 'uploads') });
    this.port = 3001;
    this.logHistory = []; // Buffer for startup logs

    // Custom Emitter Adapter to capture logs before sending to socket
    const eventAdapter = {
        emit: (event, ...args) => {
            this.io.emit(event, ...args); // Pass through to real socket
            if (event === 'log') {
               // args[0] is the message
               this._addToLogHistory(args[0]);
            }
        }
    };
    campaignManager.setEventEmitter(eventAdapter);

    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocket();

    // Auto-Resume Campaign if active
    campaignManager.initialize().then(async () => {
        const resumed = await campaignManager.resumeCampaign();
        if (resumed) {
            logger.info('System: Auto-resumed interrupted campaign.');
        } else {
            logger.info('System: No interrupted campaign to resume.');
        }
    }).catch(err => {
        logger.error(`System: Resume Check Failed: ${err.message}`);
    });
  }

  _addToLogHistory(msg) {
      this.logHistory.push(msg);
      if (this.logHistory.length > 50) {
          this.logHistory.shift(); // Keep last 50
      }
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
  }

  setupRoutes() {
        // GET /api/status - System Health & Stats
    this.app.get('/api/status', (req, res) => {
        // Read from Memory first (Real-time), fallback to Disk
        const state = campaignManager.currentState || campaignManager.loadState();
        const messageStatus = state.messageStatus || {};
        
        // NEW: Get Persistent Daily Stats
        const dailyStats = campaignManager.getDailyStats();

        // Calculate Delivery Rate based on Daily Stats if available, else fallback
        // Since we don't track failure/delivery separately efficiently in simple stats yet, 
        // let's assume totalSent in stats is what we want.
        // For delivery_rate, we might need to track failures in stats.json too?
        // My simple implementation tracked 'totalSent' (for SENT/DELIVERED). 
        // It didn't track Attempts vs Failures.
        // Let's stick to campaign-specific delivery rate OR update stats to track attempts?
        // User asked for "Total Enviado Hoje" (Total Sent Today).
        
        const totalSent = dailyStats.totalSent; // Persistent
        
        // Use current campaign for delivery rate for now, or 100% if totalSent > 0
        // (Improving this later if needed)
        const deliveryRate = totalSent > 0 ? 100 : 0; 

        // Queue Calculation
        // "Fila de Envio": Processed / Total
        const totalRows = state.totalContacts || 0;
        const processedCount = state.processedRows ? state.processedRows.length : 0;

        res.json({
            active_campaigns: campaignManager.hasActiveCampaign() ? 1 : 0,
            total_sent: totalSent,
            delivery_rate: deliveryRate,
            queue_current: processedCount,  // "Já foram lidos"
            queue_total: totalRows          // "Serão lidos"
        });
    });

    // NEW: GET /api/dashboard/hourly - Analytics
    this.app.get('/api/dashboard/hourly', (req, res) => {
        try {
            const dailyStats = campaignManager.getDailyStats();
            const hourlyCounts = dailyStats.hourly || {};
            
            // Generate full 24h keys for today (00:00 to 23:00)
            // Or just last 24h? User request says "Últimas 24h".
            // Since stats.json resets daily, we only have "Today's hours".
            // We will return 00:00 to 23:00 for the current day.
            
            const chartData = [];
            for (let i = 0; i < 24; i++) {
                const hourKey = `${String(i).padStart(2, '0')}:00`;
                chartData.push({
                    hour: hourKey,
                    sent: hourlyCounts[hourKey] || 0
                });
            }

            res.json(chartData);
        } catch (e) {
            logger.error(`Dashboard Analytics Error: ${e.message}`);
            res.status(500).json([]);
        }
    });


    // GET /api/sessions - List Chips
    this.app.get('/api/sessions', async (req, res) => {
        const sessionsMap = campaignManager.sessionManager.sessions || new Map();
        const sortedSessions = Array.from(sessionsMap.values()).sort((a, b) => {
            const timeA = parseInt(String(a.id).split('_')[1] || 0, 10);
            const timeB = parseInt(String(b.id).split('_')[1] || 0, 10);
            return timeA - timeB;
        });

        const sessionList = await Promise.all(sortedSessions.map(async (s, index) => {
            let qrDataUrl = null;
            if (s.lastQr) {
                try {
                    qrDataUrl = await QRCode.toDataURL(s.lastQr);
                } catch (e) {
                    logger.debug(`QR toDataURL failed for ${s.id}: ${e.message}`);
                }
            }
            return {
                id: s.id,
                status: s.status,
                name: s.getDisplayName(),
                phone: s.getPhoneNumber(),
                battery: 100,
                displayOrder: index + 1, // Dynamic ordering
                qr: qrDataUrl,
                qrTimestamp: s.qrTimestamp || null
            };
        }));
        res.json(sessionList);
    });

    // Helper to attach Socket listeners to a client
    this.attachClientListeners = (waClient) => {
        if (!waClient) return;
        const id = waClient.id;
        const socketIo = this.io;
        campaignManager.registerSessionClient(waClient);

        // Clean up previous listeners to avoid duplicates if any (simple approach)
        // In a full implementation we'd track listeners, but for now we assume fresh attach
        // REMOVED removeAllListeners to avoid breaking internal WhatsAppClient logic!
        
        // Helper to clear existing timeout
        const clearQrTimeout = () => {
            if (waClient.qrTimeout) {
                clearTimeout(waClient.qrTimeout);
                waClient.qrTimeout = null;
            }
        };

        // Check if already ready/authenticated (for restored sessions)
        if (waClient.status === 'READY') {
          clearQrTimeout();
          setTimeout(() => {
            socketIo.emit('session_change', { chipId: id, status: 'READY' });
          }, 500);
        } else if (waClient.status === 'AUTHENTICATING') {
          setTimeout(() => {
            socketIo.emit('session_change', { chipId: id, status: 'SYNCING' });
          }, 500);
        }

        waClient.on('qr', async (qr) => {
            logger.info(`[Socket] Emitting QR for ${id}`);
            
            // Only start the destruction timer ONCE (on the first QR)
            // Do NOT reset it when Baileys rotates the QR key (every ~20s)
            if (!waClient.qrTimeout) {
                if (!waClient.qrTimestamp) {
                    waClient.qrTimestamp = Date.now();
                }
                
                logger.info(`[${id}] Starting 60s Auto-Destroy Timer.`);
                waClient.qrTimeout = setTimeout(async () => {
                    logger.info(`[${id}] QR Timeout (60s) - Auto-destroying session.`);
                    try {
                        // removeSession handles shutdown and file deletion robustly now
                        await campaignManager.sessionManager.removeSession(id);
                        socketIo.emit('session_deleted', { chipId: id });
                        logger.info(`[${id}] Auto-destroyed successfully.`);
                    } catch (err) {
                        logger.error(`[${id}] Failed to auto-destroy: ${err.message}`);
                    }
                }, 60000);
            }

            try {
                const dataUrl = await QRCode.toDataURL(qr);
                socketIo.emit('qr_code', { 
                    chipId: id, 
                    qr: dataUrl,
                    qrTimestamp: waClient.qrTimestamp 
                });
            } catch (err) {
                logger.error(`QR Generation Error: ${err.message}`);
            }
        });

        waClient.on('status', ({ status }) => {
          logger.info(`[Socket] Emitting ${status} for ${id}`);
          
          // If status indicates connection success, clear the timeout
           if (["READY", "ONLINE", "AUTHENTICATING", "CONNECTED"].includes(status)) {
             clearQrTimeout();
             waClient.qrTimestamp = null;
          }
          
          socketIo.emit('session_change', { chipId: id, status });
        });
    };

    // POST /api/session/new - Create new Chip
    this.app.post('/api/session/new', async (req, res) => {
        try {
            const id = `chip_${Date.now()}`;
            const waClient = await campaignManager.sessionManager.startSession(id); 

            if (waClient) {
                this.attachClientListeners(waClient);
            }

            res.json({ success: true, id, status: 'LOADING' });
            this.io.emit('session_change', { chipId: id, status: 'LOADING' });

        } catch (e) {
            logger.error(`API Create Session Error: ${e.message}`);
            res.status(500).json({ error: e.message });
        }
    });

    // POST /api/session/:id/connect - Reconnect existing Chip
    this.app.post('/api/session/:id/connect', async (req, res) => {
        try {
            const { id } = req.params;
            const waClient = campaignManager.sessionManager.getSession(id);

            if (!waClient) {
                return res.status(404).json({ error: 'Session not found' });
            }

            // If already ready, just return success
            if (waClient.status === 'READY' || waClient.status === 'ONLINE') {
                 return res.json({ success: true, status: waClient.status });
            }

            // If broken (ERROR/DISCONNECTED), clear auth data to force fresh QR
            if (waClient.status === 'ERROR' || waClient.status === 'DISCONNECTED') {
                logger.info(`API: Clearing auth data for broken session ${id}`);
                try {
                    // We need to stop the socket first to release file locks
                    await waClient.shutdown(); 
                    
                    // Wait 3s for Windows to release file locks
                    await new Promise(resolve => setTimeout(resolve, 3000));

                    // Prefer provider method if available
                    if (waClient.provider && typeof waClient.provider.clearState === 'function') {
                        await waClient.provider.clearState();
                    } else {
                        // Manual fallback with CORRECT path
                        const pathHelper = require('../modules/utils/pathHelper');
                        const fs = require('fs');
                        
                        // Correctly resolve: ROOT/data/sessions/session-{id}
                        const targetDir = pathHelper.resolve('data', 'sessions', `session-${id}`);
                        
                        logger.info(`API: Manual clearing target: ${targetDir}`);
                        
                        if (fs.existsSync(targetDir)) {
                             fs.rmSync(targetDir, { recursive: true, force: true });
                             logger.info(`API: Manually deleted ${targetDir}`);
                        }
                    }
                } catch (cleanupErr) {
                    logger.warn(`Failed to clear auth data: ${cleanupErr.message}`);
                }
            }

            // Force re-initialization
            logger.info(`API: Reconnecting session ${id}`);
            await waClient.initialize();
            
            // Ensure listeners are attached (idempotent-ish)
            this.attachClientListeners(waClient);

            res.json({ success: true, status: 'CONNECTING' });

        } catch (e) {
            logger.error(`API Reconnect Session Error: ${e.message}`);
            res.status(500).json({ error: e.message });
        }
    });

    // DELETE /api/session/:id - Delete Chip
    this.app.delete('/api/session/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const waClient = campaignManager.sessionManager.getSession(id);

            // waClient shutdown is handled inside removeSession
            // if (waClient) { await waClient.shutdown(); }
            
            // Remove from manager
            const deleted = await campaignManager.sessionManager.removeSession(id);
            if (!deleted) {
                 return res.status(404).json({ error: 'Session not found or could not be removed' });
            }

            logger.info(`API: Deleted session ${id}`);
            res.json({ success: true });

        } catch (e) {
            logger.error(`API Delete Session Error: ${e.message}`);
            res.status(500).json({ error: e.message });
        }
    });

    // POST /api/campaign/start - Start Dispatch
    this.app.post('/api/campaign/start', this.upload.single('file'), async (req, res) => {
        try {
            const { message, delayMin, delayMax } = req.body;
            const file = req.file;

            if (!file) throw new Error('No file uploaded');

            // NEW: Restrict to one campaign at a time
            if (campaignManager.hasActiveCampaign()) {
                throw new Error('Já existe uma campanha em andamento. Aguarde o término ou limpe a campanha atual.');
            }

            // Move file to permanent location if needed, or parse directly
            logger.info(`API: Starting campaign with ${file.originalname}`);
            const campaignId = createCampaignId();
            const delayMinMs = Number.isFinite(Number(delayMin)) ? Number(delayMin) * 1000 : undefined;
            const delayMaxMs = Number.isFinite(Number(delayMax)) ? Number(delayMax) * 1000 : undefined;

            // Async start (Fire and Forget)
            campaignManager.initialize().then(() => {
                return campaignManager.startCampaign(file.path, message, file.originalname, {
                  campaignId,
                  delayMin: delayMinMs,
                  delayMax: delayMaxMs
                });
            }).catch(err => {
                logger.error(`Campaign Background Error: ${err.message}`);
                this.io.emit('log', `[ERROR] Campaign Failed: ${err.message}`);
            });

            res.json({ success: true, message: 'Campaign started in background', campaignId });

        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
  }

  setupSocket() {
    this.io.on('connection', (socket) => {
        logger.info(`Frontend connected: ${socket.id}`);
        
        // Flush Log History so user sees startup messages
        this.logHistory.forEach(msg => socket.emit('log', msg));
        
        // Initial State Push (if empty history, show generic)
        if (this.logHistory.length === 0) {
             socket.emit('log', 'Sistema Funcionando');
        }

        socket.on('disconnect', () => {
            logger.info(`Frontend disconnected: ${socket.id}`);
        });
    });

    // Hook into Logger to stream logs to frontend
    // We can add a transport to Winston, or just Monkey Patch for now
    // Let's add a transport in a cleaner way later, 
    // for MVP -> Monkey Patch logger.info/error
    // Hook into Logger to stream logs to frontend
    // DISABLED FOR STABILITY: Monkey patching logic caused crash.
    // We will rely on explicit socket emits for critical events.
    
    /*
    const originalInfo = logger.info.bind(logger);
    logger.info = (msg, meta) => {
        originalInfo(msg, meta);
        this.io.emit('log', `[INFO] ${msg}`);
    };

    const originalError = logger.error.bind(logger);
    logger.error = (msg, meta) => {
        originalError(msg, meta);
        this.io.emit('log', `[ERROR] ${msg}`);
    };
    */

    // Hook into SessionManager events?
    // We need to listen to 'qr' events from whatsapp clients.
    // This requires refactoring SessionManager to emit global events 
    // or attaching listeners when we create sessions.
    // For Day 5, we'll assume basic log streaming covers visibility.
  }

  start() {
    this.server.listen(this.port, async () => {
        logger.info(`API Server running on http://localhost:${this.port}`);
        
        // Load saved sessions after server starts
        await campaignManager.sessionManager.loadSessions();
        
        // Attach listeners to restored sessions
        const restoredSessions = campaignManager.sessionManager.getAllSessions();
        if (restoredSessions.length > 0) {
            logger.info(`Attaching listeners to ${restoredSessions.length} restored sessions.`);
            restoredSessions.forEach(client => {
                this.attachClientListeners(client);
            });
        }
    });

    // Global Error Handlers to prevent crash loops
    process.on('uncaughtException', (err) => {
        logger.error(`UNCAUGHT EXCEPTION: ${err.message}`);
        // In production, we should exit, but for dev we might log and keep alive if minor
        // process.exit(1); 
    });

    process.on('unhandledRejection', (reason, promise) => {
        logger.error(`UNHANDLED REJECTION: ${reason}`);
    });

    // Graceful Shutdown
    const gracefulShutdown = async (signal) => {
        logger.info(`${signal} received. Starting graceful shutdown...`);
        try {
            await campaignManager.sessionManager.stopAllSessions();
            logger.info('Graceful shutdown completed. Exiting.');
            process.exit(0);
        } catch (err) {
            logger.error(`Error during graceful shutdown: ${err.message}`);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  }
}

// Start Server if run directly
if (require.main === module) {
    const api = new ApiServer();
    api.start();
}

module.exports = ApiServer;
