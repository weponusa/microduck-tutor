import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import loadMujoco from '../vendor/mujoco/mujoco.js';
import { buildMujocoScene, updateBodyTransforms } from './mjcfScene.js';
import { ACT_NAMES, DuckPolicyRuntime, OBS_NAMES, RL, WALK_OBS_NAMES, loadPolicy } from './rlPolicy.js';
import { TrainingClient } from './rlTraining.js';
import { SENSOR_TOPICS, SensorExplorer } from './sensorExplorer.js';

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
  controlMode: 'manual',
  policyNet: null,
  policy: null,
  policySample: false,
  policyError: '',
  policySource: 'pretrained',
  trainer: null,
  trainingReady: false,
  trainingBusy: false,
  trainingMetrics: null,
  trainingHistory: [],
  sensorMode: false,
  sensorSelected: 'camera',
  sensorExplorer: null,
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
  manual: document.getElementById('btn-manual'),
  policy: document.getElementById('btn-policy-control'),
  policyBadge: document.getElementById('policy-mode-badge'),
  policyEval: document.getElementById('policy-eval'),
  policyNote: document.getElementById('policy-note'),
  rReward: document.getElementById('r-reward'),
  rReturn: document.getElementById('r-return'),
  rUpright: document.getElementById('r-upright'),
  rEpisode: document.getElementById('r-episode'),
  rDone: document.getElementById('r-done'),
  policyObs: document.getElementById('policy-obs'),
  policyAct: document.getElementById('policy-act'),
  policyStructure: document.getElementById('policy-structure'),
  policyVectorTitle: document.getElementById('policy-vector-title'),
  policyObsTitle: document.getElementById('policy-obs-title'),
  policyFormula: document.getElementById('policy-formula'),
  trainingTask: document.getElementById('training-task'),
  trainingInit: document.getElementById('training-init'),
  trainingBadge: document.getElementById('training-badge'),
  trainingState: document.getElementById('training-state'),
  trainingStart: document.getElementById('btn-train-start'),
  trainingPause: document.getElementById('btn-train-pause'),
  trainingReset: document.getElementById('btn-train-reset'),
  trainingTest: document.getElementById('btn-train-test'),
  trainingExport: document.getElementById('btn-train-export'),
  trainingSave: document.getElementById('btn-train-save'),
  trainingIteration: document.getElementById('train-iteration'),
  trainingSteps: document.getElementById('train-steps'),
  trainingReturn: document.getElementById('train-return'),
  trainingLastReturn: document.getElementById('train-last-return'),
  trainingPolicyLoss: document.getElementById('train-policy-loss'),
  trainingValueLoss: document.getElementById('train-value-loss'),
  trainingEntropy: document.getElementById('train-entropy'),
  trainingChecksum: document.getElementById('train-checksum'),
  trainingChart: document.getElementById('training-chart'),
  trainingWalkMetrics: document.getElementById('training-walk-metrics'),
  trainingDistance: document.getElementById('train-distance'),
  trainingVx: document.getElementById('train-vx'),
  trainingVy: document.getElementById('train-vy'),
  trainingTaskNote: document.getElementById('training-task-note'),
  walkWarning: document.getElementById('walk-warning'),
  checkpointNote: document.getElementById('checkpoint-note'),
  stageHint: document.getElementById('stage-hint'),
  sensorModeButton: document.getElementById('btn-sensor-mode'),
  sensorToggle: document.getElementById('btn-sensor-toggle'),
  sensorBadge: document.getElementById('sensor-mode-badge'),
  sensorBody: document.getElementById('sensor-explorer-body'),
  sensorTopicList: document.getElementById('sensor-topic-list'),
  sensorTitle: document.getElementById('sensor-title'),
  sensorStatus: document.getElementById('sensor-status'),
  sensorDescription: document.getElementById('sensor-description'),
  sensorReading: document.getElementById('sensor-reading'),
  sensorHardwareLink: document.getElementById('sensor-hardware-link'),
  sensorTofControl: document.getElementById('sensor-tof-control'),
  sensorTofDistance: document.getElementById('sensor-tof-distance'),
  sensorTofValue: document.getElementById('sensor-tof-value'),
  sensorDemo: document.getElementById('sensor-demo'),
  sensorBoundary: document.getElementById('sensor-boundary'),
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

