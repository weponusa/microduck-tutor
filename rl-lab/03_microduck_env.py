"""
第 3 课：把你自己那台鸭子接成强化学习环境。

前两课的环境是别人写好的（格子、杆子）。真实项目里 90% 的工作量在这一步：
把 MJCF 模型包成一个"能 reset、能 step、给观测、给奖励、能判断死没死"的对象。
这就是所谓的环境封装，OpenAI Gym 的接口几十年来只有这五个词：

    reset()  ->  obs              开局，给第一个观测
    step(a)  ->  obs, r, done    推进一步，给观测、奖励、结束标志
    observation_space            观测长什么样（几个数、范围）
    action_space                 动作长什么样（几个数、范围）

只要这五个词对上了，任何训练算法都能挂上来 —— PPO、SAC、你自己写的都行。
所以第 3 课不是教你训练，是教你「怎么把物理世界翻译成算法能吃的格式」。

跑法（在 rl-lab 目录下）：
    .venv/bin/python 03_microduck_env.py
"""

import os
import numpy as np
import mujoco

HERE = os.path.dirname(os.path.abspath(__file__))
SCENE = os.path.join(HERE, "..", "assets", "mjcf", "microduck", "scene.xml")

CTRL_DT = 0.02          # 每 20 ms 下一次指令（和真机舵机总线一个量级）
FRAME_SKIP = 10         # 中间插 10 个 2 ms 物理步 = 20 ms
ACTION_SCALE = 0.35     # 动作 [-1,1] 放大成 ±0.35 rad，别让策略一上来就把关节掰断
TILT_LIMIT = np.cos(np.deg2rad(45))   # 躯干 z 轴和世界 z 轴夹角超过 45° 算倒
HEIGHT_LIMIT = 0.06


class MicroDuckStandEnv:
    """任务：站着别倒。动作是 14 个关节的目标角偏移量。"""

    def __init__(self):
        self.model = mujoco.MjModel.from_xml_path(SCENE)
        self.data = mujoco.MjData(self.model)

        if self.model.nkey == 0:
            raise RuntimeError("模型里没有 keyframe，无法给定站立初值")

        # 找到 STAND 这个 keyframe（微鸭的站立姿态是刻意设计过的，重心压在踝轴上方）
        self.stand_key = 0
        for k in range(self.model.nkey):
            name = mujoco.mj_id2name(self.model, mujoco.mjtObj.mjOBJ_KEY, k)
            if name and name.upper() == "STAND":
                self.stand_key = k

        self.nu = self.model.nu
        self.trunk = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_BODY, "trunk_base")
        self.nominal = np.array(self.model.key_ctrl[self.stand_key]).copy()

        # 除了根节点的自由关节，其余都是舵机关节
        self.hinge_joints = [
            j for j in range(1, self.model.njnt)
            if self.model.jnt_type[j] == mujoco.mjtJoint.mjJNT_HINGE
        ]
        self.qpos_adr = [self.model.jnt_qposadr[j] for j in self.hinge_joints]
        self.dof_adr = [self.model.jnt_dofadr[j] for j in self.hinge_joints]

        # 观测 = 四元数(4) + 角速度(3) + 关节角(14) + 关节速度(14) + 高度(1) = 36 维
        self.obs_dim = 4 + 3 + len(self.hinge_joints) * 2 + 1
        self.action_dim = self.nu

        self.steps = 0
        self.max_steps = 500
        self._base_gains = np.array(self.model.actuator_gainprm).copy()
        self._base_bias = np.array(self.model.actuator_biasprm).copy()

    def set_servo_stiffness(self, scale):
        """把舵机的 kp 整体乘一个倍数。

        真机参数 kp≈0.55 N·m/rad 撑不住静态站立；网页版里把它拉到 8 倍就站住了。
        放在这里是为了说明：调参也是一种"人肉策略"，强化学习要做的就是不用人肉调这个。
        """
        self.model.actuator_gainprm[:] = self._base_gains * scale
        self.model.actuator_biasprm[:] = self._base_bias * scale

    # ── 观测 ────────────────────────────────────────────
    def _obs(self):
        d = self.data
        quat = d.qpos[3:7].copy()
        gyro = d.qvel[3:6].copy()                       # 根节点的角速度（局部系）
        q = np.array([d.qpos[a] for a in self.qpos_adr])
        qd = np.array([d.qvel[a] for a in self.dof_adr])
        height = np.array([d.qpos[2]])
        return np.concatenate([quat, gyro, q, qd, height])

    def _upright(self):
        """躯干 z 轴在世界系里的朝向，1 = 完全直立，0 = 躺平"""
        # xmat 是 (nbody, 9)，第 0 行是 world body，所以躯干就是 trunk 那行；
        # 第 9 个数（索引 8）是躯干局部 z 轴在世界 z 上的投影，1 = 完全直立
        return float(self.data.xmat[self.trunk, 8])

    # ── 开局 ────────────────────────────────────────────
    def reset(self, seed=None):
        mujoco.mj_resetDataKeyframe(self.model, self.data, self.stand_key)
        mujoco.mj_forward(self.model, self.data)
        self.steps = 0
        return self._obs()

    # ── 推进一步 ────────────────────────────────────────
    def step(self, action):
        action = np.clip(np.asarray(action, dtype=float), -1, 1)
        self.data.ctrl[:] = self.nominal + action * ACTION_SCALE

        for _ in range(FRAME_SKIP):
            mujoco.mj_step(self.model, self.data)

        self.steps += 1
        upright = self._upright()
        height = float(self.data.qpos[2])

        # 奖励设计：活着的每一步都值钱，站得越直越值钱，动作越折腾越扣分
        reward = 1.0 + 0.5 * max(upright, 0.0) - 0.02 * float(np.sum(action ** 2)) / self.nu

        fallen = upright < TILT_LIMIT or height < HEIGHT_LIMIT
        timeout = self.steps >= self.max_steps
        done = fallen or timeout

        return self._obs(), float(reward), done, {
            "upright": upright,
            "height": height,
            "fallen": fallen,
        }


