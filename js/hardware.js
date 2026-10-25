const RUNTIME = 'https://github.com/pollen-robotics/microduck/blob/942e58e3aa6dbb28e7037203fff11866122c7567';
const HAT = 'https://github.com/pollen-robotics/elec_RPI_Robot_HAT/blob/6de86283297e4c49a9da8312cd3395ab83c437e3';
const PRESS = 'https://pollen-robotics.com/microduck/press-kit/';

const n = (id, title, sub, x, y, detail, w = 132) => ({ id, title, sub, x, y, detail, w, h: 62 });
const l = (from, to, label, type = 'data') => ({ from, to, label, type });
const s = (label, url) => ({ label, url });

const LESSONS = [
  {
    id: 'system', tab: '整机电子地图', title: '先看整机：五类硬件怎样连成机器人', evidence: ['官方规格 + 官方驱动', 'official'],
    lead: '别把机器人想成“主板插几个传感器”。它同时有五条链：计算、感知、执行、通信和供电。强化学习只是计算链中的一步，真正让动作闭环的是传感器、总线、舵机和电源一起按节拍工作。',
    boundary: '这是官方 zero3 / beta 运行时能证明的逻辑架构，不是量产机内部的照片级布线图。不同板型的相机、ToF、头部 IMU 和 NFC 接口会变化。',
    nodes: [
      n('compute', 'RK3566 主控', 'Linux · 50 Hz', 294, 20, '运行 Linux、robotd、策略推理和各传感器服务。官方产品只承诺 RK3566 + AI 加速器；具体板卡要看 zero3 / beta 口径。'),
      n('sensors', '相机 · ToF · 双 IMU', '感知', 36, 124, '相机看图像，ToF 给 8×8 深度，IMU 给角速度、加速度和姿态。它们并不都直接参与行走控制。'),
      n('imuBoard', 'imu_to_dxl v2', 'ID 200', 270, 134, '把躯干 IMU 变成 Dynamixel 总线上的一个设备，和 15 个舵机一起被读取。'),
      n('motors', '15 × XL330', '14 策略 + 嘴', 520, 124, '右腿 10–14、左腿 20–24、头颈嘴 30–34。策略输出 14 个动作，嘴由上层行为单独控制。'),
      n('power', 'NP-F550 · 2S', '2600 mAh', 274, 238, '可拆电池给整机供电。舵机回报自身供电电压，系统据此估计电池状态，不是另装一个电量计。'),
    ],
    links: [l('compute', 'sensors', 'CSI / I²C / SPI'), l('compute', 'imuBoard', 'UART 1 Mbps'), l('imuBoard', 'motors', '同一条 DXL 总线'), l('power', 'compute', '板卡供电', 'power'), l('power', 'motors', '2S 直接供电', 'power')],
    flow: ['sensors', 'imuBoard', 'compute', 'motors', 'power'],
    facts: [['控制节拍', '50 Hz，即每 20 ms 一轮'], ['一次快读', '1 个 IMU 板 + 15 个舵机，共 16 个总线设备'], ['两种模型', '动作策略跑控制；视觉检测是另一条链路'], ['开源边界', '软件、训练和部分硬件公开，不等于完整开源硬件']],
    steps: ['IMU 和舵机先通过同一次总线事务回传状态。', '主控构造观测并运行策略，得到 14 路动作。', '目标位置写回舵机；嘴和其他互动由上层服务另行处理。'],
    sources: [s('官方产品规格与开源边界', PRESS), s('robotd：控制环与总线', `${RUNTIME}/docs/design/robotd-design.md`), s('系统服务架构', `${RUNTIME}/docs/design/architecture.md`)],
  },
  {
    id: 'compute', tab: '主控计算板', title: '主控板：RK3566 到底在算什么', evidence: ['官方驱动 · zero3', 'driver'],
    lead: 'zero3 开发配置使用 Radxa Zero 3W。它既要跑 50 Hz 控制，又要处理 Linux 服务、相机、音频、蓝牙和更新。CPU 与 NPU 的工作要分开：当前动作策略在 CPU 上运行，NPU 用于视觉检测实验。',
    boundary: 'Radxa Zero 3W 是官方运行时明确支持的开发板，不等于最终零售机主板已经锁死。官方产品规格只写 RK3566、1 GB RAM、32 GB 存储和 AI 加速器。',
    nodes: [
      n('rk', 'Rockchip RK3566', '4 × Cortex-A55', 264, 22, '主 SoC。CPU 承担控制与通用计算，板内还带 AI 加速单元；不能把 NPU 写成行走策略的执行器。'),
      n('memory', '1 GB + 32 GB', 'RAM · 存储', 40, 28, '官方整机规格口径。具体颗粒厂牌和型号未公开。'),
      n('cpu', 'CPU 控制链', 'ONNX Runtime', 58, 145, 'robotd 读取总线、构造观测、运行动作策略并做安全检查。'),
      n('npu', 'NPU 视觉实验', 'RKNN', 300, 145, '鸭子检测模型可量化部署到 NPU；检测结果和控制行为之间不能自动画等号。'),
      n('io', 'CSI · UART · I²C · I²S', '板级接口', 522, 145, '相机、舵机总线、ToF / IMU 与音频分别使用不同接口，不是都挤在一条线上。'),
    ],
    links: [l('rk', 'cpu', '动作策略'), l('rk', 'npu', '视觉实验'), l('rk', 'io', '连接外设'), l('memory', 'rk', '运行与存储')],
    flow: ['io', 'cpu', 'rk', 'npu', 'memory'],
    facts: [['开发板', 'Radxa Zero 3W（zero3 配置）'], ['控制侧', 'CPU + ONNX Runtime + 50 Hz robotd'], ['视觉侧', 'RKNN / NPU 检测实验，独立于动作策略'], ['系统', '官方开发文档使用 Armbian，并提供安装与恢复流程']],
    steps: ['传感器与舵机数据经 UART、CSI 或 I²C / SPI 进入主控。', 'CPU 先保证控制环，其他 Linux 服务通过 Unix socket 交换数据。', '需要视觉检测时才启用 NPU 链路，不能把它当成平衡控制的必需品。'],
    sources: [s('官方开发板安装文档', `${RUNTIME}/docs/robot/install-dev.md`), s('NPU 检测与限制', `${RUNTIME}/docs/project/npu-bringup.md`), s('官方整机计算规格', PRESS)],
  },
  {
    id: 'hat', tab: 'RPI Robot HAT', title: 'RPI Robot HAT：一块真能下载图纸的板', evidence: ['官方硬件 · D1', 'hardware'],
    lead: '这块 HAT 把 40 针主控接口、IMU、Dynamixel TTL / RS485、音频输入输出、Qwiic 扩展和电源管理放在一起。官方仓库给出 KiCad 9 工程、PCB、Gerber、BOM、贴片坐标和 STEP，不再只是逻辑推测。',
    boundary: '当前仓库 D1 BOM 使用 LSM6DSV16XTR；zero3 运行时仍描述早期 HAT 上的 BMI088。板卡修订和软件支持必须一起核对，不能把 D1 BOM 倒填成所有原型机的实际配置。',
    nodes: [
      n('header', '40 针 HAT 接口', '主控连接', 24, 20, '连接 Pi Zero 形态主控及对应接口；换到 Radxa 或其他板时要核对引脚和 device tree。'),
      n('imu', 'LSM6DSV16XTR', 'U12 · I²C', 208, 20, 'D1 BOM 的 IMU。官方仓库说明 D1 才切换到这一型号。'),
      n('codec', 'TLV320AIC3104', 'U2 · 音频 Codec', 410, 20, '负责音频 ADC / DAC 与控制，音频数据走 I²S，控制走 I²C。'),
      n('dxl', 'Dynamixel TTL / 485', 'J3/J11/J13/J14', 26, 152, '提供智能舵机通信与连接器；不同接口和第三方舵机仍需核对电平及线缆。'),
      n('power', 'AP63205 + LM5050-1', '电源路径', 257, 152, 'D1 BOM 中的降压与理想二极管控制器。电源网络要按原理图逐页追，不凭“有电池”猜电压。'),
      n('audio', 'PAM8406D + MEMS MIC', 'U1 · MK1', 502, 152, '集成功率放大和麦克风，另有扬声器及外接麦克风端子。'),
    ],
    links: [l('header', 'imu', 'I²C'), l('header', 'codec', 'I²S + I²C'), l('header', 'dxl', 'UART / 方向'), l('power', 'header', '5V 等电源网络', 'power'), l('codec', 'audio', '模拟音频')],
    flow: ['header', 'imu', 'dxl', 'codec', 'audio', 'power'],
    facts: [['官方文件', '原理图、PCB、Gerber、BOM、POS、STEP、装配 PDF'], ['音频', 'TLV320AIC3104 + PAM8406D + 板载 MEMS 麦克风'], ['总线', 'Dynamixel TTL / RS485；Qwiic 扩展'], ['输入范围', '仓库说明 HAT 可接受 5–28 V；具体供电网络以 D1 原理图为准']],
    steps: ['先在 D1 BOM 按位号找芯片，例如 U2、U12、U9。', '再到原理图对应页面追信号与电源网络，最后看 PCB 连接器位置。', '打样前核对修订、板框、固定孔、连接器高度、主控兼容性和未贴件 DNP。'],
    sources: [s('官方 HAT 仓库', 'https://github.com/pollen-robotics/elec_RPI_Robot_HAT'), s('D1 原理图 PDF（本地）', './assets/hardware/rpi-robot-hat-d1-schematic.pdf'), s('D1 BOM（本地 CSV）', './assets/hardware/rpi-robot-hat-d1-bom.csv'), s('生产文件目录', 'https://github.com/pollen-robotics/elec_RPI_Robot_HAT/tree/6de86283297e4c49a9da8312cd3395ab83c437e3/production')],
    hat: true,
  },
  {
    id: 'imu-board', tab: 'imu_to_dxl 板', title: 'imu_to_dxl v2：把 IMU 变成第 16 个总线设备', evidence: ['官方驱动还原', 'driver'],
    lead: '这块板最有意思的地方，不是“又有一个 IMU”，而是它挂在 Dynamixel 总线上，ID 为 200。主控每 20 ms 在同一次快速同步读里拿到它和 15 个舵机的数据，少了独立轮询的一套时序。',
    boundary: '官方驱动公开了 LSM6DSV16X、总线 ID、寄存器块和数据格式，但未公开这块板的完整原理图、PCB 和 MCU 型号。本页只拆逻辑，不虚构板上的其他器件。',
    nodes: [
      n('lsm', 'LSM6DSV16X', '6 轴 + SFLP', 30, 36, '输出陀螺仪和芯片内融合的姿态四元数；官方运行时还使用其陀螺偏置估计。'),
      n('slave', 'Dynamixel 从机逻辑', '实现已知 · 芯片未公开', 270, 32, '把 IMU 数据映射到 Dynamixel 寄存器块，响应 ID 200 的读取。具体 MCU 与电路图未公开。'),
      n('block', '地址 124 · 12 字节', '6 陀螺 + 6 四元数', 514, 36, '控制环只读前 12 字节；完整诊断块为 20 字节，还含原始加速度、计数器和状态。'),
      n('bus', 'Dynamixel 总线', 'ID 200 · 1 Mbps', 150, 190, '和 15 个 XL330 共用总线。Fast Sync Read 要求舵机固件与 IMU 板都支持对应指令。'),
      n('policy', '陀螺仪 + 重力方向', '策略观测', 464, 190, '运行时解码、做安装方向旋转和异常值处理，再把陀螺仪和重力方向交给控制与跌倒检测。'),
    ],
    links: [l('lsm', 'slave', '原始 + SFLP'), l('slave', 'block', '寄存器映射'), l('block', 'bus', 'Fast Sync Read'), l('bus', 'policy', '50 Hz 解码')],
    flow: ['lsm', 'slave', 'block', 'bus', 'policy'],
    facts: [['芯片', 'LSM6DSV16X，芯片内 SFLP 姿态融合'], ['总线身份', 'Dynamixel ID 200，和舵机一起读取'], ['控制数据', '12 字节：3 轴陀螺仪 + 四元数 x/y/z'], ['未公开', '板级原理图、PCB、MCU 与制造文件']],
    steps: ['LSM6DSV16X 产生陀螺仪与 SFLP 四元数。', '从机逻辑把数据放到地址 124 起始的块中，主控每拍读取 12 字节。', '运行时把传感器坐标转换到躯干坐标，再生成陀螺仪、四元数和重力方向。'],
    sources: [s('IMU 解码源码', `${RUNTIME}/duck-control/src/imu.rs`), s('总线与 ID 定义', `${RUNTIME}/duck-control/src/model.rs`), s('控制环设计', `${RUNTIME}/docs/design/robotd-design.md`)],
    widget: 'imu',
  },
  {
    id: 'servo', tab: 'XL330 智能舵机', title: '15 个 XL330：电机、驱动、反馈和控制在一块', evidence: ['官方运行时', 'driver'],
    lead: '智能舵机不是只会收 PWM 的普通电机。它通过总线接收目标位置，并回报位置、速度、电流、电压和温度等状态。MicroDuck 用三组 ID 管理 15 个舵机，策略只负责其中 14 个动作，鸭嘴另由上层控制。',
    boundary: '官方运行时说 XL330，但没有锁定零售机具体后缀。官方 alpha 的 2S 直供及 shutdown 配置是这套产品的专用设计，不是通用的 XL330 超压供电建议，复刻前必须核对额定电压、热与安全。',
    nodes: [
      n('host', 'robotd', '目标位置 + 读取', 26, 30, '独占总线，50 Hz 写目标、读反馈，另以约 1 Hz 读取电压和温度。'),
      n('bus', 'UART / DXL 2.0', '1 Mbps · Fast Sync Read', 264, 30, '15 个舵机与 IMU 板共享。旧固件不支持 Fast Sync Read 时会无应答。'),
      n('right', '右腿', 'ID 10–14', 518, 20, '5 个舵机。ID 13 的膝盖偏置在 alpha 配置中单独处理。'),
      n('left', '左腿', 'ID 20–24', 518, 112, '5 个舵机。ID 23 的膝盖同样有专用偏置。'),
      n('head', '头 · 颈 · 嘴', 'ID 30–34', 272, 170, '5 个舵机。策略动作表不包含嘴，嘴由拾取、歌唱等行为控制。'),
      n('feedback', '状态反馈', '位置 · 速度 · 电流 · 电压 · 温度', 30, 180, '反馈既是平衡观测的一部分，也是电源估计和过热诊断的依据。'),
    ],
    links: [l('host', 'bus', 'sync read / write'), l('bus', 'right', '5 路'), l('bus', 'left', '5 路'), l('bus', 'head', '5 路'), l('right', 'feedback', '回传'), l('left', 'feedback', '回传'), l('head', 'feedback', '回传')],
    flow: ['feedback', 'bus', 'host', 'right', 'left', 'head'],
    facts: [['总数', '15 个电机；14 路策略动作 + 1 路鸭嘴'], ['快速反馈', '地址 124 起的 PWM / current / velocity / position'], ['慢速反馈', '约每秒读取电压与温度'], ['安全', '总线失效、舵机温度和电池状态是不同故障源']],
    steps: ['主控先读关节与 IMU，构造当前状态。', '策略输出 14 路动作，经缩放、滤波和限幅后写目标位置。', '舵机内部闭环驱动关节，再把实际状态送回主控，形成下一轮观测。'],
    sources: [s('robotd：ID、寄存器与供电', `${RUNTIME}/docs/design/robotd-design.md`), s('关节与电机常量', `${RUNTIME}/duck-control/src/model.rs`), s('Fast Sync Read 实现', `${RUNTIME}/duck-control/src/bus.rs`)],
    widget: 'servo',
  },
  {
    id: 'camera', tab: '前置相机', title: '相机：从镜头和像素，到 WebRTC 视频', evidence: ['官方规格 + 驱动', 'official'],
    lead: '相机不是“接上就有图片”。镜头把光投到图像传感器，驱动设定读出模式，Rockchip 图像链路处理画面，再经硬编码和 WebRTC 发出。zero3 代码明确使用 IMX219，beta 则是 GC2093。',
    boundary: '官方产品页仍把最终相机分辨率和视场角列为未定。这里讲的 IMX219、约 62°、1080p 读出与 720p 默认流是 zero3 原型 / 驱动口径，不能写成所有量产机的最终规格。',
    nodes: [
      n('lens', '镜头', 'zero3 原型约 3.05 mm', 20, 34, '视场角由传感器尺寸与镜头共同决定，不能只看传感器型号猜 FOV。'),
      n('sensor', 'IMX219 / GC2093', '板型决定', 236, 34, 'zero3 为 IMX219，beta 为 GC2093。mediad 会检查传感器与板型是否匹配。'),
      n('csi', 'MIPI CSI + 驱动', '1920×1080 RAW10', 478, 34, '两种已知传感器在代码中都固定 1920×1080 raw 10-bit 读出模式。'),
      n('isp', 'Rockchip 图像链路', '缩放 · 标定 · 编码', 128, 180, '输出尺寸可缩放到 1280×720；内参必须区分家族估算与单机标定。'),
      n('rtc', 'mediad / WebRTC', '视频传输', 460, 180, '把画面提供给远程界面。检测模型是否使用实时帧，是另一条需要单独核对的链路。'),
    ],
    links: [l('lens', 'sensor', '光学'), l('sensor', 'csi', '像素流'), l('csi', 'isp', 'RAW10'), l('isp', 'rtc', '编码与传输')],
    flow: ['lens', 'sensor', 'csi', 'isp', 'rtc'],
    facts: [['zero3 原型', 'IMX219 + 约 3.05 mm M12 镜头，名义 HFOV 约 62°'], ['读出', '1920×1080 @ 30，RAW10；输出可缩放'], ['默认视频', '官方代码包含 720p30 与硬编码 / WebRTC 路径'], ['量产边界', '最终分辨率与 FOV 仍以官方产品规格为准']],
    steps: ['镜头和传感器产生原始像素，驱动固定读出模式。', '图像链路完成缩放和格式处理，视觉几何使用对应标定。', '需要远程观看时，mediad 编码并通过 WebRTC 传输。'],
    sources: [s('相机型号与板型检查', `${RUNTIME}/mediad/src/sensor.rs`), s('视场角与标定说明', `${RUNTIME}/mediad/src/camera.rs`), s('官方未定项', PRESS)],
    widget: 'camera',
  },
  {
    id: 'tof', tab: '8×8 ToF', title: 'ToF：64 个距离点，不是旋转激光雷达', evidence: ['官方规格 + 驱动', 'official'],
    lead: 'Time of Flight（飞行时间）通过光往返时间估计距离。MicroDuck 的 8×8 矩阵一次给 64 个区域，不是扫描周围 360°，也不是高线数建图雷达。zero3 可支持 VL53L5CX / VL53L8CX，beta 代码走 VL53L8CX + SPI。',
    boundary: '产品页尚未最终公布量程。下面的 64 格数值是教学演示，不是实机测距、噪声模型或标定结果；官方运行时目前把深度流发布出来，但不能据此宣称所有行为都已使用它。',
    nodes: [
      n('emit', '发射与接收', '光飞行时间', 20, 35, '每个区域估计目标距离，同时返回状态，坏点不能只当作普通数字使用。'),
      n('sensor', 'VL53L5CX / L8CX', '8×8 · 64 zones', 238, 35, '两代传感器在官方驱动里共用 8×8 接口，由 ID 探测区分。'),
      n('bus', 'I²C / SPI', '板型决定', 480, 35, 'zero3 在 HAT I²C 上，常见地址 0x29，也兼容原型改址 0x52；beta 为 SPI3。'),
      n('daemon', 'tofd', '深度帧流', 144, 188, '独占传感器并发布 tof.stream；官方架构文档指出该流并非总被其他行为消费。'),
      n('grid', '8×8 深度矩阵', '距离 + 状态', 472, 188, '每一格对应一个空间区域。64 个数能提示前方障碍分布，但不自动成为完整地图。'),
    ],
    links: [l('emit', 'sensor', '测距'), l('sensor', 'bus', '读取'), l('bus', 'daemon', '帧'), l('daemon', 'grid', '发布')],
    flow: ['emit', 'sensor', 'bus', 'daemon', 'grid'],
    facts: [['输出', '64 个距离值和对应状态'], ['zero3', 'HAT I²C；VL53L5CX 或 VL53L8CX'], ['beta', 'VL53L8CX，SPI3 / spidev3.0'], ['未知项', '官方最终量程、实际视场和整机行为使用方式']],
    steps: ['传感器按区域发测光并估计往返时间。', '驱动读出 64 个距离与状态，检查数据是否有效。', 'tofd 发布深度矩阵，由需要它的应用决定是否订阅。'],
    sources: [s('ToF 两代传感器驱动', `${RUNTIME}/tof/src/sensor.rs`), s('板型、总线与地址', `${RUNTIME}/tof/src/link.rs`), s('官方 8×8 规格', PRESS)],
    widget: 'tof',
  },
  {
    id: 'imu', tab: '双 IMU', title: '双 IMU：身体管平衡，头部偏交互与视觉', evidence: ['官方规格 + 驱动', 'driver'],
    lead: 'IMU 把加速度计和陀螺仪放在一起，用来感知运动与姿态。MicroDuck 的两颗 IMU 不是简单“互为备份”：躯干 IMU 是 50 Hz 控制环核心输入；头部 IMU 与头部姿态、相机和交互更相关，而且不同板型的读法不同。',
    boundary: '当前教学 MJCF 只有躯干 IMU 的真实仿真 sensordata，头部只有 site。zero3 的 BMI088 默认关闭，beta 的头部 LSM6DSV16X 由 robotd 读取；不能把这些差异抹成“所有版本都一样”。',
    nodes: [
      n('body', '躯干 IMU', 'LSM6DSV16X', 28, 35, '经 imu_to_dxl 进入 50 Hz 快读，是动作策略与跌倒检测的重要输入。'),
      n('fusion1', '芯片内 SFLP', '四元数', 278, 28, '躯干路径在芯片内做姿态融合，主控解码而不是重新跑一套主机融合。'),
      n('head', '头部 IMU', 'BMI088 / LSM6DSV16X', 510, 35, 'zero3 是 HAT BMI088，由 tofd 读取；beta 是面部板 LSM6DSV16X，由 robotd 读取。'),
      n('fusion2', 'Madgwick / 芯片 FIFO', '板型决定', 510, 174, 'zero3 在 CPU 上做 Madgwick，默认关闭以节省负载；beta 由芯片融合并批量读出。'),
      n('use', '控制 / 姿态消费者', '用途不同', 145, 181, '躯干进入运动闭环；头部提供独立 head_imu.stream，不能直接当成第二份躯干输入。'),
    ],
    links: [l('body', 'fusion1', '姿态融合'), l('fusion1', 'use', '50 Hz 控制'), l('head', 'fusion2', '读取与融合'), l('fusion2', 'use', '头部数据流')],
    flow: ['body', 'fusion1', 'use', 'head', 'fusion2'],
    facts: [['加速度计', '测比力，静止时也包含重力方向信息'], ['陀螺仪', '测角速度，适合快速运动与短时变化'], ['姿态', '融合估计会涉及坐标安装方向、延迟和漂移'], ['磁力计', '官方运行时明确当前没有磁力计与航向漂移校正']],
    steps: ['先读原始加速度和角速度，再按实际安装方向转换坐标轴。', '通过芯片内融合或主机融合得到姿态，不能用默认四元数冒充有效测量。', '躯干数据进入控制；头部数据走独立流，按具体应用消费。'],
    sources: [s('躯干 IMU 解码', `${RUNTIME}/duck-control/src/imu.rs`), s('zero3 头部 IMU', `${RUNTIME}/tof/src/imu.rs`), s('板型与默认开关', `${RUNTIME}/deploy/robotd.toml`)],
  },
  {
    id: 'audio', tab: '音频链路', title: '麦克风与扬声器：声音要经过一整条模拟—数字链', evidence: ['官方硬件 + 驱动', 'hardware'],
    lead: '麦克风把声压变成电信号，Codec 做 ADC / DAC 和音频路由，主控通过 I²S 传数字音频，再由功放推动扬声器。MicroDuck 的“嘎嘎声”不是神经网络凭空从喇叭里出来，而是软件声库和这套硬件一起完成。',
    boundary: 'D1 HAT 的芯片清单可用于教学，但不同板型的音频实现仍要以具体设备为准。网页里的合成 quack 只是教学试听，不是官方声纹、麦克风采样或频响测量。',
    nodes: [
      n('mic', 'MEMS 麦克风', 'MK1 / 外接', 20, 30, '把声音变成模拟电信号。HAT 还提供外接麦克风端子。'),
      n('codec', 'TLV320AIC3104', 'ADC · DAC · 路由', 240, 30, '音频编解码器：采集方向做 ADC，播放方向做 DAC；控制与音频数据不是同一条总线。'),
      n('i2s', 'I²S + I²C', '数据 + 控制', 490, 30, 'I²S 传音频样本，I²C 配置 Codec；Linux 通过 ALSA 设备使用它。'),
      n('voice', '软件声库与服务', '序列号生成声音', 120, 180, '官方软件为每台机器生成个体化声音，并可做麦克风的抚摸分类等实验。'),
      n('amp', 'PAM8406D + 扬声器', '功放输出', 468, 180, 'DAC 输出的模拟信号经 D 类功放放大，再驱动扬声器。'),
    ],
    links: [l('mic', 'codec', '模拟输入'), l('codec', 'i2s', 'ADC / DAC'), l('i2s', 'voice', 'ALSA'), l('voice', 'amp', '播放样本'), l('codec', 'amp', '模拟输出')],
    flow: ['mic', 'codec', 'i2s', 'voice', 'amp'],
    facts: [['采集', 'MEMS 麦克风 → ADC → I²S → Linux 音频设备'], ['播放', '软件样本 → I²S → DAC → PAM8406D → 扬声器'], ['控制', 'I²C 配置 Codec；与 I²S 数据分工不同'], ['软件', '个体化声库、合唱、theremin 与抚摸分类等']],
    steps: ['录音时，麦克风模拟信号经 ADC 变成数字音频样本。', 'Linux / 机器人服务读取或生成样本，完成具体互动逻辑。', '播放时样本经 DAC 和功放变成足够推动扬声器的模拟信号。'],
    sources: [s('D1 音频原理图', `${HAT}/audio.kicad_sch`), s('D1 BOM：Codec、功放与麦克风', `${HAT}/production/ASE01187-D1_elec_RPI_Robot_HAT_BOM.csv`), s('音频设备配置', `${RUNTIME}/deploy/robotd.toml`)],
  },
  {
    id: 'nfc', tab: '双 NFC 天线', title: 'NFC：标签靠近时，读写器怎样轮询两根天线', evidence: ['官方规格 + 驱动', 'driver'],
    lead: 'NFC 是近场通信，适合“拿一张配件卡碰一下”这种交互。MicroDuck 的头部和喙部各有一根天线。驱动会在两根天线间切换，只有两边都看不到标签时，才判定标签离开。',
    boundary: 'beta 驱动明确使用 ST25R100 + SPI；另一条 CLRC663 + USB 串口路径是 bench / 既有配置。不要把某一个读卡芯片和天线位置写成所有量产机的统一拆解结论。',
    nodes: [
      n('tag', 'NFC 标签 / 配件卡', '无源标签', 22, 42, '进入读卡器近场后被识别，可用来触发配件或玩法。'),
      n('reader', '读卡芯片', 'ST25R100 / CLRC663', 250, 34, 'beta 为 ST25R100，SPI 接口；CLRC663 是另一条 USB 串口路径。'),
      n('poll', '双天线轮询', 'ISO-14443A', 500, 34, '驱动切换天线并处理寻卡、选中与数据交换。'),
      n('head', '头部天线', 'Antenna 1', 168, 192, '官方产品确认头部有天线，具体内部坐标不依据 MJCF 猜测。'),
      n('beak', '喙部天线', 'Antenna 2', 480, 192, '官方产品确认喙部有天线，可与叼取或配件互动配合。'),
    ],
    links: [l('reader', 'poll', '控制'), l('poll', 'head', '轮询'), l('poll', 'beak', '轮询'), l('tag', 'head', '近场'), l('tag', 'beak', '近场')],
    flow: ['reader', 'poll', 'head', 'tag', 'beak'],
    facts: [['beta 读写器', 'ST25R100，/dev/spidev1.0'], ['bench / 既有路径', 'CLRC663，USB 串口 /dev/ttyACM0'], ['离开判定', '两根天线都看不到标签才判定离开'], ['互动含义', '识别近场标签，不等于远距离无线连接']],
    steps: ['读写器在一根天线上打开射频场并寻找标签。', '按协议读取标签身份或数据，再按逻辑切换另一根天线。', '软件把标签事件映射到配件或行为；两根天线都没有标签才算离开。'],
    sources: [s('两种读写器抽象', `${RUNTIME}/nfc/src/reader.rs`), s('ST25R100 与双天线', `${RUNTIME}/nfc/src/st25r100.rs`), s('官方双 NFC 规格', PRESS)],
    widget: 'nfc',
  },
  {
    id: 'power', tab: '电池与电源', title: '电源：同一个电池，不等于所有芯片吃同一个电压', evidence: ['官方硬件 + 驱动', 'hardware'],
    lead: '电源教程最重要的一句话是：先分清“电池原电压”和“各板卡需要的电源轨”。MicroDuck 的 alpha 控制文档明确舵机由 2S 电池直接供电，主控与音频等则经过板级电源网络。电压还会随负载下陷、静止时恢复。',
    boundary: '不要把 HAT 的 5–28 V 输入能力、Radxa 的板卡供电要求、XL330 的额定电压和整机续航混成一个数字。alpha 的 2S 舵机直供是专用方案，复刻时必须独立做电气与热安全评估。',
    nodes: [
      n('battery', 'NP-F550', '2S · 2600 mAh', 20, 36, '官方可拆电池。2S 表示两节电芯串联；容量不是电压，也不是功耗。'),
      n('hatPower', 'HAT 电源网络', '保护 · 降压 · 分配', 254, 36, 'D1 原理图含 LM5050-1、AP63205 等器件；要按网络逐段确认输入和输出。'),
      n('logic', '主控与音频', '稳压电源轨', 508, 30, '逻辑板与音频不能简单直接接电池原电压，具体电压轨看原理图。'),
      n('servo', '15 个舵机', 'alpha：2S 直供', 394, 190, '官方控制文档明确这一专用路径，同时配置专用 shutdown 位。不能推广成通用接法。'),
      n('sense', '舵机电压回报', '无独立电量计', 80, 190, '约每秒读取所有舵机电压并取有效平均，电压会随负载变化。'),
    ],
    links: [l('battery', 'hatPower', '电池输入', 'power'), l('hatPower', 'logic', '电源轨', 'power'), l('battery', 'servo', '2S 直供', 'power'), l('servo', 'sense', '总线回报'), l('sense', 'hatPower', '电源状态')],
    flow: ['battery', 'hatPower', 'logic', 'servo', 'sense'],
    facts: [['电池', '可拆 NP-F550，2600 mAh，续航约 1 小时且随使用变化'], ['测量', '没有独立电量计；读取舵机自身供电电压'], ['官方映射', 'alpha：6.6 V 为空电阈值，8.2 V 为带载满电参考'], ['安全', '低电平滑关机、舵机过热、SoC 降频是不同问题']],
    steps: ['断电先确认电池、极性、连接器和每路负载需要什么样的供电。', '上电后分别观察逻辑电源与舵机总线，不能用“主控能启动”证明舵机供电正确。', '运行中通过舵机回报观察电压下陷与恢复，再判断电池和负载状态。'],
    sources: [s('官方供电与电压测量', `${RUNTIME}/docs/design/robotd-design.md`), s('D1 电源原理图', `${HAT}/power.kicad_sch`), s('D1 舵机接口原理图', `${HAT}/dynamixel.kicad_sch`)],
    widget: 'power',
  },
  {
    id: 'feet', tab: '脚底与压力', title: '脚底：碰撞接触、压力传感和关节反馈不是一回事', evidence: ['仿真数据 + 待确认', 'schematic'],
    lead: '脚底是双足机器人与地面交换力的地方，但“脚碰没碰地”可以有不同实现：物理引擎能计算碰撞，压力传感器能测力，关节电流也能提供间接线索。三者不能互相冒充。当前网页能证明的是 MuJoCo 脚部接触，不是实机压力读数。',
    boundary: '脚底压力传感器只有社区拆解口径，官方产品规格没有列出，仍标为待官方确认。本讲不虚构压力芯片、量程、安装位置或采样曲线。',
    nodes: [
      n('floor', '地面与脚底几何', '接触面', 30, 40, '脚底形状、材料和姿态会影响接触稳定性；MJCF 用碰撞几何近似。'),
      n('contact', 'MuJoCo contact', '真实仿真事件', 280, 30, '物理引擎根据几何与动力学产生接触，可报告左右脚是否参与接触。'),
      n('pressure', '压力传感器？', '官方未确认', 518, 40, '社区拆解提到压力传感，但缺少官方规格支持，因此只保留问题，不画不存在的读数。'),
      n('feedback', '关节反馈', '位置 / 电流等', 140, 192, '舵机反馈可反映负载变化，但不能直接等同于某一只脚的压力值。'),
      n('policy', '平衡控制', '观测与奖励', 454, 192, '教学环境使用脚部接触参与终止和奖励；实机策略输入须以官方模型定义为准。'),
    ],
    links: [l('floor', 'contact', '碰撞'), l('contact', 'policy', '教学环境'), l('pressure', 'policy', '待确认'), l('feedback', 'policy', '间接信息')],
    flow: ['floor', 'contact', 'policy', 'pressure', 'feedback'],
    facts: [['网页可读', 'MuJoCo 左右脚 collision geom 的接触状态'], ['网页不可读', '实机压力值、压力芯片型号与量程'], ['间接反馈', '舵机位置、速度、电流等不能替代压力标定'], ['复刻参考', '若要加压力传感，需要独立选型、标定、采集与 safety 设计']],
    steps: ['先确认你要回答的是“碰没碰地”还是“用了多大力”。', '碰撞用物理接触，力的大小需要合适传感器和标定，关节反馈只能提供旁证。', '最后才把信号接入观测、奖励或安全逻辑，并检查左右脚与不同地面的差异。'],
    sources: [s('官方产品规格：未列脚底压力', PRESS), s('官方运行时：舵机反馈', `${RUNTIME}/docs/design/robotd-design.md`), s('回三维看真实仿真接触', './simulator.html')],
  },
  {
    id: 'wireless', tab: 'Wi-Fi 与蓝牙', title: '无线连接：配置、控制和视频不是同一种流量', evidence: ['官方规格 + 架构', 'official'],
    lead: 'Wi-Fi 和蓝牙都让鸭子脱离线缆，但带宽、角色和用途不同。官方架构里，蓝牙承载一部分 API 与手机配置；Wi-Fi / LAN 可承载开发、UDP 手柄和 WebRTC 远程能力。摄像头原始帧、深度流和控制消息不会都硬塞进蓝牙。',
    boundary: '官方产品页仍将无线电版本列为未定。本页讲的是服务分工，不代表网页真的扫描或连接你的设备，也不把扩散圆环当作射频覆盖范围。',
    nodes: [
      n('phone', '手机 / 电脑', '配置与控制', 22, 38, '用户侧设备可以配置机器人、发送控制或查看画面，具体能力由服务决定。'),
      n('ble', 'Bluetooth / BLE', 'btd · 窄带 API', 248, 30, 'btd 是传输层，只承载部分 API，不转发所有高带宽流。'),
      n('wifi', 'Wi-Fi / LAN', 'WebRTC · SSH · UDP', 500, 38, '可承担开发、远程控制台、UDP 手柄与视频等更高带宽任务。'),
      n('services', 'robotd / configd / mediad', '服务分工', 132, 190, '无线传输本身不拥有机器人行为，真正的功能仍由后台服务实现。'),
      n('identity', '身份与配对', '安全边界', 474, 190, '设备身份、配对、更新签名与访问控制属于系统的一部分，不能把“连上无线”当作全部安全。'),
    ],
    links: [l('phone', 'ble', '配置 / 部分 API'), l('phone', 'wifi', '视频 / 开发 / 控制'), l('ble', 'services', 'Unix socket'), l('wifi', 'services', '网络服务'), l('services', 'identity', '配对与权限')],
    flow: ['phone', 'ble', 'services', 'wifi', 'identity'],
    facts: [['蓝牙', '手机配置、身份与部分控制 API'], ['Wi-Fi', '开发、局域网控制、WebRTC 与远程能力'], ['不经过蓝牙', '架构明确不承载 padd / tofd 这类高带宽流'], ['未定项', '最终 Wi-Fi / Bluetooth 版本']],
    steps: ['先确定流量类型：配置、控制、深度帧还是视频。', '选择合适的无线与服务通道，传输层再把消息交给对应 daemon。', '配对、身份和更新权限另行检查，不能只以网络可达判断系统安全。'],
    sources: [s('官方服务与无线架构', `${RUNTIME}/docs/design/architecture.md`), s('蓝牙控制文档', `${RUNTIME}/docs/robot/duckctl.md`), s('官方无线未定项', PRESS)],
  },
];

