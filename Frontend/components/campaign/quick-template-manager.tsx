"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useQuickTemplates, QuickTemplate } from "./use-quick-templates";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface QuickTemplateManagerProps {
  onSelectTemplate: (text: string) => void;
}

export function QuickTemplateManager({ onSelectTemplate }: QuickTemplateManagerProps) {
  const { templates, addTemplate, updateTemplate, deleteTemplate } = useQuickTemplates();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<QuickTemplate | null>(null);

  // Form State
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const handleOpenCreate = () => {
    setEditingTemplate(null);
    setLabel("");
    setText("");
    setError("");
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (e: React.MouseEvent, tmpl: QuickTemplate) => {
    e.stopPropagation(); // Prevent selecting the template when clicking edit
    setEditingTemplate(tmpl);
    setLabel(tmpl.label);
    setText(tmpl.text);
    setError("");
    setIsDialogOpen(true);
  };

  const handleSave = () => {
    if (!label.trim() || !text.trim()) {
      setError("Nome e conteúdo são obrigatórios.");
      return;
    }

    if (editingTemplate) {
      updateTemplate(editingTemplate.id, label, text);
    } else {
      addTemplate(label, text);
    }
    setIsDialogOpen(false);
  };

  const handleDelete = () => {
    if (editingTemplate && confirm(`Tem certeza que deseja excluir o modelo "${editingTemplate.label}"?`)) {
      deleteTemplate(editingTemplate.id);
      setIsDialogOpen(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <span className="text-sm text-muted-foreground mr-2">
        Modelos Rápidos:
      </span>
      
      {/* Template Chips */}
      {templates.map((tmpl) => (
        <div key={tmpl.id} className="relative group">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onSelectTemplate(tmpl.text)}
            className={`h-7 text-xs border pr-2 ${
              tmpl.isCustom 
              ? "bg-secondary text-foreground border-border hover:bg-secondary/80 pl-2 pr-7" 
              : "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
            }`}
          >
            {tmpl.label}
          </Button>

          {/* Edit Button (Only for Custom) */}
          {tmpl.isCustom && (
            <button
              onClick={(e) => handleOpenEdit(e, tmpl)}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity"
              title="Editar Modelo"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}

      {/* Add Button */}
      <Button
        variant="outline"
        size="sm"
        onClick={handleOpenCreate}
        className="h-7 w-7 p-0 rounded-full border-dashed border-muted-foreground/50 text-muted-foreground hover:text-foreground hover:border-foreground"
        title="Novo Modelo"
      >
        <Plus className="h-4 w-4" />
      </Button>

      {/* Editor Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? "Editar Modelo" : "Novo Modelo"}</DialogTitle>
            <DialogDescription>
              Crie modelos para usar rapidamente em suas campanhas.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Nome do Modelo</Label>
              <Input
                id="name"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Ex: Cobrança Amigável"
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="content">Conteúdo</Label>
              <Textarea
                id="content"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Olá [Nome], ..."
                className="font-mono text-sm min-h-[150px]"
              />
              <p className="text-xs text-muted-foreground">Spintax e Variáveis são permitidos.</p>
            </div>
            {error && <p className="text-destructive text-sm font-medium">{error}</p>}
          </div>

          <DialogFooter className="flex justify-between sm:justify-between items-center w-full">
             {editingTemplate ? (
               <Button variant="destructive" size="sm" onClick={handleDelete} type="button">
                 <Trash2 className="h-4 w-4 mr-2" />
                 Excluir
               </Button>
             ) : (
               <div /> /* Spacer */
             )}
             
            <div className="flex gap-2">
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancelar
                </Button>
                <Button onClick={handleSave}>
                Salvar Modelo
                </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
