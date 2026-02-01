"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface StepMessageProps {
  message: string;
  onMessageChange: (message: string) => void;
}

const variableButtons = [
  { label: "[Nome]", value: "[Nome]" },
  { label: "[Telefone]", value: "[Telefone]" },
  { label: "[Link]", value: "[Link]" },
];

import { QuickTemplateManager } from "./quick-template-manager";

export function StepMessage({ message, onMessageChange }: StepMessageProps) {
  const insertVariable = (variable: string) => {
    onMessageChange(message + variable);
  };

  const applyTemplate = (text: string) => {
    onMessageChange(text);
  };

  // Highlight spintax patterns
  const highlightedPreview = message.replace(
    /\{([^}]+)\}/g,
    '<span class="bg-yellow-500/30 text-yellow-300 px-1 rounded">$&</span>'
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground">
          Mensagem da Campanha
        </h3>
        <p className="text-sm text-muted-foreground">
          Escreva sua mensagem. Use Spintax para variações automáticas.
        </p>
      </div>

      <div className="space-y-4">
        {/* Quick Templates */}
        {/* Quick Templates Manager */}
        <QuickTemplateManager onSelectTemplate={applyTemplate} />

        {/* Variable Buttons */}
        <div className="flex flex-wrap gap-2">
          <span className="text-sm text-muted-foreground mr-2">
            Variáveis rápidas:
          </span>
          {variableButtons.map((btn) => (
            <Button
              key={btn.label}
              variant="outline"
              size="sm"
              onClick={() => insertVariable(btn.value)}
              className="h-7 text-xs"
            >
              {btn.label}
            </Button>
          ))}
        </div>

        {/* Message Textarea */}
        <Textarea
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          placeholder="{Olá/Oi} [Nome]! Tudo bem?

Estamos com uma oferta especial para você..."
          className="min-h-[200px] bg-secondary/50 border-border font-mono text-sm resize-none"
        />

        {/* Spintax Help */}
        <Card className="border-border bg-card/50">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-foreground mb-2">
              Dica: Usando Spintax
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              Use chaves com opções separadas por / para criar variações
              automáticas na mensagem.
            </p>
            <div className="bg-secondary rounded-lg p-3">
              <p className="text-sm font-mono text-foreground">
                <span className="bg-yellow-500/30 text-yellow-300 px-1 rounded">
                  {"{Olá/Oi/Hey}"}
                </span>{" "}
                [Nome], tudo{" "}
                <span className="bg-yellow-500/30 text-yellow-300 px-1 rounded">
                  {"{bem/certo}"}
                </span>
                ?
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Preview */}
        {message && (
          <Card className="border-border bg-card/50">
            <CardContent className="p-4">
              <p className="text-sm font-medium text-foreground mb-2">
                Preview da Mensagem
              </p>
              <div
                className="bg-secondary rounded-lg p-3 text-sm text-foreground whitespace-pre-wrap"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: Preview rendering with controlled content
                dangerouslySetInnerHTML={{ __html: highlightedPreview }}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
