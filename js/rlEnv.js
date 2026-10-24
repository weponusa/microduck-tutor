export const RL_ENV = Object.freeze({
  frameSkip: 10,
  controlDt: 0.02,
  actionScale: 0.35,
  tiltLimit: Math.cos(Math.PI / 4),
  heightLimit: 0.06,
});

export const TASK_CONFIG = Object.freeze({
  stand: Object.freeze({ obsDim: 36, sceneFile: 'scene.xml', maxSteps: 500 }),
  walk: Object.freeze({ obsDim: 43, sceneFile: 'scene_walk.xml', maxSteps: 1000, targetVelocity: 0.05, gaitPeriod: 0.8 }),
});

function name2id(mujoco, model, type, name) {
  return mujoco.mj_name2id(model, type.value, name);
}

export class MicroDuckEnv {
  constructor({ mujoco, model, data, task = 'stand', targetVelocity, maxSteps }) {
    if (!TASK_CONFIG[task]) throw new Error(`未知任务：${task}`);
    if (!mujoco || !model || !data) throw new Error('MuJoCo model/data 尚未就绪');
    this.mujoco = mujoco;
    this.model = model;
    this.data = data;
    this.task = task;
    this.config = TASK_CONFIG[task];
    this.obsDim = this.config.obsDim;
    this.actDim = model.nu;
    this.maxSteps = maxSteps ?? this.config.maxSteps;
    this.targetVelocity = targetVelocity ?? this.config.targetVelocity ?? 0;
    this.gaitPeriod = this.config.gaitPeriod ?? 0.8;

    if (model.nu !== 14) throw new Error(`当前场景有 ${model.nu} 个执行器，训练环境需要 14 个`);
    this.qposAdr = [];
    this.dofAdr = [];
    for (let j = 1; j < model.njnt; j++) {
      if (model.jnt_type[j] === mujoco.mjtJoint.mjJNT_HINGE.value) {
        this.qposAdr.push(model.jnt_qposadr[j]);
        this.dofAdr.push(model.jnt_dofadr[j]);
      }
    }
    if (this.qposAdr.length !== 14) throw new Error('当前场景的 14 个 hinge 关节与训练环境不匹配');

    this.trunk = name2id(mujoco, model, mujoco.mjtObj.mjOBJ_BODY, 'trunk_base');
    if (this.trunk < 0) throw new Error('当前场景缺少 trunk_base');
    this.standKey = -1;
    for (let k = 0; k < model.nkey; k++) {
      const name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_KEY.value, k);
      if (name && name.toUpperCase() === 'STAND') this.standKey = k;
    }
    if (this.standKey < 0) throw new Error('当前场景缺少 STAND keyframe');
    this.nominal = new Float64Array(model.nu);
    for (let i = 0; i < model.nu; i++) this.nominal[i] = model.key_ctrl[this.standKey * model.nu + i];

