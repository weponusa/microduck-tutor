import * as THREE from 'three';

export const SENSOR_TOPICS = [
  {
    id: 'camera',
    title: '前置相机',
    short: '相机 · REC',
    status: '官方确认 · 仿真未建模',
    description: '官方确认前置相机与专用相机使用指示灯（经典 REC 灯造型），mediad 可通过 WebRTC 传输画面。官方驱动还区分 zero3 的 IMX219 与 beta 的 GC2093，但零售产品的最终分辨率和视场角仍未公布。当前 MJCF 只有安装位置，没有图像采集仿真；四棱锥和红点仅用于说明位置与指示灯概念。',
    boundary: '视场线框是形状示意，不代表真实 FOV、成像范围或画面；REC 点也不表示设备正在录制。',
  },
  {
    id: 'tof',
    title: 'ToF 深度传感器',
    short: 'ToF · 8×8',
    status: '官方确认 · 仿真未建模',
    description: '官方仅确认前置 ToF 可输出 8×8 深度矩阵，具体型号和量程尚未确定。这里用 64 个采样点和线束解释矩阵形态，障碍距离由教学控件给定。前沿的轻微波动也是演示效果，不是传感器噪声模型。',
    boundary: '所有距离与颜色均为交互演示，不是真实测距、标定结果或官方量程。',
  },
  {
    id: 'bodyImu',
    title: '机身 IMU',
    short: '机身 IMU',
    status: '教学模型真实数据',
    description: '官方确认机器人采用机身与头部双 IMU。当前 MJCF 在躯干 imu site 上配置了姿态、陀螺仪和加速度计，可读取本次物理仿真的 sensordata。官方运行时中，躯干 LSM6DSV16X 经 imu_to_dxl 进入 50 Hz 控制环；三支坐标轴显示该 site 的实时仿真姿态。',
    boundary: '数值来自 MuJoCo 教学模型而非硬件 IMU；模型噪声参数不等于实机误差特性。',
  },
  {
    id: 'headImu',
    title: '头部 IMU',
    short: '头部 IMU',
    status: '官方确认 · 仿真未建模',
    description: '官方确认头部另有 IMU，与机身 IMU 构成双 IMU 配置。官方运行时按板型分别读取：zero3 的 HAT BMI088 由 tofd 负责且默认关闭，beta 的 LSM6DSV16X 由 robotd 读取。当前 MJCF 仅放置 head_imu site，没有对应 sensor，因此这里只显示安装点的坐标轴朝向，没有任何头部角速度或加速度读数。',
    boundary: '坐标轴来自 head_imu site 的位姿，不是头部 IMU 的 sensordata，也不能替代实机采样。',
  },
  {
    id: 'joints',
    title: '关节与执行器',
    short: '关节 · 14 路',
    status: '教学模型真实数据',
    description: '官方产品为 15 电机、约 25 cm 高、800 g 以下，控制频率为 50 Hz；本教学模型使用 14 路执行器。社区拆解提到 XL330 与磁编码器，但这不是官方确认的量产规格。图中读取教学模型 qpos 与 ctrl，并比较目标角和关节角。',
    boundary: '关节误差是仿真控制误差，不是硬件编码器采样；社区拆解信息不能当作官方物料清单。',
  },
  {
    id: 'audio',
    title: '麦克风与扬声器',
    short: '音频 · 合成试听',
    status: '官方确认 · 仿真未建模',
    description: '官方确认麦克风、扬声器及按序列号生成声音的能力；官方 pet-detect 可用麦克风进行抚摸分类，且默认关闭。这里用 WebAudio 合成约 0.3 秒的简单 quack，配合扩散声波说明声音输出。试听和声波均为教学演示。',
    boundary: '合成声音不是官方声纹，也不模拟真实麦克风采集、扬声器频响或序列号算法。',
  },
  {
    id: 'nfc',
    title: 'NFC 双天线',
    short: 'NFC · 双天线',
    status: '官方确认 · 仿真未建模',
    description: '官方确认头部与喙部各有一组 NFC 天线。两处脉冲环用来区分安装位置，“标签靠近”动画用于讲解近场交互。当前物理模型没有标签、配对或数据交换过程。',
    boundary: '脉冲与标签靠近只是视觉示意；头部天线借用邻近 site 做教学定位，不是拆解坐标，也不代表真实 NFC 场强、读距、连接状态或通信内容。',
  },
  {
    id: 'feet',
    title: '脚底接触与压力',
    short: '脚底 · 接触',
    status: '待官方确认',
    description: '脚底压力传感器目前只有社区拆解口径，具体配置仍待官方确认。可视化读取 MuJoCo 接触表，显示左右脚 collision geom 是否真实参与接触。无 floor 的场景只能报告脚部与任意 geom 的接触，并会明确标注。',
    boundary: '接触状态是物理碰撞结果，不是压力值、力传感器读数或实机脚底硬件证明；滚轮脚等缺少命名脚底 geom 的模型不支持此读数。',
  },
  {
    id: 'wireless',
    title: '无线连接',
    short: 'Wi-Fi · 蓝牙',
    status: '官方确认 · 仿真未建模',
    description: '官方确认机器人支持 Wi-Fi 与蓝牙。躯干周围的扩散圆环用于提示无线连接能力，可播放一段纯视觉发射动画。当前模块不扫描网络，也不建立任何无线连接。',
    boundary: '圆环不代表信号强度、覆盖范围、协议状态或真实射频传播。',
  },
];

