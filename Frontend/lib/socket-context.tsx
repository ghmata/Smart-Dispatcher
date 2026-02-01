"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";
import { type Session } from "./api";
import { mergeSessions } from "./sessions-store";

interface LogEntry {
  id: string;
  timestamp: string;
  chipId: string;
  message: string;
  type: "success" | "error" | "info";
}

interface SessionChange {
  chipId: string;
  status:
    | "DISCONNECTED"
    | "QR"
    | "LOADING"
    | "SYNCING"
    | "READY"
    | "ONLINE"
    | "CONNECTING"
    | "AUTHENTICATED"
    | "ERROR";
}

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  logs: LogEntry[];
  qrCodes: Record<string, string>;
  sessionChanges: Record<string, SessionChange["status"]>;
  sessions: Session[];
  refreshSessions: () => Promise<void>;
  clearLogs: () => void;
  formatChipLabel: (session: Session) => string;
  addOptimisticSession: (session: Session) => void;
  replaceOptimisticSession: (tempId: string, session: Session) => void;
}

const SocketContext = createContext<SocketContextType | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: "init-1",
      timestamp: new Date().toLocaleTimeString("pt-BR"),
      chipId: "system",
      message: "🔄 Conectando ao monitoramento da campanha...",
      type: "info"
    }
  ]);
  const [qrCodes, setQrCodes] = useState<Record<string, string>>({});
  const [sessionChanges, setSessionChanges] = useState<
    Record<string, SessionChange["status"]>
  >({});
  const [sessions, setSessions] = useState<Session[]>([]);
  // Track processed IDs to prevent duplicates in current session
  const processedIds = useMemo(() => new Set<string>(), []);

  const addOptimisticSession = useCallback((session: Session) => {
      setSessions((prev) => [...prev, session]);
  }, []);

  const replaceOptimisticSession = useCallback((tempId: string, session: Session) => {
      setSessions((prev) => {
        const withoutTemp = prev.filter((item) => item.id !== tempId);
        const exists = withoutTemp.find((item) => item.id === session.id);
        if (exists) {
          return withoutTemp.map((item) => (item.id === session.id ? { ...item, ...session } : item));
        }
        return [...withoutTemp, session];
      });
  }, []);

  const normalizeStatus = useCallback((status: string | undefined) => {
      switch (status) {
        case "AUTHENTICATING":
          return "AUTHENTICATING";
        case "CONNECTED":
          return "SYNCING";
        case "IDLE":
          return "READY";
        case "SENDING":
        case "COOLDOWN":
          return "READY";
        case "INIT":
          return "LOADING";
        default:
          return status;
      }
  }, []);

  // Utility to format label: "chip 1 - (11) 99999-9999"
  const formatChipLabel = useCallback((session: Session) => {
      const order = session.displayOrder || 1; 
      // If phone exists, format it: 5511999999999 -> (11) 99999-9999
      let phoneLabel = "";
      if (session.phone) {
          try {
              let cleaned = session.phone.replace(/\D/g, '');
              // Fix: Inject '9' for Brazilian numbers that have it stripped (12 digits: 55 + DDD + 8 digits)
              if (cleaned.startsWith('55') && cleaned.length === 12) {
                cleaned = cleaned.slice(0, 4) + '9' + cleaned.slice(4);
              }

              if (cleaned.startsWith('55') && cleaned.length === 13) {
                  const ddd = cleaned.slice(2, 4);
                  const part1 = cleaned.slice(4, 9);
                  const part2 = cleaned.slice(9);
                  phoneLabel = ` - (${ddd}) ${part1}-${part2}`;
              } else {
                  phoneLabel = ` - ${session.phone}`;
              }
          } catch {
              phoneLabel = ` - ${session.phone}`;
          }
      } else if (
        session.status === "SYNCING" ||
        session.status === "LOADING" ||
        session.status === "QR" ||
        session.status === "CONNECTING" ||
        session.status === "AUTHENTICATED"
      ) {
          phoneLabel = " - Sincronizando...";
      }

      return `chip ${order}${phoneLabel}`;
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
        // Fetch from API
        // In a real app we might merge with pending local state, 
        // but for now API is truth + Socket updates
        
        let baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
        if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
        
        // If env var is root (http://localhost:3001) -> add /api/sessions
        // If env var is api (http://localhost:3001/api) -> add /sessions
        const url = baseUrl.endsWith('/api') ? `${baseUrl}/sessions` : `${baseUrl}/api/sessions`;
        
        const res = await fetch(url);
        const data = await res.json();
        const normalized = data.map((session: Session) => ({
          ...session,
          status: normalizeStatus(session.status) as SessionChange["status"],
        }));
        // Use mergeSessions from session-store to handle updates
        setSessions((prev) => mergeSessions(prev, normalized));

        // Restore QR codes from persistence (Fix for disappearing UI)
        const restoredQrs: Record<string, string> = {};
        normalized.forEach((s: any) => {
            if (s.qr) restoredQrs[s.id] = s.qr;
        });
        if (Object.keys(restoredQrs).length > 0) {
            setQrCodes(prev => ({ ...prev, ...restoredQrs }));
        }
    } catch (e) {
        console.error("Failed to refresh sessions", e);
    }
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  useEffect(() => {
    // Connect to Real Backend
    // Ensure we handle defaults and avoid double /api
    let baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
    
    // Normalization: Remove trailing slash
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
    
    // For Socket: must be root (remove /api if present)
    const socketUrl = baseUrl.endsWith('/api') ? baseUrl.slice(0, -4) : baseUrl;

    const socketInstance = io(socketUrl);

    socketInstance.on("connect", () => {
      setIsConnected(true);
      console.log(`[Socket] Connected to ${socketUrl}`);
      refreshSessions(); // Sync on connect
    });

    socketInstance.on("disconnect", () => {
      setIsConnected(false);
      console.log("[Socket] Disconnected");
    });

    socketInstance.on("log", (msg: string) => {
        const newLog: LogEntry = {
            id: crypto.randomUUID(),
            timestamp: new Date().toLocaleTimeString("pt-BR"),
            chipId: "system",
            message: msg,
            type: msg.includes("ERROR") ? "error" : "info"
        };
        setLogs((prev) => [...prev.slice(-99), newLog]);
    });

    socketInstance.on("qr_code", ({ chipId, qr, qrTimestamp }: { chipId: string; qr: string; qrTimestamp?: number }) => {
        console.log(`[Socket] QR received for ${chipId}`);
        setQrCodes((prev) => ({ ...prev, [chipId]: qr }));
        // Ensure session exists in list if new, and remove any OPTIMISTIC "temp_" sessions
        setSessions((prev) => {
            // Remove any temporary placeholders
            const cleanPrev = prev.filter(s => !s.id.startsWith("temp_"));
            
            if (cleanPrev.find(s => s.id === chipId)) {
              return cleanPrev.map((s) =>
                s.id === chipId ? { ...s, status: "QR", qrTimestamp } : s
              );
            }
            // Add placeholder if completely new
             return [...cleanPrev, { 
                 id: chipId, 
                 status: 'QR', 
                 displayOrder: cleanPrev.length + 1,
                 qrTimestamp
             }];
        });
    });

    // Track processed IDs to prevent duplicates in current session (Moved to top level)
    // const processedIds = useMemo(() => new Set<string>(), []); // MOVED UP -> See line 72


    // NEW: Listen for Campaign Start - Fixed Scope
    socketInstance.on("campaign_started", (payload: any) => {
         // Reset processed IDs on new campaign launch
         processedIds.clear();

         const msg = `🚀 Campanha Iniciada. Aguarde... (Total: ${payload.totalContacts || '?'} contatos)`;
         const newLog: LogEntry = {
            id: crypto.randomUUID(),
            timestamp: new Date().toLocaleTimeString("pt-BR"),
            chipId: "Campanha",
            message: msg,
            type: "info"
        };
        setLogs((prev) => [...prev.slice(-99), newLog]);
    });

    // NEW: Listen for Campaign Finish
    socketInstance.on("campaign_finished", (payload: any) => {
         const msg = `🏁 Campanha encerrada com ${payload.processed || 0} envios e ${payload.failed || 0} falhas.`;
         const newLog: LogEntry = {
            id: crypto.randomUUID(),
            timestamp: new Date().toLocaleTimeString("pt-BR"),
            chipId: "Campanha",
            message: msg,
            type: "success" // Green highlight for completion
        };
        setLogs((prev) => [...prev.slice(-99), newLog]);
    });

    // NEW: Listen for Cooldown
    socketInstance.on("cooldown_wait", (payload: any) => {
         // Use authoritative min/max from backend if available, else estimate
         const min = payload.min !== undefined ? payload.min : Math.max(0, Math.round((payload.duration || 0) / 1000) - 5);
         const max = payload.max !== undefined ? payload.max : Math.round((payload.duration || 0) / 1000) + 5;
         
         const msg = `⏳ Aguarde o cooldown de ${min} a ${max} segundos para o próximo envio...`;
         const newLog: LogEntry = {
            id: crypto.randomUUID(),
            timestamp: new Date().toLocaleTimeString("pt-BR"),
            chipId: "Campanha",
            message: msg,
            type: "info"
        };
        setLogs((prev) => [...prev.slice(-99), newLog]);
    });

    socketInstance.on("qr_code_v2", ({ chipId, qr, qrTimestamp }: { chipId: string; qr: string, qrTimestamp?: number }) => {
         console.log(`[Socket] QR v2 received for ${chipId} ts=${qrTimestamp}`);
         setQrCodes((prev) => ({ ...prev, [chipId]: qr }));
         setSessions((prev) => {
            const cleanPrev = prev.filter(s => !s.id.startsWith("temp_"));
            if (cleanPrev.find(s => s.id === chipId)) {
              return cleanPrev.map((s) =>
                s.id === chipId ? { ...s, status: "QR", qrTimestamp } : s
              );
            }
             return [...cleanPrev, { 
                 id: chipId, 
                 status: 'QR', 
                 displayOrder: cleanPrev.length + 1,
                 qrTimestamp
             }];
        });
    });
    
    // NEW: Listen to message events for the Terminal
    socketInstance.on("message_status", (payload: any) => {
        // payload: { campaignId, contactId, phone, status, error? }
        const { phone, status, error, clientMessageId } = payload;
        
        // UX Cleanup 1: Ignore intermediate technical statuses
        if (status === "SERVER_ACK" || status === "READ" || status === "PLAYED") {
             return; 
        }

        let msg = "";
        let type: LogEntry["type"] = "info";
        
        // UX Cleanup 2: Format phone number nicely
        // FALLBACK: Use "Contato Desconhecido" if phone is undefined/null
        let phoneLabel = phone || "Contato Desconhecido";
        try {
            if (phone) {
                const cleaned = phone.replace(/\D/g, '');
                if (cleaned.startsWith('55') && cleaned.length >= 12) {
                    const ddd = cleaned.slice(2, 4);
                    const part1 = cleaned.slice(4, cleaned.length - 4);
                    const part2 = cleaned.slice(-4);
                    phoneLabel = `(${ddd}) ${part1}-${part2}`;
                }
            }
        } catch (e) {}

        if (status === "SENDING") { // New status from backend for Start of Dispatch
          msg = `Mensagem sendo enviada para o n° ${phoneLabel}...`;
        } else if (status === "DELIVERED" || status === "SENT") { // Treated as Success (Soft or Hard)
          // DEDUPLICATION: Check if we already logged success for this message ID
          if (processedIds.has(clientMessageId)) {
              return; // Skip duplicate
          }
          processedIds.add(clientMessageId);

          msg = `Mensagem enviada com sucesso para o ${phoneLabel}`;
          type = "success";
        } else if (status === "FAILED") {
          msg = `Mensagem não pôde ser enviada para o número ${phoneLabel} pelo motivo de [${error || "Erro"}]`;
          type = "error";
        } else {
             return; 
        }
        
        // UX Cleanup 3: Deduplicate (don't show same status for same person twice in row)
        setLogs((prev) => {
            const lastLog = prev[prev.length - 1];
            if (lastLog && lastLog.message === msg) {
                return prev; // Ignore duplicate
            }
            
            const newLog: LogEntry = {
                id: crypto.randomUUID(),
                timestamp: new Date().toLocaleTimeString("pt-BR"),
                chipId: "Campanha", // More friendly name
                message: msg,
                type: type
            };
            return [...prev.slice(-99), newLog];
        });
    });

    socketInstance.on("session_change", ({ chipId, status }: { chipId: string; status: SessionChange["status"] }) => {
        const normalizedStatus = normalizeStatus(status) as SessionChange["status"];
        console.log(`[Socket] Session change for ${chipId}: ${normalizedStatus}`);
        setSessionChanges((prev) => ({ ...prev, [chipId]: normalizedStatus }));
        
        // Update main list status synchronously
        setSessions((prev) => {
            const exists = prev.find((s) => s.id === chipId);
            if (!exists) {
                return [
                  ...prev,
                  { id: chipId, status: normalizedStatus, displayOrder: prev.length + 1 },
                ];
            }
            return prev.map(s => s.id === chipId ? { ...s, status: normalizedStatus } : s);
        });

        if (["READY", "ONLINE", "AUTHENTICATING", "CONNECTED", "SYNCING"].includes(normalizedStatus)) {
            setQrCodes((prev) => {
                const newQrs = { ...prev };
                delete newQrs[chipId];
                return newQrs;
            });
            setTimeout(refreshSessions, 2000); // Wait a bit for backend to populate info
        }
    });

    socketInstance.on("session_deleted", ({ chipId }: { chipId: string }) => {
        console.log(`[Socket] Session deleted for ${chipId}`);
        // Remove from sessions
        setSessions(prev => prev.filter(s => s.id !== chipId));
        // Remove QR
        setQrCodes(prev => {
            const newQrs = { ...prev };
            delete newQrs[chipId];
            return newQrs;
        });
    });

    setSocket(socketInstance);

    return () => {
      socketInstance.disconnect();
    };
  }, [refreshSessions]);

  // Strictly order and index sessions for consistent UI
  const derivedSessions = useMemo(() => {
    return [...sessions]
      .sort((a, b) => {
        const timeA = parseInt(String(a.id).split('_')[1] || "0", 10);
        const timeB = parseInt(String(b.id).split('_')[1] || "0", 10);
        return timeA - timeB;
      })
      .map((s, idx) => ({ ...s, displayOrder: idx + 1 }));
  }, [sessions]);

  return (
    <SocketContext.Provider
      value={{
        socket,
        isConnected,
        logs,
        qrCodes,
        sessionChanges,
        sessions: derivedSessions,
        refreshSessions,
        clearLogs,
        formatChipLabel,
        addOptimisticSession,
        replaceOptimisticSession
      }}
    >
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error("useSocket must be used within a SocketProvider");
  }
  return context;
}