    if (task === 'walk') {
      this.leftFootGeom = name2id(mujoco, model, mujoco.mjtObj.mjOBJ_GEOM, 'left_foot_collision');
      this.rightFootGeom = name2id(mujoco, model, mujoco.mjtObj.mjOBJ_GEOM, 'right_foot_collision');
      this.floorGeom = name2id(mujoco, model, mujoco.mjtObj.mjOBJ_GEOM, 'floor');
      if (this.leftFootGeom < 0 || this.rightFootGeom < 0 || this.floorGeom < 0) {
        throw new Error('行走场景缺少左右脚 collision geom 或 floor');
      }
    }
    this.reset();
  }

  reset() {
    const { mujoco, model, data } = this;
    if (typeof mujoco.mj_resetDataKeyframe === 'function') {
      mujoco.mj_resetDataKeyframe(model, data, this.standKey);
    } else {
      mujoco.mj_resetData(model, data);
      data.qpos.set(model.key_qpos.slice(this.standKey * model.nq, (this.standKey + 1) * model.nq));
      data.ctrl.set(model.key_ctrl.slice(this.standKey * model.nu, (this.standKey + 1) * model.nu));
    }
    mujoco.mj_forward(model, data);
    this.steps = 0;
    this.phase = 0;
    this.episodeReturn = 0;
    this.originX = data.qpos[0];
    this.originY = data.qpos[1];
    return this.observation();
  }

  observation() {
    const { data } = this;
    const obs = new Float64Array(this.obsDim);
    obs[0] = data.qpos[3]; obs[1] = data.qpos[4]; obs[2] = data.qpos[5]; obs[3] = data.qpos[6];
    obs[4] = data.qvel[3]; obs[5] = data.qvel[4]; obs[6] = data.qvel[5];
    for (let i = 0; i < 14; i++) obs[7 + i] = data.qpos[this.qposAdr[i]];
    for (let i = 0; i < 14; i++) obs[21 + i] = data.qvel[this.dofAdr[i]];
    obs[35] = data.qpos[2];
    if (this.task === 'walk') {
      const contacts = this.footContacts();
      obs[36] = data.qvel[0];
      obs[37] = data.qvel[1];
      obs[38] = Math.sin(this.phase);
      obs[39] = Math.cos(this.phase);
      obs[40] = this.targetVelocity;
      obs[41] = contacts[0];
      obs[42] = contacts[1];
    }
    return obs;
  }

  footContacts() {
    const { data } = this;
    let left = 0;
    let right = 0;
    for (let i = 0; i < data.ncon; i++) {
      const contact = typeof data.contact?.get === 'function' ? data.contact.get(i) : data.contact[i];
      const g1 = contact.geom1;
      const g2 = contact.geom2;
      if ((g1 === this.leftFootGeom && g2 === this.floorGeom) || (g2 === this.leftFootGeom && g1 === this.floorGeom)) left = 1;
      if ((g1 === this.rightFootGeom && g2 === this.floorGeom) || (g2 === this.rightFootGeom && g1 === this.floorGeom)) right = 1;
    }
    return [left, right];
  }

  upright() {
    return this.data.xmat[this.trunk * 9 + 8];
  }

  step(rawAction) {
    if (rawAction.length !== this.actDim) throw new Error(`动作应为 ${this.actDim} 维`);
    const action = new Float64Array(this.actDim);
    for (let i = 0; i < this.actDim; i++) {
      action[i] = Math.max(-1, Math.min(1, rawAction[i]));
      this.data.ctrl[i] = this.nominal[i] + RL_ENV.actionScale * action[i];
    }
    for (let i = 0; i < RL_ENV.frameSkip; i++) this.mujoco.mj_step(this.model, this.data);
    this.steps += 1;
    this.phase = this.task === 'walk' ? (this.phase + 2 * Math.PI * RL_ENV.controlDt / this.gaitPeriod) % (2 * Math.PI) : 0;

    const upright = this.upright();
    const height = this.data.qpos[2];
    let actionSquared = 0;
    for (const value of action) actionSquared += value * value;
    let reward;
    let vx = 0;
    let vy = 0;
    if (this.task === 'stand') {
      reward = 1 + 0.5 * Math.max(upright, 0) - 0.02 * actionSquared / this.actDim;
    } else {
      vx = this.data.qvel[0];
      vy = this.data.qvel[1];
      const velocityError = (vx - this.targetVelocity) / 0.08;
      const velocityTracking = 2 * Math.exp(-velocityError * velocityError);
      const aliveUpright = 0.2 + 0.5 * Math.max(upright, 0);
      const actionPenalty = 0.03 * actionSquared / this.actDim;
      const lateralPenalty = 0.5 * Math.abs(vy) + 2 * vy * vy;
      const heightPenalty = 2 * (height - 0.12) ** 2;
      reward = velocityTracking + aliveUpright - actionPenalty - lateralPenalty - heightPenalty;
    }
    if (!Number.isFinite(reward) || !Number.isFinite(upright) || !Number.isFinite(height)) {
      throw new Error('MuJoCo 产生非有限物理状态，已停止本次训练');
    }
    this.episodeReturn += reward;
    const terminated = upright < RL_ENV.tiltLimit || height < RL_ENV.heightLimit;
    const truncated = !terminated && this.steps >= this.maxSteps;
    return {
      obs: this.observation(),
      reward,
      terminated,
      truncated,
      done: terminated || truncated,
      info: {
        upright,
        height,
        fallen: terminated,
        vx,
        vy,
        contacts: this.task === 'walk' ? this.footContacts() : undefined,
        steps: this.steps,
        episodeReturn: this.episodeReturn,
        distance: this.data.qpos[0] - this.originX,
        lateralDistance: this.data.qpos[1] - this.originY,
      },
    };
  }
}
