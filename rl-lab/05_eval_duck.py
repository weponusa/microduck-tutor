"""
第 4 课的收尾：把训练好的策略拉出来考试。

训练曲线好看不等于学会了。评估至少要看四件事：
    1. 成功率（多少回合撑满 500 步 = 连续站 10 秒）
    2. 确定性执行 vs 采样执行 —— 两者差别大，说明策略还没训透
    3. 换初始条件还站不站得住（鲁棒性）
    4. 躯干高度抖不抖（稳定性）

跑法：
    .venv/bin/python 05_eval_duck.py
"""

import importlib.util
import json
import os

import mujoco
import numpy as np
from stable_baselines3 import PPO

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "runs")


def load_gym():
    spec = importlib.util.spec_from_file_location("train", os.path.join(HERE, "04_train_duck.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)      # 04 的 main 被 argparse 挡着，不会执行
    return mod.DuckGym()


def episode(env, model, deterministic):
    obs, _ = env.reset()
    done, steps, heights = False, 0, []
    while not done:
        action, _ = model.predict(obs, deterministic=deterministic)
        obs, _, terminated, truncated, info = env.step(action)
        steps += 1
        heights.append(float(info["height"]))
        done = terminated or truncated
    return steps, heights


def main():
    path = os.path.join(OUT, "ppo_duck.zip")
    if not os.path.exists(path):
        print("没找到 runs/ppo_duck.zip，先跑 04_train_duck.py")
        return

    model = PPO.load(path, device="cpu")
    env = load_gym()

    print("一、正常考试（5 回合，看两种执行方式）")
    for det in (True, False):
        lens, swings = [], []
        for _ in range(5):
            steps, heights = episode(env, model, det)
            lens.append(steps)
            swings.append((max(heights) - min(heights)) * 100)
        label = "确定性（取动作均值）" if det else "采样（按概率抽动作）"
        print(f"  {label}  步数 {lens}  成功率 {np.mean(np.array(lens) >= 500) * 100:.0f}%  "
              f"高度摆幅 {np.mean(swings):.1f} cm")

    print("\n二、换个开局再考（抖一下初始姿态和位置，各 5 回合）")
    inner = env.inner
    for name, fn in [
        ("姿态抖 ±0.02", lambda d, r: d.qpos.__setitem__(slice(3, 7), d.qpos[3:7] + r.normal(0, 0.02, 4))),
        ("往前挪 1 cm", lambda d, r: d.qpos.__setitem__(0, d.qpos[0] + 0.01)),
        ("关节抖 ±0.05", lambda d, r: [d.qpos.__setitem__(a, d.qpos[a] + float(r.normal(0, 0.05)))
                                      for a in inner.qpos_adr]),
    ]:
        lens = []
        for trial in range(5):
            env.reset()
            rng = np.random.default_rng(trial)
            fn(inner.data, rng)
            mujoco.mj_forward(inner.model, inner.data)
            obs = inner._obs()
            done, steps = False, 0
            while not done:
                action, _ = model.predict(obs, deterministic=False)
                obs, _, terminated, truncated, _ = env.step(action)
                steps += 1
                done = terminated or truncated
            lens.append(steps)
        print(f"  {name:<14} 步数 {lens}  成功率 {np.mean(np.array(lens) >= 500) * 100:.0f}%")

    # 存一局撑满的轨迹，留给可视化用
    steps, heights = episode(env, model, deterministic=False)
    if steps >= 500:
        with open(os.path.join(OUT, "duck_stand.json"), "w") as f:
            json.dump({"steps": steps, "height": [round(h, 4) for h in heights]}, f)
        print(f"\n一局成功的轨迹已存：runs/duck_stand.json（{steps} 步）")

    print("""
怎么解读上面这堆数字：
  · 两种执行方式差很多 → 说明它依赖某种执行细节，可能没训透。
  · 两种都是 500 步（重训后的版本就是这样）→ 这版是真的站直了。
  · 换个开局就崩 → 策略过拟合到了训练时的初始姿态（训练时每次都从 STAND 开始）。
    解药是训练时随机化初始状态，这叫 domain randomization。
  · 拿这个去真机一定翻车：真机没有「每 20ms 精确回到同一个初始姿态」这种好事。

所以第 4 课真正学到的不是「PPO 真厉害」，而是：
训练出能跑的东西很快，训练出可靠的东西很贵。
""")


if __name__ == "__main__":
    main()
