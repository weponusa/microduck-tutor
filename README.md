# MicroDuck Tutor

让一只开源双足机器人，在浏览器里教会你强化学习。

这是一套可以离线运行的互动课程、物理模拟器和训练代码。主线不是讲公式，而是让你亲手试错、改奖励、看训练曲线、拆开真实策略网络，最后把策略跑在 MicroDuck 上。

## 在线体验

无需安装，直接用浏览器打开：

- **网站首页：<https://weponusa.github.io/microduck-tutor/>**
- **八关互动课程：<https://weponusa.github.io/microduck-tutor/rl-lab/course.html>**
- **3D 物理模拟器：<https://weponusa.github.io/microduck-tutor/simulator.html>**

建议使用最新版 Chrome、Edge 或 Safari。首次打开需要下载模型与 WASM，之后的课程计算和策略推理都在浏览器本地完成，不需要在线 API。

## 本地运行

```bash
./run.sh            # 默认 http://127.0.0.1:5173
./run.sh 8080       # 也可以换端口
```

本地开发时打开 <http://127.0.0.1:5173/>。必须通过 HTTP 访问，不能直接双击 HTML（浏览器的 ES module 与 WASM 安全限制）。全部静态资源随仓库提供，不需要 CDN。

## 八关学习路线

| 关卡 | 你会做什么 | 理解什么 |
| --- | --- | --- |
| 1. 认识结构 | 拆看 70 个零件、拨动 14 个关节 | 机器人为什么头重脚轻 |
| 2. 人机赛跑 | 和 Q-learning 一起走格子，回看第 1/16/31/50 回合 | 状态、动作、奖励、探索与利用、折扣 |
| 3. 撑爆表格 | 把状态空间一路放大 | 为什么表格装不下真实机器人 |
| 4. 找奖励漏洞 | 改写奖励，观察四种异常行为 | Reward hacking：它会优化你写的，不一定是你想的 |
| 5. 找拐点 | 读真实训练曲线 | 为什么训练会先长期平台、再突然提升 |
| 6. 押注对比 | 比较有无策略的真实轨迹 | 评估不能只看一次高分 |
| 7. 拆开看网络 | 拖 36 维输入、点 64 个隐藏单元、看 14 维输出 | 数组、矩阵乘法、tanh、梯度下降如何连成策略 |
| 8. 真鸭子站立 | 在浏览器物理引擎中运行真实策略 | 从训练结果到可观察行为 |

第七关加载的是实际训练得到的 `rl-lab/runs/duck_policy.json`，不是预编的动画或示例权重。

## 项目里有什么

| 入口 | 内容 |
| --- | --- |
| `index.html` | 整站首页与学习路线 |
| `simulator.html` | MuJoCo + three.js 物理沙盒与真实策略实验台 |
| `cover.html` | 旧封面地址的兼容跳转 |
| `rl-lab/course.html` | 八关互动课程，按关卡展开对应读本 |
| `rl-lab/start-here.html` | 读本唯一内容源、完整阅读与自测 |
| `rl-lab/stepper.html` | Q-learning 单步调试器 |
| `rl-lab/player.html` | CartPole 训练前后回放 |
| `rl-lab/01_…05_*.py` | 五个可运行的强化学习脚本 |
| `rl-lab/runs/` | 真实策略、训练曲线和评估轨迹 |

## 五个可运行的训练脚本

详细命令和实测结果见 [`rl-lab/README.md`](rl-lab/README.md)。

```bash
cd rl-lab
python3 01_gridworld_qlearning.py     # 零依赖：Q-learning
python3 -m venv .venv
.venv/bin/pip install numpy matplotlib mujoco gymnasium stable-baselines3
.venv/bin/python 02_cartpole_pg.py    # numpy 手写策略梯度
.venv/bin/python 03_microduck_env.py  # 把 MJCF 包成环境
.venv/bin/python 04_train_duck.py --steps 1000000
.venv/bin/python 05_eval_duck.py
```

已实测的结果：PPO 训练约 100 万步后，采样评估从约 47 步提升到 500 步满分；但确定性执行与采样执行可能差异很大，所以课程把“怎么判断真学会”也作为单独一课。

## 模拟器功能

- 拖拽旋转、滚轮缩放；鼠标直接拖动机器人部位施加外力。
- 暂停、单步、0.25× / 1× / 2× 速度，以及 INIT / STAND / SIT / FOLD 姿态。
- 14 个执行器的目标角与实际角、舵机刚度、悬吊模式、碰撞体显示。
- 可切换手动 / 真实 PPO 策略，以及确定性 / 采样执行；策略每 20 ms 决策一次，单步按钮也推进 20 ms。
- 实时展开 36 维观测、14 维动作、本步奖励、累计回报、直立度、回合进度和终止原因。
- 策略模式锁定训练场景、1× 舵机刚度与手动关节；推挤、暂停、复位和回合终止都可直接操作。
- 默认 `scene.xml` 有完整地面接触；`scene_walk.xml` 是训练专用场景，摔倒时部分身体可能穿地。
- 根模拟器没有行走控制器；MicroDuck 的官方行走能力来自 RL 策略，本项目只教授并演示站立策略。

## 资源与许可

| 内容 | 位置 | 来源 | 许可 |
| --- | --- | --- | --- |
| MicroDuck MJCF 与 STL | `assets/mjcf/microduck/` | `pollen-robotics/microduck_rl` | Apache-2.0 |
| 用于网页展示的模型 | `assets/duck/` | 由上述模型导出 | Apache-2.0 |
| MuJoCo 3.16 WASM | `vendor/mujoco/` | `@mujoco/mujoco` | Apache-2.0 |
| three.js r170 与 OrbitControls | `vendor/three/` | `three` | MIT |

`js/mjcfScene.js` 的场景构建参考了 `zalo/mujoco_wasm`（MIT），保留 MuJoCo 的 Z-up 坐标。第三方资源许可证随对应目录保留。
