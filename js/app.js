import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import loadMujoco from '../vendor/mujoco/mujoco.js';
import { buildMujocoScene, updateBodyTransforms } from './mjcfScene.js';

const MODEL_DIR = './assets/mjcf/microduck/';
const DEG = 180 / Math.PI;

const app = {
  mujoco: null,
  model: null,
  data: null,
  bodies: null,
  visualMeshes: [],
  collisionMeshes: [],
  root: null,
  paused: false,
  speed: 1,
  acc: 0,
  simTime: 0,
  lastFrame: 0,
  fpsSmooth: 60,
  sceneFile: 'scene.xml',
  jointRows: [],
  keyframeCount: 0,
  collisionVisible: false,
  poke: null,
  kpScale: 1,
  baseGains: [],
  suspend: false,
  suspendHeight: 0.12,
};

const ui = {
  canvas: document.getElementById('view'),
  stage: document.getElementById('stage'),
  loading: document.getElementById('loading'),
  loadingTitle: document.getElementById('loading-title'),
  loadingFill: document.getElementById('loading-fill'),
  play: document.getElementById('btn-play'),
  step: document.getElementById('btn-step'),
  reset: document.getElementById('btn-reset'),
  camera: document.getElementById('btn-camera'),
  collision: document.getElementById('btn-collision'),
  pokeBtn: document.getElementById('btn-poke'),
  kpScale: document.getElementById('kp-scale'),
  kpValue: document.getElementById('kp-value'),
  suspend: document.getElementById('btn-suspend'),
  tiltHint: document.getElementById('tilt-hint'),
  sceneSelect: document.getElementById('scene-select'),
  poseRow: document.getElementById('pose-row'),
  joints: document.getElementById('joint-controls'),
  tHeight: document.getElementById('t-height'),
  tTilt: document.getElementById('t-tilt'),
  tContact: document.getElementById('t-contact'),
  tTime: document.getElementById('t-time'),
  fps: document.getElementById('fps'),
  dof: document.getElementById('dof'),
  timestep: document.getElementById('timestep'),
  engine: document.getElementById('engine-version'),
};

/* ── three.js 舞台 ─────────────────────────────── */
const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(38, 1, 0.005, 40);
camera.up.set(0, 0, 1); // MuJoCo 是 Z-up
camera.position.set(0.5, -0.55, 0.32);

const controls = new OrbitControls(camera, ui.canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.12;
controls.maxDistance = 3;
controls.maxPolarAngle = Math.PI * 0.495;
controls.target.set(0, 0, 0.1);

const hemi = new THREE.HemisphereLight(0xffffff, 0xc9d3de, 1.15);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xfff6e8, 2.6);
key.position.set(0.6, -0.7, 1.1);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 0.05;
key.shadow.camera.far = 4;
key.shadow.camera.left = -0.45;
key.shadow.camera.right = 0.45;
key.shadow.camera.top = 0.45;
key.shadow.camera.bottom = -0.45;
key.shadow.bias = -0.0004;
scene.add(key);

const fill = new THREE.DirectionalLight(0xdfe9ff, 0.9);
fill.position.set(-0.8, 0.6, 0.5);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xffffff, 0.6);
rim.position.set(0, 1.0, 0.35);
scene.add(rim);

