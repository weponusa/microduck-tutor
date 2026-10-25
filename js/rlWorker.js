import loadMujoco from '../vendor/mujoco/mujoco.js';
import { MicroDuckEnv, TASK_CONFIG } from './rlEnv.js';
import { Random, parameterChecksum } from './rlNetwork.js';
import { PPOTrainer } from './rlPpo.js';

const MODEL_BASE = new URL('../assets/mjcf/microduck/', import.meta.url);
const PRETRAINED_URL = new URL('../rl-lab/runs/duck_policy.json', import.meta.url);
const CHECKPOINT_FORMAT = 'microduck-rl-checkpoint-v1';

let mujoco = null;
let env = null;
let trainer = null;
let task = 'stand';
let currentSceneFile = 'scene.xml';
let seed = 1;
let sampleRng = new Random(seed);
let observation = null;
let transitions = [];
let running = false;
let timer = null;
let totalSteps = 0;
let episodeReturn = null;
let episodeCount = 0;
let rolloutSteps = 128;
let lastMetrics = null;
let lastTelemetryAt = 0;
const recentReturns = [];
const recentDistances = [];
const recentVx = [];
const recentVy = [];
let initPromise = null;

function post(message) {
  self.postMessage(message);
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function fail(error, requestId = null) {
  running = false;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  post({ type: 'error', requestId, error: errorText(error), message: errorText(error) });
}

async function fetchChecked(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`资源载入失败：${url} (${response.status})`);
  return response;
}

async function mountAssets() {
  try { mujoco.FS.mkdir('/working'); } catch (_) { /* 已存在 */ }
  try { mujoco.FS.mount(mujoco.MEMFS, { root: '.' }, '/working'); } catch (_) { /* 已挂载 */ }
  try { mujoco.FS.mkdir('/working/assets'); } catch (_) { /* 已存在 */ }
  const manifest = await (await fetchChecked(new URL('manifest.json', MODEL_BASE))).json();
  const files = [
    ...manifest.xml.map((name) => ({ name, binary: false })),
    ...manifest.meshes.map((name) => ({ name: `assets/${name}`, binary: true })),
  ];
  await Promise.all(files.map(async ({ name, binary }) => {
    const response = await fetchChecked(new URL(name, MODEL_BASE));
    const contents = binary ? new Uint8Array(await response.arrayBuffer()) : await response.text();
    mujoco.FS.writeFile(`/working/${name}`, contents);
  }));
}

function createTrainer(fromPretrained, policy) {
  trainer = new PPOTrainer({ obsDim: TASK_CONFIG[task].obsDim, actDim: 14, seed });
  if (fromPretrained) trainer.model.loadActor(policy);
  sampleRng = new Random(seed ^ 0x85ebca6b);
}

function exportActor() {
  if (!trainer || !env) throw new Error('请先等待 init 完成');
  return {
    ...trainer.model.exportActor(),
    task,
    target_velocity: env.targetVelocity,
    gait_period: env.gaitPeriod / 0.02,
    max_steps: env.maxSteps,
    training_steps: totalSteps,
    training_iteration: trainer.iteration,
    scene_file: currentSceneFile,
  };
}

function exportDense(network) {
  return {
    sizes: network.sizes.slice(),
    layers: network.layers.map((layer) => ({
      w: Array.from(layer.w),
      b: Array.from(layer.b),
    })),
  };
}

