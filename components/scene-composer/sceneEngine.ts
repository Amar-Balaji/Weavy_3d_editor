// 3D Scene Composer -> Weavy : Next.js version (client only)
// @ts-nocheck
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export const WEAVY_URL = 'https://app.weavy.ai/';

/** Mounts the editor inside `root` (the <div className="sc-root"> rendered by SceneComposer). Returns a cleanup fn. */
export function createComposer(root) {
const cleanups = [];
const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); };
let rafId = 0;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const $ = (id) => root.querySelector('#' + id);
const EPS = 1e-9;
const UNIT_TO_M = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254 };
const fmt = (v) => String(Number((Math.round(v * 10) / 10).toFixed(1))); // 0.1 mm precision
const accent = () => getComputedStyle(root).getPropertyValue('--accent').trim() || '#ff7a45';

let toastTimer;
function toast(msg, kind = 'info', ms = 4500) {
  const el = $('toast');
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), ms);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const blobToDataURL = (blob) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });

const safeName = () => (settings.fileName || 'scene').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'scene';

/* ------------------------------------------------------------------ */
/* Settings (persisted in localStorage)                                */
/* ------------------------------------------------------------------ */
const DEFAULTS = {
  importUnits: 'm', gridMm: '100', snapMm: '0', rotSnap: '0',
  showDims: true, dimsInShot: false,
  shotRes: '2048', transparent: false, gridInShot: false,
  openWeavy: true, fileName: 'scene',
  bg: '#1d1f24', ambient: 0.6, sun: 2.2, sunAz: 35, shadows: true, grid: true,
};
const settings = { ...DEFAULTS };
const BINDINGS = {
  importUnits: 'importUnits', gridMm: 'gridSpacing', snapMm: 'moveSnap', rotSnap: 'rotSnap',
  showDims: 'showDims', dimsInShot: 'dimsInShot',
  shotRes: 'shotRes', transparent: 'shotTransparent', gridInShot: 'shotGrid',
  openWeavy: 'openWeavy', fileName: 'fileName',
  bg: 'bgColor', ambient: 'ambientInt', sun: 'sunInt', sunAz: 'sunAz', shadows: 'shadows', grid: 'showGrid',
};

async function loadSettings() {
  try { Object.assign(settings, JSON.parse(localStorage.getItem('sc-settings') || '{}')); } catch (e) { console.warn(e); }
}
function saveSettings() {
  try { localStorage.setItem('sc-settings', JSON.stringify(settings)); } catch (e) { console.warn(e); }
}
function bindSettings() {
  for (const [key, id] of Object.entries(BINDINGS)) {
    const el = $(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!settings[key];
    else el.value = settings[key];
    const evt = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
    on(el, evt, () => {
      settings[key] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? parseFloat(el.value) : el.value;
      saveSettings();
      applySettings();
    });
  }
}

/* ------------------------------------------------------------------ */
/* Renderer / scene                                                    */
/* ------------------------------------------------------------------ */
const viewport = $('viewport');
const overlay = $('overlay');
const octx = overlay.getContext('2d');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewport.insertBefore(renderer.domElement, overlay);

const scene = new THREE.Scene();
const bgColor = new THREE.Color(DEFAULTS.bg);
scene.background = bgColor;

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 2000);
camera.position.set(4, 3, 5);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.target.set(0, 0.5, 0);

const ambient = new THREE.AmbientLight(0xffffff, DEFAULTS.ambient);
const sun = new THREE.DirectionalLight(0xffffff, DEFAULTS.sun);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -15;
sun.shadow.camera.right = sun.shadow.camera.top = 15;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 60;
sun.shadow.bias = -0.0005;
scene.add(ambient, sun, sun.target);

// Invisible floor that only shows shadows (not exported)
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2),
  new THREE.ShadowMaterial({ opacity: 0.28 })
);
ground.position.y = -0.001;
ground.receiveShadow = true;
scene.add(ground);

// All user objects live here -> this group is what gets exported
const objectsRoot = new THREE.Group();
objectsRoot.name = 'Scene';
scene.add(objectsRoot);