const sensorExplorer = new SensorExplorer({
  scene,
  camera,
  controls,
  canvas: ui.canvas,
  stage: ui.stage,
  onSelect: (id) => selectSensorTopic(id),
});
app.sensorExplorer = sensorExplorer;

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
  sensorExplorer.disposeModel();
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
  app.controlMode = 'manual';
  app.policy = null;

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
  configurePolicyRuntime();
  sensorExplorer.rebuild(app);
  selectSensorTopic(app.sensorSelected);

  ui.dof.textContent = String(model.nq - 7);
  ui.timestep.textContent = `${(model.opt.timestep * 1000).toFixed(1)} ms`;
  ui.sceneSelect.value = sceneFile;
  updateControlModeUI();

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
  app.poke = null;
  if (app.policy) app.policy.resetEpisode();
  if (!silent) markActivePose(index);
  syncSlidersFromCtrl();
  updateBodyTransforms(app);
  updatePolicyTelemetry();
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

/* ── 强化学习策略实验台 ───────────────────────── */
function buildPolicyVectorUI() {
  const obsDim = app.policyNet?.obs_dim || 36;
  const names = obsDim === 43 ? WALK_OBS_NAMES : OBS_NAMES;
  ui.policyStructure.textContent = `${obsDim} → 64 → 64 → 14`;
  ui.policyVectorTitle.textContent = `拆开看这一次决策：${obsDim} 维输入 / 14 维输出`;
  ui.policyObsTitle.textContent = `输入：网络此刻看到的 ${obsDim} 个数`;
  ui.policyObs.innerHTML = names.map((name, i) =>
    `<div class="vector-row" title="obs[${i}] ${name}"><span class="idx">${i}</span><span class="name">${name}</span><span class="num" id="policy-o-${i}">—</span></div>`).join('');
  ui.policyAct.innerHTML = ACT_NAMES.map((name, i) =>
    `<div class="vector-row" title="action[${i}] ${name}"><span class="idx">${i}</span><span class="name">${name}</span><span class="num" id="policy-a-${i}">—</span></div>`).join('');
}

function setPolicyNote(text, kind = '') {
  ui.policyNote.textContent = text;
  ui.policyNote.className = `card-note${kind ? ` ${kind}` : ''}`;
}

function resetPolicyMetrics() {
  ui.rReward.textContent = '—';
  ui.rReturn.textContent = '—';
  ui.rUpright.textContent = '—';
  ui.rEpisode.textContent = '—';
  ui.rDone.textContent = app.policyNet ? '策略模式尚未开启' : '策略权重不可用，手动模式不受影响';
  ui.rDone.className = 'episode-state';
  for (let i = 0; i < (app.policyNet?.obs_dim || 36); i++) document.getElementById(`policy-o-${i}`).textContent = '—';
  for (let i = 0; i < 14; i++) document.getElementById(`policy-a-${i}`).textContent = '—';
}

function updatePolicyTelemetry() {
  const p = app.policy;
  if (app.controlMode !== 'policy' || !p) return;
  ui.rReward.textContent = p.reward === null ? '—' : p.reward.toFixed(4);
  ui.rReturn.textContent = p.totalReturn.toFixed(2);
  ui.rUpright.textContent = p.upright.toFixed(4);
  ui.rEpisode.textContent = `${p.steps} / ${p.maxSteps} 步 · ${(p.steps * RL.controlDt).toFixed(2)} s`;
  ui.rDone.textContent = p.doneReason || (p.steps ? `回合进行中：倾斜超过 45° 或高度低于 6 cm 即终止${p.task === 'walk' ? ` · 前进 ${(p.distance * 100).toFixed(1)} cm` : ''}` : '已从 STAND 复位，等待第一次决策');
  ui.rDone.className = `episode-state${p.doneReason ? (p.steps >= p.maxSteps && !p.doneReason.startsWith('终止') ? ' good' : ' bad') : ''}`;
  for (let i = 0; i < p.lastObservation.length; i++) document.getElementById(`policy-o-${i}`).textContent = p.lastObservation[i].toFixed(3);
  for (let i = 0; i < 14; i++) document.getElementById(`policy-a-${i}`).textContent = p.lastAction[i].toFixed(3);
}