function loadDense(network, saved) {
  if (!saved || !Array.isArray(saved.sizes) || !Array.isArray(saved.layers) ||
      saved.sizes.length !== network.sizes.length || saved.layers.length !== network.layers.length ||
      saved.sizes.some((size, i) => size !== network.sizes[i])) {
    throw new Error('critic 检查点网络结构不匹配');
  }
  network.layers.forEach((layer, i) => {
    const source = saved.layers[i];
    if (!source || source.w?.length !== layer.w.length || source.b?.length !== layer.b.length ||
        !source.w.every(Number.isFinite) || !source.b.every(Number.isFinite)) {
      throw new Error(`critic 第 ${i} 层检查点无效`);
    }
    layer.w.set(source.w);
    layer.b.set(source.b);
  });
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function metricsMessage(update = null, includeActor = false) {
  const walking = task === 'walk';
  return {
    type: 'metrics',
    task,
    sceneFile: currentSceneFile,
    running,
    iteration: trainer?.iteration ?? 0,
    totalSteps,
    episodeReturn,
    lastReturn: episodeReturn,
    meanReturn: mean(recentReturns),
    episodeCount,
    policyLoss: update?.policyLoss ?? lastMetrics?.policyLoss ?? null,
    valueLoss: update?.valueLoss ?? lastMetrics?.valueLoss ?? null,
    entropy: update?.entropy ?? lastMetrics?.entropy ?? null,
    actorGradNorm: update?.actorGradNorm ?? lastMetrics?.actorGradNorm ?? null,
    criticGradNorm: update?.criticGradNorm ?? lastMetrics?.criticGradNorm ?? null,
    actorChecksum: trainer ? parameterChecksum(trainer.model.actorParameters()) : null,
    criticChecksum: trainer ? parameterChecksum(trainer.model.critic.parameters()) : null,
    distance: walking ? (mean(recentDistances) ?? (env ? env.data.qpos[0] - env.originX : 0)) : null,
    forwardSpeed: walking ? (mean(recentVx) ?? env?.data.qvel[0] ?? 0) : null,
    lateralSpeed: walking ? (mean(recentVy) ?? env?.data.qvel[1] ?? 0) : null,
    actor: includeActor ? exportActor() : undefined,
  };
}

function telemetryMessage(result = null) {
  const forward = trainer.model.actorForward(observation);
  const info = result?.info || {};
  return {
    type: 'telemetry',
    task,
    totalSteps,
    iteration: trainer.iteration,
    observation,
    activations: forward.cache,
    mean: forward.mean,
    criticValue: trainer.model.criticForward(observation).value,
    lastReward: result?.reward ?? null,
    upright: info.upright ?? env.upright(),
    height: info.height ?? env.data.qpos[2],
    contacts: task === 'walk' ? env.footContacts() : [0, 0],
    forwardSpeed: info.vx ?? (task === 'walk' ? env.data.qvel[0] : 0),
    lateralSpeed: info.vy ?? (task === 'walk' ? env.data.qvel[1] : 0),
    distance: info.distance ?? (task === 'walk' ? env.data.qpos[0] - env.originX : 0),
    episodeSteps: info.steps ?? env.steps,
    episodeReturn: info.episodeReturn ?? env.episodeReturn,
    done: Boolean(result?.done),
  };
}

function checkpoint() {
  if (!trainer) throw new Error('请先等待 init 完成');
  return {
    format: CHECKPOINT_FORMAT,
    task,
    sceneFile: currentSceneFile,
    obsDim: env.obsDim,
    actDim: env.actDim,
    seed,
    totalSteps,
    iteration: trainer.iteration,
    episodeReturn,
    episodeCount,
    actor: exportActor(),
    critic: exportDense(trainer.model.critic),
    actorAdam: trainer.actorAdam.export(trainer.model.actorParameters()),
    criticAdam: trainer.criticAdam.export(trainer.model.critic.parameters()),
    trainerRngState: trainer.rng.state >>> 0,
    sampleRngState: sampleRng.state >>> 0,
    recentReturns: recentReturns.slice(),
    recentDistances: recentDistances.slice(),
    recentVx: recentVx.slice(),
    recentVy: recentVy.slice(),
    lastMetrics,
  };
}

function finiteArray(values, limit = 20) {
  if (!Array.isArray(values)) return [];
  return values.filter(Number.isFinite).slice(-limit);
}

function restoreCheckpoint(saved) {
  if (!saved || saved.format !== CHECKPOINT_FORMAT || saved.task !== task ||
      saved.obsDim !== env.obsDim || saved.actDim !== env.actDim) {
    throw new Error('检查点格式、任务或观测/动作维度不匹配');
  }
  if (saved.sceneFile && saved.sceneFile !== currentSceneFile) {
    throw new Error(`检查点场景是 ${saved.sceneFile}，当前是 ${currentSceneFile}`);
  }
  trainer.model.loadActor(saved.actor);
  loadDense(trainer.model.critic, saved.critic);
  trainer.actorAdam.restore(trainer.model.actorParameters(), saved.actorAdam);
  trainer.criticAdam.restore(trainer.model.critic.parameters(), saved.criticAdam);
  if (!Number.isInteger(saved.totalSteps) || saved.totalSteps < 0 ||
      !Number.isInteger(saved.iteration) || saved.iteration < 0) {
    throw new Error('检查点训练进度无效');
  }
  totalSteps = saved.totalSteps;
  trainer.iteration = saved.iteration;
  trainer.rng.state = saved.trainerRngState >>> 0;
  sampleRng.state = saved.sampleRngState >>> 0;
  episodeReturn = Number.isFinite(saved.episodeReturn) ? saved.episodeReturn : null;
  episodeCount = Number.isInteger(saved.episodeCount) ? saved.episodeCount : 0;
  recentReturns.splice(0, recentReturns.length, ...finiteArray(saved.recentReturns));
  recentDistances.splice(0, recentDistances.length, ...finiteArray(saved.recentDistances));
  recentVx.splice(0, recentVx.length, ...finiteArray(saved.recentVx));
  recentVy.splice(0, recentVy.length, ...finiteArray(saved.recentVy));
  lastMetrics = saved.lastMetrics || null;
  transitions = [];
  observation = env.reset();
}

async function initialize(config) {
  task = config.task ?? config.checkpoint?.task ?? 'stand';
  if (!TASK_CONFIG[task]) throw new Error(`未知任务：${task}`);
  const fromPretrained = Boolean(config.fromPretrained);
  if (fromPretrained && task !== 'stand') {
    throw new Error('站立 checkpoint 是 36 维输入，不能直接热启动 43 维行走任务');
  }
  if (fromPretrained && config.checkpoint) throw new Error('恢复检查点时不能再选预训练热启动');
  seed = Number.isFinite(config.seed) ? config.seed : 1;
  currentSceneFile = config.checkpoint?.sceneFile ?? config.sceneFile ?? TASK_CONFIG[task].sceneFile;
  if (typeof currentSceneFile !== 'string' || /[\\/]|\.\./.test(currentSceneFile)) {
    throw new Error('sceneFile 必须是模型目录内的文件名');
  }

  mujoco = await loadMujoco({
    locateFile: (path) => path.endsWith('.wasm') ? new URL('../vendor/mujoco/mujoco.wasm', import.meta.url).href : path,
  });
  await mountAssets();
  let model;
  try {
    model = mujoco.MjModel.mj_loadXML(`/working/${currentSceneFile}`);
  } catch (_) {
    model = mujoco.MjModel.from_xml_path(`/working/${currentSceneFile}`);
  }
  if (!model) throw new Error(`MJCF 解析失败：${currentSceneFile}`);
  const data = new mujoco.MjData(model);
  env = new MicroDuckEnv({ mujoco, model, data, task });
  let policy = null;
  if (fromPretrained) policy = await (await fetchChecked(PRETRAINED_URL)).json();
  createTrainer(fromPretrained, policy);
  observation = env.observation();
  transitions = [];
  totalSteps = 0;
  episodeReturn = null;
  episodeCount = 0;
  recentReturns.length = 0;
  recentDistances.length = 0;
  recentVx.length = 0;
  recentVy.length = 0;
  lastMetrics = null;
  rolloutSteps = Number.isInteger(config.rolloutSteps) && config.rolloutSteps > 0 ? config.rolloutSteps : 128;
  if (config.checkpoint) restoreCheckpoint(config.checkpoint);
  post({
    type: config.checkpoint ? 'restored' : 'ready',
    requestId: config.requestId ?? null,
    task,
    sceneFile: currentSceneFile,
    obsDim: env.obsDim,
    actDim: env.actDim,
    fromPretrained,
    restored: Boolean(config.checkpoint),
    totalSteps,
    iteration: trainer.iteration,
    actorChecksum: parameterChecksum(trainer.model.actorParameters()),
    criticChecksum: parameterChecksum(trainer.model.critic.parameters()),
  });
  lastTelemetryAt = 0;
  post(metricsMessage(null, true));
}

function trainingStep() {
  if (!running || !trainer || !env) return;
  try {
    const sampled = trainer.model.sample(observation, sampleRng);
    const result = env.step(sampled.action);
    const transition = {
      obs: observation,
      action: sampled.action,
      logProb: sampled.logProb,
      value: sampled.value,
      reward: result.reward,
      terminated: result.terminated,
      truncated: result.truncated,
      done: result.done,
      bootstrapValue: result.truncated ? trainer.model.criticForward(result.obs).value : 0,
    };
    transitions.push(transition);
    totalSteps += 1;
    observation = result.obs;

    if (result.done) {
      episodeReturn = result.info.episodeReturn;
      episodeCount += 1;
      recentReturns.push(episodeReturn);
      if (recentReturns.length > 20) recentReturns.shift();
      if (task === 'walk') {
        recentDistances.push(result.info.distance);
        recentVx.push(result.info.vx);
        recentVy.push(result.info.vy);
        for (const values of [recentDistances, recentVx, recentVy]) if (values.length > 20) values.shift();
      }
      observation = env.reset();
    }

    if (transitions.length >= rolloutSteps) {
      const last = transitions[transitions.length - 1];
      const lastValue = last.terminated ? 0 : trainer.model.criticForward(result.obs).value;
      const update = trainer.update(transitions, lastValue);
      transitions = [];
      lastMetrics = metricsMessage(update, true);
      post(lastMetrics);
    }
    const telemetryNow = performance.now();
    if (telemetryNow - lastTelemetryAt >= 100) {
      post(telemetryMessage(result));
      lastTelemetryAt = telemetryNow;
    }
    timer = setTimeout(trainingStep, 0);
  } catch (error) {
    fail(error);
  }
}

function start() {
  if (!trainer || !env) throw new Error('请先等待 init 完成');
  if (running) return;
  running = true;
  post({ type: 'started', task });
  timer = setTimeout(trainingStep, 0);
}

function pause() {
  running = false;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (trainer) post(metricsMessage());
}

function reset(config = {}) {
  if (!trainer || !env) throw new Error('请先等待 init 完成');
  running = false;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (!config.keepModel) createTrainer(false, null);
  observation = env.reset();
  transitions = [];
  totalSteps = 0;
  episodeReturn = null;
  episodeCount = 0;
  recentReturns.length = 0;
  recentDistances.length = 0;
  recentVx.length = 0;
  recentVy.length = 0;
  lastMetrics = null;
  post(metricsMessage());
}

self.onmessage = async (event) => {
  const message = event.data ?? {};
  const { type, requestId = null } = message;
  try {
    if (type === 'init') {
      if (initPromise) throw new Error('Worker 已执行 init；如需换任务请创建新 Worker');
      initPromise = initialize(message);
      await initPromise;
      return;
    }
    if (initPromise) await initPromise;
    switch (type) {
      case 'start': start(); break;
      case 'pause': pause(); break;
      case 'reset': reset(message); break;
      case 'export': post({ type: 'exported', requestId, task, actor: exportActor() }); break;
      case 'getCheckpoint': post({ type: 'checkpoint', requestId, checkpoint: checkpoint() }); break;
      default: throw new Error(`未知 Worker 消息：${type}`);
    }
  } catch (error) {
    fail(error, requestId);
  }
};
