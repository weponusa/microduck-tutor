// 第一关机械零件与硬件课的对应关系。
// geom 编号来自 assets/duck/duck.glb 使用的 scene.xml 导出版本；
// 网格名用于复核，界面与课程链接只使用稳定的课程 ID。
export const ANATOMY_HARDWARE = [
  {
    id: 'compute', short: '主控板', title: '主控计算板', lesson: 'compute', geoms: [60], mesh: 'pcb__raspberry_pi_zero_2_w',
    description: '你点的是原型主控板网格。模型保留 Raspberry Pi Zero 外形；当前官方 zero3 开发配置使用 Radxa Zero 3W。继续拆 RK3566、CPU 动作策略与 NPU 视觉实验。',
  },
  {
    id: 'hat', short: 'Robot HAT', title: 'RPI Robot HAT', lesson: 'hat', geoms: [52], mesh: 'elec_rpi_robot_hat_pcb',
    description: '这块绿色板就是模型里的 RPI Robot HAT。它不只是示意图：官方公开了 D1 的 KiCad、原理图、PCB 和 BOM，可以继续看到芯片与接口。',
  },
  {
    id: 'servo', short: '15 个舵机', title: 'XL330 智能舵机', lesson: 'servo', geoms: [5, 10, 14, 21, 24, 27, 34, 35, 40, 45, 50, 63, 69, 73, 74], mesh: 'xl330',
    description: '模型里共有 15 个 XL330 网格；其中 14 个关节参与动作策略，鸭嘴由上层行为单独控制。继续看总线 ID、位置 / 速度 / 电流 / 电压 / 温度反馈。',
  },
  {
    id: 'camera', short: '相机', title: '前置相机与镜头', lesson: 'camera', geoms: [43, 59], mesh: 'lens + m12_lens_holder',
    description: '你点的是镜头或镜头支架。模型能说明安装位置和机械关系，但不会采集图像；继续看图像传感器、MIPI CSI、像素链和 WebRTC。',
  },
  {
    id: 'tof', short: '8×8 ToF', title: 'ToF 深度传感器', lesson: 'tof', geoms: [], mesh: '仅有 site，无独立零件网格',
    description: '当前机械模型有 ToF 安装 site，但没有可单独点击的传感器网格，也没有真实测距。进入课程可直接操作 8×8、共 64 格的深度矩阵。',
  },
  {
    id: 'imu', short: '双 IMU', title: '机身与头部 IMU', lesson: 'imu', geoms: [], mesh: 'imu_to_dxl 无独立零件网格',
    description: '模型没有单独的 imu_to_dxl 板网格；物理沙盒能读躯干 IMU 仿真数据，头部只有安装 site。继续看两种 IMU、两条数据链和 12 字节格式。',
  },
  {
    id: 'audio', short: '扬声器', title: '音频链路', lesson: 'audio', geoms: [61], mesh: 'speaker',
    description: '你点的是扬声器。声音还要经过麦克风、Codec、I²S、软件和功放；继续把这条模拟—数字—模拟链路完整走一遍。',
  },
  {
    id: 'nfc', short: 'NFC', title: 'NFC 双天线', lesson: 'nfc', geoms: [], mesh: '无独立天线网格',
    description: '当前模型没有独立 NFC 天线网格，不能用机身位置冒充拆解坐标。官方确认头部与喙部双天线；课程里可模拟两处轮询与离开判定。',
  },
  {
    id: 'power', short: '电池', title: '电池与电源', lesson: 'power', geoms: [8], mesh: 'np_f970（旧模型代理）',
    description: '模型里的电池网格名为 np_f970，是旧模型的外形代理；官方现售规格是可拆 NP-F550、2600 mAh。继续看 2S 供电、板级电源轨与舵机电压回报。',
  },
  {
    id: 'feet', short: '脚底', title: '脚底接触与压力', lesson: 'feet', geoms: [28, 30, 77, 81], mesh: 'sole / foot',
    description: '你点的是脚掌或鞋底。几何形状能产生物理碰撞，但接触不等于压力读数；继续看压力传感的证据边界，以及关节反馈能提供什么旁证。',
  },
  {
    id: 'wireless', short: '无线', title: 'Wi-Fi 与蓝牙', lesson: 'wireless', geoms: [], mesh: '无独立无线模块网格',
    description: '无线功能不能从这块机械模型里看出芯片与天线位置。继续看蓝牙、Wi-Fi、配置、控制和视频各自走哪条服务通道。',
  },
];

export const GEOM_TO_HARDWARE = new Map(
  ANATOMY_HARDWARE.flatMap((part) => part.geoms.map((geom) => [`geom${geom}`, part.id]))
);
