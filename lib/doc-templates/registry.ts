// Template registry — the single lookup point for every document template.
// Pure (no DB); safe to import from client, server, or the MCP process.

import type { DocTemplate } from "./types";
import { contractTemplate } from "./contract";
import { preconTemplate } from "./precon";
import { lienReleaseTemplate } from "./lien-release";
import { completionCertTemplate } from "./completion-cert";
import { changeOrderTemplate } from "./change-order";
import { estimateDocTemplate } from "./estimate-doc";
import { invoiceDocTemplate } from "./invoice-doc";
import { roughEstimateTemplate } from "./rough-estimate";

const TEMPLATES: DocTemplate[] = [
  contractTemplate,
  preconTemplate,
  lienReleaseTemplate,
  completionCertTemplate,
  changeOrderTemplate,
  estimateDocTemplate,
  invoiceDocTemplate,
  roughEstimateTemplate,
];

const BY_KEY = new Map(TEMPLATES.map((t) => [t.key, t]));

export function getTemplate(key: string): DocTemplate | null {
  return BY_KEY.get(key) ?? null;
}

export function listTemplates(): DocTemplate[] {
  return TEMPLATES;
}

/** Compact manifest for AI tools / UI menus — no build() function. */
export interface TemplateManifest {
  key: string;
  version: string;
  title: string;
  subtitle: string;
  docClass: DocTemplate["docClass"];
  scope: DocTemplate["scope"];
  fields: {
    key: string;
    label: string;
    kind: string;
    source: string;
    required: boolean;
    enumValues?: readonly string[];
  }[];
}

export function templateManifest(t: DocTemplate): TemplateManifest {
  return {
    key: t.key,
    version: t.version,
    title: t.title,
    subtitle: t.subtitle,
    docClass: t.docClass,
    scope: t.scope,
    fields: t.fields.map((f) => ({
      key: f.key,
      label: f.label,
      kind: f.kind,
      source: f.source,
      required: f.required,
      ...(f.enumValues ? { enumValues: f.enumValues } : {}),
    })),
  };
}
