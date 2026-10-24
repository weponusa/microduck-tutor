export const POLICY_URL = './rl-lab/runs/duck_policy.json';

export const RL = Object.freeze({
  frameSkip: 10,
  controlDt: 0.02,
  actionScale: 0.35,
  tiltLimit: Math.cos(Math.PI / 4),
  heightLimit: 0.06,
  maxSteps: 500,
});

export const OBS_NAMES = [
  '姿态 w', '姿态 x', '姿态 y', '姿态 z',
  '角速度 x', '角速度 y', '角速度 z',
  '左髋偏航', '左髋横滚', '左髋俯仰', '左膝', '左踝',
  '颈俯仰', '头俯仰', '头偏航', '头横滚',
  '右髋偏航', '右髋横滚', '右髋俯仰', '右膝', '右踝',
  '左髋偏航速度', '左髋横滚速度', '左髋俯仰速度', '左膝速度', '左踝速度',
  '颈俯仰速度', '头俯仰速度', '头偏航速度', '头横滚速度',
  '右髋偏航速度', '右髋横滚速度', '右髋俯仰速度', '右膝速度', '右踝速度',
  '根节点高度',
];

export const ACT_NAMES = [
  '左髋偏航', '左髋横滚', '左髋俯仰', '左膝', '左踝',
  '颈俯仰', '头俯仰', '头偏航', '头横滚',
  '右髋偏航', '右髋横滚', '右髋俯仰', '右膝', '右踝',
];

function checkLayer(layer, inputDim, label) {
  if (!layer || !Array.isArray(layer.w) || !Array.isArray(layer.b)) {
    throw new Error(`${label} 缺少权重或偏置`);
  }
  if (layer.b.length !== layer.w.length) throw new Error(`${label} 的偏置维度不一致`);
  layer.w.forEach((row, i) => {
    if (!Array.isArray(row) || row.length !== inputDim) {
      throw new Error(`${label} 第 ${i} 行维度应为 ${inputDim}`);
    }
    if (!row.every(Number.isFinite) || !Number.isFinite(layer.b[i])) {
      throw new Error(`${label} 含非有限数值`);
    }
  });
}

export function validatePolicy(net) {
  if (!net || net.obs_dim !== 36 || net.act_dim !== 14) {
    throw new Error('策略必须是 36 维观测、14 维动作');
  }
  if (net.activation !== 'tanh' || !Array.isArray(net.layers) || net.layers.length !== 2) {
    throw new Error('策略结构应为两层 tanh 隐藏层');
  }
  let inputDim = net.obs_dim;
  net.layers.forEach((layer, i) => {
    checkLayer(layer, inputDim, `隐藏层 ${i + 1}`);
    inputDim = layer.w.length;
  });
  if (net.layers[0].w.length !== 64 || net.layers[1].w.length !== 64) {
    throw new Error('策略结构应为 36 → 64 → 64 → 14');
  }
  checkLayer(net.action_head, inputDim, '动作头');
  if (net.action_head.w.length !== net.act_dim) throw new Error('动作头输出不是 14 维');
  if (!Array.isArray(net.log_std) || net.log_std.length !== net.act_dim || !net.log_std.every(Number.isFinite)) {
    throw new Error('log_std 必须是 14 个有限数值');
  }
  return net;
}

export async function loadPolicy(url = POLICY_URL) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`策略载入失败：${response.status}`);
  return validatePolicy(await response.json());
}