let grid = null;
let gridMmBuilt = null;
function buildGrid(mm) {
  if (gridMmBuilt === mm && grid) return;
  if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
  const cfg = { 10: [2, 200], 100: [10, 100], 1000: [50, 50] }[mm] || [10, 100];
  grid = new THREE.GridHelper(cfg[0], cfg[1], 0x5a5f6b, 0x34373f);
  grid.renderOrder = -1;
  scene.add(grid);
  gridMmBuilt = mm;
}

const boxHelper = new THREE.BoxHelper(undefined, 0xff7a45);
boxHelper.visible = false;
scene.add(boxHelper);

const tc = new TransformControls(camera, renderer.domElement);
const tcHelper = typeof tc.getHelper === 'function' ? tc.getHelper() : tc; // r169+ vs older
tc.setSize(0.9);
scene.add(tcHelper);
tc.addEventListener('dragging-changed', (e) => (orbit.enabled = !e.value));
tc.addEventListener('objectChange', () => {
  boxHelper.update();
  updateDimsFields();
});

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

function setSunAzimuth(deg) {
  const az = THREE.MathUtils.degToRad(deg);
  const el = THREE.MathUtils.degToRad(50);
  const r = 14;
  sun.position.set(Math.cos(az) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(az) * Math.cos(el) * r);
}

function applySettings() {
  bgColor.set(settings.bg);
  ambient.intensity = +settings.ambient;
  sun.intensity = +settings.sun;
  setSunAzimuth(+settings.sunAz);
  sun.castShadow = !!settings.shadows;
  ground.visible = !!settings.shadows;
  buildGrid(+settings.gridMm);
  grid.visible = !!settings.grid;
  tc.setTranslationSnap(+settings.snapMm > 0 ? +settings.snapMm / 1000 : null);
  tc.setRotationSnap(+settings.rotSnap > 0 ? THREE.MathUtils.degToRad(+settings.rotSnap) : null);
}

/* ------------------------------------------------------------------ */
/* Objects                                                             */
/* ------------------------------------------------------------------ */
let selected = null;

function uniqueName(base) {
  const names = new Set(objectsRoot.children.map((o) => o.name));
  if (!names.has(base)) return base;
  let i = 1;
  while (names.has(`${base}.${String(i).padStart(3, '0')}`)) i++;
  return `${base}.${String(i).padStart(3, '0')}`;
}

function getBaseSize(obj) {
  const mn = new THREE.Vector3().fromArray(obj.userData.baseMin);
  return new THREE.Vector3().fromArray(obj.userData.baseMax).sub(mn);
}

// Store the un-scaled local bounding box -> lets us show/edit real size in mm regardless of rotation
function registerObject(obj, name) {
  obj.name = uniqueName(name);
  obj.position.set(0, 0, 0);
  obj.rotation.set(0, 0, 0);
  obj.scale.set(1, 1, 1);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) box.set(new THREE.Vector3(), new THREE.Vector3());
  obj.userData.baseMin = box.min.toArray();
  obj.userData.baseMax = box.max.toArray();
  obj.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  obj.position.set(orbit.target.x, -box.min.y, orbit.target.z); // sit on the ground at view centre
  objectsRoot.add(obj);
  select(obj);
  return obj;
}

const PRIMS = {
  box: () => new THREE.BoxGeometry(1, 1, 1),
  sphere: () => new THREE.SphereGeometry(0.5, 48, 32),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 48),
  cone: () => new THREE.ConeGeometry(0.5, 1, 48),
  plane: () => new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
};
function addPrimitive(type) {
  const mat = new THREE.MeshStandardMaterial({
    color: '#c8c8c8', roughness: 0.5, metalness: 0,
    side: type === 'plane' ? THREE.DoubleSide : THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(PRIMS[type](), mat);
  registerObject(mesh, type[0].toUpperCase() + type.slice(1));
}

async function importFiles(fileList) {
  for (const file of fileList) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['glb', 'gltf'].includes(ext)) { toast(`Unsupported file: ${file.name} (use .glb or .gltf)`, 'warn'); continue; }
    try {
      const gltf = await loader.parseAsync(await file.arrayBuffer(), '');
      const content = gltf.scene || gltf.scenes[0];
      content.scale.multiplyScalar(UNIT_TO_M[settings.importUnits] || 1);
      const wrap = new THREE.Group();
      wrap.add(content);
      wrap.updateMatrixWorld(true);
      // pivot = bottom-centre of the model
      const b = new THREE.Box3().setFromObject(wrap);
      if (!b.isEmpty()) {
        const c = b.getCenter(new THREE.Vector3());
        content.position.x -= c.x;
        content.position.z -= c.z;
        content.position.y -= b.min.y;
      }
      const obj = registerObject(wrap, file.name.replace(/\.(glb|gltf)$/i, ''));
      const s = getBaseSize(obj).multiplyScalar(1000);
      const big = Math.max(s.x, s.y, s.z);
      const hint = big > 1e6 || big < 1 ? ' — size looks off, check Import units' : '';
      toast(`Imported ${obj.name}: ${fmt(s.x)} × ${fmt(s.y)} × ${fmt(s.z)} mm${hint}`, hint ? 'warn' : 'ok', 6000);
      focusSelected();
    } catch (e) {
      console.error(e);
      toast(`Import failed for ${file.name}: ${e.message || e}`, 'error', 7000);
    }
  }
}