function resize() {
  const w = ui.stage.clientWidth;
  const h = ui.stage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(ui.stage);

/* ── 载入进度 ─────────────────────────────────── */
function setLoading(title, ratio) {
  if (title) ui.loadingTitle.textContent = title;
  if (typeof ratio === 'number') ui.loadingFill.style.width = `${Math.round(ratio * 100)}%`;
}

function hideLoading() {
  ui.loading.classList.add('hidden');
}

function showError(err) {
  ui.loading.classList.remove('hidden');
  ui.loadingTitle.textContent = '载入失败';
  ui.loadingFill.style.width = '100%';
  ui.loadingFill.style.background = '#d93025';
  const box = document.createElement('pre');
  box.className = 'error-box';
  box.textContent = String(err && err.stack ? err.stack : err);
  ui.loading.querySelector('.loading-box').appendChild(box);
  console.error(err);
}

/* ── 模型资产写进 MuJoCo 虚拟文件系统 ───────────── */
async function mountModelFiles(mujoco) {
  try { mujoco.FS.mkdir('/working'); } catch (e) { /* 已存在 */ }
  try { mujoco.FS.mount(mujoco.MEMFS, { root: '.' }, '/working'); } catch (e) { /* 已挂载 */ }
  try { mujoco.FS.mkdir('/working/assets'); } catch (e) { /* 已存在 */ }

  const manifest = await (await fetch(MODEL_DIR + 'manifest.json')).json();
  const tasks = [
    ...manifest.xml.map((f) => ({ path: f, url: MODEL_DIR + f, binary: false })),
    ...manifest.meshes.map((m) => ({ path: 'assets/' + m, url: MODEL_DIR + 'assets/' + m, binary: true })),
  ];

  let done = 0;
  await Promise.all(
    tasks.map(async (t) => {
      const res = await fetch(t.url);
      if (!res.ok) throw new Error(`资产缺失：${t.url} (${res.status})`);
      if (t.binary) {
        mujoco.FS.writeFile('/working/' + t.path, new Uint8Array(await res.arrayBuffer()));
      } else {
        mujoco.FS.writeFile('/working/' + t.path, await res.text());
      }
      done += 1;
      setLoading(null, done / tasks.length);
    })
  );
  return tasks.length;
}

/* ── 载入 / 切换场景 ───────────────────────────── */
function disposeScene() {
  if (!app.root) return;
  scene.remove(app.root);
  app.root.traverse((obj) => {
    if (obj.isMesh) {
      obj.geometry?.dispose?.();
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material?.dispose?.();
    }
  });
  app.root = null;
  app.bodies = null;
  app.visualMeshes = [];
  app.collisionMeshes = [];
}

function frameCamera() {
  const box = new THREE.Box3();
  for (const mesh of app.visualMeshes) {
    if (mesh.geometry.type === 'PlaneGeometry') continue; // 地面不参与取景
    mesh.updateWorldMatrix(true, false);
    mesh.geometry.computeBoundingBox();
    box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
  }
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.1, -0.1, 0), new THREE.Vector3(0.1, 0.1, 0.25));

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.length(), 0.1);
  const dist = span * 1.72;

  const dir = new THREE.Vector3(0.75, -1.0, 0.42).normalize();
  camera.position.copy(center).add(dir.multiplyScalar(dist));
  camera.near = Math.max(span / 400, 0.001);
  camera.far = span * 60;
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.minDistance = span * 0.6;
  controls.maxDistance = span * 12;
  controls.update();

  const s = Math.max(span * 0.75, 0.12);
  key.shadow.camera.left = -s;
  key.shadow.camera.right = s;
  key.shadow.camera.top = s;
  key.shadow.camera.bottom = -s;
  key.shadow.camera.updateProjectionMatrix();
  key.position.copy(center).add(new THREE.Vector3(0.45, -0.5, 0.85).normalize().multiplyScalar(span * 2.2));
  key.target.position.copy(center);
  key.target.updateMatrixWorld();
  if (!key.target.parent) scene.add(key.target);
}