const TOPIC_BY_ID = new Map(SENSOR_TOPICS.map((topic) => [topic.id, topic]));
const COLORS = {
  camera: 0xff5a5f,
  tof: 0x36a9e1,
  bodyImu: 0x6c63ff,
  headImu: 0x9b72cf,
  joints: 0xe3a008,
  audio: 0xff8a3d,
  nfc: 0x22a884,
  feet: 0x39a96b,
  wireless: 0x4380ce,
};
const LABEL_OFFSETS = {
  camera: [34, -34],
  tof: [92, 4],
  bodyImu: [-68, 20],
  headImu: [-82, -48],
  joints: [-70, 42],
  audio: [-36, 50],
  nfc: [70, 48],
  feet: [58, 24],
  wireless: [-76, -28],
};

function name2id(app, type, name) {
  try {
    return app.mujoco.mj_name2id(app.model, app.mujoco.mjtObj[type].value, name);
  } catch (error) {
    return -1;
  }
}

function nameOf(app, type, id) {
  try {
    return app.mujoco.mj_id2name(app.model, app.mujoco.mjtObj[type].value, id) || '';
  } catch (error) {
    return '';
  }
}

function makeLineMaterial(color, opacity = 0.85) {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
}

function makeRing(radius, color, opacity = 0.65) {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.82, radius, 40),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  return mesh;
}

export class SensorExplorer {
  constructor({ scene, camera, controls, canvas, stage, onSelect }) {
    this.scene = scene;
    this.camera = camera;
    this.controls = controls;
    this.canvas = canvas;
    this.stage = stage;
    this.onSelect = onSelect;

    this.enabled = false;
    this.selected = null;
    this.tofDistance = 40;
    this.app = null;
    this.group = null;
    this.labelRoot = null;
    this.markers = new Map();
    this.labels = new Map();
    this.pickTargets = [];
    this.visuals = {};
    this.siteIds = {};
    this.bodyIds = {};
    this.sensorIds = {};
    this.joints = [];
    this.footGeomIds = [-1, -1];
    this.floorGeomId = -1;
    this.contactMode = 'none';
    this.audioError = '';
    this.demoStart = { audio: -Infinity, nfc: -Infinity, wireless: -Infinity };
    this.demoDuration = { audio: 1, nfc: 1.5, wireless: 1.2 };
    this._now = 0;
    this._tofDirty = true;
    this._contacts = { left: false, right: false };

    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._project = new THREE.Vector3();
    this._world = new THREE.Vector3();
    this._cameraDirection = new THREE.Vector3();
    this._toMarker = new THREE.Vector3();
    this._matrix = new THREE.Matrix4();
    this._color = new THREE.Color();
    this._xAxis = new THREE.Vector3(1, 0, 0);
    this._yAxis = new THREE.Vector3(0, 1, 0);
    this._zAxis = new THREE.Vector3(0, 0, 1);

    this._onPointerDown = (event) => {
      if (!this.enabled || !this.group || !this.pickTargets.length) return;
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      this._pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      this._raycaster.setFromCamera(this._pointer, this.camera);
      const hit = this._raycaster.intersectObjects(this.pickTargets, false)[0];
      if (!hit) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.select(hit.object.userData.sensorId);
    };
    this.canvas.addEventListener('pointerdown', this._onPointerDown, true);
  }