function duplicateSelected() {
  if (!selected) return;
  const copy = selected.clone(true);
  copy.traverse((o) => {
    if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
  });
  copy.name = uniqueName(selected.name);
  const w = getBaseSize(selected).x * Math.abs(selected.scale.x);
  copy.position.x += w + 0.1; // next to the original, 100 mm gap
  objectsRoot.add(copy);
  select(copy);
}

function deleteSelected() {
  if (!selected) return;
  const obj = selected;
  select(null);
  objectsRoot.remove(obj);
  refreshOutliner();
}

function toggleVisible(obj) {
  obj.visible = !obj.visible;
  if (obj === selected) select(obj);
  else refreshOutliner();
}

function select(obj) {
  selected = obj || null;
  if (selected && selected.visible) tc.attach(selected);
  else tc.detach();
  boxHelper.visible = !!selected && selected.visible;
  if (selected) boxHelper.setFromObject(selected);
  refreshOutliner();
  updateObjectPanel();
  updateDimsFields();
}

/* ------------------------------------------------------------------ */
/* Outliner                                                            */
/* ------------------------------------------------------------------ */
function refreshOutliner() {
  const ul = $('outliner');
  ul.innerHTML = '';
  $('objCount').textContent = objectsRoot.children.length;
  if (!objectsRoot.children.length) {
    const li = document.createElement('li');
    li.className = 'placeholder';
    li.textContent = 'Add a primitive or import a GLB';
    ul.appendChild(li);
  }
  for (const obj of objectsRoot.children) {
    const li = document.createElement('li');
    if (obj === selected) li.classList.add('selected');
    if (!obj.visible) li.classList.add('hidden-obj');

    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'eye';
    eye.title = obj.visible ? 'Hide (H)' : 'Show (H)';
    eye.textContent = obj.visible ? '●' : '○';
    eye.addEventListener('click', (e) => { e.stopPropagation(); toggleVisible(obj); });

    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = obj.name;
    nm.title = 'Double-click to rename';
    nm.addEventListener('dblclick', (e) => { e.stopPropagation(); startRename(li, nm, obj); });

    li.append(eye, nm);
    li.addEventListener('click', () => select(obj));
    ul.appendChild(li);
  }
  updateSceneBounds();
  $('btnDup').disabled = $('btnDel').disabled = !selected;
}

function startRename(li, nm, obj) {
  const input = document.createElement('input');
  input.value = obj.name;
  nm.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    if (commit && input.value.trim()) obj.name = input.value.trim();
    refreshOutliner();
    updateObjectPanel();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
    e.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}

/* ------------------------------------------------------------------ */
/* Object (material) panel                                             */
/* ------------------------------------------------------------------ */
function forEachMaterial(obj, fn) {
  obj.traverse((o) => {
    if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m && fn(m));
  });
}
function firstMaterial(obj) {
  let mat = null;
  forEachMaterial(obj, (m) => { if (!mat) mat = m; });
  return mat;
}

function updateObjectPanel() {
  const has = !!selected;
  root.querySelector('#tab-object [data-empty]').hidden = has;
  for (const id of ['objName', 'matColor', 'matRough', 'matMetal']) $(id).disabled = !has;
  if (!has) { $('objName').value = ''; return; }
  $('objName').value = selected.name;
  const m = firstMaterial(selected);
  if (m?.color) $('matColor').value = `#${m.color.getHexString()}`;
  if (typeof m?.roughness === 'number') { $('matRough').value = m.roughness; $('matRoughVal').textContent = m.roughness.toFixed(2); }
  if (typeof m?.metalness === 'number') { $('matMetal').value = m.metalness; $('matMetalVal').textContent = m.metalness.toFixed(2); }
}

