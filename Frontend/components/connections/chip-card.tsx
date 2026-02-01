import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Smartphone,
  Battery,
  BatteryLow,
  BatteryMedium,
  BatteryFull,
  QrCode,
  Loader2,
  User,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Session } from "@/lib/api";
import { connectSession, deleteSession } from "@/lib/api";
import { useSocket } from "@/lib/socket-context";

interface ChipCardProps {
  session: Session;
  qrCode?: string;
  onStatusChange?: (chipId: string, status: Session["status"]) => void;
}

export function ChipCard({ session, qrCode, onStatusChange }: ChipCardProps) {
  const [connecting, setConnecting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [timeLeft, setTimeLeft] = useState(60);
  const { formatChipLabel, refreshSessions } = useSocket();

  // Reset timer whenever a new QR Code arrives
  // Timer persistence logic
  useEffect(() => {
    if ((session.status === "QR" || qrCode) && session.qrTimestamp) {
        const calculateTimeLeft = () => {
            const now = Date.now();
            const elapsed = Math.floor((now - (session.qrTimestamp || now)) / 1000);
            return Math.max(0, 60 - elapsed);
        };

        setTimeLeft(calculateTimeLeft()); // Initial set

        const interval = setInterval(() => {
            const remaining = calculateTimeLeft();
            setTimeLeft(remaining);
            if (remaining <= 0) {
                clearInterval(interval);
            }
        }, 1000);
        return () => clearInterval(interval);
    } else if (qrCode && !session.qrTimestamp) {
         // Fallback if no timestamp provided (shouldn't happen with updated backend)
         setTimeLeft(60);
    }
  }, [qrCode, session.status, session.qrTimestamp]);

  const handleReconnect = async () => {
    setConnecting(true);
    try {
      await connectSession(session.id);
      onStatusChange?.(session.id, "QR");
    } catch (error) {
      console.error("[v0] Error connecting:", error);
    } finally {
      setConnecting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Tem certeza que deseja excluir este chip? Esta ação não pode ser desfeita.")) {
      return;
    }

    setDeleting(true);
    try {
      await deleteSession(session.id);
      await refreshSessions();
    } catch (error) {
      console.error("[v0] Error deleting:", error);
    } finally {
      setDeleting(false);
    }
  };

  const getBorderColor = () => {
    switch (session.status) {
      case "READY":
      case "ONLINE":
        return "border-green-500/50 hover:border-green-500";
      case "QR":
      case "LOADING":
      case "CONNECTING":
      case "AUTHENTICATED":
      case "SYNCING":
        return "border-yellow-500/50 hover:border-yellow-500";
      case "DISCONNECTED":
      case "ERROR":
        return "border-red-500/50 hover:border-red-500";
      default:
        return "border-border";
    }
  };

  const getStatusBadge = () => {
    switch (session.status) {
      case "READY":
      case "ONLINE":
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
            Online
          </Badge>
        );
      case "QR":
        return (
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
            QR Code
          </Badge>
        );
      case "LOADING":
      case "CONNECTING":
      case "AUTHENTICATED":
      case "SYNCING":
        return (
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
            Sincronizando...
          </Badge>
        );
      case "DISCONNECTED":
        return (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
            Desconectado
          </Badge>
        );
      case "ERROR":
        return (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
            Erro
          </Badge>
        );
      default:
        return null;
    }
  };

  const BatteryIcon = () => {
    if (!session.battery) return null;
    if (session.battery < 20) return <BatteryLow className="h-4 w-4 text-red-400" />;
    if (session.battery < 50) return <BatteryMedium className="h-4 w-4 text-yellow-400" />;
    return <BatteryFull className="h-4 w-4 text-green-400" />;
  };

  return (
    <Card
      className={cn(
        "border-2 bg-card/50 backdrop-blur-sm transition-all duration-300",
        getBorderColor()
      )}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
              <Smartphone className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-foreground">
                  {formatChipLabel(session)}
              </p>
              {session.name && (
                <p className="text-sm text-muted-foreground">{session.name}</p>
              )}
            </div>
          </div>
          {getStatusBadge()}
        </div>

        {!(session.status === "READY" || session.status === "ONLINE" || session.status === "ERROR") && (qrCode || session.status === "QR" || session.status === "LOADING" || session.status === "SYNCING" || session.status === "CONNECTING" || session.status === "AUTHENTICATED" || session.status === "DISCONNECTED") && (
          <div className={cn(
            "mb-4 flex flex-col items-center justify-center rounded-lg bg-white p-4 border-2 transition-all relative",
            qrCode ? "border-yellow-400/50" : "border-transparent"
          )}>
             {qrCode ? (
               <div className="flex flex-col items-center">
                  <img
                    src={qrCode || "/placeholder.svg"}
                    alt="QR Code"
                    className="h-32 w-32"
                  />
                  <div className="w-full bg-gray-100 h-1.5 mt-2 rounded-full overflow-hidden">
                       <div 
                         className="h-full bg-yellow-400 transition-all duration-1000 ease-linear"
                         style={{ width: `${(timeLeft / 60) * 100}%` }}
                       />
                  </div>
              </div>
            ) : (session.status === "SYNCING" || session.status === "AUTHENTICATING" || session.status === "CONNECTED" || session.status === "LOADING" || session.status === "CONNECTING") ? (
                <div className="flex flex-col h-32 w-32 items-center justify-center gap-2">
                     <Loader2 className="h-8 w-8 animate-spin text-yellow-500" />
                     <span className="text-xs text-yellow-600 font-semibold text-center">
                        {session.status === "AUTHENTICATING" ? "Autenticando..." : "Sincronizando..."}
                     </span>
                </div>
            ) : session.status === "DISCONNECTED" ? (
                <div className="flex flex-col h-32 w-32 items-center justify-center gap-2">
                     <Smartphone className="h-10 w-10 text-red-300" />
                     <span className="text-xs text-red-400 font-semibold text-center">Desconectado</span>
                </div>
            ) : (
              <div className="flex flex-col h-32 w-32 items-center justify-center gap-2">
                  <QrCode className="h-16 w-16 text-muted-foreground" />
              </div>
            )}
            <p className="mt-2 text-xs text-gray-600 text-center font-medium">
              {qrCode
                ? (
                    <>
                    Escaneie com o WhatsApp e aguarde<br/>
                    <span className="text-red-400 font-bold">Expira em: 00:{timeLeft.toString().padStart(2, '0')}</span>
                    </>
                )
                : (session.status === "AUTHENTICATING" || session.status === "CONNECTED" || session.status === "SYNCING" || session.status === "LOADING")
                  ? "Aguarde a conexão..."
                  : session.status === "DISCONNECTED"
                    ? "Clique em Reconectar"
                    : "Aguarde..."}
            </p>
          </div>
        )}

        {/* Online Profile Info */}
        {(session.status === "READY" || session.status === "ONLINE") && (
          <div className="mb-4 flex items-center gap-3 rounded-lg bg-secondary/50 p-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">
                {session.name || "Perfil WhatsApp"}
              </p>
              {session.battery && (
                <div className="flex items-center gap-1 mt-0.5">
                  <BatteryIcon />
                  <span className="text-xs text-muted-foreground">
                    {session.battery}%
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Actions for Disconnected/Error */}
        {(session.status === "DISCONNECTED" || session.status === "ERROR") && (
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              onClick={handleReconnect}
              disabled={connecting || deleting}
              className="w-full border-primary/20 hover:bg-primary/10 hover:text-primary"
            >
              {connecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Conectando
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Reconectar
                </>
              )}
            </Button>
            
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={connecting || deleting}
              className="w-full bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20"
            >
              {deleting ? (
                 <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Excluindo
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Excluir
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