function defaultNormal() {
  const u1 = Math.max(Math.random(), 1e-12);
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function forwardPolicy(net, observation, { sample = false, normal = defaultNormal } = {}) {
  if (!observation || observation.length !== net.obs_dim) {
    throw new Error(`观测必须是 ${net.obs_dim} 维`);
  }
  let h = observation;
  for (const layer of net.layers) {
    const out = new Float64Array(layer.w.length);
    for (let o = 0; o < layer.w.length; o++) {
      const row = layer.w[o];
      let value = layer.b[o];
      for (let i = 0; i < row.length; i++) value += row[i] * h[i];
      out[o] = Math.tanh(value);
    }
    h = out;
  }

  const action = new Float64Array(net.act_dim);
  for (let o = 0; o < net.act_dim; o++) {
    const row = net.action_head.w[o];
    let value = net.action_head.b[o];
    for (let i = 0; i < row.length; i++) value += row[i] * h[i];
    if (sample) value += Math.exp(net.log_std[o]) * normal();
    action[o] = Math.max(-1, Math.min(1, value));
  }
  return action;
}

export class DuckPolicyRuntime {
  constructor({ mujoco, model, data, net }) {
    validatePolicy(net);
    if (!model || !data || !mujoco) throw new Error('物理模型尚未就绪');
    if (model.nu !== net.act_dim) throw new Error(`当前场景有 ${model.nu} 个执行器，策略需要 14 个`);

    this.mujoco = mujoco;
    this.model = model;
    this.data = data;
    this.net = net;
    this.qposAdr = [];
    this.dofAdr = [];
    for (let j = 1; j < model.njnt; j++) {
      if (model.jnt_type[j] === mujoco.mjtJoint.mjJNT_HINGE.value) {
        this.qposAdr.push(model.jnt_qposadr[j]);
        this.dofAdr.push(model.jnt_dofadr[j]);
      }
    }
    if (this.qposAdr.length !== 14) throw new Error('当前场景的 14 个 hinge 关节与策略不匹配');

    this.trunk = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, 'trunk_base');
    if (this.trunk < 0) throw new Error('当前场景缺少 trunk_base 躯干');

    this.standKey = -1;
    for (let k = 0; k < model.nkey; k++) {
      const name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_KEY.value, k);
      if (name && name.toUpperCase() === 'STAND') this.standKey = k;
    }
    if (this.standKey < 0) throw new Error('当前场景缺少 STAND 初始姿态');

    this.nominal = new Float64Array(model.nu);
    for (let i = 0; i < model.nu; i++) {
      this.nominal[i] = model.key_ctrl[this.standKey * model.nu + i];
    }
    this.resetEpisode();
  }

  resetEpisode() {
    this.phase = 0;
    this.steps = 0;
    this.reward = null;
    this.actionPenalty = 0;
    this.totalReturn = 0;
    this.upright = this.getUpright();
    this.height = this.data.qpos[2];
    this.doneReason = '';
    this.lastObservation = this.getObservation();
    this.lastAction = new Float64Array(this.net.act_dim);
    this.seed = 20261023;
  }

  randomNormal() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    const u1 = Math.max(this.seed / 4294967296, 1e-7);
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    const u2 = this.seed / 4294967296;
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  getObservation() {
    const { data } = this;
    const obs = new Float64Array(36);
    obs[0] = data.qpos[3]; obs[1] = data.qpos[4]; obs[2] = data.qpos[5]; obs[3] = data.qpos[6];
    obs[4] = data.qvel[3]; obs[5] = data.qvel[4]; obs[6] = data.qvel[5];
    for (let i = 0; i < 14; i++) obs[7 + i] = data.qpos[this.qposAdr[i]];
    for (let i = 0; i < 14; i++) obs[21 + i] = data.qvel[this.dofAdr[i]];
    obs[35] = data.qpos[2];
    return obs;
  }

  getUpright() {
    return this.data.xmat[this.trunk * 9 + 8];
  }

  beforePhysicsStep(sample) {
    if (this.doneReason || this.phase !== 0) return;
    const observation = this.getObservation();
    const action = forwardPolicy(this.net, observation, {
      sample,
      normal: () => this.randomNormal(),
    });
    for (let i = 0; i < this.model.nu; i++) {
      this.data.ctrl[i] = this.nominal[i] + RL.actionScale * action[i];
    }
    this.lastObservation = observation;
    this.lastAction = action;
  }

  afterPhysicsStep() {
    if (this.doneReason) return null;
    this.phase += 1;
    if (this.phase < RL.frameSkip) return null;
    this.phase = 0;
    this.steps += 1;
    this.upright = this.getUpright();
    this.height = this.data.qpos[2];

    let actionPenalty = 0;
    for (const action of this.lastAction) actionPenalty += action * action;
    this.actionPenalty = actionPenalty;
    this.reward = 1 + 0.5 * Math.max(this.upright, 0) - 0.02 * actionPenalty / this.model.nu;
    this.totalReturn += this.reward;

    if (this.upright < RL.tiltLimit) this.doneReason = '终止：躯干倾斜超过 45°';
    else if (this.height < RL.heightLimit) this.doneReason = '终止：根节点高度低于 6 cm';
    else if (this.steps >= RL.maxSteps) this.doneReason = '完成：500 步 / 10 秒';
    return this;
  }
}
