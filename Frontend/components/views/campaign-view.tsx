"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StepUpload } from "@/components/campaign/step-upload";
import { StepMessage } from "@/components/campaign/step-message";
import { StepConfig } from "@/components/campaign/step-config";
import { StepLaunch } from "@/components/campaign/step-launch";
import { startCampaign, getStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useEffect } from "react";
import {
  Upload,
  MessageSquare,
  Settings,
  Rocket,
  ChevronLeft,
  ChevronRight,
  Check,
} from "lucide-react";

const steps = [
  { id: 1, label: "Upload", icon: Upload },
  { id: 2, label: "Mensagem", icon: MessageSquare },
  { id: 3, label: "Configuração", icon: Settings },
  { id: 4, label: "Disparo", icon: Rocket },
];

interface CampaignViewProps {
  onRouteChange: (route: string) => void;
}

import { useToast } from "@/components/ui/use-toast";

export function CampaignView({ onRouteChange }: CampaignViewProps) {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<string[][]>([]);
  const [message, setMessage] = useState("");
  const [delayMin, setDelayMin] = useState(15);
  const [delayMax, setDelayMax] = useState(45);
  const [launching, setLaunching] = useState(false);
  const [returnToLaunch, setReturnToLaunch] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false); // NEW: Block if active

  // Check if system is busy on mount

  useEffect(() => {
      getStatus().then(status => {
          if (status.active_campaigns > 0) {
              setIsBlocked(true);
          }
      }).catch(console.error);
  }, []);

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return file !== null;
      case 2:
        return message.trim().length > 0;
      case 3:
        return delayMin < delayMax;
      default:
        return true;
    }
  };

  const handleEditStep = (stepId: number) => {
    setReturnToLaunch(true);
    setCurrentStep(stepId);
  };

  const handleNext = () => {
    if (returnToLaunch) {
      setCurrentStep(4);
      setReturnToLaunch(false);
    } else {
      setCurrentStep((prev) => Math.min(4, prev + 1));
    }
  };

  const handleLaunch = async () => {
    if (!file) return;

    setLaunching(true);
    try {
      await startCampaign({
        file,
        message,
        delayMin,
        delayMax,
      });

      // Visual Handshake: Success notification
      toast({
        title: "✅ Campanha iniciada!",
        description: "Preparando o envio...",
        duration: 3000,
        variant: "default", // or success if available, default is fine
        className: "bg-green-600 text-white border-none"
      });

      // Cognitive Delay: Wait 2s before redirecting
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Redirect to dashboard after delay
      onRouteChange("dashboard");
    } catch (error) {
      console.error("[v0] Error starting campaign:", error);
      toast({
        title: "Erro ao iniciar",
        description: "Verifique o console ou tente novamente.",
        variant: "destructive"
      });
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Nova Campanha</h2>
        <p className="text-sm text-muted-foreground">
          Configure e inicie uma nova campanha de mensagens.
        </p>
      </div>

      {isBlocked && (
          <div className="rounded-md bg-yellow-500/15 p-4 border border-yellow-500/30 text-yellow-500">
              <div className="flex items-center gap-2">
                  <Rocket className="h-5 w-5" />
                  <p className="font-medium">Campanha em Andamento</p>
              </div>
              <p className="text-sm mt-1 opacity-90">
                  Já existe uma campanha sendo processada. Aguarde o término para iniciar uma nova.
              </p>
          </div>
      )}

      {/* Step Indicator */}
      <Card className="border-border bg-card/50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const isCompleted = currentStep > step.id;
              const isCurrent = currentStep === step.id;

              return (
                <div key={step.id} className="flex items-center flex-1">
                  <button
                    onClick={() => {
                        setCurrentStep(step.id);
                        if (step.id !== 4) setReturnToLaunch(false);
                    }}
                    className={cn(
                      "flex items-center gap-2 transition-all duration-200",
                      isCurrent
                        ? "text-primary"
                        : isCompleted
                          ? "text-green-400"
                          : "text-muted-foreground"
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all duration-200",
                        isCurrent
                          ? "border-primary bg-primary/20"
                          : isCompleted
                            ? "border-green-500 bg-green-500/20"
                            : "border-border bg-secondary"
                      )}
                    >
                      {isCompleted ? (
                        <Check className="h-5 w-5" />
                      ) : (
                        <Icon className="h-5 w-5" />
                      )}
                    </div>
                    <span className="hidden sm:inline font-medium text-sm">
                      {step.label}
                    </span>
                  </button>
                  {index < steps.length - 1 && (
                    <div
                      className={cn(
                        "flex-1 h-0.5 mx-4 transition-all duration-200",
                        currentStep > step.id ? "bg-green-500" : "bg-border"
                      )}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Step Content */}
      <Card className="border-border bg-card/50">
        <CardContent className="p-6">
          {currentStep === 1 && (
            <StepUpload
              file={file}
              onFileChange={setFile}
              previewData={previewData}
              onPreviewChange={setPreviewData}
            />
          )}
          {currentStep === 2 && (
            <StepMessage message={message} onMessageChange={setMessage} />
          )}
          {currentStep === 3 && (
            <StepConfig
              delayMin={delayMin}
              delayMax={delayMax}
              onDelayMinChange={setDelayMin}
              onDelayMaxChange={setDelayMax}
            />
          )}
          {currentStep === 4 && (
            <StepLaunch
              file={file}
              message={message}
              delayMin={delayMin}
              delayMax={delayMax}
              onLaunch={handleLaunch}
              launching={launching}
              onEditStep={handleEditStep}
            />
          )}
        </CardContent>
      </Card>

      {/* Navigation Buttons */}
      {currentStep < 4 && (
        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={() => {
                setCurrentStep((prev) => Math.max(1, prev - 1));
                setReturnToLaunch(false); // Cancel edit flow if going back
            }}
            disabled={currentStep === 1}
          >
            <ChevronLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
          <Button
            onClick={handleNext}
            disabled={!canProceed() || isBlocked}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {returnToLaunch ? (
                 <>
                    Salvar e Voltar
                    <Check className="ml-2 h-4 w-4" />
                 </>
            ) : (
                <>
                    Próximo
                    <ChevronRight className="ml-2 h-4 w-4" />
                </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
