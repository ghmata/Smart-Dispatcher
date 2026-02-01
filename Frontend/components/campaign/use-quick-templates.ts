"use client";

import { useState, useEffect } from "react";

export interface QuickTemplate {
  id: string;
  label: string;
  text: string;
  isCustom: boolean;
}

const DEFAULT_TEMPLATES: QuickTemplate[] = [
  {
    id: "default-1",
    label: "Amigável",
    text: "{Opa/Olá/Oi} [Nome], {tudo bem?/como vai?/tudo certo?}\n\nEstou passando para lembrar do seu boleto.\nSegue o link: [Link]",
    isCustom: false,
  },
  {
    id: "default-2",
    label: "Direta",
    text: "[Nome], referente ao seu débito: segue o link para pagamento [Link].\n\n{Qualquer dúvida estou à disposição/Aguardo confirmação}.",
    isCustom: false,
  },
  {
    id: "default-3",
    label: "Formal",
    text: "{Prezado(a)/Caro(a)} [Nome], entramos em contato referente a pendência financeira.\nPara regularizar, acesse: [Link].",
    isCustom: false,
  },
];

const STORAGE_KEY = "quickTemplates:v1";

export function useQuickTemplates() {
  const [templates, setTemplates] = useState<QuickTemplate[]>(DEFAULT_TEMPLATES);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const customTemplates: QuickTemplate[] = JSON.parse(stored);
        if (Array.isArray(customTemplates)) {
          // Verify integrity
          const validCustomTemplates = customTemplates.filter(
            (t) => t.id && t.label && t.text && t.isCustom
          );
          setTemplates([...DEFAULT_TEMPLATES, ...validCustomTemplates]);
          return;
        }
      }
    } catch (e) {
      console.warn("Failed to load custom templates from localStorage:", e);
    }
  }, []);

  // Persistence helper
  const _saveToStorage = (allTemplates: QuickTemplate[]) => {
    try {
      const customOnly = allTemplates.filter((t) => t.isCustom);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(customOnly));
    } catch (e) {
      console.error("Failed to save templates:", e);
    }
  };

  const addTemplate = (label: string, text: string) => {
    const newTemplate: QuickTemplate = {
      id: crypto.randomUUID ? crypto.randomUUID() : `tmpl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      label,
      text,
      isCustom: true,
    };
    
    const updated = [...templates, newTemplate];
    setTemplates(updated);
    _saveToStorage(updated);
  };

  const updateTemplate = (id: string, label: string, text: string) => {
    const updated = templates.map((t) =>
      t.id === id && t.isCustom ? { ...t, label, text } : t
    );
    setTemplates(updated);
    _saveToStorage(updated);
  };

  const deleteTemplate = (id: string) => {
    const updated = templates.filter((t) => t.id !== id);
    setTemplates(updated);
    _saveToStorage(updated);
  };

  return {
    templates,
    addTemplate,
    updateTemplate,
    deleteTemplate,
  };
}
