# MicroDuck Tutor

让一只开源双足机器人，在浏览器里教会你强化学习。

这是一套可以离线运行的互动课程、物理模拟器和训练代码。主线不是讲公式，而是让你亲手试错、改奖励、看训练曲线、拆开真实策略网络，最后把策略跑在 MicroDuck 上。

## 在线体验

无需安装，直接用浏览器打开：

- **网站首页：<https://weponusa.github.io/microduck-tutor/>**
- **八关互动课程：<https://weponusa.github.io/microduck-tutor/rl-lab/course.html>**
- **真实训练室与 3D 物理模拟器：<https://weponusa.github.io/microduck-tutor/simulator.html>**

建议使用最新版 Chrome、Edge 或 Safari。首次打开需要下载模型与 WASM，之后的课程计算、PPO 训练和策略推理都在浏览器本地完成，不需要在线 API。训练检查点保存在当前浏览器的 IndexedDB 中，不上传操作数据。

## 本地运行

```bash
./run.sh            # 默认 http://127.0.0.1:5173
./run.sh 8080       # 也可以换端口
```

本地开发时打开 <http://127.0.0.1:5173/>。必须通过 HTTP 访问，不能直接双击 HTML（浏览器的 ES module 与 WASM 安全限制）。全部静态资源随仓库提供，不需要 CDN。

## 八关学习路线

| 关卡 | 你会做什么 | 理解什么 |
| --- | --- | --- |
| 1. 认识结构 | 拆看 70 个零件、拨动关节，并从电子部件进入对应硬件课 | 机械装配、电子拆解与头重脚轻的关系 |
| 2. 人机赛跑 | 和 Q-learning 一起走格子，回看第 1/16/31/50 回合 | 状态、动作、奖励、探索与利用、折扣 |
| 3. 撑爆表格 | 把状态空间一路放大 | 为什么表格装不下真实机器人 |
| 4. 找奖励漏洞 | 改写奖励，观察四种异常行为 | Reward hacking：它会优化你写的，不一定是你想的 |
| 5. 找拐点 | 读真实训练曲线 | 为什么训练会先长期平台、再突然提升 |
| 6. 押注对比 | 比较有无策略的真实轨迹 | 评估不能只看一次高分 |
| 7. 亲手算网络 | 先算 2 个输入，再试 tanh、算矩阵参数，最后运行真实策略 | 数组、矩阵乘法、tanh 如何连成策略 |
| 8. 真鸭子站立 | 在浏览器物理引擎中运行真实策略 | 从训练结果到可观察行为 |

“八关课程”是全站唯一的教学入口。第二关可进入 Q-learning 单步调试器，逐行观察 Q 表更新；第五关可进入 CartPole 训练前后回放。这两个进阶页面都从课程进入，并能返回原关卡，不再占用首页或顶部导航的独立入口。

第七关按“算一笔 → 压一下 → 排成网络 → 跑真策略”逐步解锁，真实权重和热力图默认折叠。最后一步加载实际训练得到的 `rl-lab/runs/duck_policy.json`，不是预编的动画或示例权重。

## 项目里有什么

| 入口 | 内容 |
| --- | --- |
| `index.html` | 整站首页与学习路线 |
| `simulator.html` | MuJoCo + three.js 物理沙盒、浏览器内 PPO 训练室与策略测试台 |
| `hardware.html` | 13 讲电路板与传感器拆解课，附官方 HAT 原理图与 BOM |
| `cover.html` | 旧封面地址的兼容跳转 |
| `rl-lab/course.html` | 八关互动课程，按关卡展开对应读本 |
| `rl-lab/start-here.html` | 读本唯一内容源、完整阅读与自测 |
| `rl-lab/stepper.html` | 第二关进阶：Q-learning 单步调试器 |
| `rl-lab/player.html` | 第五关进阶：CartPole 训练前后回放 |
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
- 实时展开观测、14 维动作、本步奖励、累计回报、直立度、回合进度和终止原因。
- 策略模式锁定训练场景、1× 舵机刚度与手动关节；推挤、暂停、复位和回合终止都可直接操作。
- 默认 `scene.xml` 有完整地面接触；`scene_walk.xml` 是训练专用场景，摔倒时部分身体可能穿地。

## 传感器互动拆解

在模拟器点击“传感器拆解”，再点三维标签或右侧列表，可观察 9 类感知与交互：前置相机、8×8 ToF、机身 IMU、头部 IMU、关节反馈、音频、双 NFC 天线、脚底接触和无线连接。

- **真实仿真数据**：躯干 IMU 的 `sensordata`、14 路关节 `qpos / ctrl`、MuJoCo 左右脚碰撞接触。
- **教学示意**：相机视场线框、可拖距离的 64 点 ToF 网格、NFC/无线脉冲和 WebAudio 合成嘎嘎声，均明确标注为非硬件读数。
- **产品口径**：官方现售产品为 15 个电机、25 cm、800 g 以下、50 Hz 控制环；本教学模型为 14 路执行器，两者不混用。
- **事实边界**：相机分辨率/视场角、ToF 型号与量程尚未最终公布；脚底压力传感仅有社区拆解口径，页面标记为待官方确认。整机不是完整开源硬件；RPI Robot HAT 已单独公开 KiCad / PCB / BOM，但不代表 imu_to_dxl、制造级机械 CAD、完整线束和整机 BOM 都已开放。

