'use client';

import { useEffect, useRef } from 'react';
import './scene-composer.css';

export default function SceneComposer() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    // Three.js only runs in the browser -> load it lazily on mount
    import('./sceneEngine').then(({ createComposer }) => {
      if (!cancelled && rootRef.current) dispose = createComposer(rootRef.current);
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  return (
    <div className="sc-root" ref={rootRef}>

  <header id="toolbar">
    <div className="brand">◆ Scene Composer</div>

    <div className="group" aria-label="Add">
      <button type="button" data-add="box" title="Add box (1000 mm)">Box</button>
      <button type="button" data-add="sphere" title="Add sphere (Ø1000 mm)">Sphere</button>
      <button type="button" data-add="cylinder" title="Add cylinder (Ø1000 × 1000 mm)">Cylinder</button>
      <button type="button" data-add="cone" title="Add cone (Ø1000 × 1000 mm)">Cone</button>
      <button type="button" data-add="plane" title="Add plane (2000 × 2000 mm)">Plane</button>
      <button type="button" id="btnImport" title="Import GLB / GLTF (or drop files on the viewport)">Import…</button>
    </div>

    <div className="group" aria-label="Transform mode">
      <button type="button" data-mode="translate" className="active" title="Move (W)">Move</button>
      <button type="button" data-mode="rotate" title="Rotate (E)">Rotate</button>
      <button type="button" data-mode="scale" title="Scale (R)">Scale</button>
      <button type="button" id="btnSpace" title="Toggle world / local gizmo (Q)">World</button>
    </div>

    <div className="group" aria-label="View">
      <button type="button" data-view="persp" title="Perspective">Persp</button>
      <button type="button" data-view="front" title="Front">Front</button>
      <button type="button" data-view="top" title="Top">Top</button>
      <button type="button" data-view="right" title="Right">Right</button>
      <button type="button" id="btnFocus" title="Focus selected (F)">Focus</button>
    </div>

    <div className="spacer"></div>

    <div className="group" aria-label="Output">
      <button type="button" id="btnShot" title="Save PNG screenshot">Screenshot</button>
      <button type="button" id="btnExport" title="Export the whole scene as one .glb">Export GLB</button>
      <button type="button" id="btnWeavy" className="primary" title="Copy screenshot for Weavy (then Ctrl+V)">Transfer to Weavy ➜</button>
    </div>
  </header>

  <main>
    <aside id="left">
      <div className="panel-head">
        <span>Objects <small id="objCount">0</small></span>
        <span className="mini">
          <button type="button" id="btnDup" title="Duplicate (Ctrl+D)">Dup</button>
          <button type="button" id="btnDel" title="Delete (Del)">Del</button>
        </span>
      </div>
      <ul id="outliner"></ul>
    </aside>

    <section id="viewport">
      <canvas id="overlay"></canvas>
      <div id="dropHint">Drop .glb / .gltf to import</div>
    </section>

    <aside id="right">
      <nav className="tabs" role="tablist">
        <button type="button" data-tab="object">Object</button>
        <button type="button" data-tab="dims" className="active">Dimensions</button>
        <button type="button" data-tab="scene">Scene</button>
        <button type="button" data-tab="export">Export</button>
      </nav>

      {/* OBJECT */}
      <div className="tabpanel" id="tab-object" hidden>
        <p className="empty" data-empty>Select an object.</p>
        <label>Name <input id="objName" type="text" /></label>
        <label>Color <input id="matColor" type="color" defaultValue="#c8c8c8" /></label>
        <label>Roughness <span className="val" id="matRoughVal">0.50</span>
          <input id="matRough" type="range" min="0" max="1" step="0.01" defaultValue="0.5" /></label>
        <label>Metalness <span className="val" id="matMetalVal">0.00</span>
          <input id="matMetal" type="range" min="0" max="1" step="0.01" defaultValue="0" /></label>
        <p className="note">Material changes apply to every mesh inside the selected object.</p>
      </div>

      {/* DIMENSIONS (mm) */}
      <div className="tabpanel" id="tab-dims">
        <p className="empty" id="dimsEmpty">Select an object to edit its size in mm.</p>

        <h4>Size <small>(mm)</small>
          <label className="inline"><input id="lockRatio" type="checkbox" /> 🔒 Lock ratio</label></h4>
        <div className="xyz">
          <label>W <small>X</small><input id="dimW" type="number" step="0.1" min="0" /></label>
          <label>H <small>Y</small><input id="dimH" type="number" step="0.1" min="0" /></label>
          <label>D <small>Z</small><input id="dimD" type="number" step="0.1" min="0" /></label>
        </div>

        <h4>Position <small>(mm)</small></h4>
        <div className="xyz">
          <label>X<input id="posX" type="number" step="1" /></label>
          <label>Y<input id="posY" type="number" step="1" /></label>
          <label>Z<input id="posZ" type="number" step="1" /></label>
        </div>

        <h4>Rotation <small>(°)</small></h4>
        <div className="xyz">
          <label>X<input id="rotX" type="number" step="1" /></label>
          <label>Y<input id="rotY" type="number" step="1" /></label>
          <label>Z<input id="rotZ" type="number" step="1" /></label>
        </div>

        <div className="row">
          <button type="button" id="btnResetScale">Reset scale</button>
          <button type="button" id="btnGround">Place on ground</button>
        </div>

        <h4>Scene bounds</h4>
        <p className="readout" id="sceneBounds">—</p>

        <h4>Units &amp; grid</h4>
        <label>Import units
          <select id="importUnits">
            <option value="m">Metres (glTF default)</option>
            <option value="cm">Centimetres</option>
            <option value="mm">Millimetres</option>
            <option value="in">Inches</option>
          </select></label>
        <label>Grid spacing
          <select id="gridSpacing">
            <option value="10">10 mm</option>
            <option value="100">100 mm</option>
            <option value="1000">1000 mm</option>
          </select></label>
        <label>Move snap
          <select id="moveSnap">
            <option value="0">Off</option>
            <option value="1">1 mm</option>
            <option value="10">10 mm</option>
            <option value="50">50 mm</option>
            <option value="100">100 mm</option>
            <option value="500">500 mm</option>
            <option value="1000">1000 mm</option>
          </select></label>
        <label>Rotate snap
          <select id="rotSnap">
            <option value="0">Off</option>
            <option value="5">5°</option>
            <option value="15">15°</option>
            <option value="45">45°</option>
            <option value="90">90°</option>
          </select></label>

        <h4>Overlay</h4>
        <label className="inline"><input id="showDims" type="checkbox" /> Show dimension lines in viewport</label>
        <label className="inline"><input id="dimsInShot" type="checkbox" /> Include dimension lines in screenshot</label>
        <p className="note">1 scene unit = 1 metre. Values show in mm; GLB export stays in metres, so it opens at the right size in Blender / Revit.</p>
      </div>

      {/* SCENE */}
      <div className="tabpanel" id="tab-scene" hidden>
        <label>Background <input id="bgColor" type="color" /></label>
        <label>Ambient light <input id="ambientInt" type="range" min="0" max="3" step="0.05" /></label>
        <label>Sun light <input id="sunInt" type="range" min="0" max="6" step="0.05" /></label>
        <label>Sun direction <input id="sunAz" type="range" min="0" max="360" step="1" /></label>
        <label className="inline"><input id="shadows" type="checkbox" /> Shadows</label>
        <label className="inline"><input id="showGrid" type="checkbox" /> Grid</label>
      </div>

      {/* EXPORT */}
      <div className="tabpanel" id="tab-export" hidden>
        <label>File name <input id="fileName" type="text" /></label>
        <h4>Screenshot</h4>
        <label>Resolution (long edge)
          <select id="shotRes">
            <option value="viewport">Viewport</option>
            <option value="1024">1024 px</option>
            <option value="2048">2048 px</option>
            <option value="4096">4096 px</option>
          </select></label>
        <label className="inline"><input id="shotTransparent" type="checkbox" /> Transparent background</label>
        <label className="inline"><input id="shotGrid" type="checkbox" /> Include grid</label>
        <h4>Transfer to Weavy</h4>
        <label className="inline"><input id="openWeavy" type="checkbox" /> Open Weavy in a new tab after copying</label>
        <p className="note">Transfer copies the PNG to your clipboard. In Weavy, click the canvas and press Ctrl+V. If the clipboard is blocked, the PNG downloads instead.</p>
      </div>
    </aside>
  </main>

  <footer id="status">W/E/R move·rotate·scale · F focus · H hide · Ctrl+D duplicate · Del delete · Esc deselect</footer>
  <div id="toast" role="status" aria-live="polite"></div>
  <input id="fileInput" type="file" accept=".glb,.gltf" multiple hidden />

  
    </div>
  );
}
