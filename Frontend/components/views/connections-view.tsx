"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChipCard } from "@/components/connections/chip-card";
import { getSessions, createSession, type Session } from "@/lib/api";
import { useSocket } from "@/lib/socket-context";
import { Plus, Loader2, RefreshCw } from "lucide-react";

export function ConnectionsView() {
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const {
    qrCodes,
    sessions,
    refreshSessions,
    addOptimisticSession,
    replaceOptimisticSession,
  } = useSocket();

  // Load sessions on mount (sync with backend)
  useEffect(() => {
    setLoading(true);
    refreshSessions().finally(() => setLoading(false));
  }, [refreshSessions]);

  // Strict Creation Rule: Can only add if ALL existing chips are ONLINE
  const canAddChip = sessions.length === 0 || sessions.every((s) => s.status === "READY" || s.status === "ONLINE");

  const handleAddChip = async () => {
    if (!canAddChip) return;
    
    // ... [existing logic] ...
    // Optimistic UI: Show card immediately
    const tempId = `temp_${Date.now()}`;
    addOptimisticSession({
        id: tempId,
        status: "LOADING",
        displayOrder: sessions.length + 1,
        name: "Gerando Novo Chip..."
    });

    setCreating(true);
    try {
      const response = await createSession();
      if (response?.id) {
        replaceOptimisticSession(tempId, {
          id: response.id,
          status: (response.status as Session["status"]) ?? "LOADING",
          displayOrder: sessions.length + 1,
          name: "Gerando Novo Chip...",
        });
      }
    } catch (error) {
      console.error("[v0] Error creating session:", error);
      // TODO: Remove optimistic session on error if needed, 
      // but usually refreshSessions() will clean it up next time
    } finally {
      setCreating(false);
    }
  };

  const connectedCount = sessions.filter((s) => {
    const status = s.status?.toUpperCase();
    return ["READY", "ONLINE", "IDLE", "SENDING", "COOLDOWN"].includes(status || "");
  }).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">
            Gerenciador de Chips
          </h2>
          <p className="text-sm text-muted-foreground">
            {connectedCount} de {sessions.length} chips conectados
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshSessions()}
            disabled={loading}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          
          <div className="flex flex-col items-end">
            <Button
                onClick={handleAddChip}
                disabled={creating || !canAddChip}
                className="bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50"
                title={!canAddChip ? "Todos os chips anteriores devem estar Online" : ""}
            >
                {creating ? (
                <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Criando...
                </>
                ) : (
                <>
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar Novo Chip
                </>
                )}
            </Button>
            {!canAddChip && (
                <span className="text-[10px] text-red-400 mt-1">
                    Conecte os chips anteriores primeiro
                </span>
            )}
          </div>
        </div>
      </div>

      {loading && sessions.length === 0 ? (
        <div className="flex h-[50vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex h-[50vh] flex-col items-center justify-center gap-4">
          <p className="text-muted-foreground">Nenhum chip cadastrado</p>
          <Button onClick={handleAddChip} disabled={creating || !canAddChip}>
            <Plus className="mr-2 h-4 w-4" />
            Adicionar Primeiro Chip
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sessions
            .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
            .map((session) => (
            <ChipCard
              key={session.id}
              session={session}
              qrCode={qrCodes[session.id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