const byId = new Map(LESSONS.map((lesson, index) => [lesson.id, index]));
const ui = Object.fromEntries([
  'lesson-list', 'lesson-counter', 'lesson-evidence', 'lesson-title', 'lesson-lead', 'lesson-boundary',
  'hardware-diagram', 'node-detail', 'lesson-widget', 'lesson-facts', 'lesson-steps', 'lesson-sources',
  'hat-assets', 'lesson-prev', 'lesson-next', 'play-flow',
].map((id) => [id, document.getElementById(id)]));
const SVG_NS = 'http://www.w3.org/2000/svg';
let currentIndex = 0;
let selectedNode = null;
let flowTimer = null;
let flowStep = 0;

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}
function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}
function stopFlow() {
  if (flowTimer) clearInterval(flowTimer);
  flowTimer = null;
  ui['play-flow'].classList.remove('playing');
  ui['play-flow'].textContent = '▶ 播放数据旅程';
  ui['hardware-diagram'].querySelectorAll('.flow-active').forEach((node) => node.classList.remove('flow-active'));
}
function showNode(id, fromFlow = false) {
  const lesson = LESSONS[currentIndex];
  const node = lesson.nodes.find((item) => item.id === id) || lesson.nodes[0];
  selectedNode = node.id;
  ui['hardware-diagram'].querySelectorAll('.diagram-node').forEach((item) => item.classList.toggle('selected', item.dataset.node === node.id));
  ui['node-detail'].replaceChildren(el('b', '', node.title), el('span', '', node.detail));
  if (!fromFlow) stopFlow();
}
function center(node) {
  return { x: node.x + node.w / 2, y: node.y + node.h / 2 };
}
function renderDiagram(lesson) {
  ui['hardware-diagram'].replaceChildren();
  const defs = svgEl('defs');
  for (const [id, color] of [['arrow-data', '#8fa8b6'], ['arrow-power', '#d99a43']]) {
    const marker = svgEl('marker', { id, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' });
    marker.appendChild(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: color }));
    defs.appendChild(marker);
  }
  ui['hardware-diagram'].appendChild(defs);
  const nodeMap = new Map(lesson.nodes.map((node) => [node.id, node]));
  for (const link of lesson.links) {
    const a = center(nodeMap.get(link.from));
    const b = center(nodeMap.get(link.to));
    const line = svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: `diagram-link${link.type === 'power' ? ' power' : ''}` });
    ui['hardware-diagram'].appendChild(line);
    const label = svgEl('text', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 5, class: 'diagram-link-label' });
    label.textContent = link.label;
    ui['hardware-diagram'].appendChild(label);
  }
  for (const node of lesson.nodes) {
    const group = svgEl('g', { class: 'diagram-node', tabindex: '0', role: 'button', 'aria-label': `${node.title}：${node.sub}`, 'data-node': node.id });
    group.appendChild(svgEl('rect', { x: node.x, y: node.y, width: node.w, height: node.h, rx: 9 }));
    const title = svgEl('text', { x: node.x + node.w / 2, y: node.y + 26 });
    title.textContent = node.title;
    const sub = svgEl('text', { x: node.x + node.w / 2, y: node.y + 44, class: 'node-sub' });
    sub.textContent = node.sub;
    group.append(title, sub);
    group.addEventListener('click', () => showNode(node.id));
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showNode(node.id); }
    });
    ui['hardware-diagram'].appendChild(group);
  }
}
function playFlow() {
  if (flowTimer) { stopFlow(); return; }
  const lesson = LESSONS[currentIndex];
  flowStep = 0;
  ui['play-flow'].classList.add('playing');
  ui['play-flow'].textContent = '■ 停止播放';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const advance = () => {
    ui['hardware-diagram'].querySelectorAll('.flow-active').forEach((node) => node.classList.remove('flow-active'));
    if (flowStep >= lesson.flow.length) { stopFlow(); return; }
    const id = lesson.flow[flowStep];
    ui['hardware-diagram'].querySelector(`[data-node="${id}"]`)?.classList.add('flow-active');
    showNode(id, true);
    flowStep += 1;
  };
  advance();
  flowTimer = setInterval(advance, reduced ? 250 : 850);
}

