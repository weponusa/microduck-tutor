import {
  ActorCritic,
  Adam,
  Random,
  clipGradients,
  gaussianEntropy,
  gaussianLogProb,
  parameterChecksum,
} from './rlNetwork.js';

export function computeGae(transitions, lastValue, gamma = 0.99, lambda = 0.95) {
  const advantages = new Float64Array(transitions.length);
  const returns = new Float64Array(transitions.length);
  let gae = 0;
  for (let t = transitions.length - 1; t >= 0; t--) {
    const transition = transitions[t];
    const nextValue = transition.truncated
      ? transition.bootstrapValue
      : (t === transitions.length - 1 ? lastValue : transitions[t + 1].value);
    const nonTerminal = transition.terminated ? 0 : 1;
    const continuesEpisode = !(transition.done ?? transition.terminated);
    const delta = transition.reward + gamma * nextValue * nonTerminal - transition.value;
    gae = delta + gamma * lambda * (continuesEpisode ? 1 : 0) * gae;
    advantages[t] = gae;
    returns[t] = advantages[t] + transition.value;
  }
  return { advantages, returns };
}

export function normalizeAdvantages(advantages) {
  let mean = 0;
  for (const value of advantages) mean += value;
  mean /= Math.max(1, advantages.length);
  let variance = 0;
  for (const value of advantages) variance += (value - mean) ** 2;
  variance /= Math.max(1, advantages.length);
  const std = Math.sqrt(variance);
  const normalized = new Float64Array(advantages.length);
  if (std > 1e-8) for (let i = 0; i < advantages.length; i++) normalized[i] = (advantages[i] - mean) / std;
  return { values: normalized, mean, std };
}

export class PPOTrainer {
  constructor({
    obsDim,
    actDim = 14,
    seed = 1,
    learningRate = 3e-4,
    gamma = 0.99,
    gaeLambda = 0.95,
    clipRange = 0.2,
    entropyCoef = 0.005,
    valueCoef = 0.5,
    maxGradNorm = 0.5,
    epochs = 4,
    minibatchSize = 64,
  }) {
    this.model = new ActorCritic({ obsDim, actDim, seed });
    this.gamma = gamma;
    this.gaeLambda = gaeLambda;
    this.clipRange = clipRange;
    this.entropyCoef = entropyCoef;
    this.valueCoef = valueCoef;
    this.maxGradNorm = maxGradNorm;
    this.epochs = epochs;
    this.minibatchSize = minibatchSize;
    this.learningRate = learningRate;
    this.actorAdam = new Adam();
    this.criticAdam = new Adam();
    this.rng = new Random(seed ^ 0x9e3779b9);
    this.iteration = 0;
  }

  update(transitions, lastValue) {
    if (!transitions.length) throw new Error('PPO 更新需要至少一条 transition');
    const { advantages, returns } = computeGae(transitions, lastValue, this.gamma, this.gaeLambda);
    const normalized = normalizeAdvantages(advantages).values;
    const indices = Array.from({ length: transitions.length }, (_, i) => i);
    let policyLoss = 0;
    let valueLoss = 0;
    let entropy = 0;
    let actorGradNorm = 0;
    let criticGradNorm = 0;
    let batches = 0;
    let samplesSeen = 0;

    for (let epoch = 0; epoch < this.epochs; epoch++) {
      this.rng.shuffle(indices);
      for (let start = 0; start < indices.length; start += this.minibatchSize) {
        const batch = indices.slice(start, start + this.minibatchSize);
        const count = batch.length;
        this.model.zeroGrad();
        let batchPolicyLoss = 0;
        let batchValueLoss = 0;
        let batchEntropy = 0;

        for (const index of batch) {
          const sample = transitions[index];
          const { mean, cache } = this.model.actorForward(sample.obs);
          const logProb = gaussianLogProb(sample.action, mean, this.model.logStd);
          const logRatio = Math.max(-20, Math.min(20, logProb - sample.logProb));
          const ratio = Math.exp(logRatio);
          const advantage = normalized[index];
          const clippedRatio = Math.max(1 - this.clipRange, Math.min(1 + this.clipRange, ratio));
          batchPolicyLoss -= Math.min(ratio * advantage, clippedRatio * advantage) / count;
          batchEntropy += gaussianEntropy(this.model.logStd) / count;

          const clipped = (advantage >= 0 && ratio > 1 + this.clipRange) ||
            (advantage < 0 && ratio < 1 - this.clipRange);
          const coefficient = clipped ? 0 : ratio * advantage / count;
          const dMean = new Float64Array(this.model.actDim);
          for (let a = 0; a < this.model.actDim; a++) {
            const inverseVariance = Math.exp(-2 * this.model.logStd[a]);
            const difference = sample.action[a] - mean[a];
            const dLogProbMean = difference * inverseVariance;
            const dLogProbStd = difference * difference * inverseVariance - 1;
            dMean[a] = -coefficient * dLogProbMean;
            this.model.logStdGrad[a] += -coefficient * dLogProbStd - this.entropyCoef / count;
          }
          this.model.actor.backward(cache, dMean);

          const critic = this.model.criticForward(sample.obs);
          const difference = critic.value - returns[index];
          batchValueLoss += 0.5 * difference * difference / count;
          this.model.critic.backward(critic.cache, new Float64Array([this.valueCoef * difference / count]));
        }

        const actorParameters = this.model.actorParameters();
        const criticParameters = this.model.critic.parameters();
        actorGradNorm += clipGradients(actorParameters, this.maxGradNorm);
        criticGradNorm += clipGradients(criticParameters, this.maxGradNorm);
        this.actorAdam.step(actorParameters, this.learningRate);
        this.criticAdam.step(criticParameters, this.learningRate);
        for (let i = 0; i < this.model.logStd.length; i++) {
          this.model.logStd[i] = Math.max(-4, Math.min(2, this.model.logStd[i]));
        }
        policyLoss += batchPolicyLoss;
        valueLoss += batchValueLoss;
        entropy += batchEntropy;
        batches += 1;
        samplesSeen += count;
      }
    }

    this.iteration += 1;
    const result = {
      iteration: this.iteration,
      policyLoss: policyLoss / batches,
      valueLoss: valueLoss / batches,
      entropy: entropy / batches,
      actorGradNorm: actorGradNorm / batches,
      criticGradNorm: criticGradNorm / batches,
      actorChecksum: parameterChecksum(this.model.actorParameters()),
      criticChecksum: parameterChecksum(this.model.critic.parameters()),
      samplesSeen,
    };
    for (const [key, value] of Object.entries(result)) {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`PPO 指标 ${key} 非有限数值`);
    }
    return result;
  }
}
