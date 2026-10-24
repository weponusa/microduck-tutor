"""
第 4 课：把鸭子丢给 PPO 去学站立。

这一课的重点不是"算法原理"，是工程：
    · 怎么把第 3 课的环境接成 gymnasium 标准接口
    · 怎么开多个环境并行采样（否则一天也训不完）
    · 怎么在中途存盘、怎么评估
    · 怎么判断"它到底是学会了，还是撞运气"

跑法（在 rl-lab 目录下）：
    .venv/bin/python 04_train_duck.py --steps 200000

产出：
    runs/ppo_duck.zip          训练好的策略（可以直接 load 回来继续训）
    runs/duck_training.png     学习曲线
"""

import argparse
import importlib.util
import os
import time

import gymnasium as gym
import numpy as np
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.vec_env import DummyVecEnv

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "runs")
os.makedirs(OUT, exist_ok=True)


def load_env_module():
    """第 3 课的 MicroDuckStandEnv 是按教学文件写的（文件名带序号），这里动态加载它，
    顺便演示一件事：一个好的环境定义是独立于算法的，谁能 import 谁就能用它训练。"""
    path = os.path.join(HERE, "03_microduck_env.py")
    spec = importlib.util.spec_from_file_location("duck_env", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class DuckGym(gym.Env):
    """把 MicroDuckStandEnv 套进 gymnasium 的五个词里"""

    metadata = {"render_modes": []}

    def __init__(self, seed=0):
        super().__init__()
        self.inner = load_env_module().MicroDuckStandEnv()
        self.action_space = gym.spaces.Box(-1.0, 1.0, shape=(self.inner.action_dim,), dtype=np.float32)
        high = np.full(self.inner.obs_dim, np.inf, dtype=np.float32)
        self.observation_space = gym.spaces.Box(-high, high, dtype=np.float32)
        self._rng = np.random.default_rng(seed)

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        return self.inner.reset().astype(np.float32), {}

    def step(self, action):
        obs, reward, done, info = self.inner.step(action)
        # gymnasium 规范是 5 元组：obs, reward, terminated, truncated, info
        # 「摔倒」是 terminated（真的结束了），「撑满 500 步」是 truncated（到时了，不是失败）
        terminated = bool(info.get("fallen", False))
        truncated = bool(done and not terminated)
        return obs.astype(np.float32), float(reward), terminated, truncated, info


class Recorder(BaseCallback):
    """记录每回合的步数和回报，训练完画曲线用"""

    def __init__(self):
        super().__init__()
        self.lens = []
        self.returns = []

    def _on_step(self):
        for info in self.locals.get("infos", []):
            if "episode" in info:
                self.lens.append(info["episode"]["l"])
                self.returns.append(info["episode"]["r"])
        return True


def evaluate(model, episodes=5):
    env = DuckGym()
    lens, rets = [], []
    for _ in range(episodes):
        obs, _ = env.reset()
        done, total, steps = False, 0.0, 0
        while not done:
            action, _ = model.predict(obs, deterministic=True)
            obs, reward, terminated, truncated, _ = env.step(action)
            total += reward
            steps += 1
            done = terminated or truncated
        lens.append(steps)
        rets.append(total)
    return float(np.mean(lens)), float(np.mean(rets))


def plot(recorder, path, baseline):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import matplotlib.font_manager as fm

        have = {f.name for f in fm.fontManager.ttflist}
        for cand in ("PingFang SC", "Hiragino Sans GB", "Heiti SC", "STHeiti", "Arial Unicode MS"):
            if cand in have:
                plt.rcParams["font.family"] = cand
                break
        plt.rcParams["axes.unicode_minus"] = False

        fig, ax = plt.subplots(figsize=(8, 3.6), dpi=160)
        x = np.arange(len(recorder.lens))
        ax.plot(x, recorder.lens, color="#d6dae1", linewidth=0.7, label="每回合步数")
        w = max(10, len(x) // 40)
        if len(x) >= w:
            smooth = np.convolve(recorder.lens, np.ones(w) / w, mode="valid")
            ax.plot(range(w - 1, len(x)), smooth, color="#e08a1e", linewidth=2,
                    label=f"{w} 回合滑动平均")
        ax.axhline(baseline, color="#8a94a0", linestyle="--", linewidth=1,
                   label=f"站着不动 ≈ {baseline:.0f} 步")
        ax.axhline(500, color="#c9ced6", linestyle=":", linewidth=1)
        ax.set_xlabel("回合 (episode)")
        ax.set_ylabel("坚持的步数")
        ax.set_ylim(0, 520)
        ax.set_title("MicroDuck 站立 · PPO 学习曲线", fontsize=11)
        ax.legend(fontsize=8, frameon=False)
        ax.spines[["top", "right"]].set_visible(False)
        fig.tight_layout()
        fig.savefig(path)
        return True
    except Exception as e:
        print(f"（跳过画图：{e}）")
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=200_000, help="总采样步数")
    ap.add_argument("--envs", type=int, default=4, help="并行环境数量")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default="runs/ppo_duck.zip", help="模型保存路径")
    ap.add_argument("--dump", default="", help="把逐回合成绩存成 json（给网页画曲线用）")
    args = ap.parse_args()

    # 先量一下"站着不动"的基线，后面曲线里要画这条线
    env0 = DuckGym()
    obs, _ = env0.reset()
    base_steps, done = 0, False
    while not done:
        obs, _, terminated, truncated, _ = env0.step(np.zeros(env0.action_space.shape, dtype=np.float32))
        done = terminated or truncated
        base_steps += 1
    print(f"基线（老老实实站着不动）：{base_steps} 步就倒\n")

    venv = DummyVecEnv([lambda i=i: Monitor(DuckGym(seed=args.seed + i)) for i in range(args.envs)])

    model = PPO(
        "MlpPolicy",
        venv,
        learning_rate=3e-4,
        n_steps=512,
        batch_size=256,
        gamma=0.99,
        gae_lambda=0.95,
        ent_coef=0.005,          # 一点熵奖励，逼它别太早认命
        clip_range=0.2,
        verbose=0,
        seed=args.seed,
    )

    recorder = Recorder()
    print(f"开始训练：{args.steps} 步 × {args.envs} 环境…")
    t0 = time.time()
    model.learn(total_timesteps=args.steps // args.envs * args.envs, callback=recorder)
    dt = time.time() - t0

    if recorder.lens:
        print(f"\n训练完成，用时 {dt:.0f} 秒，共 {len(recorder.lens)} 个回合")
        first = np.mean(recorder.lens[: max(1, len(recorder.lens) // 10)])
        last = np.mean(recorder.lens[-max(1, len(recorder.lens) // 10):])
        print(f"  最初 10% 回合平均 {first:5.1f} 步")
        print(f"  最后 10% 回合平均 {last:5.1f} 步")

    mean_len, mean_ret = evaluate(model, episodes=5)
    print(f"\n评估（贪心执行 5 回合）：平均 {mean_len:.0f} 步，平均回报 {mean_ret:.1f}")

    path = os.path.join(HERE, args.out) if not os.path.isabs(args.out) else args.out
    model.save(path)
    print(f"模型已存：{path}")

    if args.dump and recorder.lens:
        import json as _json
        _json.dump({"lens": recorder.lens, "returns": recorder.returns},
                   open(os.path.join(HERE, args.dump), "w"))
        print(f"逐回合成绩已存：{args.dump}（{len(recorder.lens)} 个回合）")

    if recorder.lens:
        img = os.path.join(OUT, "duck_training.png")
        if plot(recorder, img, base_steps):
            print(f"曲线已存：{img}")

    print("""
怎么读这张图：
  · 步数长期贴着基线 → 没学到东西（奖励太苛刻、观测不够、步数太少，三选一）
  · 步数先涨后崩 → 学习率太大或熵太低，策略塌缩了
  · 稳定往上涨但离 500 很远 → 正常，加步数再加步数

想继续训：把 runs/ppo_duck.zip 用 PPO.load(path, env=venv) 载回来再 learn。
""")


if __name__ == "__main__":
    main()
