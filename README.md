# CIDER Web

Production React + Vite + TypeScript frontend for the CIDER wizard.

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

The app uses one resumable local session. Imported image blobs and cropped slice blobs are stored in IndexedDB; lightweight session metadata is stored in localStorage.

OCR runs locally in the browser against cropped in-memory line pixels.