function updateControlModeUI() {
  const active = app.controlMode === 'policy' && !!app.policy;
  ui.manual.classList.toggle('active', !active);
  ui.policy.classList.toggle('active', active);
  ui.manual.setAttribute('aria-pressed', String(!active));
  ui.policy.setAttribute('aria-pressed', String(active));
  ui.policy.disabled = !app.policyNet || !app.model;
  ui.policyEval.disabled = !active;
  ui.policyBadge.textContent = active ? (app.policySample ? '策略 · 采样' : '策略 · 确定性') : '手动控制';
  ui.policyBadge.classList.toggle('on', active);
  ui.sceneSelect.disabled = active || !app.model;
  ui.kpScale.disabled = active;
  ui.suspend.disabled = active;
  for (const row of app.jointRows) row.input.disabled = active;
  ui.poseRow.querySelectorAll('button').forEach((button) => { button.disabled = active; });
  if (!active) resetPolicyMetrics();
}

function policyCompatibilityIssue() {
  if (!app.policyNet) return app.policyError || '真实策略尚未载入';
  const task = app.policyNet.task || (app.policyNet.obs_dim === 43 ? 'walk' : 'stand');
  if (task === 'stand' && app.sceneFile !== 'scene.xml') return '这份站立策略只在 scene.xml 上训练；请先切回「站立 · 地面接触」。';
  if (task === 'walk' && !['scene.xml', 'scene_walk.xml'].includes(app.sceneFile)) return '行走实验需要 scene.xml 或 scene_walk.xml；滚轮脚场景不能用于双足步态评估。';
  if (Math.abs(app.kpScale - 1) > 1e-6) return '请把舵机刚度恢复为 1×，否则比较的是改过的物理参数，不是原训练策略。';
  if (app.suspend) return '请先关闭悬吊模式；策略训练时躯干没有被固定在空中。';
  if (!app.policy) return app.policyError || '当前模型与这份策略不兼容';
  return '';
}

function configurePolicyRuntime() {
  buildPolicyVectorUI();
  app.policy = null;
  app.policyError = '';
  if (app.policyNet) {
    try {
      app.policy = new DuckPolicyRuntime({
        mujoco: app.mujoco,
        model: app.model,
        data: app.data,
        net: app.policyNet,
      });
    } catch (err) {
      app.policyError = err.message;
    }
  }
  updateControlModeUI();
  updatePolicyTelemetry();
  const walk = app.policy?.task === 'walk';
  ui.policyFormula.innerHTML = walk
    ? '行走实验：目标前进速度 5 cm/s；43 维输入额外包含世界系速度、步态相位与左右脚接触。<br>测试时同时看位移、横移、直立度和终止原因；不能只凭回报判断会走路。'
    : '动作不是绝对角度：目标角 = STAND 角度 + 0.35 × 动作<br>奖励 = 1 + 0.5 × max(直立度, 0) − 0.02 × 动作平方和 ÷ 14';
}

function startPolicyEpisode({ autoplay = false } = {}) {
  const issue = policyCompatibilityIssue();
  if (issue) {
    setPolicyNote(issue, 'warn');
    return;
  }
  applyKeyframe(app.policy.standKey);
  app.poke = null;
  setPolicyNote(app.policySample
    ? '采样执行：每个动作加入 log_std 对应的噪声。切换方式或点重置都会从同一 STAND 姿态重开。'
    : '确定性执行：直接取动作均值。它可能弱于采样执行，这正是评估时要检查的差异。', 'good');
  updateControlModeUI();
  updatePolicyTelemetry();
  if (autoplay) setPaused(false);
}

function setControlMode(mode) {
  if (mode === 'manual') {
    app.controlMode = 'manual';
    app.poke = null;
    if (app.policy) app.policy.resetEpisode();
    setPolicyNote('手动模式：拖动关节滑块直接设置目标角。切到真实策略后，这些滑块会锁定，避免两边同时抢控制权。');
    updateControlModeUI();
    return;
  }
  const issue = policyCompatibilityIssue();
  if (issue) {
    setPolicyNote(issue, 'warn');
    return;
  }
  app.controlMode = 'policy';
  startPolicyEpisode({ autoplay: true });
}

/* ── 真实 PPO 训练室 ─────────────────────────── */
function setTrainingState(text, kind = '') {
  ui.trainingState.textContent = text;
  ui.trainingState.className = `training-state${kind ? ` ${kind}` : ''}`;
}

