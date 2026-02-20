# QuillDock Capture (Chrome Extension)

This extension lets you browse a site and build documentation as you go:

- Capture **visible viewport** screenshot
- Capture **selected area** screenshot
- Capture **full page** screenshot
- Draw markup on each screenshot (**pen / rectangle / arrow / text**)
- Add notes for each screenshot
- Review and edit all notes in a Docs-like workspace
- Open each capture in a **full-screen editor modal** for annotation + note editing
- Export the final document with **multiple PDF design templates + preview**
- Review workspace is now built with **React + Vite**

## Development Setup

1. Install dependencies:
   `npm install`
2. Build extension bundle:
   `npm run build`
3. Output will be generated in:
   `QuillDock/dist`

Optional local UI development for review page:
`npm run dev`

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select:
   `QuillDock/dist`

## How to Use

1. Open the target website page.
2. Click the small `DOC` launcher icon on the right side of the page.
3. Use capture buttons in the right sidebar:

- `Visible`
- `Selection`
- `Full Page`

4. After capture, an in-page editor modal opens automatically.
5. Annotate (`Pen` / `Rectangle` / `Arrow` / `Text`) and add notes.
6. Click `Save To Workspace` or `Discard Capture`.
7. Review your captured screens in the sidebar list (newest is always at the top).
8. Click a list item anytime to re-open the modal and edit.
9. Click `Open Workspace` for full document editing.
10. Click `Export As PDF`, pick a template, preview it, then export.

## Template Base + Docs

- Template authoring guide:
  `QuillDock/templates/TEMPLATE_GUIDE.md`
- Base reusable HTML:
  `QuillDock/templates/base-document-template.html`
- Example template letters:
  `QuillDock/templates/examples/feature-walkthrough-template.html`
  `QuillDock/templates/examples/audit-letter-template.html`

## Notes

- Chrome internal pages (e.g. `chrome://`) cannot be captured.
- Very large pages may exceed browser canvas memory limits for full-page capture.
- Data is stored locally in IndexedDB.
