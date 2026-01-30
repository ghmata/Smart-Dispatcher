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
    campaignManager.setEventEmitter(this.io);

    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocket();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
  }

  setupRoutes() {
    // GET /api/status - System Health & Stats
    this.app.get('/api/status', (req, res) => {
        const state = campaignManager.loadState();
        const messageStatus = state.messageStatus || {};
        codex/execute-correction-plan-with-best-practices-2skxaa
        const sentStatuses = new Set(['SERVER_ACK', 'SENT', 'DELIVERED', 'READ', 'PLAYED']);
        const deliveredStatuses = new Set(['DELIVERED', 'READ', 'PLAYED']);
        const totalSent = Object.values(messageStatus).filter((msg) => sentStatuses.has(msg.status)).length;
        const delivered = Object.values(messageStatus).filter((msg) => deliveredStatuses.has(msg.status)).length;
=======
        const totalSent = Object.values(messageStatus).filter((msg) => msg.status === 'SERVER_ACK').length;
        const delivered = Object.values(messageStatus).filter((msg) => msg.status === 'DELIVERED').length;
         const deliveryRate = totalSent ? Number(((delivered / totalSent) * 100).toFixed(1)) : 0;
        res.json({
            active_campaigns: campaignManager.isPaused ? 0 : (fs.existsSync(campaignManager.stateFile) ? 1 : 0),
            total_sent: totalSent,
            delivery_rate: deliveryRate,
            queue_current: 0,
            queue_total: 0
        });
    });

    // GET /api/sessions - List Chips
    this.app.get('/api/sessions', async (req, res) => {
        const sessionsMap = campaignManager.sessionManager.sessions || new Map();
        const sortedSessions = Array.from(sessionsMap.values()).sort((a, b) => {
            const timeA = parseInt(String(a.id).split('_')[1] || a.displayOrder || 0, 10) || 0;
            const timeB = parseInt(String(b.id).split('_')[1] || b.displayOrder || 0, 10) || 0;
            return timeA - timeB || (a.displayOrder || 0) - (b.displayOrder || 0);
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
                name: s.getDisplayName ? s.getDisplayName() : (s.client?.info?.pushname || null),
                phone: s.getPhoneNumber ? s.getPhoneNumber() : null,
                battery: 100,
                displayOrder: s.displayOrder || index + 1,
                qr: qrDataUrl
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
        
        // Check if already ready/authenticated (for restored sessions)
        if (waClient.status === 'READY') {
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
            try {
                const dataUrl = await QRCode.toDataURL(qr);
                socketIo.emit('qr_code', { chipId: id, qr: dataUrl });
            } catch (err) {
                logger.error(`QR Generation Error: ${err.message}`);
            }
        });

        waClient.on('status', ({ status }) => {
          logger.info(`[Socket] Emitting ${status} for ${id}`);
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

    // POST /api/campaign/start - Start Dispatch
    this.app.post('/api/campaign/start', this.upload.single('file'), async (req, res) => {
        try {
            const { message, delayMin, delayMax } = req.body;
            const file = req.file;

            if (!file) throw new Error('No file uploaded');

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
        
        // Initial State Push
        socket.emit('log', '[SYSTEM] Connected to Backend API');

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
  }
}

// Start Server if run directly
if (require.main === module) {
    const api = new ApiServer();
    api.start();
}

module.exports = ApiServer;