function finiteMetric(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function resetTrainingMetrics() {
  app.trainingMetrics = null;
  app.trainingHistory = [];
  ui.trainingIteration.textContent = '0';
  ui.trainingSteps.textContent = '0';
  ui.trainingReturn.textContent = '—';
  ui.trainingLastReturn.textContent = '—';
  ui.trainingPolicyLoss.textContent = '—';
  ui.trainingValueLoss.textContent = '—';
  ui.trainingEntropy.textContent = '—';
  ui.trainingChecksum.textContent = '—';
  ui.trainingDistance.textContent = '—';
  ui.trainingVx.textContent = '—';
  ui.trainingVy.textContent = '—';
  drawTrainingChart();
  updateTrainingButtons();
}

function updateTrainingButtons() {
  const ready = app.trainingReady;
  const running = !!app.trainer?.running;
  const busy = app.trainingBusy;
  ui.trainingStart.disabled = busy || running;
  ui.trainingStart.textContent = running ? '训练中…' : (ready ? '继续训练' : '开始训练');
  ui.trainingPause.disabled = busy || !ready || !running;
  ui.trainingTest.disabled = busy || !ready;
  ui.trainingExport.disabled = busy || !ready;
  ui.trainingSave.disabled = busy || !ready;
  ui.trainingReset.disabled = busy;
  ui.trainingTask.disabled = busy || running;
  ui.trainingInit.disabled = busy || running;
  ui.trainingBadge.textContent = busy ? '正在初始化' : running ? '真实训练中' : ready ? '已暂停 · 可测试' : '尚未开始';
  ui.trainingBadge.classList.toggle('on', running);
}

function updateTrainingTaskUI() {
  const walk = ui.trainingTask.value === 'walk';
  const pretrainedOption = ui.trainingInit.querySelector('option[value="pretrained"]');
  pretrainedOption.disabled = walk;
  pretrainedOption.textContent = walk ? '站立微调：行走不可直接套用' : '站立微调：载入已有 actor';
  if (walk && ui.trainingInit.value === 'pretrained') ui.trainingInit.value = 'scratch';
  ui.trainingWalkMetrics.hidden = !walk;
  ui.walkWarning.hidden = !walk;
  ui.trainingTaskNote.textContent = walk
    ? '行走实验：43 维观测 = 36 维基础状态 + 世界系前进/横向速度 + 步态相位 sin/cos + 目标速度 + 左右脚接触。奖励同时考察前进、直立、动作和横移，与站立权重完全分开。'
    : '站立：36 维观测，45° 倾斜或低于 6 cm 终止，500 步超时。超时截断会用 critic bootstrap，不与摔倒混为一谈。';
}

function drawTrainingChart() {
  const canvas = ui.trainingChart;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#fbfcfd';
  ctx.fillRect(0, 0, w, h);
  ctx.font = '18px -apple-system, PingFang SC, sans-serif';
  ctx.fillStyle = '#8a94a0';
  if (!app.trainingHistory.length) {
    ctx.fillText('开始训练后，这里画真实回合回报与 PPO 损失', 24, 92);
    return;
  }
  const history = app.trainingHistory;
  const left = 48;
  const right = w - 18;
  const width = right - left;
  const xAt = (i) => left + (history.length === 1 ? 0 : i / (history.length - 1)) * width;

  function panel(y0, y1, series, colors, labels) {
    ctx.strokeStyle = '#e8ecf0';
    ctx.lineWidth = 1;
    for (let j = 0; j <= 2; j++) {
      const y = y0 + (y1 - y0) * j / 2;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    }
    const values = series.flatMap((s) => history.map(s).filter(Number.isFinite));
    if (!values.length) return;
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (Math.abs(hi - lo) < 1e-9) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.08;
    lo -= pad; hi += pad;
    series.forEach((selector, k) => {
      ctx.strokeStyle = colors[k];
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      let started = false;
      history.forEach((item, i) => {
        const value = selector(item);
        if (!Number.isFinite(value)) return;
        const x = xAt(i);
        const y = y1 - (value - lo) / (hi - lo) * (y1 - y0);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.fillStyle = colors[k];
      ctx.font = '17px -apple-system, PingFang SC, sans-serif';
      ctx.fillText(labels[k], left + k * 150, y0 - 7);
    });
    ctx.fillStyle = '#8a94a0';
    ctx.font = '14px SFMono-Regular, Consolas, monospace';
    ctx.fillText(hi.toFixed(2), 4, y0 + 5);
    ctx.fillText(lo.toFixed(2), 4, y1);
  }

  panel(28, 100, [(m) => m.meanReturn], ['#1f8a70'], ['平均回合回报']);
  panel(137, 169, [(m) => m.policyLoss, (m) => m.valueLoss], ['#e08a1e', '#4380ce'], ['策略损失', '价值损失']);
}

function handleTrainingMetrics(message) {
  const previous = app.trainingHistory[app.trainingHistory.length - 1];
  const metric = {
    iteration: Number(message.iteration ?? message.update ?? previous?.iteration ?? 0),
    totalSteps: Number(message.totalSteps ?? message.steps ?? previous?.totalSteps ?? 0),
    meanReturn: Number(message.meanReturn ?? message.episodeReturn ?? message.return ?? NaN),
    lastReturn: Number(message.lastReturn ?? message.lastEpisodeReturn ?? message.episodeReturn ?? NaN),
    policyLoss: Number(message.policyLoss ?? message.actorLoss ?? NaN),
    valueLoss: Number(message.valueLoss ?? message.criticLoss ?? NaN),
    entropy: Number(message.entropy ?? NaN),
    actorChecksum: message.actorChecksum ?? message.actor_checksum ?? message.checksum ?? '',
    distance: Number(message.distance ?? message.meanDistance ?? NaN),
    vx: Number(message.forwardSpeed ?? message.vx ?? NaN),
    vy: Number(message.lateralSpeed ?? message.vy ?? NaN),
    sceneFile: message.sceneFile,
  };
  if (!Number.isFinite(metric.meanReturn) && Number.isFinite(metric.lastReturn)) metric.meanReturn = metric.lastReturn;
  app.trainingMetrics = { ...message, ...metric };
  if (!previous || metric.iteration !== previous.iteration) {
    app.trainingHistory.push(metric);
    if (app.trainingHistory.length > 120) app.trainingHistory.shift();
  } else {
    app.trainingHistory[app.trainingHistory.length - 1] = metric;
  }
  ui.trainingIteration.textContent = String(metric.iteration);
  ui.trainingSteps.textContent = metric.totalSteps.toLocaleString('zh-CN');
  ui.trainingReturn.textContent = finiteMetric(metric.meanReturn, 2);
  ui.trainingLastReturn.textContent = finiteMetric(metric.lastReturn, 2);
  ui.trainingPolicyLoss.textContent = finiteMetric(metric.policyLoss, 4);
  ui.trainingValueLoss.textContent = finiteMetric(metric.valueLoss, 4);
  ui.trainingEntropy.textContent = finiteMetric(metric.entropy, 4);
  ui.trainingChecksum.textContent = metric.actorChecksum === '' ? '—' : String(metric.actorChecksum).slice(0, 14);
  ui.trainingDistance.textContent = Number.isFinite(metric.distance) ? `${(metric.distance * 100).toFixed(1)} cm` : '—';
  ui.trainingVx.textContent = Number.isFinite(metric.vx) ? `${(metric.vx * 100).toFixed(2)} cm/s` : '—';
  ui.trainingVy.textContent = Number.isFinite(metric.vy) ? `${(metric.vy * 100).toFixed(2)} cm/s` : '—';
  drawTrainingChart();
  if (app.trainer?.running) {
    setTrainingState(`正在用真实物理轨迹更新参数 · 第 ${metric.iteration} 轮 · 共 ${metric.totalSteps.toLocaleString('zh-CN')} 次决策。左侧测试画面已暂停。`, 'running');
  }
}

async function initTraining() {
  if (app.trainingBusy) return;
  app.trainingBusy = true;
  updateTrainingButtons();
  const task = ui.trainingTask.value;
  const mode = ui.trainingInit.value;
  try {
    setPaused(true);
    setControlMode('manual');
    let checkpoint = null;
    if (mode === 'resume') {
      checkpoint = await app.trainer.loadCheckpoint(task);
      if (!checkpoint) throw new Error('这个任务还没有本地检查点。请先训练并保存，或改为从零开始。');
    }
    setTrainingState(mode === 'resume' ? '正在恢复 actor、critic、Adam 和训练步数…' : '正在启动第二套 MuJoCo 物理环境…');
    await app.trainer.init({ task, fromPretrained: mode === 'pretrained', checkpoint });
    app.trainingReady = true;
    resetTrainingMetrics();
    const label = task === 'walk' ? '行走实验' : '站立';
    setTrainingState(`${label}环境已就绪。点击“开始训练”后才会采样和更新权重；训练期间左侧测试保持暂停。`);
  } catch (error) {
    app.trainingReady = false;
    setTrainingState(error.message, 'error');
    console.error(error);
  } finally {
    app.trainingBusy = false;
    updateTrainingButtons();
  }
}

async function exportTrainingActor() {
  if (!app.trainingReady) throw new Error('请先初始化并完成至少一次训练准备');
  const actor = await app.trainer.exportActor();
  if (!actor) throw new Error('训练引擎没有返回 actor');
  return actor;
}

async function testTrainingPolicy() {
  if (app.trainingBusy) return;
  app.trainingBusy = true;
  updateTrainingButtons();
  try {
    app.trainer.pause();
    setTrainingState('正在取出当前 actor 权重并装入左侧物理沙盒…');
    const actor = await exportTrainingActor();
    app.policyNet = actor;
    app.policySource = 'trained';
    const task = actor.task || ui.trainingTask.value;
    const sceneFile = app.trainingMetrics?.sceneFile || (task === 'walk' ? 'scene_walk.xml' : 'scene.xml');
    if (app.sceneFile !== sceneFile) await loadModel(sceneFile);
    else configurePolicyRuntime();
    app.controlMode = 'policy';
    startPolicyEpisode({ autoplay: true });
    setPolicyNote(`正在测试本次浏览器训练的 ${task === 'walk' ? '行走实验' : '站立'} actor。训练已暂停；这不是预训练权重或预录轨迹。`, 'good');
    setTrainingState('当前 actor 已装入左侧。你可以切确定性/采样、单步 20 ms 或推一下；点“继续训练”不会改动这份测试快照。');
  } catch (error) {
    setTrainingState(`测试失败：${error.message}`, 'error');
    console.error(error);
  } finally {
    app.trainingBusy = false;
    updateTrainingButtons();
  }
}

async function downloadTrainingPolicy() {
  try {
    app.trainer.pause();
    const actor = await exportTrainingActor();
    const task = actor.task || ui.trainingTask.value;
    const steps = app.trainingMetrics?.totalSteps || 0;
    const blob = new Blob([JSON.stringify(actor, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `microduck-${task}-actor-${steps}steps.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setTrainingState('已导出当前 actor 推理权重。完整续训状态请用“保存检查点”，它另外包含 critic 和 Adam。');
  } catch (error) {
    setTrainingState(`导出失败：${error.message}`, 'error');
  }
}

async function saveTrainingCheckpoint() {
  try {
    app.trainer.pause();
    setTrainingState('正在保存 actor、critic、Adam 与训练进度到本机浏览器…');
    await app.trainer.saveCheckpoint();
    ui.checkpointNote.textContent = `已保存 ${ui.trainingTask.value === 'walk' ? '行走' : '站立'}检查点。刷新后选择“继续本地检查点”即可恢复。`;
    setTrainingState('检查点已保存在本机 IndexedDB，不会上传。当前仍处于暂停状态。');
  } catch (error) {
    setTrainingState(`保存失败：${error.message}`, 'error');
  }
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
  const policyActive = app.controlMode === 'policy' && app.policy && !app.policy.doneReason;
  if (policyActive && app.policy.phase === 0) app.policy.beforePhysicsStep(app.policySample);
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
  if (policyActive) {
    const episode = app.policy.afterPhysicsStep();
    if (episode && episode.doneReason) {
      app.acc = 0;
      setPaused(true);
      updatePolicyTelemetry();
    }
  }
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
  updatePolicyTelemetry();
}

/* ── 传感器互动拆解 ───────────────────────────── */
const SENSOR_HARDWARE_LESSONS = {
  camera: 'camera', tof: 'tof', bodyImu: 'imu', headImu: 'imu', joints: 'servo',
  audio: 'audio', nfc: 'nfc', feet: 'feet', wireless: 'wireless',
};
let lastSensorReading = 0;

function updateSensorReading() {
  if (!app.sensorMode) return;
  try {
    ui.sensorReading.textContent = sensorExplorer.getReading(app.sensorSelected) || '当前没有可显示的读数';
  } catch (error) {
    ui.sensorReading.textContent = `读数暂不可用：${error.message}`;
  }
}

function selectSensorTopic(id) {
  const topic = SENSOR_TOPICS.find((item) => item.id === id) || SENSOR_TOPICS[0];
  app.sensorSelected = topic.id;
  if (sensorExplorer.selected !== topic.id) sensorExplorer.select(topic.id);
  ui.sensorTopicList.querySelectorAll('button').forEach((button) => {
    const active = button.dataset.sensor === topic.id;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  ui.sensorTitle.textContent = topic.title;
  ui.sensorStatus.textContent = topic.status;
  ui.sensorStatus.className = 'sensor-status';
  if (topic.id === 'feet') ui.sensorStatus.classList.add('unconfirmed');
  else if (['bodyImu', 'joints'].includes(topic.id)) ui.sensorStatus.classList.add('simulated');
  ui.sensorDescription.textContent = topic.description;
  ui.sensorBoundary.textContent = topic.boundary;
  ui.sensorTofControl.hidden = topic.id !== 'tof';
  const demoLabels = { audio: '试听合成嘎嘎声（非官方声纹）', nfc: '模拟 NFC 标签靠近', wireless: '演示无线连接脉冲' };
  ui.sensorDemo.hidden = !demoLabels[topic.id];
  ui.sensorDemo.textContent = demoLabels[topic.id] || '';
  ui.sensorHardwareLink.href = `./hardware.html#${SENSOR_HARDWARE_LESSONS[topic.id] || 'system'}`;
  updateSensorReading();
}

function setSensorMode(enabled) {
  app.sensorMode = enabled;
  sensorExplorer.setEnabled(enabled);
  ui.sensorBody.hidden = !enabled;
  ui.sensorToggle.textContent = enabled ? '退出传感器模式' : '进入传感器模式';
  ui.sensorToggle.setAttribute('aria-pressed', String(enabled));
  ui.sensorModeButton.textContent = enabled ? '× 退出拆解' : '◎ 传感器拆解';
  ui.sensorModeButton.classList.toggle('active', enabled);
  ui.sensorModeButton.setAttribute('aria-pressed', String(enabled));
  ui.sensorBadge.textContent = enabled ? '互动中' : '9 个观察点';
  ui.sensorBadge.classList.toggle('on', enabled);
  ui.stageHint.innerHTML = enabled
    ? '<kbd>点标签</kbd> 选择传感器 · <kbd>拖拽空白处</kbd> 旋转 · 彩色动态图形为教学示意'
    : '<kbd>拖拽</kbd> 旋转视角 · <kbd>滚轮</kbd> 缩放 · <kbd>直接拖机器人</kbd> 施加外力';
  if (enabled) selectSensorTopic(app.sensorSelected);
}

for (const topic of SENSOR_TOPICS) {
  const button = document.createElement('button');
  button.className = 'sensor-topic';
  button.dataset.sensor = topic.id;
  button.textContent = topic.short;
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => selectSensorTopic(topic.id));
  ui.sensorTopicList.appendChild(button);
}
ui.sensorToggle.addEventListener('click', () => setSensorMode(!app.sensorMode));
ui.sensorModeButton.addEventListener('click', () => setSensorMode(!app.sensorMode));
ui.sensorTofDistance.addEventListener('input', () => {
  const distance = Number(ui.sensorTofDistance.value);
  ui.sensorTofValue.textContent = `${distance} cm`;
  sensorExplorer.setTofDistance(distance);
  updateSensorReading();
});
ui.sensorDemo.addEventListener('click', async () => {
  try {
    await sensorExplorer.runDemo(app.sensorSelected);
  } catch (error) {
    ui.sensorReading.textContent = `演示未能启动：${error.message}`;
  }
  updateSensorReading();
});

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
    while (app.acc >= h && guard < 500 && !app.paused) {
      stepOnce();
      app.acc -= h;
      guard += 1;
    }
    updateBodyTransforms(app);
    updateTelemetry(now);
  }

  controls.update();
  sensorExplorer.update(now);
  if (app.sensorMode && now - lastSensorReading > 120) {
    updateSensorReading();
    lastSensorReading = now;
  }
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
  if (app.controlMode === 'policy' && app.policy?.doneReason) {
    setPolicyNote('这一回合已经结束。先点「重置」回到 STAND，再逐次单步。', 'warn');
    return;
  }
  setPaused(true);
  for (let i = 0; i < 10; i++) stepOnce();
  updateBodyTransforms(app);
  updateTelemetry(performance.now() + 1000);
});

ui.reset.addEventListener('click', () => {
  if (app.controlMode === 'policy' && app.policy) {
    startPolicyEpisode();
    return;
  }
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
  if (app.controlMode === 'policy' && app.policy?.doneReason) {
    setPolicyNote('这一回合已经结束。先点「重置」，再推它做下一次测试。', 'warn');
    return;
  }
  app.poke = { t: 0.14, fx: 1.1, fy: 0.25 };
  setPaused(false);
});

ui.manual.addEventListener('click', () => setControlMode('manual'));
ui.policy.addEventListener('click', () => setControlMode('policy'));
ui.policyEval.addEventListener('change', () => {
  app.policySample = ui.policyEval.value === 'sample';
  if (app.controlMode === 'policy') startPolicyEpisode({ autoplay: true });
  updateControlModeUI();
});

ui.trainingStart.addEventListener('click', async () => {
  if (!app.trainingReady) {
    await initTraining();
    if (!app.trainingReady) return;
  }
  try {
    setPaused(true);
    app.trainer.start();
    updateTrainingButtons();
  } catch (error) {
    setTrainingState(error.message, 'error');
  }
});
ui.trainingPause.addEventListener('click', () => {
  app.trainer?.pause();
  setTrainingState('已暂停：不再采样，也不再更新参数。可测试当前 actor、保存检查点或继续训练。');
  updateTrainingButtons();
});
ui.trainingReset.addEventListener('click', async () => {
  const taskName = ui.trainingTask.value === 'walk' ? '行走实验' : '站立';
  if (!window.confirm(`重新初始化${taskName}？这会清空当前训练 worker 和该任务的本地检查点；已导出的 JSON 不受影响。`)) return;
  app.trainer?.pause();
  app.trainer?.dispose();
  app.trainingReady = false;
  await app.trainer?.clearCheckpoint(ui.trainingTask.value);
  resetTrainingMetrics();
  await initTraining();
});
ui.trainingTask.addEventListener('change', async () => {
  app.trainer?.pause();
  app.trainer?.dispose();
  app.trainingReady = false;
  resetTrainingMetrics();
  updateTrainingTaskUI();
  setTrainingState('任务已切换。站立与行走使用不同观测和权重，点击“开始训练”创建对应环境。');
  try {
    const checkpoint = await app.trainer.loadCheckpoint(ui.trainingTask.value);
    ui.checkpointNote.textContent = checkpoint
      ? '检测到该任务的本地检查点；在“初始权重”中选择“继续本地检查点”即可恢复。'
      : '该任务还没有本地检查点。训练后可手动保存。';
  } catch (error) {
    ui.checkpointNote.textContent = `无法读取本地检查点：${error.message}`;
  }
});
ui.trainingInit.addEventListener('change', () => {
  if (app.trainingReady) {
    app.trainer?.pause();
    app.trainer?.dispose();
    app.trainingReady = false;
    resetTrainingMetrics();
    setTrainingState('初始权重方式已改变；点击“开始训练”重新创建环境。');
  }
});
ui.trainingTest.addEventListener('click', testTrainingPolicy);
ui.trainingExport.addEventListener('click', downloadTrainingPolicy);
ui.trainingSave.addEventListener('click', saveTrainingCheckpoint);

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
  buildPolicyVectorUI();
  resetPolicyMetrics();
  app.trainer = new TrainingClient({
    onMetrics: handleTrainingMetrics,
    onStatus: () => updateTrainingButtons(),
    onError: (error) => setTrainingState(`训练错误：${error.message}`, 'error'),
  });
  updateTrainingTaskUI();
  resetTrainingMetrics();
  requestAnimationFrame(frame);

  setLoading('启动 MuJoCo 引擎…', 0.05);
  const mujoco = await loadMujoco({
    locateFile: (p) => (p.endsWith('.wasm') ? './vendor/mujoco/mujoco.wasm' : p),
  });
  app.mujoco = mujoco;

  let version = '3.16';
  try { version = mujoco.mj_versionString?.() || version; } catch (e) {}
  ui.engine.textContent = version;

  setLoading('载入真实 PPO 策略…', 0.08);
  try {
    app.policyNet = await loadPolicy();
  } catch (err) {
    app.policyError = err.message;
    setPolicyNote(`策略未能载入：${err.message}。手动物理沙盒仍可使用。`, 'warn');
    console.error(err);
  }

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