def rollout(env, policy, label, seed=0):
    """跑一回合，打印结果。policy(obs) -> action"""
    rng = np.random.default_rng(seed)
    obs = env.reset()
    total, uprights = 0.0, []
    for t in range(env.max_steps):
        action = policy(obs, rng)
        obs, reward, done, info = env.step(action)
        total += reward
        uprights.append(info["upright"])
        if done:
            break
    print(f"  {label:<16} 撑了 {t + 1:3d} 步（{t * CTRL_DT:5.2f} 秒）  "
          f"总回报 {total:7.1f}  平均直立度 {np.mean(uprights):.2f}  "
          f"{'倒了' if info['fallen'] else '活到超时'}")
    return total, t + 1


def main():
    env = MicroDuckStandEnv()
    print("环境就绪：")
    print(f"  模型      {os.path.basename(SCENE)}")
    print(f"  观测维度  {env.obs_dim}")
    print(f"  动作维度  {env.action_dim}（14 个舵机的目标角偏移）")
    print(f"  控制频率  {1 / CTRL_DT:.0f} Hz（每步内部跑 {FRAME_SKIP} 个物理步）")
    print(f"  满分      {env.max_steps} 步 = {env.max_steps * CTRL_DT:.0f} 秒\n")

    print("三种策略各跑一回合，感受一下奖励和「倒没倒」的关系：")
    rollout(env, lambda o, r: np.zeros(env.action_dim), "保持站立姿态")
    rollout(env, lambda o, r: r.uniform(-1, 1, env.action_dim), "全程随机乱动")
    rollout(env, lambda o, r: r.normal(0, 0.15, env.action_dim), "小幅度抖动")

    print("\n再试一个人肉调参的对照：把舵机刚度拉到 8 倍（真机参数的 8 倍）：")
    env.set_servo_stiffness(8.0)
    rollout(env, lambda o, r: np.zeros(env.action_dim), "站立 + 8× 刚度")
    env.set_servo_stiffness(1.0)

    print("""
这就是第 3 课的全部内容：环境不含任何"智能"。
上面三个函数都是死板的，区别只在于给舵机下什么指令。

强化学习要做的，就是找到一个 policy(obs)，
让上面那个「总回报」尽可能大 —— 而它唯一的教材，就是自己摔倒的经历。

下一课（04）才会把这个 env 丢给 PPO 去训练。
""")
    print("提示：如果你想把观测改成只有 IMU + 关节角（不含高度这种「作弊信息」），")
    print("      只需要改 _obs()，其余代码不用动。这就是接口的价值。")


if __name__ == "__main__":
    main()