on($('objName'), 'change', () => {
  if (selected && $('objName').value.trim()) { selected.name = $('objName').value.trim(); refreshOutliner(); }
});
on($('matColor'), 'input', () => {
  if (selected) forEachMaterial(selected, (m) => m.color && m.color.set($('matColor').value));
});
on($('matRough'), 'input', () => {
  const v = parseFloat($('matRough').value);
  $('matRoughVal').textContent = v.toFixed(2);
  if (selected) forEachMaterial(selected, (m) => { if ('roughness' in m) m.roughness = v; });
});
on($('matMetal'), 'input', () => {
  const v = parseFloat($('matMetal').value);
  $('matMetalVal').textContent = v.toFixed(2);
  if (selected) forEachMaterial(selected, (m) => { if ('metalness' in m) m.metalness = v; });
});

/* ------------------------------------------------------------------ */
/* Dimensions tab (mm)                                                 */
/* ------------------------------------------------------------------ */
const SIZE = { x: $('dimW'), y: $('dimH'), z: $('dimD') };
const POS = { x: $('posX'), y: $('posY'), z: $('posZ') };
const ROT = { x: $('rotX'), y: $('rotY'), z: $('rotZ') };
const allDimInputs = [...Object.values(SIZE), ...Object.values(POS), ...Object.values(ROT)];

function setVal(el, v) {
  if (document.activeElement !== el) el.value = v; // don't fight the user while typing
}

function updateDimsFields() {
  const has = !!selected;
  $('dimsEmpty').hidden = has;
  $('btnResetScale').disabled = $('btnGround').disabled = !has;
  if (!has) {
    allDimInputs.forEach((el) => { el.disabled = true; el.value = ''; });
    updateSceneBounds();
    return;
  }
  const base = getBaseSize(selected);
  for (const ax of ['x', 'y', 'z']) {
    const flat = base[ax] < EPS; // e.g. a plane has no height
    SIZE[ax].disabled = flat;
    setVal(SIZE[ax], flat ? '0' : fmt(base[ax] * Math.abs(selected.scale[ax]) * 1000));
    POS[ax].disabled = ROT[ax].disabled = false;
    setVal(POS[ax], fmt(selected.position[ax] * 1000));
    setVal(ROT[ax], fmt(THREE.MathUtils.radToDeg(selected.rotation[ax])));
  }
  updateSceneBounds();
}

function afterEdit() {
  selected.updateMatrixWorld(true);
  boxHelper.update();
  updateDimsFields();
}