async function loadModel(sceneFile, { keepCamera = false } = {}) {
  const { mujoco } = app;
  ui.loading.classList.remove('hidden');
  ui.loadingFill.style.background = '';
  setLoading(`载入 ${sceneFile} …`, 1);

  disposeScene();

  if (app.data) { try { app.data.delete(); } catch (e) {} app.data = null; }
  if (app.model) { try { app.model.delete(); } catch (e) {} app.model = null; }

  const path = '/working/' + sceneFile;
  let model = null;
  try {
    model = mujoco.MjModel.mj_loadXML(path);
  } catch (e) {
    model = mujoco.MjModel.from_xml_path(path);
  }
  if (!model) throw new Error(`MJCF 解析失败：${sceneFile}`);

  app.model = model;
  app.data = new mujoco.MjData(model);
  mujoco.mj_forward(model, app.data);
  app.simTime = 0;
  app.acc = 0;
  app.sceneFile = sceneFile;

  cacheActuatorGains();
  applyKpScale(app.kpScale);

  const built = buildMujocoScene(mujoco, model, { groundSize: 4, groundRepeat: 26 });
  app.root = built.root;
  app.bodies = built.bodies;
  app.visualMeshes = built.visualMeshes;
  app.collisionMeshes = built.collisionMeshes;
  scene.add(app.root);

  buildJointUI();
  buildPoseUI();

  const standIdx = findKeyframeIndex('STAND');
  applyKeyframe(standIdx >= 0 ? standIdx : 0);

  ui.dof.textContent = String(model.nq - 7);
  ui.timestep.textContent = `${(model.opt.timestep * 1000).toFixed(1)} ms`;
  ui.sceneSelect.value = sceneFile;
  ui.sceneSelect.disabled = false;

  if (!keepCamera) frameCamera();
  hideLoading();
}

function findKeyframeIndex(name) {
  const { mujoco, model } = app;
  for (let k = 0; k < model.nkey; k++) {
    try {
      if ((mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_KEY.value, k) || '').toUpperCase() === name) return k;
    } catch (e) {}
  }
  return -1;
}

/* ── 关节控制 UI ──────────────────────────────── */
function jointDisplayName(name) {
  return name
    .replace('left_', '左 ')
    .replace('right_', '右 ')
    .replace('hip_yaw', '髋偏航')
    .replace('hip_roll', '髋横滚')
    .replace('hip_pitch', '髋俯仰')
    .replace('knee', '膝')
    .replace('ankle', '踝')
    .replace('neck_pitch', '颈俯仰')
    .replace('head_pitch', '头俯仰')
    .replace('head_yaw', '头偏航')
    .replace('head_roll', '头横滚');
}

function groupOf(name) {
  if (name.startsWith('left_')) return '左腿';
  if (name.startsWith('right_')) return '右腿';
  return '头部';
}

function buildJointUI() {
  const { mujoco, model } = app;
  ui.joints.innerHTML = '';
  app.jointRows = [];

  const groups = { 头部: [], 左腿: [], 右腿: [] };
  const rows = [];

  for (let i = 0; i < model.nu; i++) {
    let name = '';
    try {
      name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_ACTUATOR.value, i) || `actuator_${i}`;
    } catch (e) {
      name = `actuator_${i}`;
    }

    const jointId = model.actuator_trnid[i * 2];
    const qposAdr = model.jnt_qposadr[jointId];
    const limited = model.jnt_limited[jointId];
    let lo = -170;
    let hi = 170;
    if (limited) {
      lo = model.jnt_range[jointId * 2] * DEG;
      hi = model.jnt_range[jointId * 2 + 1] * DEG;
    }
    rows.push({ i, name, jointId, qposAdr, lo: Math.min(lo, hi), hi: Math.max(lo, hi) });
    (groups[groupOf(name)] || groups['头部']).push(rows[rows.length - 1]);
  }

  for (const [groupName, list] of Object.entries(groups)) {
    if (!list.length) continue;
    const title = document.createElement('div');
    title.className = 'joint-group-title';
    title.textContent = groupName;
    ui.joints.appendChild(title);

    for (const row of list) {
      const wrap = document.createElement('div');
      wrap.className = 'joint';

      const label = document.createElement('label');
      label.textContent = jointDisplayName(row.name);
      label.title = row.name;

      const value = document.createElement('span');
      value.className = 'value';

      const input = document.createElement('input');
      input.type = 'range';
      input.min = row.lo.toFixed(0);
      input.max = row.hi.toFixed(0);
      input.step = '1';
      input.value = '0';
      input.addEventListener('input', () => {
        if (!app.data) return;
        app.data.ctrl[row.i] = (parseFloat(input.value) * Math.PI) / 180;
        updateJointValue(row, value);
      });

      wrap.append(label, value, input);
      ui.joints.appendChild(wrap);

      row.input = input;
      row.valueEl = value;
      app.jointRows.push(row);
      updateJointValue(row, value);
    }
  }
}

