"""
第 2 课：换成一个"动作会影响下一秒"的连续任务 —— 立杆子（CartPole）。
这一步开始出现神经网络，但仍然只有 numpy，没有任何强化学习库。

为什么第 2 课要换成杆子？
    格子房间里，走错一步只是扣分；杆子这里，你这一秒用力过猛，下一秒杆子就倒了。
    奖励不再和你做了什么一一对应，而有延迟 —— 这才是强化学习真正难的地方。

任务：小车左右推，尽量让杆子别倒，坚持 500 步算满分。

跑法（用 rl-lab 的虚拟环境）：
    .venv/bin/python 02_cartpole_pg.py

它会产出三样东西（都在 runs/ 目录）：
    cartpole_curve.png      学习曲线
    cartpole_random.json    没训练时的表现
    cartpole_trained.json   训练后的表现
后者用 player.html 打开，能看到杆子从"三秒就倒"变成"一直立着"。
"""

import json
import os

import numpy as np

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "runs")
os.makedirs(OUT, exist_ok=True)

# ── 环境：小车 + 杆子，物理公式来自经典控制问题 ────────────────────────
GRAVITY = 9.8
MASS_CART = 1.0
MASS_POLE = 0.1
POLE_HALF = 0.5          # 半根杆长，米
FORCE = 10.0             # 左右最大推力
DT = 0.02                # 每步 20 毫秒
X_LIMIT = 2.4            # 小车跑出这个位置就算失败
THETA_LIMIT = 12 * np.pi / 180   # 杆子歪超过 12 度就算失败
MAX_STEPS = 500


def reset():
    return np.array([0.0, 0.0, 0.0, 0.0])   # x, x速度, 角度, 角速度


def step(state, action):
    x, x_dot, theta, theta_dot = state
    force = FORCE if action == 1 else -FORCE

    total_mass = MASS_CART + MASS_POLE
    polemass_len = MASS_POLE * POLE_HALF
    cos, sin = np.cos(theta), np.sin(theta)

    temp = (force + polemass_len * theta_dot ** 2 * sin) / total_mass
    theta_acc = (GRAVITY * sin - cos * temp) / (POLE_HALF * (4.0 / 3.0 - MASS_POLE * cos ** 2 / total_mass))
    x_acc = temp - polemass_len * theta_acc * cos / total_mass

    x = x + DT * x_dot
    x_dot = x_dot + DT * x_acc
    theta = theta + DT * theta_dot
    theta_dot = theta_dot + DT * theta_acc

    # 每多活一步给 1 分；倒了没有分
    done = abs(x) > X_LIMIT or abs(theta) > THETA_LIMIT
    return np.array([x, x_dot, theta, theta_dot]), (0.0 if done else 1.0), done


# ── 策略：一个两层小网络，输入 4 个状态，输出"往左/往右"的概率 ──────────
class Policy:
    def __init__(self, n_in=4, n_hidden=32, n_out=2, lr=0.02, seed=0):
        rng = np.random.default_rng(seed)
        self.W1 = rng.normal(0, 0.5, (n_in, n_hidden))
        self.b1 = np.zeros(n_hidden)
        self.W2 = rng.normal(0, 0.1, (n_hidden, n_out))
        self.b2 = np.zeros(n_out)
        self.lr = lr

    def probs(self, x):
        self.h = np.tanh(x @ self.W1 + self.b1)
        logits = self.h @ self.W2 + self.b2
        logits = logits - logits.max()
        e = np.exp(logits)
        self.p = e / e.sum()
        return self.p

    def act(self, x, rng):
        p = self.probs(x)
        return 1 if rng.random() < p[1] else 0, p

    def update(self, samples, gamma=0.99):
        """REINFORCE：好的一整条轨迹中，每一步都往"多做这个动作"推一点。

        samples 里每一行是 (状态, 动作, 该步之后所有奖励的折扣和)
        用"比平均好多少"（优势）当权重 —— 这样只有高于平均的动作被加强。
        """
        states = np.array([s[0] for s in samples])
        actions = np.array([s[1] for s in samples])
        returns = np.array([s[2] for s in samples], dtype=float)

        adv = returns - returns.mean()
        std = adv.std() + 1e-8
        adv = adv / std                     # 归一化，训练稳定得多

        H = np.tanh(states @ self.W1 + self.b1)
        logits = H @ self.W2 + self.b2
        logits = logits - logits.max(axis=1, keepdims=True)
        P = np.exp(logits)
        P = P / P.sum(axis=1, keepdims=True)

        # 交叉熵对 logits 的梯度，再乘上优势
        d_logits = P.copy()
        d_logits[np.arange(len(actions)), actions] -= 1.0
        d_logits *= adv[:, None] / len(actions)

        dW2 = H.T @ d_logits
        db2 = d_logits.sum(axis=0)
        dH = d_logits @ self.W2.T
        dZ1 = dH * (1 - H ** 2)             # tanh 的导数

        dW1 = states.T @ dZ1
        db1 = dZ1.sum(axis=0)

        self.W2 -= self.lr * dW2
        self.b2 -= self.lr * db2
        self.W1 -= self.lr * dW1
        self.b1 -= self.lr * db1


