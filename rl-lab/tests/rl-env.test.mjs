import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import loadMujoco from '../../vendor/mujoco/mujoco.js';
import { MicroDuckEnv, RL_ENV } from '../../js/rlEnv.js';
import { PPOTrainer } from '../../js/rlPpo.js';
import { Random, parameterChecksum } from '../../js/rlNetwork.js';

const modelBase = new URL('../../assets/mjcf/microduck/', import.meta.url);
const mujoco = await loadMujoco({
  locateFile: (path) => path.endsWith('.wasm') ? fileURLToPath(new URL('../../vendor/mujoco/mujoco.wasm', import.meta.url)) : path,
});
try { mujoco.FS.mkdir('/working'); } catch (_) {}
try { mujoco.FS.mkdir('/working/assets'); } catch (_) {}
const manifest = JSON.parse(await readFile(new URL('manifest.json', modelBase), 'utf8'));
for (const name of manifest.xml) {
  mujoco.FS.writeFile(`/working/${name}`, await readFile(new URL(name, modelBase), 'utf8'));
}
for (const name of manifest.meshes) {
  mujoco.FS.writeFile(`/working/assets/${name}`, new Uint8Array(await readFile(new URL(`assets/${name}`, modelBase))));
}

function makeEnv(task, maxSteps) {
  const scene = task === 'walk' ? 'scene_walk.xml' : 'scene.xml';
  const model = mujoco.MjModel.mj_loadXML(`/working/${scene}`);
  const data = new mujoco.MjData(model);
  return new MicroDuckEnv({ mujoco, model, data, task, maxSteps });
}

test('真实 MuJoCo 站立环境保持 36 维语义、clip 与超时 bootstrap 标记', () => {
  const env = makeEnv('stand', 1);
  const obs = env.reset();
  assert.equal(obs.length, 36);
  assert.equal(obs[0], env.data.qpos[3]);
  assert.equal(obs[35], env.data.qpos[2]);
  const result = env.step(new Float64Array(14).fill(4));
  assert.ok(Array.from(env.data.ctrl).every((value, i) => Math.abs(value - (env.nominal[i] + RL_ENV.actionScale)) < 1e-12));
  assert.equal(result.terminated, false);
  assert.equal(result.truncated, true);
  assert.equal(result.done, true);
  assert.equal(result.info.fallen, false);
  assert.ok(Number.isFinite(result.reward));
});

test('站立与行走都能用真实物理轨迹完成 PPO 参数更新', () => {
  for (const task of ['stand', 'walk']) {
    const env = makeEnv(task, 500);
    const ppo = new PPOTrainer({ obsDim: env.obsDim, actDim: 14, seed: 19, epochs: 1, minibatchSize: 8 });
    const rng = new Random(23);
    const beforeActor = parameterChecksum(ppo.model.actorParameters());
    const beforeCritic = parameterChecksum(ppo.model.critic.parameters());
    let obs = env.reset();
    const transitions = [];
    let result;
    for (let i = 0; i < 16; i++) {
      const sampled = ppo.model.sample(obs, rng);
      result = env.step(sampled.action);
      transitions.push({
        obs, action: sampled.action, logProb: sampled.logProb, value: sampled.value,
        reward: result.reward, terminated: result.terminated, truncated: result.truncated,
        done: result.done, bootstrapValue: result.truncated ? ppo.model.criticForward(result.obs).value : 0,
      });
      obs = result.done ? env.reset() : result.obs;
    }
    const last = transitions.at(-1);
    const lastValue = last.terminated ? 0 : ppo.model.criticForward(result.obs).value;
    const metrics = ppo.update(transitions, lastValue);
    assert.equal(metrics.iteration, 1);
    assert.notEqual(parameterChecksum(ppo.model.actorParameters()), beforeActor, `${task} actor 未更新`);
    assert.notEqual(parameterChecksum(ppo.model.critic.parameters()), beforeCritic, `${task} critic 未更新`);
    const actor = ppo.model.exportActor();
    assert.equal(actor.obs_dim, task === 'walk' ? 43 : 36);
    assert.ok(actor.layers.every((layer) => layer.w.flat().every(Number.isFinite)));
  }
});

test('真实 MuJoCo 行走环境是 43 维并读取双脚接触与世界速度', () => {
  const env = makeEnv('walk', 10);
  const obs = env.reset();
  assert.equal(obs.length, 43);
  assert.equal(obs[36], env.data.qvel[0]);
  assert.equal(obs[37], env.data.qvel[1]);
  assert.equal(obs[40], env.targetVelocity);
  assert.ok(obs[41] === 0 || obs[41] === 1);
  assert.ok(obs[42] === 0 || obs[42] === 1);
  const result = env.step(new Float64Array(14));
  assert.equal(result.obs.length, 43);
  assert.equal(result.obs[36], env.data.qvel[0]);
  assert.equal(result.obs[37], env.data.qvel[1]);
  assert.notEqual(result.obs[38], obs[38]);
  assert.ok(Number.isFinite(result.info.vx));
  assert.ok(Number.isFinite(result.info.vy));
  assert.equal(result.info.contacts.length, 2);
});