function updateJointValue(row, el) {
  const target = parseFloat(row.input.value);
  let actual = null;
  if (app.data && row.qposAdr >= 0) actual = app.data.qpos[row.qposAdr] * DEG;
  el.innerHTML =
    actual === null
      ? `${target.toFixed(0)}°`
      : `${target.toFixed(0)}° <small>→ ${actual.toFixed(0)}°</small>`;
}

function syncSlidersFromCtrl() {
  if (!app.data) return;
  for (const row of app.jointRows) {
    const deg = THREE.MathUtils.clamp((app.data.ctrl[row.i] * DEG) || 0, row.lo, row.hi);
    row.input.value = String(Math.round(deg));
    updateJointValue(row, row.valueEl);
  }
}

/* ── 姿态预设 ─────────────────────────────────── */
function buildPoseUI() {
  const { mujoco, model } = app;
  ui.poseRow.innerHTML = '';
  app.keyframeCount = model.nkey;

  for (let k = 0; k < model.nkey; k++) {
    let name = `KEY ${k}`;
    try {
      name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_KEY.value, k) || name;
    } catch (e) {}
    const btn = document.createElement('button');
    btn.className = 'pose-btn';
    btn.textContent = name;
    btn.dataset.key = String(k);
    btn.addEventListener('click', () => applyKeyframe(k));
    ui.poseRow.appendChild(btn);
  }
  markActivePose(0);
}

function markActivePose(index) {
  ui.poseRow.querySelectorAll('.pose-btn').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.key) === index);
  });
}

function applyKeyframe(index, { silent = false } = {}) {
  const { mujoco, model, data } = app;
  if (!model || !data) return;
  try {
    mujoco.mj_resetDataKeyframe(model, data, index);
  } catch (e) {
    // 老版本绑定没有这个函数就手动搬一遍
    const qadr = index * model.nq;
    for (let i = 0; i < model.nq; i++) data.qpos[i] = model.key_qpos[qadr + i];
    for (let i = 0; i < model.nu; i++) data.ctrl[i] = model.key_ctrl[index * model.nu + i];
  }
  mujoco.mj_forward(model, data);
  app.simTime = 0;
  app.acc = 0;
  if (!silent) markActivePose(index);
  syncSlidersFromCtrl();
  updateBodyTransforms(app);
}

/* ── 执行器增益 ───────────────────────────────── */
function cacheActuatorGains() {
  const { model } = app;
  const stride = model.actuator_gainprm.length / Math.max(model.nu, 1);
  app.baseGains = [];
  for (let i = 0; i < model.nu; i++) {
    app.baseGains.push({
      gain: model.actuator_gainprm[i * stride],
      bias: model.actuator_biasprm[i * stride + 1],
    });
  }
  app.gainStride = stride;
}

function applyKpScale(scale) {
  const { model } = app;
  if (!app.baseGains.length) return;
  for (let i = 0; i < model.nu; i++) {
    const s = app.gainStride;
    model.actuator_gainprm[i * s] = app.baseGains[i].gain * scale;
    model.actuator_biasprm[i * s + 1] = app.baseGains[i].bias * scale;
  }
  app.kpScale = scale;
  ui.kpValue.textContent = `${scale.toFixed(1)}×`;
}

/* ── 拖拽施力 ─────────────────────────────────── */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let drag = null;

