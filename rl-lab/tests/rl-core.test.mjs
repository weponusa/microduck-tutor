import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  Adam,
  ActorCritic,
  DenseNetwork,
  Random,
  gaussianEntropy,
  gaussianLogProb,
} from '../../js/rlNetwork.js';
import { PPOTrainer, computeGae, normalizeAdvantages } from '../../js/rlPpo.js';
import { forwardPolicy, validatePolicy } from '../../js/rlPolicy.js';

function close(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test('高斯 log-prob 使用未裁剪动作且熵公式正确', () => {
  const action = Float64Array.from([1.7, -0.25]);
  const mean = Float64Array.from([0.2, -0.25]);
  const logStd = Float64Array.from([0, Math.log(2)]);
  const expected = -0.5 * (1.5 ** 2 + Math.log(2 * Math.PI)) - Math.log(2) - 0.5 * Math.log(2 * Math.PI);
  close(gaussianLogProb(action, mean, logStd), expected, 1e-12);
  close(gaussianEntropy(logStd), Math.log(2) + Math.log(2 * Math.PI) + 1, 1e-12);
  assert.notEqual(gaussianLogProb(action, mean, logStd), gaussianLogProb(Float64Array.from([1, -0.25]), mean, logStd));
});

test('DenseNetwork 反向传播与数值梯度一致', () => {
  const network = new DenseNetwork([3, 4, 2], new Random(42));
  const input = Float64Array.from([0.3, -0.8, 1.2]);
  const outputCoefficients = Float64Array.from([0.7, -1.1]);
  const loss = () => {
    const activations = network.forward(input);
    const output = activations[activations.length - 1];
    return output[0] * outputCoefficients[0] + output[1] * outputCoefficients[1];
  };
  network.zeroGrad();
  network.backward(network.forward(input), outputCoefficients);
  const epsilon = 1e-6;
  for (const layer of network.layers) {
    for (const [values, gradients] of [[layer.w, layer.gw], [layer.b, layer.gb]]) {
      for (let i = 0; i < values.length; i++) {
        const original = values[i];
        values[i] = original + epsilon;
        const plus = loss();
        values[i] = original - epsilon;
        const minus = loss();
        values[i] = original;
        const numerical = (plus - minus) / (2 * epsilon);
        close(gradients[i], numerical, 2e-7);
      }
    }
  }
});

test('GAE 区分 terminated 与 truncated，并隔离回合边界', () => {
  const terminal = computeGae([
    { reward: 1, value: 0.5, terminated: false, truncated: false, done: false },
    { reward: 1, value: 0.2, terminated: true, truncated: false, done: true },
  ], 99, 0.99, 0.95);
  close(terminal.advantages[1], 0.8);
  close(terminal.advantages[0], 0.5 + 0.99 * 0.2 + 0.99 * 0.95 * 0.8);

  const truncated = computeGae([
    { reward: 1, value: 0.2, terminated: false, truncated: true, done: true, bootstrapValue: 0.7 },
    { reward: 10, value: 3, terminated: false, truncated: false, done: false },
  ], 50, 0.99, 0.95);
  close(truncated.advantages[0], 1 + 0.99 * 0.7 - 0.2);
  close(truncated.returns[0], 1 + 0.99 * 0.7);
  assert.ok(truncated.advantages[1] > 0);
});

test('优势标准化对常量输入安全', () => {
  const normalized = normalizeAdvantages(Float64Array.from([1, 3, 5])).values;
  close(normalized.reduce((a, b) => a + b, 0), 0);
  close(normalized.reduce((a, b) => a + b * b, 0) / 3, 1, 1e-7);
  assert.deepEqual(Array.from(normalizeAdvantages(Float64Array.from([2, 2])).values), [0, 0]);
});

test('现有 duck_policy.json 可热启动且重新导出保持前向兼容', async () => {
  const policy = validatePolicy(JSON.parse(await readFile(new URL('../runs/duck_policy.json', import.meta.url), 'utf8')));
  const model = new ActorCritic({ obsDim: 36, actDim: 14 });
  model.loadActor(policy);
  const rng = new Random(123);
  for (let n = 0; n < 3; n++) {
    const obs = Float64Array.from({ length: 36 }, () => rng.normal() * 0.1);
    const expected = forwardPolicy(policy, obs);
    const actual = model.deterministic(obs);
    for (let i = 0; i < actual.length; i++) close(actual[i], expected[i], 1e-12);
  }
  assert.deepEqual(validatePolicy(model.exportActor()).log_std, policy.log_std);
  assert.throws(() => new ActorCritic({ obsDim: 43, actDim: 14 }).loadActor(policy), /维度/);
});

test('Adam 检查点保存并恢复一阶/二阶动量', () => {
  const parameters = [{ value: new Float64Array([0.2, -0.1]), grad: new Float64Array([0.3, -0.4]) }];
  const adam = new Adam();
  adam.step(parameters, 0.01);
  const saved = adam.export(parameters);
  const afterFirst = Array.from(parameters[0].value);
  parameters[0].grad = new Float64Array([0.1, 0.2]);
  adam.step(parameters, 0.01);
  const expected = Array.from(parameters[0].value);

  parameters[0].value.set(afterFirst);
  const restored = new Adam();
  restored.restore(parameters, saved);
  restored.step(parameters, 0.01);
  assert.deepEqual(Array.from(parameters[0].value), expected);
  assert.equal(restored.stepCount, 2);
  assert.throws(() => new Adam().restore(parameters, { stepCount: 0, states: [] }), /结构无效/);
});

test('PPO 实际更新 actor/critic 并可导出兼容 actor', () => {
  const ppo = new PPOTrainer({ obsDim: 3, actDim: 2, seed: 7, epochs: 2, minibatchSize: 2 });
  ppo.model.actor = new DenseNetwork([3, 4, 4, 2], new Random(8));
  ppo.model.critic = new DenseNetwork([3, 4, 4, 1], new Random(9));
  const beforeActor = ppo.model.exportActor().action_head.b.slice();
  const beforeCritic = Array.from(ppo.model.critic.layers.at(-1).b);
  const rng = new Random(10);
  const transitions = Array.from({ length: 4 }, () => {
    const obs = Float64Array.from([rng.normal(), rng.normal(), rng.normal()]);
    const sampled = ppo.model.sample(obs, rng);
    return { obs, action: sampled.action, logProb: sampled.logProb, value: sampled.value, reward: rng.normal(), terminated: false, truncated: false, done: false };
  });
  const metrics = ppo.update(transitions, 0.4);
  assert.equal(metrics.iteration, 1);
  assert.equal(metrics.samplesSeen, 8);
  assert.ok(Number.isFinite(metrics.policyLoss));
  assert.ok(Number.isFinite(metrics.valueLoss));
  assert.notDeepEqual(ppo.model.exportActor().action_head.b, beforeActor);
  assert.notDeepEqual(Array.from(ppo.model.critic.layers.at(-1).b), beforeCritic);
  assert.equal(ppo.model.actor.parameters(), ppo.model.actor.parameters(), '参数包装对象必须稳定，Adam 才能跨 batch 找到动量');
  const actorAdam = ppo.actorAdam.export(ppo.model.actorParameters());
  const criticAdam = ppo.criticAdam.export(ppo.model.critic.parameters());
  assert.ok(actorAdam.states.some((state) => state.m.some((value) => value !== 0)));
  assert.ok(criticAdam.states.some((state) => state.m.some((value) => value !== 0)));
  const exported = ppo.model.exportActor();
  const restored = new ActorCritic({ obsDim: 3, actDim: 2, hiddenSizes: [4, 4] });
  restored.loadActor(exported);
  const obs = Float64Array.from([0.1, 0.2, 0.3]);
  assert.deepEqual(Array.from(restored.deterministic(obs)), Array.from(ppo.model.deterministic(obs)));
});

test('完整 Adam/RNG 恢复后下一次 PPO 更新逐参数一致', () => {
  const makeTrainer = () => {
    const ppo = new PPOTrainer({ obsDim: 3, actDim: 2, seed: 31, epochs: 2, minibatchSize: 2 });
    ppo.model.actor = new DenseNetwork([3, 4, 4, 2], new Random(32));
    ppo.model.critic = new DenseNetwork([3, 4, 4, 1], new Random(33));
    return ppo;
  };
  const collect = (ppo, rng) => Array.from({ length: 4 }, () => {
    const obs = Float64Array.from([rng.normal(), rng.normal(), rng.normal()]);
    const sampled = ppo.model.sample(obs, rng);
    return { obs, action: sampled.action, logProb: sampled.logProb, value: sampled.value, reward: rng.normal(), terminated: false, truncated: false, done: false };
  });
  const original = makeTrainer();
  const originalSampleRng = new Random(34);
  original.update(collect(original, originalSampleRng), 0.2);
  const logStdState = original.actorAdam.export(original.model.actorParameters()).states.at(-1);
  assert.ok(logStdState.m.some((value) => value !== 0), 'log_std 的 Adam 动量必须跨 batch 保留');

  const restored = makeTrainer();
  restored.model.loadActor(original.model.exportActor());
  restored.model.critic.layers.forEach((layer, i) => {
    layer.w.set(original.model.critic.layers[i].w);
    layer.b.set(original.model.critic.layers[i].b);
  });
  restored.actorAdam.restore(restored.model.actorParameters(), original.actorAdam.export(original.model.actorParameters()));
  restored.criticAdam.restore(restored.model.critic.parameters(), original.criticAdam.export(original.model.critic.parameters()));
  restored.iteration = original.iteration;
  restored.rng.state = original.rng.state;
  const restoredSampleRng = new Random(1);
  restoredSampleRng.state = originalSampleRng.state;

  const nextOriginal = collect(original, originalSampleRng);
  const nextRestored = collect(restored, restoredSampleRng);
  assert.deepEqual(nextRestored, nextOriginal);
  const metricsOriginal = original.update(nextOriginal, 0.4);
  const metricsRestored = restored.update(nextRestored, 0.4);
  assert.deepEqual(metricsRestored, metricsOriginal);
  assert.deepEqual(restored.model.exportActor(), original.model.exportActor());
  assert.deepEqual(restored.actorAdam.export(restored.model.actorParameters()), original.actorAdam.export(original.model.actorParameters()));
  restored.model.critic.layers.forEach((layer, i) => {
    assert.deepEqual(Array.from(layer.w), Array.from(original.model.critic.layers[i].w));
    assert.deepEqual(Array.from(layer.b), Array.from(original.model.critic.layers[i].b));
  });
});
