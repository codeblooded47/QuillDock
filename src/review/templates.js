export const DEFAULT_TEMPLATE_ID = "classic";
export const DEFAULT_SECTION_TEMPLATE_FILE =
  "templates/base-section-template.html";

export const PDF_TEMPLATES = [
  {
    id: "classic",
    className: "template-classic",
    name: "Classic Brief",
    description:
      "Google-Docs-like structure for polished team handoff documents.",
    baseHtmlFile: "templates/base-document-template.html",
    sectionHtmlFile: DEFAULT_SECTION_TEMPLATE_FILE,
  },
  {
    id: "spotlight",
    className: "template-spotlight",
    name: "Spotlight Guide",
    description:
      "Bold callouts with strong section framing for feature walkthroughs.",
    baseHtmlFile: "templates/examples/feature-walkthrough-template.html",
    sectionHtmlFile: DEFAULT_SECTION_TEMPLATE_FILE,
  },
  {
    id: "dossier",
    className: "template-dossier",
    name: "Dossier Notes",
    description:
      "Report-style layout with softer tones for audits and stakeholder updates.",
    baseHtmlFile: "templates/examples/audit-letter-template.html",
    sectionHtmlFile: DEFAULT_SECTION_TEMPLATE_FILE,
  },
  {
    id: "blueprint",
    className: "template-blueprint",
    name: "Blueprint Flow",
    description:
      "Technical look with clean dividers for engineering documentation.",
    baseHtmlFile: "templates/base-document-template.html",
    sectionHtmlFile: DEFAULT_SECTION_TEMPLATE_FILE,
  },
  {
    id: "premium",
    className: "template-premium",
    name: "Premium Showcase",
    description:
      "Modern, highly aesthetic design with typography from Outfit, gradients, and soft shadows. Ideal for executive presentations.",
    baseHtmlFile: "templates/examples/premium-showcase-template.html",
    sectionHtmlFile: DEFAULT_SECTION_TEMPLATE_FILE,
  },
  {
    id: "minimalist",
    className: "template-minimalist",
    name: "Minimalist Clean",
    description:
      "Ultra-clean aesthetics with the Inter font. Focuses entirely on the content with subtle borders and plenty of whitespace.",
    baseHtmlFile: "templates/examples/minimalist-clean-template.html",
    sectionHtmlFile: DEFAULT_SECTION_TEMPLATE_FILE,
  },
];

export function normalizeTemplateId(templateId) {
  return PDF_TEMPLATES.some((template) => template.id === templateId)
    ? templateId
    : DEFAULT_TEMPLATE_ID;
}

export function getTemplateById(templateId) {
  const normalizedTemplateId = normalizeTemplateId(templateId);
  return (
    PDF_TEMPLATES.find((template) => template.id === normalizedTemplateId) ||
    PDF_TEMPLATES[0]
  );
}

export function captureTypeLabel(captureType) {
  const labels = {
    visible: "Visible",
    selection: "Selection",
    fullpage: "Full Page",
  };

  return labels[captureType] || "Capture";
}
