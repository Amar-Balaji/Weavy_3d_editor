3D SCENE COMPOSER -> WEAVY  (Next.js App Router version, no Chrome extension needed)
====================================================================================

1) Copy these folders into your Next.js project root (same level as your existing app/ folder):
     app/composer/page.tsx
     components/scene-composer/SceneComposer.tsx
     components/scene-composer/sceneComposer.ts
     components/scene-composer/scene-composer.css

2) Install Three.js:
     npm install three
     npm install -D @types/three

3) Run:  npm run dev   ->  open http://localhost:3000/composer

   Deploy as usual (Vercel etc.) -> https://amarbalaji.in/composer
   Works from ANY browser, including the office laptop: nothing to install, no .js files to download.

NOTES
- If your project does not use the "@/..." import alias, change the import in app/composer/page.tsx to:
     import SceneComposer from '../../components/scene-composer/SceneComposer';
- If your project uses a src/ folder, put app/ and components/ inside src/.
- If your layout adds a navbar/footer, the editor fills 100dvh under it; wrap the page or adjust
  `.sc-root { height: ... }` in scene-composer.css.
- Transfer to Weavy = copies the PNG to the clipboard (and optionally opens app.weavy.ai).
  In Weavy click the canvas and press Ctrl+V. If clipboard is blocked, the PNG downloads instead.
  (A normal website cannot type into another tab - that part needed the extension.)
- All dimensions in mm (Dimensions tab). GLB export is in metres = correct real-world scale.