  rebuild(app) {
    this.disposeModel();
    this.app = app;
    if (!app?.mujoco || !app.model || !app.data) return;

    this.group = new THREE.Group();
    this.group.name = 'sensor-explorer';
    this.group.visible = this.enabled;
    this.scene.add(this.group);

    for (const name of ['head_camera', 'tof', 'head_imu', 'imu', 'mouth_tip', 'left_foot', 'right_foot']) {
      this.siteIds[name] = name2id(app, 'mjOBJ_SITE', name);
    }
    for (const name of ['trunk_base', 'jaw_soft', 'ankle_left', 'ankle_right']) {
      this.bodyIds[name] = name2id(app, 'mjOBJ_BODY', name);
    }
    for (const name of ['orientation', 'imu_accel', 'angular-velocity']) {
      this.sensorIds[name] = name2id(app, 'mjOBJ_SENSOR', name);
    }

    this.footGeomIds = [
      name2id(app, 'mjOBJ_GEOM', 'left_foot_collision'),
      name2id(app, 'mjOBJ_GEOM', 'right_foot_collision'),
    ];
    this.floorGeomId = name2id(app, 'mjOBJ_GEOM', 'floor');
    if (this.footGeomIds.every((id) => id >= 0)) {
      this.contactMode = this.floorGeomId >= 0 ? 'floor' : 'any';
    }

    this._cacheJoints();
    this._createLabels();
    this._createMarkers();
    this._createVisuals();
    this._refreshSelection();
    this.update(performance.now());
  }

  _cacheJoints() {
    const { model, mujoco } = this.app;
    const hingeType = mujoco.mjtJoint?.mjJNT_HINGE?.value ?? 1;
    for (let i = 0; i < model.nu && this.joints.length < 14; i++) {
      const jointId = model.actuator_trnid[i * 2];
      if (jointId < 0 || model.jnt_type[jointId] !== hingeType) continue;
      this.joints.push({
        actuator: i,
        jointId,
        bodyId: model.jnt_bodyid[jointId],
        qposAdr: model.jnt_qposadr[jointId],
        name: nameOf(this.app, 'mjOBJ_ACTUATOR', i) || `actuator_${i}`,
      });
    }
  }