function widgetIntro(title, note) {
  const box = el('div');
  box.appendChild(el('div', 'widget-title', title));
  if (note) box.appendChild(el('p', 'widget-note', note));
  return box;
}
function renderImuWidget() {
  const box = widgetIntro('亲手拆这 12 个字节：点任意一字节');
  const grid = el('div', 'byte-grid');
  const output = el('div', 'widget-output', '字节 0–5 是陀螺仪，6–11 是四元数 x/y/z；w 由单位四元数约束恢复。');
  const labels = ['gx L', 'gx H', 'gy L', 'gy H', 'gz L', 'gz H', 'qx L', 'qx H', 'qy L', 'qy H', 'qz L', 'qz H'];
  const explain = (i) => i < 6
    ? `字节 ${i}：陀螺仪 ${['x', 'y', 'z'][Math.floor(i / 2)]} 轴的${i % 2 ? '高' : '低'}字节。三轴各用 i16 小端整数，量程 ±500 dps，17.5 mdps/LSB。`
    : `字节 ${i}：SFLP 四元数 ${['x', 'y', 'z'][Math.floor((i - 6) / 2)]} 分量的${i % 2 ? '高' : '低'}字节。三个分量各是 2 字节 IEEE half-precision。`;
  labels.forEach((label, i) => {
    const button = el('button', `byte-cell ${i < 6 ? 'gyro' : 'quat'}`, label);
    button.id = `byte-${i}`;
    button.type = 'button';
    button.addEventListener('click', () => {
      grid.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
      output.textContent = explain(i);
    });
    grid.appendChild(button);
  });
  box.append(grid, output, el('p', 'widget-note', '完整诊断块其实是 20 字节；50 Hz 控制环只取前 12 字节，以便与舵机数据在同一事务中读取。'));
  return box;
}
function renderTofWidget() {
  const box = widgetIntro('64 格深度矩阵：拖动教学障碍距离');
  const control = el('label', 'tof-control');
  control.append('障碍距离');
  const range = el('input');
  range.id = 'tof-demo-range';
  range.type = 'range'; range.min = '20'; range.max = '120'; range.step = '5'; range.value = '60';
  const output = el('output', '', '60 cm');
  control.append(range, output);
  const grid = el('div', 'tof-grid');
  const cells = Array.from({ length: 64 }, (_, i) => {
    const cell = el('div', 'tof-cell');
    cell.id = `tof-cell-${i}`;
    grid.appendChild(cell);
    return cell;
  });
  const update = () => {
    const base = Number(range.value);
    output.textContent = `${base} cm`;
    cells.forEach((cell, i) => {
      const row = Math.floor(i / 8), col = i % 8;
      const value = Math.max(1, base + ((row * 3 + col * 2) % 7) - 3);
      cell.textContent = String(value);
      cell.style.background = `hsl(${205 - value * 0.45} 48% ${Math.max(72, 94 - value * 0.12)}%)`;
    });
  };
  range.addEventListener('input', update);
  update();
  box.append(control, grid, el('p', 'widget-note', '颜色与每格差异只是帮助观察 8×8 结构的教学数据，不是实机深度、量程或噪声。'));
  return box;
}
function renderServoWidget() {
  const box = widgetIntro('把 15 个 ID 分组：为什么策略只输出 14 路？');
  const groups = el('div', 'id-groups');
  for (const [title, ids, mouth] of [
    ['右腿', [10, 11, 12, 13, 14], false], ['左腿', [20, 21, 22, 23, 24], false],
    ['头颈（策略）', [30, 31, 32, 33], false], ['鸭嘴（上层控制）', [34], true],
  ]) {
    const group = el('div', 'id-group');
    group.appendChild(el('b', '', title));
    ids.forEach((id) => group.appendChild(el('span', `id-chip${mouth ? ' mouth' : ''}`, `ID ${id}`)));
    groups.appendChild(group);
  }
  box.append(groups, el('p', 'widget-note', '10 个腿部 + 4 个头颈 = 14 路策略动作；第 15 个是鸭嘴。不同复刻项目可能使用另一套 ID，不能照搬。'));
  return box;
}
function renderCameraWidget() {
  const box = widgetIntro(' zero3 相机链路：读出像素和输出像素分开看');
  const choices = el('div', 'choice-row');
  const output = el('div', 'widget-output');
  const modes = [
    ['传感器全阵列', 3280, 2464, 'IMX219 的完整像素阵列；不等于默认 WebRTC 输出。'],
    ['驱动读出', 1920, 1080, '代码固定的 1920×1080 @ 30 RAW10 读出；原型为全宽缩放读出。'],
    ['默认视频', 1280, 720, '常见默认输出 1280×720 @ 30，经缩放与硬编码后传输。'],
  ];
  modes.forEach(([label, w, h, detail], index) => {
    const button = el('button', `choice-button${index === 0 ? ' active' : ''}`, label);
    button.addEventListener('click', () => {
      choices.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
      output.textContent = `${w} × ${h} = ${(w * h).toLocaleString('zh-CN')} 像素。${detail}`;
    });
    choices.appendChild(button);
    if (index === 0) output.textContent = `${w} × ${h} = ${(w * h).toLocaleString('zh-CN')} 像素。${detail}`;
  });
  box.append(choices, output, el('p', 'widget-note', '这些数字用于理解 zero3 原型链路；官方零售产品的最终相机规格仍未锁定。'));
  return box;
}
function renderNfcWidget() {
  const box = widgetIntro('模拟两根天线轮询：只有两处都没有标签，才算离开');
  const choices = el('div', 'choice-row');
  const output = el('div', 'widget-output', '点一个场景，看双天线判定。');
  for (const [label, detail] of [
    ['标签在头部', '天线 1 看到标签 → 标签在场；不需要另一根也同时看到。'],
    ['标签在喙部', '天线 2 看到标签 → 标签在场；可触发对应配件逻辑。'],
    ['两边都没有', '天线 1 与天线 2 都没有标签 → 才判定标签离开。'],
  ]) {
    const button = el('button', 'choice-button', label);
    button.addEventListener('click', () => {
      choices.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
      output.textContent = detail;
    });
    choices.appendChild(button);
  }
  box.append(choices, output);
  return box;
}
function renderPowerWidget() {
  const box = widgetIntro('看 alpha 电压口径：不是精确电量百分比实验');
  const control = el('label', 'tof-control');
  control.append('舵机回报电压');
  const range = el('input'); range.id = 'voltage-demo-range'; range.type = 'range'; range.min = '6.4'; range.max = '8.4'; range.step = '0.1'; range.value = '7.4';
  const value = el('output', '', '7.4 V');
  control.append(range, value);
  const output = el('div', 'widget-output');
  const update = () => {
    const voltage = Number(range.value);
    value.textContent = `${voltage.toFixed(1)} V`;
    output.textContent = voltage <= 6.6
      ? `${voltage.toFixed(1)} V：到达或低于官方 alpha 映射的空电阈值；平滑低电会触发坐下与关机流程。`
      : voltage >= 8.2
        ? `${voltage.toFixed(1)} V：官方 alpha 的带载满电参考。不是建议给 XL330 通用的充电或供电目标。`
        : `${voltage.toFixed(1)} V：位于 alpha 工作映射区间。实际电压会随负载下陷、静止恢复，不能一次读数就当精确剩余容量。`;
  };
  range.addEventListener('input', update); update();
  box.append(control, output, el('p', 'widget-note', '滑杆只是解释官方映射边界，不仿真电池化学、内阻或功耗。'));
  return box;
}
function renderWidget(lesson) {
  ui['lesson-widget'].replaceChildren();
  const factories = { imu: renderImuWidget, tof: renderTofWidget, servo: renderServoWidget, camera: renderCameraWidget, nfc: renderNfcWidget, power: renderPowerWidget };
  if (factories[lesson.widget]) ui['lesson-widget'].appendChild(factories[lesson.widget]());
}