规格来源：[Pollen Robotics 官方 press kit](https://pollen-robotics.com/microduck/press-kit/) 与[官方软件栈](https://github.com/pollen-robotics/microduck)。

## 电路板与传感器拆解课

从模拟器进入 `hardware.html`，共 13 讲：整机电子地图、主控板、RPI Robot HAT、imu_to_dxl、XL330、相机、ToF、双 IMU、音频、NFC、电源、脚底和无线。

- 第一关的机械拆解与 13 讲双向联动：可高亮主控、HAT、15 个舵机、相机、扬声器、电池和脚底，也能直接进入无独立网格的 ToF / IMU / NFC / 无线课程；旧模型主控与电池外形均标注版本差异。
- 每一讲都有可点击的器件逻辑图、数据旅程、接口说明、事实边界和原始来源；第一关与三维传感器页都能跳到对应课程，硬件课可返回第一关查看装配。
- 互动实验包括 IMU 12 字节拆解、8×8 ToF 矩阵、15 电机 / 14 策略动作、相机像素链、双 NFC 轮询和电压边界。
- 官方 RPI Robot HAT D1 的渲染、原理图 PDF 和 BOM CSV 随站提供；另链接 KiCad、Gerber、贴片坐标与 STEP。
- 参考资料区分官方 `microduck` / `microduck_rl` / HAT、社区复刻教程与 Open Duck Mini，不把不同板型和社区方案混成官方量产配置。

## 训练驾驶舱：看见网络与行走状态

在模拟器点击“训练驾驶舱”，上半部保留真实物理画面，下半部显示机器人此刻的观测、actor 前向、动作、步态和训练指标。

- **真实网络**：显示全部 36 / 43 个输入、两层各 64 个神经元和 14 路动作。节点亮度来自真实激活；每个目标节点展示绝对权重最大的 6 条入边，正负与粗细由真实权重决定。
- **两种视图**：空间拓扑展示动态网络云团与真实信号脉冲，层级结构用于理解输入、隐藏层和输出；“前向一遍”按层演示数据流，暂停时不会用持续脉冲假装仍在训练。
- **清晰的信息分区**：姿态、IMU、关节、速度、脚底等信号卡替代调试日志；主要 6 路 / 全部 14 路动作可切换，回报与损失、关节动作、IMU 和步态相位分别绘制。
- **点神经元看计算**：可查看 bias、完整加权求和、tanh 或线性动作均值，以及贡献最大的 6 条输入。
- **训练实时**：Worker 每约 100 ms 发回当前 actor 对最新观测的真实前向、critic 估值和物理状态；PPO 更新时同步当前 actor 权重。
- **测试快照**：点击“测试当前 actor”后，显示装入左侧沙盒的权重与实际执行动作，不与后台训练快照混用。
- **行走状态**：43 维观测、世界系速度、步态相位、左右脚接触、目标速度、即时奖励和回合回报；行走仍标为未完成稳定步态验收的训练实验。

## 浏览器里的真实训练室

打开 `simulator.html`，在“真实训练室 · PPO”选择任务，然后初始化并开始训练：

1. **站立**：36 维观测，可从零训练，也可在预训练站立 actor 上微调。
2. **行走实验**：43 维观测，加入世界系速度、步态相位、目标速度和左右脚真实接触；使用独立场景与检查点，不能直接载入 36 维站立 actor。
3. **训练**：独立 Web Worker 中运行第二套 MuJoCo 物理环境，实际采样轨迹并更新 actor、critic 与 Adam 优化器；不是播放预录轨迹。
4. **观察**：回报与损失来自真实 rollout 和反向传播，可开始、暂停、重新初始化，并查看权重指纹是否变化。
5. **测试与保存**：点击“测试当前策略”才把当前 actor 装入左侧沙盒；可导出策略 JSON，或保存包含 actor / critic、Adam 动量、RNG 和累计进度的本地检查点。

训练与左侧测试画面是两套独立物理环境。后台训练不会用左侧动画冒充过程；只有主动测试时才运行当前策略。恢复检查点会保留模型和优化器状态，丢弃未满的一批轨迹并开启新回合，不是逐物理帧续播。

**能力边界：**站立与行走都已经通过“真实物理采样 → PPO 参数更新 → 导出 → 回灌测试”的工程验证，但短时间的参数更新不等于行为收敛。行走目前仍是训练实验，尚未完成稳定步态与完整碰撞验收，不能据此宣称鸭子已经学会稳定行走。

## 资源与许可

| 内容 | 位置 | 来源 | 许可 |
| --- | --- | --- | --- |
| MicroDuck MJCF 与 STL | `assets/mjcf/microduck/` | `pollen-robotics/microduck_rl` | Apache-2.0 |
| 用于网页展示的模型 | `assets/duck/` | 由上述模型导出 | Apache-2.0 |
| MuJoCo 3.16 WASM | `vendor/mujoco/` | `@mujoco/mujoco` | Apache-2.0 |
| three.js r170 与 OrbitControls | `vendor/three/` | `three` | MIT |
| RPI Robot HAT D1 渲染、原理图与 BOM | `assets/hardware/` | `pollen-robotics/elec_RPI_Robot_HAT` | Apache-2.0 |

`js/mjcfScene.js` 的场景构建参考了 `zalo/mujoco_wasm`（MIT），保留 MuJoCo 的 Z-up 坐标。第三方资源许可证随对应目录保留。
