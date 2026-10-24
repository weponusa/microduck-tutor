"""
第 1 课：不看任何库，把强化学习的循环亲手写一遍。

任务：5×5 的格子房间，从左上角走到右下角，中间有个坑。
你能看到的东西只有三样 —— 我在第几格、我能往哪走、走完拿到什么分。

这里面没有神经网络，也没有"训练框架"。
它要说明一件事：强化学习 = 反复试错 + 把"哪一步带来了好结果"记到这张表上。
这张表叫 Q 表，整个算法只有一行数学：

    Q[状态][动作] ← Q[状态][动作] + 学习率 × (眼前奖励 + 折扣 × 下一格最好的 Q − Q[状态][动作])

用 python3 直接跑，不需要装任何东西：
    python3 01_gridworld_qlearning.py
"""

import random

W = H = 5
START = (0, 0)
GOAL = (4, 4)
PIT = (2, 2)

ACTIONS = {
    0: (-1, 0),   # 上
    1: (1, 0),    # 下
    2: (0, -1),   # 左
    3: (0, 1),    # 右
}
ARROWS = {0: "↑", 1: "↓", 2: "←", 3: "→"}

ALPHA = 0.2      # 学习率：新经验占多大比重
GAMMA = 0.95     # 折扣：远处的奖励值多少（0.95 表示 10 步后只剩 60%）
EPSILON = 0.2    # 探索率：20% 的概率随便走一步，不然永远发现不了更好的路
EPISODES = 800


def step(state, action):
    """走一步，返回（新状态, 奖励, 是否结束）"""
    dr, dc = ACTIONS[action]
    r, c = state[0] + dr, state[1] + dc

    if not (0 <= r < H and 0 <= c < W):        # 撞墙：留在原地，扣分
        return state, -1.0, False
    if (r, c) == PIT:                           # 掉坑：本回合结束
        return (r, c), -10.0, True
    if (r, c) == GOAL:                          # 到家：给大奖，回合结束
        return (r, c), 10.0, True
    return (r, c), -0.1, False                  # 每走一步都要付一点"时间成本"


def train():
    q = {s: [0.0] * 4 for s in [(r, c) for r in range(H) for c in range(W)]}
    history = []

    for ep in range(EPISODES):
        state = START
        total = 0.0
        for _ in range(60):                     # 最多 60 步，防止绕圈
            # ε-贪心：大部分时候选表里最好的，小部分时候瞎走
            if random.random() < EPSILON:
                action = random.randrange(4)
            else:
                values = q[state]
                best = max(values)
                action = random.choice([a for a, v in enumerate(values) if v == best])

            nxt, reward, done = step(state, action)

            # ↓↓↓ 整个强化学习最小的那颗心脏，就这一行 ↓↓↓
            target = reward if done else reward + GAMMA * max(q[nxt])
            q[state][action] += ALPHA * (target - q[state][action])

            state = nxt
            total += reward
            if done:
                break
        history.append(total)

    return q, history


def show_policy(q):
    print("\n学到的策略（每个格子最优动作）：")
    for r in range(H):
        line = []
        for c in range(W):
            if (r, c) == START:
                line.append(" 起")
            elif (r, c) == GOAL:
                line.append(" 终")
            elif (r, c) == PIT:
                line.append(" 坑")
            else:
                line.append(" " + ARROWS[max(range(4), key=lambda a: q[(r, c)][a])])
        print("   ".join(line))


def show_path(q):
    state, path = START, [START]
    for _ in range(12):
        if state == GOAL:
            break
        action = max(range(4), key=lambda a: q[state][a])
        nxt, _, done = step(state, action)
        if nxt == state:
            break
        path.append(nxt)
        state = nxt
        if done:
            break
    print("\n按学到的策略走一遍：")
    print("  " + " → ".join(f"({r},{c})" for r, c in path))
    print("  结果：" + ("到达终点 ✅" if path[-1] == GOAL else "没走到终点 ❌"))


def evaluate(q, episodes=200, epsilon=0.0):
    """按当前 Q 表跑若干回合，统计到达率和平均步数（贪心，不再随机探索）"""
    wins, steps_list, returns = 0, [], []
    for _ in range(episodes):
        state, total, steps = START, 0.0, 0
        for _ in range(60):
            steps += 1
            if epsilon > 0 and random.random() < epsilon:
                action = random.randrange(4)
            else:
                values = q[state]
                best = max(values)
                action = random.choice([a for a, v in enumerate(values) if v == best])
            state, reward, done = step(state, action)
            total += reward
            if done:
                break
        wins += state == GOAL
        steps_list.append(steps)
        returns.append(total)
    return wins / episodes, sum(steps_list) / len(steps_list), sum(returns) / len(returns)


def show_curve(history):
    print("\n训练过程（每 100 回合的平均回报，注意这里还带着 20% 的随机探索）：")
    for i in range(0, EPISODES, 100):
        chunk = history[i:i + 100]
        avg = sum(chunk) / len(chunk)
        print(f"  {i:4d}–{i + 99:<4d} {avg:6.2f}")


def show_comparison(before, after):
    print("\n关键对比（贪心执行，200 回合统计）：")
    print("                     到达率     平均步数    平均回报")
    print(f"  训练前（空表）      {before[0] * 100:5.0f}%     {before[1]:7.1f}     {before[2]:7.2f}")
    print(f"  训练后              {after[0] * 100:5.0f}%     {after[1]:7.1f}     {after[2]:7.2f}")


if __name__ == "__main__":
    empty_q = {s: [0.0] * 4 for s in [(r, c) for r in range(H) for c in range(W)]}
    before = evaluate(empty_q)

    q, history = train()
    after = evaluate(q)

    show_comparison(before, after)
    show_curve(history)
    show_policy(q)
    show_path(q)
    print("""
看三件事就够了：
1. 训练前的空表没有任何偏好，四成几率走进坑里。
2. 训练中分数起伏是因为还有 20% 的探索 —— 探索是必须的，否则发现不了更好的路。
3. 训练后到达率 100%、步数接近最短路径 —— 这叫"策略收敛"。

注意它没学会"墙在哪里"这种知识，它只是把每个格子上"往哪走更划算"背了下来。
神经网络干的是同一件事，只是当状态装不进表格时（比如机器人有 14 个关节角度、
速度还有几十个维度），用一个网络去近似这张 Q 表。
""")