function renderLesson(index, updateHash = true) {
  stopFlow();
  currentIndex = Math.max(0, Math.min(LESSONS.length - 1, index));
  const lesson = LESSONS[currentIndex];
  document.querySelectorAll('.lesson-tab').forEach((button, i) => {
    button.classList.toggle('active', i === currentIndex);
    button.setAttribute('aria-current', i === currentIndex ? 'step' : 'false');
  });
  ui['lesson-counter'].textContent = `第 ${currentIndex + 1} / ${LESSONS.length} 讲`;
  ui['lesson-evidence'].textContent = lesson.evidence[0];
  ui['lesson-evidence'].className = `evidence ${lesson.evidence[1]}`;
  ui['lesson-title'].textContent = lesson.title;
  ui['lesson-lead'].textContent = lesson.lead;
  ui['lesson-boundary'].textContent = `边界：${lesson.boundary}`;
  ui['hat-assets'].hidden = !lesson.hat;
  renderDiagram(lesson);
  showNode(lesson.nodes[0].id, true);
  renderWidget(lesson);
  ui['lesson-facts'].replaceChildren();
  lesson.facts.forEach(([term, detail]) => {
    const row = el('div'); row.append(el('dt', '', term), el('dd', '', detail)); ui['lesson-facts'].appendChild(row);
  });
  ui['lesson-steps'].replaceChildren(...lesson.steps.map((step) => el('li', '', step)));
  ui['lesson-sources'].replaceChildren(...lesson.sources.map((source) => {
    const anchor = el('a', '', `${source.label} ↗`); anchor.href = source.url;
    if (/^https?:/.test(source.url)) { anchor.target = '_blank'; anchor.rel = 'noreferrer'; }
    return anchor;
  }));
  ui['lesson-prev'].disabled = currentIndex === 0;
  ui['lesson-next'].disabled = currentIndex === LESSONS.length - 1;
  ui['lesson-next'].textContent = currentIndex === LESSONS.length - 1 ? '已到最后' : `下一讲：${LESSONS[currentIndex + 1].tab} →`;
  if (updateHash) history.replaceState(null, '', `#${lesson.id}`);
  document.title = `${lesson.tab} · 电路板与传感器拆解课`;
}

LESSONS.forEach((lesson, index) => {
  const button = el('button', 'lesson-tab');
  button.type = 'button';
  button.dataset.lesson = lesson.id;
  button.append(el('span', '', String(index + 1).padStart(2, '0')), el('span', '', lesson.tab));
  button.addEventListener('click', () => renderLesson(index));
  ui['lesson-list'].appendChild(button);
});
ui['lesson-prev'].addEventListener('click', () => renderLesson(currentIndex - 1));
ui['lesson-next'].addEventListener('click', () => renderLesson(currentIndex + 1));
ui['play-flow'].addEventListener('click', playFlow);
window.addEventListener('hashchange', () => {
  const index = byId.get(location.hash.slice(1));
  if (index !== undefined && index !== currentIndex) renderLesson(index, false);
});
renderLesson(byId.get(location.hash.slice(1)) ?? 0, false);
window.__microduckHardware = { lessons: LESSONS, renderLesson, get currentIndex() { return currentIndex; } };