const readNum = (el) => {
  const v = parseFloat(String(el.value).replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

for (const ax of ['x', 'y', 'z']) {
  SIZE[ax].addEventListener('change', () => {
    if (!selected) return;
    const mm = readNum(SIZE[ax]);
    const base = getBaseSize(selected)[ax];
    if (mm === null || mm <= 0 || base < EPS) { updateDimsFields(); return; }
    const newAbs = mm / 1000 / base;
    if ($('lockRatio').checked) {
      const cur = Math.abs(selected.scale[ax]) || EPS;
      selected.scale.multiplyScalar(newAbs / cur);
    } else {
      selected.scale[ax] = (Math.sign(selected.scale[ax]) || 1) * newAbs;
    }
    afterEdit();
  });
  POS[ax].addEventListener('change', () => {
    const mm = readNum(POS[ax]);
    if (!selected || mm === null) return updateDimsFields();
    selected.position[ax] = mm / 1000;
    afterEdit();
  });
  ROT[ax].addEventListener('change', () => {
    const deg = readNum(ROT[ax]);
    if (!selected || deg === null) return updateDimsFields();
    selected.rotation[ax] = THREE.MathUtils.degToRad(deg);
    afterEdit();
  });
}
allDimInputs.forEach((el) => on(el, 'keydown', (e) => { if (e.key === 'Enter') el.blur(); }));

on($('btnResetScale'), 'click', () => {
  if (!selected) return;
  selected.scale.set(1, 1, 1);
  afterEdit();
});
on($('btnGround'), 'click', () => {
  if (!selected) return;
  selected.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(selected);
  if (!b.isEmpty()) selected.position.y -= b.min.y;
  afterEdit();
});

function sceneBox() {
  const box = new THREE.Box3();
  for (const o of objectsRoot.children) if (o.visible) box.union(new THREE.Box3().setFromObject(o));
  return box;
}
function updateSceneBounds() {
  const box = sceneBox();
  if (box.isEmpty()) { $('sceneBounds').textContent = '—'; return; }
  const s = box.getSize(new THREE.Vector3()).multiplyScalar(1000);
  $('sceneBounds').textContent = `${fmt(s.x)} × ${fmt(s.y)} × ${fmt(s.z)} mm`;
}

/* Dimension lines (drawn on a 2D canvas: same code for viewport overlay and screenshots) */
const _p = new THREE.Vector3();
function toScreen(v, cam, w, h) {
  _p.copy(v).project(cam);
  if (_p.z < -1 || _p.z > 1) return null;
  return { x: ((_p.x + 1) / 2) * w, y: ((1 - _p.y) / 2) * h };
}

function drawDimensions(ctx, obj, cam, w, h, k = 1) {
  if (!obj?.userData?.baseMin || !obj.visible) return;
  obj.updateMatrixWorld(true);
  const mn = new THREE.Vector3().fromArray(obj.userData.baseMin);
  const mx = new THREE.Vector3().fromArray(obj.userData.baseMax);
  const base = mx.clone().sub(mn);
  const P = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(obj.matrixWorld);
  const s = obj.scale;
  const items = [
    ['W', P(mn.x, mn.y, mx.z), P(mx.x, mn.y, mx.z), base.x * Math.abs(s.x)],
    ['H', P(mn.x, mn.y, mx.z), P(mn.x, mx.y, mx.z), base.y * Math.abs(s.y)],
    ['D', P(mx.x, mn.y, mx.z), P(mx.x, mn.y, mn.z), base.z * Math.abs(s.z)],
  ];
  const col = accent();
  ctx.save();
  ctx.lineWidth = 2 * k;
  ctx.strokeStyle = col;
  ctx.font = `600 ${12 * k}px system-ui, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [label, a3, b3, len] of items) {
    if (len < 1e-5) continue;
    const a = toScreen(a3, cam, w, h);
    const b = toScreen(b3, cam, w, h);
    if (!a || !b) continue;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    const nx = (-dy / L) * 6 * k, ny = (dx / L) * 6 * k;
    for (const p of [a, b]) { ctx.beginPath(); ctx.moveTo(p.x - nx, p.y - ny); ctx.lineTo(p.x + nx, p.y + ny); ctx.stroke(); }
    const text = `${label} ${fmt(len * 1000)} mm`;
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const tw = ctx.measureText(text).width + 12 * k, th = 19 * k;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.roundRect(cx - tw / 2, cy - th / 2, tw, th, 4 * k); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, cx, cy + 0.5 * k);
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */
function viewDistance() {
  const box = sceneBox();
  if (box.isEmpty()) return 6;
  return Math.max(2, box.getSize(new THREE.Vector3()).length() * 1.4);
}
function setView(kind) {
  const box = sceneBox();
  const t = box.isEmpty() ? new THREE.Vector3(0, 0.5, 0) : box.getCenter(new THREE.Vector3());
  const d = viewDistance();
  const dir = {
    persp: new THREE.Vector3(0.6, 0.45, 0.75),
    front: new THREE.Vector3(0, 0, 1),
    top: new THREE.Vector3(0, 1, 0.0001),
    right: new THREE.Vector3(1, 0, 0),
  }[kind].normalize();
  orbit.target.copy(t);
  camera.position.copy(t).addScaledVector(dir, d);
  camera.lookAt(t);
  orbit.update();
}
function focusSelected() {
  if (!selected) return setView('persp');
  const box = new THREE.Box3().setFromObject(selected);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(0.3, box.getSize(new THREE.Vector3()).length());
  const dir = camera.position.clone().sub(orbit.target).normalize();
  orbit.target.copy(c);
  camera.position.copy(c).addScaledVector(dir, r * 1.6);
  orbit.update();
}

/* ------------------------------------------------------------------ */
/* Screenshot / export                                                 */
/* ------------------------------------------------------------------ */
async function captureCanvas() {
  const vw = viewport.clientWidth || 1, vh = viewport.clientHeight || 1;
  let w, h;
  if (settings.shotRes === 'viewport') {
    w = Math.round(vw * renderer.getPixelRatio());
    h = Math.round(vh * renderer.getPixelRatio());
  } else {
    const max = Math.min(+settings.shotRes, renderer.capabilities.maxTextureSize || 4096);
    if (vw >= vh) { w = max; h = Math.round((max * vh) / vw); } else { h = max; w = Math.round((max * vw) / vh); }
  }

  // save state
  const prevPR = renderer.getPixelRatio();
  const prevSize = renderer.getSize(new THREE.Vector2());
  const prevBg = scene.background;
  const prevGrid = grid.visible;
  const prevBox = boxHelper.visible;
  const prevTc = tcHelper.visible;

  // clean frame: no gizmo / selection box, optional grid & transparency
  tcHelper.visible = false;
  boxHelper.visible = false;
  grid.visible = settings.grid && settings.gridInShot;
  if (settings.transparent) { scene.background = null; renderer.setClearColor(0x000000, 0); }

  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  ctx.drawImage(renderer.domElement, 0, 0);
  if (settings.dimsInShot && selected) drawDimensions(ctx, selected, camera, w, h, w / vw);

  // restore
  scene.background = prevBg;
  grid.visible = prevGrid;
  boxHelper.visible = prevBox;
  tcHelper.visible = prevTc;
  renderer.setPixelRatio(prevPR);
  renderer.setSize(prevSize.x, prevSize.y, false);
  camera.aspect = prevSize.x / prevSize.y;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);

  return out;
}

async function capturePngBlob() {
  const c = await captureCanvas();
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG encode failed'))), 'image/png'));
}

async function saveScreenshot() {
  try {
    const blob = await capturePngBlob();
    downloadBlob(blob, `${safeName()}.png`);
    toast('Screenshot saved as PNG', 'ok');
  } catch (e) { toast(`Screenshot failed: ${e.message}`, 'error'); }
}

function exportGLB() {
  if (!objectsRoot.children.some((o) => o.visible)) { toast('Nothing visible to export', 'warn'); return; }
  const exporter = new GLTFExporter();
  exporter.parse(
    objectsRoot,
    (result) => {
      downloadBlob(new Blob([result], { type: 'model/gltf-binary' }), `${safeName()}.glb`);
      toast(`Exported ${safeName()}.glb (metres, real scale)`, 'ok');
    },
    (err) => toast(`Export failed: ${err?.message || err}`, 'error'),
    { binary: true, onlyVisible: true }
  );
}

/* ------------------------------------------------------------------ */
/* Transfer to Weavy                                                   */
/* ------------------------------------------------------------------ */
function transferToWeavy() {
  // ClipboardItem gets a Promise so the write starts inside the click (user gesture) — works in Chrome/Edge.
  const pngPromise = capturePngBlob();
  let weavyTab = null;
  navigator.clipboard
    .write([new ClipboardItem({ 'image/png': pngPromise })])
    .then(() => {
      if (settings.openWeavy) weavyTab = window.open(WEAVY_URL, 'weavy');
      toast(
        weavyTab || !settings.openWeavy
          ? 'Image copied ✔ — in Weavy, click the canvas and press Ctrl+V'
          : 'Image copied ✔ — switch to your Weavy tab and press Ctrl+V',
        'ok', 7000
      );
    })
    .catch(async (e) => {
      console.warn('Clipboard failed', e);
      try { downloadBlob(await pngPromise, `${safeName()}.png`); } catch {}
      toast('Clipboard blocked — PNG downloaded instead. Import it in Weavy.', 'warn', 7000);
    });
}

/* ------------------------------------------------------------------ */
/* Input / UI wiring                                                   */
/* ------------------------------------------------------------------ */
root.querySelectorAll('[data-add]').forEach((b) => on(b, 'click', () => addPrimitive(b.dataset.add)));
on($('btnImport'), 'click', () => $('fileInput').click());
on($('fileInput'), 'change', async (e) => {
  await importFiles([...e.target.files]);
  e.target.value = '';
});

function setMode(mode) {
  tc.setMode(mode);
  root.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
}
root.querySelectorAll('[data-mode]').forEach((b) => on(b, 'click', () => setMode(b.dataset.mode)));
on($('btnSpace'), 'click', () => {
  tc.setSpace(tc.space === 'world' ? 'local' : 'world');
  $('btnSpace').textContent = tc.space === 'world' ? 'World' : 'Local';
});
root.querySelectorAll('[data-view]').forEach((b) => on(b, 'click', () => setView(b.dataset.view)));
on($('btnFocus'), 'click', focusSelected);
on($('btnDup'), 'click', duplicateSelected);
on($('btnDel'), 'click', deleteSelected);
on($('btnShot'), 'click', saveScreenshot);
on($('btnExport'), 'click', exportGLB);
on($('btnWeavy'), 'click', transferToWeavy);

root.querySelectorAll('.tabs [data-tab]').forEach((b) =>
  on(b, 'click', () => {
    root.querySelectorAll('.tabs [data-tab]').forEach((x) => x.classList.toggle('active', x === b));
    root.querySelectorAll('.tabpanel').forEach((p) => (p.hidden = p.id !== `tab-${b.dataset.tab}`));
  })
);

// Click-to-select (ignore orbit drags and gizmo clicks)
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downAt = null;
on(renderer.domElement, 'pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
on(renderer.domElement, 'pointerup', (e) => {
  if (!downAt || e.button !== 0) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 4 || tc.dragging || tc.axis) return;
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(objectsRoot.children.filter((o) => o.visible), true);
  const hit = hits.find((h) => {
    for (let o = h.object; o; o = o.parent) if (!o.visible) return false;
    return true;
  });
  if (!hit) return select(null);
  let o = hit.object;
  while (o.parent && o.parent !== objectsRoot) o = o.parent;
  select(o);
});

// Drag & drop import
on(viewport, 'dragover', (e) => { e.preventDefault(); viewport.classList.add('dragging'); });
on(viewport, 'dragleave', (e) => { if (e.target === viewport) viewport.classList.remove('dragging'); });
on(viewport, 'drop', (e) => {
  e.preventDefault();
  viewport.classList.remove('dragging');
  if (e.dataTransfer?.files?.length) importFiles([...e.dataTransfer.files]);
});

on(window, 'keydown', (e) => {
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); duplicateSelected(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (k === 'w') setMode('translate');
  else if (k === 'e') setMode('rotate');
  else if (k === 'r') setMode('scale');
  else if (k === 'q') $('btnSpace').click();
  else if (k === 'f') focusSelected();
  else if (k === 'h' && selected) toggleVisible(selected);
  else if (k === 'delete' || k === 'backspace' || k === 'x') deleteSelected();
  else if (k === 'escape') select(null);
});

/* ------------------------------------------------------------------ */
/* Resize + render loop                                                */
/* ------------------------------------------------------------------ */
function onResize() {
  const w = Math.max(1, viewport.clientWidth), h = Math.max(1, viewport.clientHeight);
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const dpr = window.devicePixelRatio || 1;
  overlay.width = Math.round(w * dpr);
  overlay.height = Math.round(h * dpr);
  overlay.style.width = `${w}px`;
  overlay.style.height = `${h}px`;
}
const ro = new ResizeObserver(onResize);
ro.observe(viewport);
cleanups.push(() => ro.disconnect());

function loop() {
  rafId = requestAnimationFrame(loop);
  orbit.update();
  renderer.render(scene, camera);

  const dpr = window.devicePixelRatio || 1;
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (settings.showDims && selected) {
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawDimensions(octx, selected, camera, viewport.clientWidth, viewport.clientHeight, 1);
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
let disposed = false;
(async function init() {
  await loadSettings();
  if (disposed) return;
  bindSettings();
  applySettings();
  onResize();
  addPrimitive('box');
  setView('persp');
  loop();
})();

return function dispose() {
  disposed = true;
  cancelAnimationFrame(rafId);
  cleanups.forEach((fn) => fn());
  tc.detach();
  tc.dispose?.();
  orbit.dispose();
  scene.traverse((o) => {
    o.geometry?.dispose?.();
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.dispose?.());
  });
  renderer.dispose();
  renderer.domElement.remove();
};
}
