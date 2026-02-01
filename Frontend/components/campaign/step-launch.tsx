"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Rocket,
  FileSpreadsheet,
  MessageSquare,
  Clock,
  CheckCircle,
  Loader2,
  Pencil,
} from "lucide-react";

interface StepLaunchProps {
  file: File | null;
  message: string;
  delayMin: number;
  delayMax: number;
  onLaunch: () => void;
  launching: boolean;
  onEditStep: (stepId: number) => void;
}

export function StepLaunch({
  file,
  message,
  delayMin,
  delayMax,
  onLaunch,
  launching,
  onEditStep,
}: StepLaunchProps) {
  const isReady = file && message.trim().length > 0;

  const summaryItems = [
    {
      icon: FileSpreadsheet,
      label: "Arquivo de Leads",
      value: file?.name ?? "Nenhum arquivo selecionado",
      valid: !!file,
      stepId: 1,
    },
    {
      icon: MessageSquare,
      label: "Mensagem",
      value: message
        ? `${message.slice(0, 50)}${message.length > 50 ? "..." : ""}`
        : "Nenhuma mensagem",
      valid: message.trim().length > 0,
       stepId: 2,
    },
    {
      icon: Clock,
      label: "Intervalo de Envio",
      value: `${delayMin}s - ${delayMax}s`,
      valid: true,
      stepId: 3,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground">
          Iniciar Campanha
        </h3>
        <p className="text-sm text-muted-foreground">
          Revise as configurações e inicie sua campanha.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="space-y-3">
        {summaryItems.map((item) => {
          const Icon = item.icon;
          return (
            <Card
              key={item.label}
              className={`border ${
                item.valid ? "border-border" : "border-destructive/50"
              } bg-card/50`}
            >
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                      item.valid ? "bg-primary/10" : "bg-destructive/10"
                    }`}
                  >
                    <Icon
                      className={`h-5 w-5 ${
                        item.valid ? "text-primary" : "text-destructive"
                      }`}
                    />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{item.label}</p>
                    <p className="font-medium text-foreground">{item.value}</p>
                  </div>
                </div>
                
                 <div className="flex items-center gap-2">
                    {item.valid && <CheckCircle className="h-5 w-5 text-green-400" />}
                    <Button
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-muted-foreground hover:text-primary"
                        onClick={() => onEditStep(item.stepId)}
                    >
                        <Pencil className="h-4 w-4" />
                    </Button>
                 </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Launch Button */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-6 flex flex-col items-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/20 mb-4">
            <Rocket className="h-8 w-8 text-primary" />
          </div>
          <p className="text-center text-muted-foreground mb-6 max-w-md">
            Ao clicar em iniciar, a campanha começará imediatamente. Você poderá
            acompanhar o progresso no Dashboard.
          </p>
          <Button
            size="lg"
            onClick={onLaunch}
            disabled={!isReady || launching}
            className="w-full max-w-xs bg-primary hover:bg-primary/90 text-primary-foreground h-12 text-base"
          >
            {launching ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Iniciando Campanha...
              </>
            ) : (
              <>
                <Rocket className="mr-2 h-5 w-5" />
                Iniciar Campanha
              </>
            )}
          </Button>
          {!isReady && (
            <p className="text-sm text-destructive mt-3">
              Preencha todos os campos obrigatórios para continuar.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
