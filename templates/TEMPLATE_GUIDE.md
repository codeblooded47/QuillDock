# QuillDock Template Guide

This folder gives you a reusable HTML base so you can create multiple letter/document templates for PDF export.

## What You Get

- `base-document-template.html`: neutral starter template with placeholder tokens.
- `examples/feature-walkthrough-template.html`: product walkthrough style.
- `examples/audit-letter-template.html`: report/letter style for compliance or audits.

## Placeholder Tokens

Use these tokens in any template HTML:

- `{{DOCUMENT_TITLE}}`
- `{{GENERATED_AT}}`
- `{{OVERVIEW}}`
- `{{SECTIONS_HTML}}`

`{{SECTIONS_HTML}}` should contain repeated section blocks from your captures (image + note).

## Create a New Template Letter

1. Copy `base-document-template.html` to a new file in `templates/examples/`.
2. Change typography, colors, spacing, and section styles.
3. Keep the token placeholders in your layout.
4. Add the template metadata in `/src/review/templates.js`:
   - `id`
   - `className`
   - `name`
   - `description`
   - `baseHtmlFile`
5. Add CSS rules in `/review.css` for the new `className` (e.g. `.paper.template-your-id`).

## CSS Contract (React Workspace)

If you want the template selectable in the app preview/export flow, define these styles:

- `.paper.template-your-id`
- `.paper.template-your-id .paper-header`
- `.paper.template-your-id .section-card`
- `.paper.template-your-id .capture-badge`

This keeps your design consistent in both workspace and export.

## Fast Pattern for Multiple Letters

Create several template files using this naming:

- `templates/examples/letter-client-onboarding.html`
- `templates/examples/letter-release-notes.html`
- `templates/examples/letter-audit-summary.html`

Then map each one in `src/review/templates.js` so it appears in export template choices.