def run_episode(policy, rng, learn=True, record=False):
    state = reset()
    samples = []
    trajectory = []
    total = 0.0

    for _ in range(MAX_STEPS):
        action, _ = policy.act(state, rng)
        nxt, reward, done = step(state, action)
        samples.append([state.copy(), action, reward])
        if record:
            trajectory.append([round(float(nxt[0]), 4), round(float(nxt[2]), 4)])
        state = nxt
        total += reward
        if done:
            break

    # 算每一步的「以后能拿多少分」（折扣回报，从后往前累加）
    g = 0.0
    for i in reversed(range(len(samples))):
        g = samples[i][2] + 0.99 * g
        samples[i][2] = g

    if learn:
        policy.update(samples)
    return total, trajectory


def evaluate(policy, rng, episodes=20, record=False):
    scores, traj = [], None
    for _ in range(episodes):
        s, t = run_episode(policy, rng, learn=False, record=record)
        scores.append(s)
        if record and (traj is None or len(t) > len(traj)):
            traj = t
    return float(np.mean(scores)), traj


def main():
    rng = np.random.default_rng(0)
    policy = Policy(seed=1)

    print("先看没训练的时候能撑多久：")
    random_score, random_traj = evaluate(Policy(lr=0.0, seed=99), rng, episodes=20, record=True)
    # 用 lr=0 的策略当"随机 baseline"（权重随机、不学习）
    print(f"  平均 {random_score:5.1f} 步（满分 500）\n")

    curve = []
    best_mean = 0.0
    for ep in range(1, 8001):
        score, _ = run_episode(policy, rng)
        curve.append(score)

        if ep % 50 == 0:
            mean50 = float(np.mean(curve[-50:]))
            best_mean = max(best_mean, mean50)
            print(f"  第 {ep:4d} 回合   最近 50 回合平均 {mean50:6.1f} 步")
            if mean50 >= 480:
                print("\n  达标（平均 ≥ 480 步），提前收工。")
                break

    trained_score, trained_traj = evaluate(policy, rng, episodes=20, record=True)

    print("\n训练前后对比（20 回合，贪心执行）：")
    print(f"  训练前（随机权重）  平均 {random_score:6.1f} 步")
    print(f"  训练后              平均 {trained_score:6.1f} 步  （满分 {MAX_STEPS}）")

    with open(os.path.join(OUT, "cartpole_random.json"), "w") as f:
        json.dump({"label": "训练前（随机权重）", "avg": random_score, "frames": random_traj}, f)
    with open(os.path.join(OUT, "cartpole_trained.json"), "w") as f:
        json.dump({"label": "训练后", "avg": trained_score, "frames": trained_traj}, f)

    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import matplotlib.font_manager as fm

        # macOS 上让图里的中文正常显示，否则全是方块
        have = {f.name for f in fm.fontManager.ttflist}
        for cand in ("PingFang SC", "Hiragino Sans GB", "Heiti SC", "STHeiti", "Arial Unicode MS"):
            if cand in have:
                plt.rcParams["font.family"] = cand
                break
        plt.rcParams["axes.unicode_minus"] = False

        fig, ax = plt.subplots(figsize=(8, 3.6), dpi=160)
        ax.plot(curve, color="#c9ced6", linewidth=0.8, label="每回合得分")
        window = 30
        if len(curve) >= window:
            smooth = np.convolve(curve, np.ones(window) / window, mode="valid")
            ax.plot(range(window - 1, len(curve)), smooth, color="#e08a1e", linewidth=2,
                    label=f"{window} 回合滑动平均")
        ax.axhline(random_score, color="#8a94a0", linestyle="--", linewidth=1,
                   label=f"随机策略 ≈ {random_score:.0f} 步")
        ax.set_xlabel("回合 (episode)")
        ax.set_ylabel("坚持的步数")
        ax.set_ylim(0, MAX_STEPS + 20)
        ax.set_title("CartPole · REINFORCE 学习曲线", fontsize=11)
        ax.legend(fontsize=8, frameon=False)
        ax.spines[["top", "right"]].set_visible(False)
        fig.tight_layout()
        fig.savefig(os.path.join(OUT, "cartpole_curve.png"))
        print(f"\n曲线已存：runs/cartpole_curve.png")
    except Exception as e:  # 没装 matplotlib 也不影响主流程
        print(f"\n（跳过画图：{e}）")

    print("轨迹已存：runs/cartpole_random.json / cartpole_trained.json，用 player.html 播放。")


if __name__ == "__main__":
    main()
