export const LOG_2PI = Math.log(2 * Math.PI);

export class Random {
  constructor(seed = 1) {
    this.state = (Number(seed) >>> 0) || 0x6d2b79f5;
  }

  uniform() {
    let t = (this.state += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  normal() {
    const u = Math.max(this.uniform(), 1e-12);
    const v = this.uniform();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(this.uniform() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}

function asFloat64(values) {
  return values instanceof Float64Array ? values : Float64Array.from(values);
}

export class DenseNetwork {
  constructor(sizes, rng, { outputScale = 1 } = {}) {
    if (!Array.isArray(sizes) || sizes.length < 2 || sizes.some((n) => !Number.isInteger(n) || n <= 0)) {
      throw new Error('DenseNetwork sizes 必须是正整数数组');
    }
    this.sizes = sizes.slice();
    this.layers = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const inputs = sizes[l];
      const outputs = sizes[l + 1];
      const scale = (l === sizes.length - 2 ? outputScale : 1) * Math.sqrt(2 / (inputs + outputs));
      const w = new Float64Array(inputs * outputs);
      for (let i = 0; i < w.length; i++) w[i] = rng.normal() * scale;
      this.layers.push({
        inputs,
        outputs,
        w,
        b: new Float64Array(outputs),
        gw: new Float64Array(w.length),
        gb: new Float64Array(outputs),
      });
    }
    // Adam 用参数对象作为 WeakMap 键；包装对象必须跨 batch 保持稳定。
    this.parameterList = this.layers.flatMap((layer) => [
      { value: layer.w, grad: layer.gw },
      { value: layer.b, grad: layer.gb },
    ]);
  }

  forward(input) {
    if (input.length !== this.sizes[0]) throw new Error(`网络输入应为 ${this.sizes[0]} 维`);
    const activations = [input];
    let h = input;
    for (let l = 0; l < this.layers.length; l++) {
      const layer = this.layers[l];
      const out = new Float64Array(layer.outputs);
      for (let o = 0; o < layer.outputs; o++) {
        let sum = layer.b[o];
        const offset = o * layer.inputs;
        for (let i = 0; i < layer.inputs; i++) sum += layer.w[offset + i] * h[i];
        out[o] = l === this.layers.length - 1 ? sum : Math.tanh(sum);
      }
      activations.push(out);
      h = out;
    }
    return activations;
  }

  zeroGrad() {
    for (const layer of this.layers) {
      layer.gw.fill(0);
      layer.gb.fill(0);
    }
  }

  // outputGrad 是 loss 对该网络线性输出的导数；梯度累加而不清零。
  backward(activations, outputGrad, scale = 1) {
    let delta = outputGrad;
    for (let l = this.layers.length - 1; l >= 0; l--) {
      const layer = this.layers[l];
      const input = activations[l];
      const previous = new Float64Array(layer.inputs);
      for (let o = 0; o < layer.outputs; o++) {
        let d = delta[o] * scale;
        if (l < this.layers.length - 1) d *= 1 - activations[l + 1][o] ** 2;
        const offset = o * layer.inputs;
        layer.gb[o] += d;
        for (let i = 0; i < layer.inputs; i++) {
          layer.gw[offset + i] += d * input[i];
          previous[i] += layer.w[offset + i] * d;
        }
      }
      delta = previous;
    }
    return delta;
  }

  parameters() {
    return this.parameterList;
  }
}

export function gaussianLogProb(actions, means, logStd) {
  let total = 0;
  for (let i = 0; i < actions.length; i++) {
    const z = (actions[i] - means[i]) * Math.exp(-logStd[i]);
    total += -0.5 * z * z - logStd[i] - 0.5 * LOG_2PI;
  }
  return total;
}

export function gaussianEntropy(logStd) {
  let total = 0;
  for (let i = 0; i < logStd.length; i++) total += logStd[i] + 0.5 * (LOG_2PI + 1);
  return total;
}

export class ActorCritic {
  constructor({ obsDim, actDim = 14, hiddenSizes = [64, 64], seed = 1, initialLogStd = -0.7 }) {
    this.obsDim = obsDim;
    this.actDim = actDim;
    const rng = new Random(seed);
    this.actor = new DenseNetwork([obsDim, ...hiddenSizes, actDim], rng, { outputScale: 0.1 });
    this.critic = new DenseNetwork([obsDim, ...hiddenSizes, 1], rng);
    this.logStd = new Float64Array(actDim).fill(initialLogStd);
    this.logStdGrad = new Float64Array(actDim);
    this.logStdParameter = { value: this.logStd, grad: this.logStdGrad };
  }

  actorForward(obs) {
    const cache = this.actor.forward(obs);
    return { mean: cache[cache.length - 1], cache };
  }

  criticForward(obs) {
    const cache = this.critic.forward(obs);
    return { value: cache[cache.length - 1][0], cache };
  }

  sample(obs, rng) {
    const { mean } = this.actorForward(obs);
    const action = new Float64Array(this.actDim);
    for (let i = 0; i < action.length; i++) action[i] = mean[i] + Math.exp(this.logStd[i]) * rng.normal();
    return {
      action,
      mean,
      logProb: gaussianLogProb(action, mean, this.logStd),
      value: this.criticForward(obs).value,
    };
  }

  deterministic(obs) {
    const { mean } = this.actorForward(obs);
    return Float64Array.from(mean, (x) => Math.max(-1, Math.min(1, x)));
  }

  actorParameters() {
    return [...this.actor.parameters(), this.logStdParameter];
  }

  zeroGrad() {
    this.actor.zeroGrad();
    this.critic.zeroGrad();
    this.logStdGrad.fill(0);
  }

  exportActor() {
    const layers = this.actor.layers.slice(0, -1).map((layer) => ({
      w: Array.from({ length: layer.outputs }, (_, o) =>
        Array.from(layer.w.slice(o * layer.inputs, (o + 1) * layer.inputs))),
      b: Array.from(layer.b),
    }));
    const head = this.actor.layers[this.actor.layers.length - 1];
    return {
      obs_dim: this.obsDim,
      act_dim: this.actDim,
      activation: 'tanh',
      layers,
      action_head: {
        w: Array.from({ length: head.outputs }, (_, o) =>
          Array.from(head.w.slice(o * head.inputs, (o + 1) * head.inputs))),
        b: Array.from(head.b),
      },
      log_std: Array.from(this.logStd),
    };
  }

  loadActor(policy) {
    validateActorPolicy(policy, this.obsDim, this.actDim);
    const source = [...policy.layers, policy.action_head];
    for (let l = 0; l < source.length; l++) {
      const layer = this.actor.layers[l];
      if (source[l].w.length !== layer.outputs) throw new Error('预训练策略隐藏层尺寸不匹配');
      for (let o = 0; o < layer.outputs; o++) {
        layer.w.set(asFloat64(source[l].w[o]), o * layer.inputs);
      }
      layer.b.set(asFloat64(source[l].b));
    }
    this.logStd.set(asFloat64(policy.log_std));
  }
}

export function validateActorPolicy(policy, obsDim, actDim = 14) {
  if (!policy || policy.obs_dim !== obsDim || policy.act_dim !== actDim || policy.activation !== 'tanh') {
    throw new Error(`策略维度/激活不匹配：需要 ${obsDim} 维观测、${actDim} 维动作、tanh`);
  }
  if (!Array.isArray(policy.layers) || policy.layers.length !== 2) throw new Error('策略需要两层 tanh 隐藏层');
  const layers = [...policy.layers, policy.action_head];
  let inputDim = obsDim;
  for (const layer of layers) {
    if (!layer || !Array.isArray(layer.w) || !Array.isArray(layer.b) || layer.w.length !== layer.b.length) {
      throw new Error('策略层格式无效');
    }
    for (const row of layer.w) {
      if (!Array.isArray(row) || row.length !== inputDim || !row.every(Number.isFinite)) throw new Error('策略权重维度或数值无效');
    }
    if (!layer.b.every(Number.isFinite)) throw new Error('策略偏置含非有限数值');
    inputDim = layer.w.length;
  }
  if (inputDim !== actDim || !Array.isArray(policy.log_std) || policy.log_std.length !== actDim || !policy.log_std.every(Number.isFinite)) {
    throw new Error('策略动作头或 log_std 无效');
  }
  return policy;
}

export class Adam {
  constructor({ beta1 = 0.9, beta2 = 0.999, epsilon = 1e-8 } = {}) {
    this.beta1 = beta1;
    this.beta2 = beta2;
    this.epsilon = epsilon;
    this.stepCount = 0;
    this.states = new WeakMap();
  }

  step(parameters, learningRate) {
    this.stepCount += 1;
    const correction1 = 1 - this.beta1 ** this.stepCount;
    const correction2 = 1 - this.beta2 ** this.stepCount;
    for (const parameter of parameters) {
      let state = this.states.get(parameter);
      if (!state) {
        state = { m: new Float64Array(parameter.value.length), v: new Float64Array(parameter.value.length) };
        this.states.set(parameter, state);
      }
      for (let i = 0; i < parameter.value.length; i++) {
        const g = parameter.grad[i];
        state.m[i] = this.beta1 * state.m[i] + (1 - this.beta1) * g;
        state.v[i] = this.beta2 * state.v[i] + (1 - this.beta2) * g * g;
        parameter.value[i] -= learningRate * (state.m[i] / correction1) / (Math.sqrt(state.v[i] / correction2) + this.epsilon);
      }
    }
  }

  export(parameters) {
    return {
      stepCount: this.stepCount,
      states: parameters.map((parameter) => {
        const state = this.states.get(parameter);
        return {
          m: state ? Array.from(state.m) : new Array(parameter.value.length).fill(0),
          v: state ? Array.from(state.v) : new Array(parameter.value.length).fill(0),
        };
      }),
    };
  }

  restore(parameters, checkpoint) {
    if (!checkpoint || !Number.isInteger(checkpoint.stepCount) || checkpoint.stepCount < 0 ||
        !Array.isArray(checkpoint.states) || checkpoint.states.length !== parameters.length) {
      throw new Error('Adam 检查点结构无效');
    }
    this.states = new WeakMap();
    parameters.forEach((parameter, index) => {
      const state = checkpoint.states[index];
      if (!state || state.m?.length !== parameter.value.length || state.v?.length !== parameter.value.length ||
          !state.m.every(Number.isFinite) || !state.v.every(Number.isFinite)) {
        throw new Error(`Adam 第 ${index} 组动量维度或数值无效`);
      }
      this.states.set(parameter, { m: Float64Array.from(state.m), v: Float64Array.from(state.v) });
    });
    this.stepCount = checkpoint.stepCount;
  }
}

export function clipGradients(parameters, maxNorm) {
  let squared = 0;
  for (const p of parameters) for (const g of p.grad) squared += g * g;
  const norm = Math.sqrt(squared);
  const scale = norm > maxNorm ? maxNorm / (norm + 1e-12) : 1;
  if (scale < 1) for (const p of parameters) for (let i = 0; i < p.grad.length; i++) p.grad[i] *= scale;
  return norm;
}

export function parameterChecksum(parameters) {
  let hash = 2166136261;
  for (const p of parameters) {
    const bytes = new Uint8Array(p.value.buffer, p.value.byteOffset, p.value.byteLength);
    for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