  _createLabels() {
    this.labelRoot = document.createElement('div');
    this.labelRoot.className = 'sensor-overlay';
    this.labelRoot.dataset.sensorExplorer = '';
    this.labelRoot.hidden = !this.enabled;
    this.stage.appendChild(this.labelRoot);

    for (const topic of SENSOR_TOPICS) {
      const label = document.createElement('button');
      label.type = 'button';
      label.textContent = topic.short;
      label.title = `${topic.title}\n${topic.status}\n${topic.boundary}`;
      label.dataset.sensorId = topic.id;
      label.className = 'sensor-label';
      label.hidden = true;
      label.style.left = '0';
      label.style.top = '0';
      label.addEventListener('pointerdown', (event) => event.stopPropagation());
      label.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.select(topic.id);
      });
      this.labelRoot.appendChild(label);
      this.labels.set(topic.id, label);
    }
  }

  _anchor(siteName, bodyName) {
    const siteId = this.siteIds[siteName];
    if (siteId >= 0) return { type: 'site', id: siteId };
    const bodyId = this.bodyIds[bodyName];
    return bodyId >= 0 ? { type: 'body', id: bodyId } : null;
  }

  _createMarkers() {
    const anchors = {
      camera: this._anchor('head_camera', 'jaw_soft'),
      tof: this._anchor('tof', 'jaw_soft'),
      bodyImu: this._anchor('imu', 'trunk_base'),
      headImu: this._anchor('head_imu', 'jaw_soft'),
      joints: this._anchor('', 'trunk_base'),
      audio: this._anchor('mouth_tip', 'jaw_soft'),
      nfc: this._anchor('mouth_tip', 'jaw_soft'),
      feet: this.contactMode !== 'none' ? this._anchor('left_foot', 'ankle_left') : null,
      wireless: this._anchor('', 'trunk_base'),
    };
    const sphereGeometry = new THREE.SphereGeometry(0.0052, 16, 12);
    const haloGeometry = new THREE.RingGeometry(0.007, 0.0082, 32);

    for (const topic of SENSOR_TOPICS) {
      const anchor = anchors[topic.id];
      if (!anchor) continue;
      const marker = new THREE.Group();
      const material = new THREE.MeshBasicMaterial({
        color: COLORS[topic.id],
        transparent: true,
        opacity: 0.92,
        depthTest: false,
        depthWrite: false,
      });
      const sphere = new THREE.Mesh(sphereGeometry, material);
      sphere.renderOrder = 30;
      sphere.userData.sensorId = topic.id;
      const halo = new THREE.Mesh(
        haloGeometry,
        new THREE.MeshBasicMaterial({
          color: COLORS[topic.id],
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
        })
      );
      halo.renderOrder = 29;
      marker.add(sphere, halo);
      this.group.add(marker);
      this.pickTargets.push(sphere);
      this.markers.set(topic.id, { group: marker, sphere, halo, anchor });
    }
  }

  _visual(id) {
    const group = new THREE.Group();
    group.name = `sensor-${id}`;
    group.visible = false;
    this.group.add(group);
    this.visuals[id] = group;
    return group;
  }

  _createVisuals() {
    this._createCameraVisual();
    this._createTofVisual();
    this._createImuVisual('bodyImu');
    this._createImuVisual('headImu');
    this._createJointVisual();
    this._createAudioVisual();
    this._createNfcVisual();
    this._createFeetVisual();
    this._createWirelessVisual();
  }

  _createCameraVisual() {
    const group = this._visual('camera');
    const far = 0.09;
    const corners = [
      [far, -0.04, -0.03], [far, 0.04, -0.03],
      [far, 0.04, 0.03], [far, -0.04, 0.03],
    ];
    const segments = [];
    for (let i = 0; i < 4; i++) {
      segments.push(0, 0, 0, ...corners[i]);
      segments.push(...corners[i], ...corners[(i + 1) % 4]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
    group.add(new THREE.LineSegments(geometry, makeLineMaterial(COLORS.camera, 0.8)));
    const rec = new THREE.Mesh(
      new THREE.SphereGeometry(0.004, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xff2028, transparent: true, depthTest: false, depthWrite: false })
    );
    rec.position.set(0.006, -0.012, 0.01);
    rec.renderOrder = 31;
    group.add(rec);
    group.userData.rec = rec;
  }

  _createTofVisual() {
    const group = this._visual('tof');
    const positions = new Float32Array(64 * 3);
    const colors = new Float32Array(64 * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ size: 0.004, vertexColors: true, sizeAttenuation: true, depthWrite: false })
    );
    points.frustumCulled = false;
    group.add(points);

    const gridIndices = [];
    const at = (row, col) => row * 8 + col;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 7; col++) gridIndices.push(at(row, col), at(row, col + 1));
    }
    for (let col = 0; col < 8; col++) {
      for (let row = 0; row < 7; row++) gridIndices.push(at(row, col), at(row + 1, col));
    }
    const gridPositions = new Float32Array(gridIndices.length * 3);
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute('position', new THREE.BufferAttribute(gridPositions, 3).setUsage(THREE.DynamicDrawUsage));
    const grid = new THREE.LineSegments(gridGeometry, makeLineMaterial(COLORS.tof, 0.55));
    grid.frustumCulled = false;
    group.add(grid);

    const perimeter = [];
    for (let col = 0; col < 8; col += 1) perimeter.push(at(0, col));
    for (let row = 1; row < 8; row += 1) perimeter.push(at(row, 7));
    for (let col = 6; col >= 0; col -= 1) perimeter.push(at(7, col));
    for (let row = 6; row > 0; row -= 1) perimeter.push(at(row, 0));
    const beamPositions = new Float32Array(perimeter.length * 6);
    const beamGeometry = new THREE.BufferGeometry();
    beamGeometry.setAttribute('position', new THREE.BufferAttribute(beamPositions, 3).setUsage(THREE.DynamicDrawUsage));
    const beams = new THREE.LineSegments(beamGeometry, makeLineMaterial(COLORS.tof, 0.2));
    beams.frustumCulled = false;
    group.add(beams);
    group.userData.tof = { points, positions, colors, gridIndices, gridPositions, perimeter, beamPositions };
  }

  _createImuVisual(id) {
    const group = this._visual(id);
    const length = 0.025;
    group.add(
      new THREE.ArrowHelper(this._xAxis, new THREE.Vector3(), length, 0xe33f45, 0.006, 0.003),
      new THREE.ArrowHelper(this._yAxis, new THREE.Vector3(), length, 0x36a76c, 0.006, 0.003),
      new THREE.ArrowHelper(this._zAxis, new THREE.Vector3(), length, 0x367bd9, 0.006, 0.003)
    );
  }

  _createJointVisual() {
    const group = this._visual('joints');
    const positions = new Float32Array(14 * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, this.joints.length);
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: COLORS.joints, size: 0.009, sizeAttenuation: true, depthTest: false })
    );
    points.renderOrder = 25;
    points.frustumCulled = false;
    group.add(points);
    group.userData.positions = positions;
  }

  _createAudioVisual() {
    const group = this._visual('audio');
    group.userData.rings = [];
    for (let i = 0; i < 3; i++) {
      const ring = makeRing(0.012, COLORS.audio, 0.3);
      ring.rotateY(Math.PI / 2);
      group.add(ring);
      group.userData.rings.push(ring);
    }
  }

  _createNfcVisual() {
    const group = this._visual('nfc');
    group.userData.sides = [];
    for (const siteName of ['head_imu', 'mouth_tip']) {
      const side = new THREE.Group();
      side.userData.siteName = siteName;
      side.userData.rings = [];
      for (let i = 0; i < 2; i++) {
        const ring = makeRing(0.012, COLORS.nfc, 0.4);
        side.add(ring);
        side.userData.rings.push(ring);
      }
      group.add(side);
      group.userData.sides.push(side);
    }
  }

  _createFeetVisual() {
    const group = this._visual('feet');
    group.userData.feet = [];
    for (const siteName of ['left_foot', 'right_foot']) {
      const ring = makeRing(0.018, 0x8a96a3, 0.8);
      ring.userData.siteName = siteName;
      group.add(ring);
      group.userData.feet.push(ring);
    }
  }

  _createWirelessVisual() {
    const group = this._visual('wireless');
    group.userData.rings = [];
    for (let i = 0; i < 3; i++) {
      const ring = makeRing(0.035, COLORS.wireless, 0.35);
      group.add(ring);
      group.userData.rings.push(ring);
    }
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.group) this.group.visible = this.enabled;
    if (this.labelRoot) this.labelRoot.hidden = !this.enabled;
  }

  select(id) {
    if (!TOPIC_BY_ID.has(id)) return;
    this.selected = id;
    this._refreshSelection();
    if (typeof this.onSelect === 'function') this.onSelect(id);
  }

  _refreshSelection() {
    for (const [id, group] of Object.entries(this.visuals)) {
      group.visible = id === this.selected && this.markers.has(id);
    }
    for (const topic of SENSOR_TOPICS) {
      const label = this.labels.get(topic.id);
      if (!label) continue;
      label.classList.toggle('selected', topic.id === this.selected);
    }
  }

  setTofDistance(cm) {
    if (!Number.isFinite(cm)) return;
    this.tofDistance = THREE.MathUtils.clamp(cm, 10, 100);
    this._tofDirty = true;
  }

  runDemo(id) {
    if (!Object.hasOwn(this.demoStart, id)) return;
    this.select(id);
    this.demoStart[id] = this._now || performance.now() / 1000;
    if (id === 'audio') void this._playQuack();
  }

  async _playQuack() {
    let context = null;
    try {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) throw new Error('WebAudio unavailable');
      context = new AudioContextClass();
      this._audioContext = context;
      if (context.state === 'suspended') await context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime;
      oscillator.type = 'sawtooth';
      oscillator.frequency.setValueAtTime(520, start);
      oscillator.frequency.exponentialRampToValueAtTime(310, start + 0.12);
      oscillator.frequency.exponentialRampToValueAtTime(220, start + 0.3);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.09, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => {
        if (this._audioContext === context) this._audioContext = null;
        context.close().catch(() => {});
      };
      oscillator.start(start);
      oscillator.stop(start + 0.3);
      this.audioError = '';
    } catch (error) {
      this.audioError = '当前浏览器无法播放合成试听';
      if (context) {
        if (this._audioContext === context) this._audioContext = null;
        try { await context.close(); } catch (closeError) {}
      }
    }
  }

  _sensorValues(name) {
    const id = this.sensorIds[name];
    if (id === undefined || id < 0) return null;
    const { model, data } = this.app;
    const address = model.sensor_adr[id];
    const dimension = model.sensor_dim[id];
    return data.sensordata.subarray(address, address + dimension);
  }

  _readContacts() {
    this._contacts.left = false;
    this._contacts.right = false;
    if (!this.app?.data || this.contactMode === 'none') return this._contacts;
    const { data } = this.app;
    for (let i = 0; i < data.ncon; i++) {
      const contact = typeof data.contact?.get === 'function' ? data.contact.get(i) : data.contact[i];
      if (!contact) continue;
      for (let side = 0; side < 2; side++) {
        const foot = this.footGeomIds[side];
        const involvesFoot = contact.geom1 === foot || contact.geom2 === foot;
        if (!involvesFoot) continue;
        const isFloor = this.contactMode === 'any' || contact.geom1 === this.floorGeomId || contact.geom2 === this.floorGeomId;
        if (isFloor) this._contacts[side === 0 ? 'left' : 'right'] = true;
      }
    }
    return this._contacts;
  }

  getReading(id) {
    if (!TOPIC_BY_ID.has(id)) return '';
    if (!this.app?.data) return '模型尚未就绪';
    switch (id) {
      case 'bodyImu': {
        const quat = this._sensorValues('orientation');
        if (quat?.length >= 4) {
          return `仿真 orientation [w,x,y,z]：${Array.from(quat.slice(0, 4), (v) => v.toFixed(3)).join(', ')}`;
        }
        const accel = this._sensorValues('imu_accel');
        if (accel?.length >= 3) {
          return `仿真 imu_accel [m/s²]：${Array.from(accel.slice(0, 3), (v) => v.toFixed(3)).join(', ')}`;
        }
        return '当前 MJCF 没有机身 IMU sensordata';
      }
      case 'headImu':
        return '仅 head_imu site 朝向 · 当前 MJCF 无头部 IMU 读数';
      case 'joints': {
        let maxError = 0;
        let maxName = '—';
        for (const joint of this.joints) {
          const error = Math.abs(this.app.data.ctrl[joint.actuator] - this.app.data.qpos[joint.qposAdr]);
          if (error > maxError) { maxError = error; maxName = joint.name; }
        }
        return `${this.joints.length} 路教学模型最大 |ctrl−qpos|：${(maxError * 180 / Math.PI).toFixed(2)}°（${maxName}）`;
      }
      case 'feet': {
        if (this.contactMode === 'none') return '当前模型缺少命名的左右脚 collision geom · 无接触读数';
        const contact = this._readContacts();
        const mode = this.contactMode === 'floor' ? '脚底对 floor' : '脚部对任意 geom（非 floor 限定）';
        return `MuJoCo ${mode} · 左：${contact.left ? '接触' : '离地'} / 右：${contact.right ? '接触' : '离地'} · 非压力`;
      }
      case 'tof':
        return `演示障碍距离 ${this.tofDistance.toFixed(0)} cm · 非真实测距`;
      case 'camera':
        return '官方前置相机 + REC 造型使用指示灯 · 分辨率 / FOV 未定 · 无图像仿真';
      case 'audio':
        return this.audioError || '合成 quack 仅为教学试听 · 非官方声纹 / 非麦克风采样';
      case 'nfc':
        return '官方头部 + 喙部双天线 · 脉冲为示意，无 NFC 通信读数';
      case 'wireless':
        return '官方 Wi-Fi + 蓝牙 · 圆环为示意，无链路状态读数';
      default:
        return TOPIC_BY_ID.get(id).status;
    }
  }

  _applyAnchor(object, anchor, rotate = true) {
    if (!anchor || anchor.id < 0) return false;
    const { data } = this.app;
    if (anchor.type === 'site') {
      const p = anchor.id * 3;
      object.position.set(data.site_xpos[p], data.site_xpos[p + 1], data.site_xpos[p + 2]);
      if (rotate) {
        const m = anchor.id * 9;
        this._matrix.set(
          data.site_xmat[m], data.site_xmat[m + 1], data.site_xmat[m + 2], 0,
          data.site_xmat[m + 3], data.site_xmat[m + 4], data.site_xmat[m + 5], 0,
          data.site_xmat[m + 6], data.site_xmat[m + 7], data.site_xmat[m + 8], 0,
          0, 0, 0, 1
        );
        object.quaternion.setFromRotationMatrix(this._matrix);
      }
    } else {
      const p = anchor.id * 3;
      const q = anchor.id * 4;
      object.position.set(data.xpos[p], data.xpos[p + 1], data.xpos[p + 2]);
      if (rotate) object.quaternion.set(data.xquat[q + 1], data.xquat[q + 2], data.xquat[q + 3], data.xquat[q]);
    }
    return true;
  }

  _applySite(object, name, rotate = true) {
    return this._applyAnchor(object, { type: 'site', id: this.siteIds[name] ?? -1 }, rotate);
  }

  _updateTof(now) {
    const visual = this.visuals.tof;
    if (!visual) return;
    this._applySite(visual, 'tof');
    const data = visual.userData.tof;
    const distance = this.tofDistance / 100;
    const hue = 0.58 * (distance - 0.1) / 0.9;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const index = row * 8 + col;
        const offset = index * 3;
        const wave = 1 + 0.008 * Math.sin(now * 2 + row * 0.53 + col * 0.41);
        data.positions[offset] = distance * wave;
        data.positions[offset + 1] = (col - 3.5) / 3.5 * distance * 0.16;
        data.positions[offset + 2] = (3.5 - row) / 3.5 * distance * 0.12;
        this._color.setHSL(hue, 0.86, 0.5 + row * 0.012);
        data.colors[offset] = this._color.r;
        data.colors[offset + 1] = this._color.g;
        data.colors[offset + 2] = this._color.b;
      }
    }
    for (let i = 0; i < data.gridIndices.length; i++) {
      const source = data.gridIndices[i] * 3;
      const target = i * 3;
      data.gridPositions[target] = data.positions[source];
      data.gridPositions[target + 1] = data.positions[source + 1];
      data.gridPositions[target + 2] = data.positions[source + 2];
    }
    for (let i = 0; i < data.perimeter.length; i++) {
      const source = data.perimeter[i] * 3;
      const target = i * 6;
      data.beamPositions[target] = 0;
      data.beamPositions[target + 1] = 0;
      data.beamPositions[target + 2] = 0;
      data.beamPositions[target + 3] = data.positions[source];
      data.beamPositions[target + 4] = data.positions[source + 1];
      data.beamPositions[target + 5] = data.positions[source + 2];
    }
    data.points.geometry.attributes.position.needsUpdate = true;
    data.points.geometry.attributes.color.needsUpdate = true;
    visual.children[1].geometry.attributes.position.needsUpdate = true;
    visual.children[2].geometry.attributes.position.needsUpdate = true;
    this._tofDirty = false;
  }

  _updateJoints() {
    const visual = this.visuals.joints;
    const positions = visual.userData.positions;
    const { data } = this.app;
    for (let i = 0; i < this.joints.length; i++) {
      const body = this.joints[i].bodyId * 3;
      positions[i * 3] = data.xpos[body];
      positions[i * 3 + 1] = data.xpos[body + 1];
      positions[i * 3 + 2] = data.xpos[body + 2];
    }
    visual.children[0].geometry.setDrawRange(0, this.joints.length);
    visual.children[0].geometry.attributes.position.needsUpdate = true;
  }

  _demoPhase(id, now) {
    return THREE.MathUtils.clamp((now - this.demoStart[id]) / this.demoDuration[id], 0, 1);
  }

  _updateSelected(now) {
    const id = this.selected;
    if (!id || !this.visuals[id]) return;
    const visual = this.visuals[id];
    if (id === 'camera') {
      this._applySite(visual, 'head_camera');
      visual.userData.rec.material.opacity = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(now * 6));
    } else if (id === 'tof') {
      this._updateTof(now);
    } else if (id === 'bodyImu') {
      this._applySite(visual, 'imu');
    } else if (id === 'headImu') {
      this._applySite(visual, 'head_imu');
    } else if (id === 'joints') {
      this._updateJoints();
    } else if (id === 'audio') {
      this._applySite(visual, 'mouth_tip');
      const phase = this._demoPhase('audio', now);
      visual.userData.rings.forEach((ring, i) => {
        const local = THREE.MathUtils.clamp(phase * 1.45 - i * 0.18, 0, 1);
        const active = phase < 1;
        ring.position.x = active ? local * 0.055 : 0.006 + i * 0.004;
        const scale = active ? 0.6 + local * 2.2 : 0.55 + i * 0.25;
        ring.scale.setScalar(scale);
        ring.material.opacity = active ? (1 - local) * 0.75 : 0.24;
      });
    } else if (id === 'nfc') {
      const phase = this._demoPhase('nfc', now);
      for (const side of visual.userData.sides) {
        this._applySite(side, side.userData.siteName);
        side.userData.rings.forEach((ring, i) => {
          const local = THREE.MathUtils.clamp(phase * 1.35 - i * 0.25, 0, 1);
          const active = phase < 1;
          ring.scale.setScalar(active ? 0.5 + local * 3.2 : 0.7 + i * 0.45);
          ring.material.opacity = active ? (1 - local) * 0.8 : 0.3;
        });
      }
    } else if (id === 'feet') {
      const contacts = this._readContacts();
      visual.userData.feet.forEach((ring, i) => {
        this._applySite(ring, ring.userData.siteName, false);
        const active = i === 0 ? contacts.left : contacts.right;
        ring.material.color.setHex(active ? 0x24b47e : 0x8a96a3);
        ring.material.opacity = active ? 0.95 : 0.45;
        ring.scale.setScalar(active ? 1.15 : 1);
      });
    } else if (id === 'wireless') {
      this._applyAnchor(visual, { type: 'body', id: this.bodyIds.trunk_base ?? -1 });
      const phase = this._demoPhase('wireless', now);
      visual.userData.rings.forEach((ring, i) => {
        const local = THREE.MathUtils.clamp(phase * 1.4 - i * 0.2, 0, 1);
        const active = phase < 1;
        ring.scale.setScalar(active ? 0.45 + local * 2.4 : 0.65 + i * 0.4);
        ring.material.opacity = active ? (1 - local) * 0.7 : 0.24;
      });
    }
  }

  _updateLabels() {
    this.camera.updateMatrixWorld();
    const width = this.stage.clientWidth;
    const height = this.stage.clientHeight;
    if (!width || !height) return;
    this.camera.getWorldDirection(this._cameraDirection);
    for (const [id, marker] of this.markers) {
      const label = this.labels.get(id);
      if (!label) continue;
      this._world.copy(marker.group.position);
      this._toMarker.copy(this._world).sub(this.camera.position);
      this._project.copy(this._world).project(this.camera);
      const offset = LABEL_OFFSETS[id] || [0, -22];
      const x = (this._project.x * 0.5 + 0.5) * width + offset[0];
      const y = (-this._project.y * 0.5 + 0.5) * height + offset[1];
      const visible = this._toMarker.dot(this._cameraDirection) > 0 &&
        this._project.z >= -1 && this._project.z <= 1 &&
        x >= 8 && x <= width - 8 && y >= 8 && y <= height - 8;
      label.hidden = !visible;
      if (visible) label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    }
  }

  update(now) {
    if (!this.enabled || !this.app?.data || !this.group) return;
    this._now = now / 1000;
    const seconds = this._now;
    for (const [id, marker] of this.markers) {
      this._applyAnchor(marker.group, marker.anchor, false);
      marker.group.quaternion.copy(this.camera.quaternion);
      const selected = id === this.selected;
      marker.sphere.scale.setScalar(selected ? 1.4 : 1);
      const pulse = selected ? 1.2 + Math.sin(seconds * 4) * 0.08 : 1;
      marker.halo.scale.setScalar(pulse);
      marker.halo.material.opacity = selected ? 0.9 : 0.5;
    }
    this._updateSelected(seconds);
    this._updateLabels();
  }

  disposeModel() {
    if (this.group) {
      this.scene.remove(this.group);
      const geometries = new Set();
      const materials = new Set();
      this.group.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        if (Array.isArray(object.material)) object.material.forEach((material) => materials.add(material));
        else if (object.material) materials.add(object.material);
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      this.group.clear();
    }
    this.labelRoot?.remove();
    this.labels.clear();
    this.group = null;
    this.labelRoot = null;
    this.markers.clear();
    this.pickTargets = [];
    this.visuals = {};
    this.siteIds = {};
    this.bodyIds = {};
    this.sensorIds = {};
    this.joints = [];
    this.footGeomIds = [-1, -1];
    this.floorGeomId = -1;
    this.contactMode = 'none';
    this.app = null;
  }

  dispose() {
    this.setEnabled(false);
    this.disposeModel();
    this.canvas.removeEventListener('pointerdown', this._onPointerDown, true);
    if (this._audioContext) {
      try { this._audioContext.close().catch(() => {}); } catch (error) {}
      this._audioContext = null;
    }
    this.onSelect = null;
  }
}