function setPointer(event) {
  const rect = ui.canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

ui.canvas.addEventListener('pointerdown', (event) => {
  if (!app.data) return;
  setPointer(event);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(app.visualMeshes, false);
  const hit = hits.find((h) => h.object.userData.bodyID > 0);
  if (!hit) return;

  const normal = camera.getWorldDirection(new THREE.Vector3());
  drag = {
    bodyID: hit.object.userData.bodyID,
    plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.point),
    hit: hit.point.clone(),
    current: hit.point.clone(),
  };
  controls.enabled = false;
  ui.canvas.setPointerCapture(event.pointerId);
});

ui.canvas.addEventListener('pointermove', (event) => {
  if (!drag) return;
  setPointer(event);
  raycaster.setFromCamera(pointer, camera);
  const p = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(drag.plane, p)) drag.current.copy(p);
});

function endDrag(event) {
  if (!drag) return;
  drag = null;
  controls.enabled = true;
  try { ui.canvas.releasePointerCapture(event.pointerId); } catch (e) {}
}
ui.canvas.addEventListener('pointerup', endDrag);
ui.canvas.addEventListener('pointercancel', endDrag);

/* ── 物理步进 ─────────────────────────────────── */
function applyExternalForces() {
  const { data, model } = app;
  if (!data.xfrc_applied) return;
  data.xfrc_applied.fill(0);

  if (drag) {
    const mass = model.body_mass[drag.bodyID] || 0.2;
    const offset = drag.current.clone().sub(drag.hit);
    offset.multiplyScalar(mass * 380);
    const base = drag.bodyID * 6;
    data.xfrc_applied[base + 0] = offset.x;
    data.xfrc_applied[base + 1] = offset.y;
    data.xfrc_applied[base + 2] = offset.z;
  }

  if (app.poke) {
    app.poke.t -= model.opt.timestep;
    const base = 1 * 6;
    data.xfrc_applied[base + 0] += app.poke.fx;
    data.xfrc_applied[base + 1] += app.poke.fy;
    if (app.poke.t <= 0) app.poke = null;
  }
}

function stepOnce() {
  const { model, data } = app;
  if (app.suspend) {
    // 悬吊：把自由关节钉在空中，只让四肢受物理与执行器影响
    data.qpos[0] = 0;
    data.qpos[1] = 0;
    data.qpos[2] = app.suspendHeight;
    data.qpos[3] = 1;
    data.qpos[4] = 0;
    data.qpos[5] = 0;
    data.qpos[6] = 0;
    for (let i = 0; i < 6; i++) data.qvel[i] = 0;
  }
  applyExternalForces();
  app.mujoco.mj_step(model, data);
  app.simTime += model.opt.timestep;
  if (app.simTime < 0) app.simTime = 0;
}

/* ── 遥测 ─────────────────────────────────────── */
let lastUiUpdate = 0;

function updateTelemetry(now) {
  if (!app.data || now - lastUiUpdate < 100) return;
  lastUiUpdate = now;

  const { data } = app;
  ui.tHeight.textContent = `${(data.qpos[2] * 100).toFixed(1)} cm`;

  const w = data.qpos[3];
  const x = data.qpos[4];
  const y = data.qpos[5];
  const z = data.qpos[6];
  const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)) * DEG;
  const pitch = Math.asin(THREE.MathUtils.clamp(2 * (w * y - z * x), -1, 1)) * DEG;
  ui.tTilt.textContent = `${pitch.toFixed(0)}° / ${roll.toFixed(0)}°`;
  ui.tContact.textContent = String(data.ncon);
  const tilted = Math.abs(pitch) > 42 || Math.abs(roll) > 42;
  if (tilted !== app.tilted) {
    app.tilted = tilted;
    ui.tiltHint.hidden = !tilted;
  }
  ui.tTime.textContent = `${app.simTime.toFixed(2)} s`;

  for (const row of app.jointRows) updateJointValue(row, row.valueEl);
}

