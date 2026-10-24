"""
把训练好的 PPO 策略导出成 JSON，供网页端用纯 JS 做前向推理。

SB3 的 MlpPolicy 结构很简单：
    obs(36) → Linear(64) → Tanh → Linear(64) → Tanh → Linear(14) = 动作均值
确定性执行就是直接取这个均值（再按动作空间裁剪）。

跑法：
    .venv/bin/python tools/export_policy.py
产出：
    runs/duck_policy.json
"""

import json
import os

import numpy as np
import torch
from stable_baselines3 import PPO

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL = os.path.join(HERE, "runs", "ppo_duck.zip")
OUT = os.path.join(HERE, "runs", "duck_policy.json")


def main():
    model = PPO.load(MODEL, device="cpu")
    policy = model.policy
    extractor = policy.mlp_extractor.policy_net

    layers = []
    for module in extractor:
        if isinstance(module, torch.nn.Linear):
            layers.append({
                "w": module.weight.detach().numpy().tolist(),   # (out, in)
                "b": module.bias.detach().numpy().tolist(),
            })
    action_head = {
        "w": policy.action_net.weight.detach().numpy().tolist(),
        "b": policy.action_net.bias.detach().numpy().tolist(),
    }
    log_std = policy.log_std.detach().numpy().tolist()

    # 验证：JSON 里的权重手工前向，应当和 SB3 的确定性输出一致
    def forward(obs):
        h = np.asarray(obs, dtype=np.float32)
        for layer in layers:
            w = np.asarray(layer["w"], dtype=np.float32)
            b = np.asarray(layer["b"], dtype=np.float32)
            h = np.tanh(h @ w.T + b)
        w = np.asarray(action_head["w"], dtype=np.float32)
        b = np.asarray(action_head["b"], dtype=np.float32)
        # SB3 的 predict 会把动作裁到动作空间范围内，这里保持一致
        return np.clip(h @ w.T + b, -1.0, 1.0)

    rng = np.random.default_rng(0)
    worst = 0.0
    for _ in range(20):
        obs = rng.normal(0, 0.5, 36).astype(np.float32)
        a_js = forward(obs)
        a_sb3, _ = model.predict(obs, deterministic=True)
        worst = max(worst, float(np.max(np.abs(a_js - a_sb3))))

    print(f"导出层数 {len(layers)}，动作头 1 层，log_std 长度 {len(log_std)}")
    print(f"与 SB3 确定性输出的最大偏差：{worst:.2e}")
    assert worst < 1e-4, "前向结果对不上，不要用这个 JSON"

    payload = {
        "obs_dim": int(model.observation_space.shape[0]),
        "act_dim": int(model.action_space.shape[0]),
        "activation": "tanh",
        "layers": layers,
        "action_head": action_head,
        "log_std": log_std,
        "note": "PPO MlpPolicy 确定性执行 = action_head(tanh(...)) ，不含 tanh 压缩",
    }
    with open(OUT, "w") as f:
        json.dump(payload, f)
    print(f"已写入 {OUT}（{os.path.getsize(OUT) / 1024:.0f} KB）")


if __name__ == "__main__":
    main()