/* ── 主循环 ───────────────────────────────────── */
function frame(now) {
  requestAnimationFrame(frame);
  if (!app.lastFrame) app.lastFrame = now;
  const dt = Math.min((now - app.lastFrame) / 1000, 0.05);
  app.lastFrame = now;

  app.fpsSmooth = app.fpsSmooth * 0.9 + (1 / Math.max(dt, 1e-4)) * 0.1;
  ui.fps.textContent = String(Math.round(app.fpsSmooth));

  if (app.data && !app.paused) {
    const h = app.model.opt.timestep;
    app.acc += dt * app.speed;
    let guard = 0;
    while (app.acc >= h && guard < 500) {
      stepOnce();
      app.acc -= h;
      guard += 1;
    }
    updateBodyTransforms(app);
    updateTelemetry(now);
  }

  controls.update();
  renderer.render(scene, camera);
}

/* ── 交互绑定 ─────────────────────────────────── */
function setPaused(paused) {
  app.paused = paused;
  ui.play.textContent = paused ? '继续' : '暂停';
  ui.play.classList.toggle('primary', !paused);
}

ui.play.addEventListener('click', () => setPaused(!app.paused));

ui.step.addEventListener('click', () => {
  if (!app.data) return;
  setPaused(true);
  for (let i = 0; i < 10; i++) stepOnce();
  updateBodyTransforms(app);
  updateTelemetry(performance.now() + 1000);
});

ui.reset.addEventListener('click', () => {
  const idx = Number(ui.poseRow.querySelector('.pose-btn.active')?.dataset.key ?? 0);
  applyKeyframe(idx);
});

ui.camera.addEventListener('click', () => frameCamera());

ui.collision.addEventListener('click', () => {
  app.collisionVisible = !app.collisionVisible;
  ui.collision.classList.toggle('on', app.collisionVisible);
  for (const m of app.collisionMeshes) m.visible = app.collisionVisible;
});

ui.pokeBtn.addEventListener('click', () => {
  app.poke = { t: 0.14, fx: 1.1, fy: 0.25 };
  setPaused(false);
});

ui.kpScale.addEventListener('input', () => {
  applyKpScale(parseFloat(ui.kpScale.value));
});

ui.suspend.addEventListener('click', () => {
  app.suspend = !app.suspend;
  ui.suspend.textContent = `悬吊模式：${app.suspend ? '开' : '关'}`;
  ui.suspend.classList.toggle('on', app.suspend);
  if (app.suspend) {
    // 保持当前姿态，只把躯干拎起来
    app.suspendHeight = Math.max(app.data.qpos[2], 0.12);
  }
});

document.querySelectorAll('.chip[data-speed]').forEach((chip) => {
  chip.addEventListener('click', () => {
    app.speed = Number(chip.dataset.speed);
    document.querySelectorAll('.chip[data-speed]').forEach((c) => c.classList.toggle('active', c === chip));
  });
});

ui.sceneSelect.addEventListener('change', async () => {
  const file = ui.sceneSelect.value;
  try {
    await loadModel(file);
  } catch (e) {
    showError(e);
  }
});

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.code === 'Space') {
    event.preventDefault();
    setPaused(!app.paused);
  } else if (event.key === 'r' || event.key === 'R') {
    ui.reset.click();
  }
});

/* ── 启动 ─────────────────────────────────────── */
async function boot() {
  resize();
  requestAnimationFrame(frame);

  setLoading('启动 MuJoCo 引擎…', 0.05);
  const mujoco = await loadMujoco({
    locateFile: (p) => (p.endsWith('.wasm') ? './vendor/mujoco/mujoco.wasm' : p),
  });
  app.mujoco = mujoco;

  let version = '3.16';
  try { version = mujoco.mj_versionString?.() || version; } catch (e) {}
  ui.engine.textContent = version;

  setLoading('载入模型资产（约 24 MB）…', 0.1);
  const count = await mountModelFiles(mujoco);
  console.log(`[microduck] 已挂载 ${count} 个模型文件`);

  setLoading('编译场景…', 0.95);
  await loadModel('scene.xml');
  setPaused(false);
}

boot().catch(showError);

// 调试入口：控制台里可以直接看 mjModel / MjData
window.__microduck = app;
