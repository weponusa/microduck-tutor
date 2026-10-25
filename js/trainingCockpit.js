import { ACT_NAMES, OBS_NAMES, WALK_OBS_NAMES, forwardPolicyTrace } from './rlPolicy.js';

const POSITIVE = '#ff6b9f';
const NEGATIVE = '#62d9e8';
const MUTED = '#7f919d';
const AMBER = '#f4c95d';
const GREEN = '#65d6a6';
const COLORS = [POSITIVE, NEGATIVE, AMBER, GREEN, '#a98bff'];

function finite(value, digits = 3) { return Number.isFinite(value) ? value.toFixed(digits) : '—'; }
function clamp01(value) { return Math.max(0, Math.min(1, value)); }
function rms(values) { return values.length ? Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length) : 0; }
function norm(values) { return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)); }
function random01(seed) { const value = Math.sin(seed * 12.9898) * 43758.5453; return value - Math.floor(value); }

export class TrainingCockpit {
  constructor({ onStart, onPause, onTest, onTask, onClose, onTogglePlay, onPoke }) {
    this.root = document.getElementById('training-cockpit');
    this.networkCanvas = document.getElementById('cockpit-network-canvas');
    this.gaitCanvas = document.getElementById('cockpit-gait-canvas');
    this.chartCanvas = document.getElementById('cockpit-loss-chart');
    this.enabled = false;
    this.lastUpdate = 0;
    this.net = null;
    this.nodes = [];
    this.edges = [];
    this.pulseEdges = [];
    this.selected = null;
    this.source = null;
    this.obsCards = [];
    this.obsSignature = '';
    this.actionRows = [];
    this.maxWeight = 0;
    this.viewMode = 'topology';
    this.forwardStart = null;
    this.showAllActions = false;
    this.history = [];
    this.historyDim = 0;
    this.time = 0;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

    document.getElementById('cockpit-start').addEventListener('click', onStart);
    document.getElementById('cockpit-pause').addEventListener('click', onPause);
    document.getElementById('cockpit-test').addEventListener('click', onTest);
    document.getElementById('cockpit-close').addEventListener('click', onClose);
    document.getElementById('cockpit-play').addEventListener('click', onTogglePlay);
    document.getElementById('cockpit-poke').addEventListener('click', onPoke);
    document.getElementById('cockpit-task').addEventListener('change', (event) => onTask(event.target.value));
    document.getElementById('cockpit-view-topology').addEventListener('click', () => this.setViewMode('topology'));
    document.getElementById('cockpit-view-layers').addEventListener('click', () => this.setViewMode('layers'));
    document.getElementById('cockpit-forward').addEventListener('click', () => { this.forwardStart = this.time; });
    document.getElementById('cockpit-actions-toggle').addEventListener('click', () => {
      this.showAllActions = !this.showAllActions;
      document.getElementById('cockpit-actions-toggle').textContent = this.showAllActions ? '只看主要动作' : '全部 14 路';
      if (this.source) this.renderActions(this.source);
    });
    document.querySelectorAll('[data-pipeline]').forEach((button) => button.addEventListener('click', () => this.selectPipeline(button.dataset.pipeline)));
    this.networkCanvas.addEventListener('click', (event) => this.pickNode(event));
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.root.hidden = !this.enabled;
    if (this.enabled) {
      this.net = null;
      this.lastUpdate = 0;
      this.forwardStart = null;
    }
  }

  setViewMode(mode) {
    this.viewMode = mode;
    document.getElementById('cockpit-view-topology').classList.toggle('active', mode === 'topology');
    document.getElementById('cockpit-view-layers').classList.toggle('active', mode === 'layers');
    this.layoutGraph();
    if (this.source) this.renderNetwork(this.source);
  }

  selectPipeline(stage) {
    document.querySelectorAll('[data-pipeline]').forEach((button) => button.classList.toggle('active', button.dataset.pipeline === stage));
    if (!this.source) return;
    if (stage === 'learn') {
      this.selected = null;
      document.getElementById('cockpit-neuron-detail').textContent = 'LEARN：物理环境产生奖励，critic 估计状态价值，GAE 计算优势，PPO 用 clipped ratio 更新 actor 与 critic。底部曲线全部来自真实训练历史。';
    } else {
      const layer = stage === 'sense' ? 0 : stage === 'estimate' ? 1 : 3;
      this.selected = this.nodes.find((node) => node.layer === layer && node.index === 0);
      if (this.selected) this.showNeuronDetail(this.selected);
    }
    this.renderNetwork(this.source);
  }

  sourceFromApp(app) {
    if (app.policy && app.policyNet && (app.controlMode === 'policy' || !app.trainingTelemetry)) {
      const policy = app.policy;
      const trace = forwardPolicyTrace(app.policyNet, policy.lastObservation);
      return {
        kind: 'test', net: app.policyNet, observation: policy.lastObservation,
        activations: trace.activations, mean: trace.mean, action: policy.lastAction,
        criticValue: null, reward: policy.reward, totalReturn: policy.totalReturn,
        upright: policy.upright, height: policy.height, contacts: policy.getFootContacts(),
        forwardSpeed: policy.forwardSpeed, lateralSpeed: policy.lateralSpeed,
        distance: policy.distance, episodeSteps: policy.steps, done: Boolean(policy.doneReason),
        doneReason: policy.doneReason, paused: app.paused,
      };
    }
    const telemetry = app.trainingTelemetry;
    const net = app.trainingActor;
    if (!telemetry || !net) return null;
    return {
      kind: 'training', net, observation: telemetry.observation,
      activations: telemetry.activations, mean: telemetry.mean, action: telemetry.mean,
      criticValue: telemetry.criticValue, reward: telemetry.lastReward,
      totalReturn: telemetry.episodeReturn, upright: telemetry.upright,
      height: telemetry.height, contacts: telemetry.contacts || [0, 0],
      forwardSpeed: telemetry.forwardSpeed, lateralSpeed: telemetry.lateralSpeed,
      distance: telemetry.distance, episodeSteps: telemetry.episodeSteps,
      done: telemetry.done, doneReason: telemetry.done ? '本回合已结束，新回合即将开始' : '',
      paused: !app.trainer?.running,
    };
  }

  update(app, now = performance.now(), force = false) {
    if (!this.enabled || (!force && now - this.lastUpdate < 100)) return;
    this.lastUpdate = now;
    this.time = now;
    const source = this.sourceFromApp(app);
    this.source = source;
    this.updateButtons(app);
    if (!source) {
      document.getElementById('cockpit-source').textContent = '等待策略或训练数据';
      document.getElementById('cockpit-neuron-detail').textContent = '先运行真实策略，或开始一次训练。';
      return;
    }
    if (this.historyDim !== source.observation.length) {
      this.history = [];
      this.historyDim = source.observation.length;
    }
    this.history.push({ obs: Array.from(source.observation), action: Array.from(source.action), reward: source.reward, upright: source.upright });
    if (this.history.length > 90) this.history.shift();
    if (this.net !== source.net) {
      this.net = source.net;
      this.selected = null;
      this.buildGraph();
    }
    this.layoutGraph();
    this.renderObservations(source);
    this.renderActions(source);
    this.renderGait(source);
    this.renderNetwork(source);
    this.renderMetrics(app, source);
    this.renderCharts(app);
    if (this.selected) this.showNeuronDetail(this.selected);
  }

  updateButtons(app) {
    const running = Boolean(app.trainer?.running);
    document.getElementById('cockpit-start').disabled = running;
    document.getElementById('cockpit-pause').disabled = !running;
    document.getElementById('cockpit-test').disabled = !app.trainingReady;
    document.getElementById('cockpit-task').value = app.trainer?.task || document.getElementById('training-task').value;
    document.getElementById('cockpit-play').textContent = app.paused ? '继续物理' : '暂停物理';
    document.getElementById('cockpit-play').disabled = !app.data;
    document.getElementById('cockpit-poke').disabled = !app.data;
  }

  nodeName(layer, index) {
    if (layer === 0) {
      const names = this.net.obs_dim === 43 ? WALK_OBS_NAMES : OBS_NAMES;
      return names[index] || `输入 ${index}`;
    }
    if (layer === 3) return ACT_NAMES[index] || `动作 ${index}`;
    return `隐藏层 ${layer} · 神经元 ${index + 1}`;
  }

  buildGraph() {
    this.nodes = [];
    this.edges = [];
    this.maxWeight = 0;
    const sizes = [this.net.obs_dim, 64, 64, this.net.act_dim];
    const centers = [-1.12, -0.38, 0.38, 1.12];
    sizes.forEach((size, layer) => {
      for (let index = 0; index < size; index++) {
        const seed = layer * 1000 + index + 1;
        this.nodes.push({
          layer, index, x: 0, y: 0, z: 0, value: 0, name: this.nodeName(layer, index),
          x3: centers[layer] + (random01(seed * 1.7) - 0.5) * 0.62,
          y3: (random01(seed * 2.3) - 0.5) * 1.55,
          z3: (random01(seed * 3.1) - 0.5) * 1.45,
        });
      }
    });
    const at = (layer, index) => this.nodes[sizes.slice(0, layer).reduce((a, b) => a + b, 0) + index];
    for (let layer = 1; layer <= 3; layer++) {
      const weights = layer < 3 ? this.net.layers[layer - 1] : this.net.action_head;
      for (let target = 0; target < sizes[layer]; target++) {
        const incoming = weights.w[target].map((weight, source) => ({ source, weight }));
        incoming.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
        for (const edge of incoming.slice(0, 6)) {
          this.edges.push({ from: at(layer - 1, edge.source), to: at(layer, target), weight: edge.weight });
          this.maxWeight = Math.max(this.maxWeight, Math.abs(edge.weight));
        }
      }
    }
    this.pulseEdges = this.edges.slice().sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 28);
  }

  layoutGraph() {
    if (!this.net) return;
    const width = this.networkCanvas.clientWidth || 600;
    const height = this.networkCanvas.clientHeight || 300;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (this.networkCanvas.width !== Math.round(width * dpr) || this.networkCanvas.height !== Math.round(height * dpr)) {
      this.networkCanvas.width = Math.round(width * dpr);
      this.networkCanvas.height = Math.round(height * dpr);
    }
    if (this.viewMode === 'layers') {
      const xAt = [0.09, 0.37, 0.65, 0.92];
      const sizes = [this.net.obs_dim, 64, 64, this.net.act_dim];
      sizes.forEach((size, layer) => {
        const top = layer === 3 ? 48 : 34;
        const bottom = layer === 3 ? 44 : 34;
        this.nodes.filter((node) => node.layer === layer).forEach((node, index) => {
          node.x = width * xAt[layer];
          node.y = top + (size === 1 ? 0 : index / (size - 1)) * (height - top - bottom);
          node.z = 0;
        });
      });
      return;
    }
    const angle = this.reducedMotion ? 0.32 : this.time * 0.00007;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const tilt = 0.22, cosT = Math.cos(tilt), sinT = Math.sin(tilt);
    const scaleX = width * 0.33, scaleY = height * 0.56;
    for (const node of this.nodes) {
      const rx = node.x3 * cos + node.z3 * sin;
      const rz = -node.x3 * sin + node.z3 * cos;
      const ry = node.y3 * cosT - rz * sinT;
      const perspective = 1 + rz * 0.16;
      node.x = width * 0.5 + rx * scaleX / perspective;
      node.y = height * 0.52 + ry * scaleY / perspective;
      node.z = rz;
    }
  }

  renderNetwork(source) {
    const ctx = this.networkCanvas.getContext('2d');
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const width = this.networkCanvas.clientWidth;
    const height = this.networkCanvas.clientHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    source.activations.forEach((values, layer) => {
      this.nodes.filter((node) => node.layer === layer).forEach((node) => { node.value = values[node.index]; });
    });
    let forwardLayer = -1;
    if (this.forwardStart !== null) {
      const elapsed = this.time - this.forwardStart;
      forwardLayer = Math.min(3, Math.floor(elapsed / 480));
      if (elapsed > 2100) { this.forwardStart = null; forwardLayer = -1; }
    }
    for (const edge of this.edges) {
      const strength = clamp01(Math.abs(edge.weight) / Math.max(this.maxWeight, 1e-9));
      const activity = clamp01(Math.abs(edge.from.value));
      const inForward = forwardLayer < 0 || edge.to.layer === forwardLayer;
      ctx.strokeStyle = edge.weight >= 0 ? POSITIVE : NEGATIVE;
      ctx.globalAlpha = (0.055 + strength * (0.13 + activity * 0.42)) * (inForward ? 1 : 0.14);
      ctx.lineWidth = 0.35 + strength * 2.2;
      ctx.beginPath(); ctx.moveTo(edge.from.x, edge.from.y); ctx.lineTo(edge.to.x, edge.to.y); ctx.stroke();
    }
    if (!this.reducedMotion && (!source.paused || this.forwardStart !== null)) {
      const pulses = this.forwardStart !== null ? this.edges.filter((edge) => edge.to.layer === forwardLayer).slice(0, 42) : this.pulseEdges;
      pulses.forEach((edge, index) => {
        const t = this.forwardStart !== null ? ((this.time - this.forwardStart) % 480) / 480 : (this.time * 0.00055 + index * 0.117) % 1;
        const x = edge.from.x + (edge.to.x - edge.from.x) * t;
        const y = edge.from.y + (edge.to.y - edge.from.y) * t;
        ctx.globalAlpha = this.forwardStart !== null ? 0.95 : 0.32 + clamp01(Math.abs(edge.from.value)) * 0.6;
        ctx.fillStyle = edge.weight >= 0 ? POSITIVE : NEGATIVE;
        ctx.beginPath(); ctx.arc(x, y, this.forwardStart !== null ? 3 : 2, 0, Math.PI * 2); ctx.fill();
      });
    }
    for (const node of this.nodes) {
      const activity = Math.tanh(Math.abs(node.value) * 1.8);
      const selected = this.selected === node;
      const depth = this.viewMode === 'topology' ? clamp01(0.65 + node.z * 0.25) : 1;
      const inForward = forwardLayer < 0 || node.layer <= forwardLayer;
      ctx.globalAlpha = (0.35 + activity * 0.65) * depth * (inForward ? 1 : 0.2);
      ctx.fillStyle = node.value >= 0 ? POSITIVE : NEGATIVE;
      const radius = (node.layer === 3 ? 5.5 : node.layer === 0 ? 3.8 : 3.25) * (0.75 + activity * 0.45) * depth;
      ctx.beginPath(); ctx.arc(node.x, node.y, radius, 0, Math.PI * 2); ctx.fill();
      if (activity > 0.55) {
        ctx.globalAlpha *= 0.22;
        ctx.beginPath(); ctx.arc(node.x, node.y, radius + 5, 0, Math.PI * 2); ctx.fill();
      }
      if (selected) {
        ctx.globalAlpha = 1; ctx.strokeStyle = AMBER; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(node.x, node.y, 10, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.font = '600 10px "SF Mono", Menlo, monospace';
    const labels = [`OBS ${this.net.obs_dim}`, 'H1 · 64', 'H2 · 64', 'ACTION · 14'];
    labels.forEach((label, layer) => {
      const nodes = this.nodes.filter((node) => node.layer === layer);
      const x = this.viewMode === 'topology'
        ? width * [0.12, 0.38, 0.64, 0.88][layer]
        : nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length;
      ctx.fillStyle = layer === 3 ? AMBER : MUTED;
      ctx.fillText(label, x - 28, this.viewMode === 'layers' ? 18 : height - 10);
    });
  }

  observationGroups(source) {
    const obs = source.observation;
    const walking = obs.length === 43;
    const groups = [
      { key: 'quat', title: '姿态四元数', tag: 'OBS 00–03', indices: [0, 1, 2, 3], color: NEGATIVE, value: () => finite(obs[0], 3), sub: () => `x ${finite(obs[1], 2)} · y ${finite(obs[2], 2)} · z ${finite(obs[3], 2)}`, read: (o) => o[0] },
      { key: 'gyro', title: '机身角速度', tag: 'OBS 04–06', indices: [4, 5, 6], color: POSITIVE, value: () => finite(norm(Array.from(obs.slice(4, 7))), 3), sub: () => `x ${finite(obs[4], 2)} · y ${finite(obs[5], 2)} · z ${finite(obs[6], 2)}`, read: (o) => norm(o.slice(4, 7)) },
      { key: 'joints', title: '关节位置', tag: 'OBS 07–20', indices: [7], color: AMBER, value: () => finite(rms(Array.from(obs.slice(7, 21))), 3), sub: () => '14 路 · RMS 偏离程度', read: (o) => rms(o.slice(7, 21)) },
      { key: 'jointVel', title: '关节速度', tag: 'OBS 21–34', indices: [21], color: '#a98bff', value: () => finite(rms(Array.from(obs.slice(21, 35))), 3), sub: () => '14 路 · RMS 运动强度', read: (o) => rms(o.slice(21, 35)) },
      { key: 'height', title: '根节点高度', tag: 'OBS 35', indices: [35], color: GREEN, value: () => `${(obs[35] * 100).toFixed(1)} cm`, sub: () => `直立度 ${finite(source.upright, 3)}`, read: (o) => o[35] * 100 },
    ];
    if (walking) groups.push(
      { key: 'velocity', title: '世界系速度', tag: 'OBS 36–37', indices: [36], color: GREEN, value: () => `${(obs[36] * 100).toFixed(2)} cm/s`, sub: () => `横移 ${(obs[37] * 100).toFixed(2)} cm/s`, read: (o) => o[36] * 100 },
      { key: 'phase', title: '步态相位', tag: 'OBS 38–40', indices: [38], color: AMBER, value: () => finite((Math.atan2(obs[38], obs[39]) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2), 2), sub: () => `sin ${finite(obs[38], 2)} · cos ${finite(obs[39], 2)} · 目标 ${(obs[40] * 100).toFixed(0)}`, read: (o) => o[38] },
      { key: 'contact', title: '左右脚接触', tag: 'OBS 41–42', indices: [41], color: NEGATIVE, value: () => `${obs[41] + obs[42]} / 2`, sub: () => `左 ${obs[41] ? '接触' : '离地'} · 右 ${obs[42] ? '接触' : '离地'}`, read: (o) => o[41] + o[42] }
    );
    return groups;
  }

  renderObservations(source) {
    const groups = this.observationGroups(source);
    const signature = groups.map((group) => group.key).join('|');
    const box = document.getElementById('cockpit-observations');
    if (signature !== this.obsSignature) {
      this.obsSignature = signature;
      this.obsCards = [];
      box.replaceChildren();
      groups.forEach((group) => {
        const card = document.createElement('button');
        card.className = 'cockpit-signal-card';
        card.dataset.signal = group.key;
        const top = document.createElement('span'); top.textContent = group.title;
        const tag = document.createElement('i'); tag.textContent = group.tag;
        const value = document.createElement('b');
        const sub = document.createElement('small');
        const canvas = document.createElement('canvas');
        card.append(top, tag, value, sub, canvas);
        card.addEventListener('click', () => {
          this.selected = this.nodes.find((node) => node.layer === 0 && node.index === group.indices[0]);
          if (this.selected) this.showNeuronDetail(this.selected);
          this.renderNetwork(this.source);
        });
        box.appendChild(card);
        this.obsCards.push({ group, value, sub, canvas });
      });
    }
    this.obsCards.forEach(({ value, sub, canvas }, index) => {
      const group = groups[index];
      value.textContent = group.value();
      value.style.color = group.color;
      sub.textContent = group.sub();
      this.drawSparkline(canvas, this.history.map((frame) => group.read(frame.obs)), group.color);
    });
    document.getElementById('cockpit-obs-dim').textContent = `${source.observation.length} 维输入`;
  }

  drawSparkline(canvas, values, color) {
    const width = canvas.clientWidth || 100, height = canvas.clientHeight || 30;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    const valid = values.filter(Number.isFinite);
    if (!valid.length) return;
    let lo = Math.min(...valid), hi = Math.max(...valid);
    if (hi - lo < 1e-8) { lo -= 0.5; hi += 0.5; }
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
    values.forEach((value, index) => {
      if (!Number.isFinite(value)) return;
      const x = values.length === 1 ? 0 : index / (values.length - 1) * width;
      const y = height - 3 - (value - lo) / (hi - lo) * (height - 6);
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    const last = values[values.length - 1];
    if (Number.isFinite(last)) {
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(width - 2, height - 3 - (last - lo) / (hi - lo) * (height - 6), 2.2, 0, Math.PI * 2); ctx.fill();
    }
  }

  renderActions(source) {
    const box = document.getElementById('cockpit-actions');
    if (!this.actionRows.length) {
      ACT_NAMES.forEach((name, index) => {
        const row = document.createElement('div'); row.className = 'cockpit-action-row';
        const label = document.createElement('span'); label.textContent = name;
        const track = document.createElement('i'); track.className = 'cockpit-action-track';
        const fill = document.createElement('i'); fill.className = 'cockpit-action-fill';
        const value = document.createElement('b');
        track.appendChild(fill); row.append(label, track, value); box.appendChild(row);
        this.actionRows.push({ row, fill, value, index });
      });
    }
    const order = this.actionRows.map((row) => row.index).sort((a, b) => Math.abs(source.action[b]) - Math.abs(source.action[a]));
    const visible = new Set(this.showAllActions ? order : order.slice(0, 6));
    this.actionRows.forEach((row) => {
      const value = source.action[row.index] || 0;
      row.row.hidden = !visible.has(row.index);
      row.fill.style.width = `${Math.min(100, Math.abs(value) * 100)}%`;
      row.fill.style.background = value >= 0 ? POSITIVE : NEGATIVE;
      row.value.textContent = finite(value, 3);
    });
    document.getElementById('cockpit-action-mode').textContent = source.kind === 'training'
      ? `actor 均值 · 显示 ${visible.size} / 14 路 · 训练另加探索噪声`
      : `沙盒实际执行 · 显示 ${visible.size} / 14 路`;
  }

  renderGait(source) {
    const walking = source.net.obs_dim === 43;
    const ctx = this.gaitCanvas.getContext('2d');
    const width = this.gaitCanvas.clientWidth || 220, height = this.gaitCanvas.clientHeight || 100;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.gaitCanvas.width = Math.round(width * dpr); this.gaitCanvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    document.getElementById('cockpit-left-foot').className = `cockpit-foot ${source.contacts[0] ? 'contact' : ''}`;
    document.getElementById('cockpit-right-foot').className = `cockpit-foot ${source.contacts[1] ? 'contact' : ''}`;
    document.getElementById('cockpit-speed').textContent = `${(source.forwardSpeed * 100).toFixed(2)} cm/s`;
    if (!walking) {
      ctx.fillStyle = MUTED; ctx.font = '11px sans-serif'; ctx.fillText('站立任务 · 无步态相位', 12, 22);
      ctx.fillStyle = '#24343e'; ctx.fillRect(12, 46, width - 24, 12);
      ctx.fillStyle = source.upright > 0.707 ? GREEN : AMBER; ctx.fillRect(12, 46, (width - 24) * clamp01(source.upright), 12);
      ctx.fillStyle = MUTED; ctx.fillText(`upright ${finite(source.upright)} · ${(source.height * 100).toFixed(1)} cm`, 12, 82);
      return;
    }
    const sin = source.observation[38], cos = source.observation[39];
    const phase = (Math.atan2(sin, cos) + Math.PI * 2) % (Math.PI * 2);
    const cx = 51, cy = 50, radius = 35;
    ctx.strokeStyle = '#2c3d47'; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = AMBER; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(phase) * radius, cy + Math.sin(phase) * radius); ctx.stroke();
    ctx.fillStyle = AMBER; ctx.beginPath(); ctx.arc(cx + Math.cos(phase) * radius, cy + Math.sin(phase) * radius, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = MUTED; ctx.font = '10px "SF Mono", Menlo, monospace';
    ctx.fillText(`${(phase / (Math.PI * 2)).toFixed(2)}`, 39, 54);
    ctx.fillText(`sin ${finite(sin, 2)} / cos ${finite(cos, 2)}`, 108, 40);
    ctx.fillText(`目标 ${(source.observation[40] * 100).toFixed(0)} cm/s`, 108, 64);
  }

  renderMetrics(app, source) {
    const training = source.kind === 'training';
    document.getElementById('cockpit-source').textContent = training ? (app.trainer?.running ? '● LIVE TRAINING · 当前 actor' : 'Ⅱ PAUSED · 当前 actor') : '◆ POLICY TEST · 沙盒执行';
    document.getElementById('cockpit-task-note').textContent = source.net.obs_dim === 43 ? '行走训练实验 · 尚未完成稳定步态验收' : '站立任务 · 36 维观测与 14 路动作';
    document.getElementById('robot-hud-task').textContent = source.net.obs_dim === 43 ? 'WALK EXPERIMENT' : 'STAND';
    document.getElementById('robot-hud-reward').textContent = finite(source.reward, 3);
    document.getElementById('robot-hud-speed').textContent = `${(source.forwardSpeed * 100).toFixed(1)} cm/s`;
    document.getElementById('cockpit-reward').textContent = finite(source.reward, 4);
    document.getElementById('cockpit-return').textContent = finite(source.totalReturn, 2);
    document.getElementById('cockpit-critic').textContent = finite(source.criticValue, 4);
    document.getElementById('cockpit-distance').textContent = `${(source.distance * 100).toFixed(1)} cm`;
    document.getElementById('cockpit-episode').textContent = `${source.episodeSteps} 步${source.done ? ' · 结束' : ''}`;
    const metrics = app.trainingMetrics || {};
    document.getElementById('cockpit-policy-loss').textContent = finite(metrics.policyLoss, 4);
    document.getElementById('cockpit-value-loss').textContent = finite(metrics.valueLoss, 4);
    document.getElementById('cockpit-entropy').textContent = finite(metrics.entropy, 4);
    document.getElementById('cockpit-iteration').textContent = String(metrics.iteration ?? 0);
  }

  drawSeries(canvas, series, { grid = true } = {}) {
    const width = canvas.clientWidth || 300, height = canvas.clientHeight || 90;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    if (grid) {
      ctx.strokeStyle = '#1e2c35'; ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, height * i / 4); ctx.lineTo(width, height * i / 4); ctx.stroke(); }
    }
    series.forEach((line) => {
      const values = line.values.filter(Number.isFinite);
      if (!values.length) return;
      let lo = Math.min(...values), hi = Math.max(...values);
      if (hi - lo < 1e-8) { lo -= 0.5; hi += 0.5; }
      ctx.strokeStyle = line.color; ctx.lineWidth = 1.7; ctx.beginPath();
      let started = false;
      line.values.forEach((value, index) => {
        if (!Number.isFinite(value)) return;
        const x = line.values.length === 1 ? 0 : index / (line.values.length - 1) * width;
        const y = height - 4 - (value - lo) / (hi - lo) * (height - 10);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
  }

  renderCharts(app) {
    const history = app.trainingHistory || [];
    this.drawSeries(this.chartCanvas, [
      { values: history.map((m) => m.meanReturn), color: GREEN },
      { values: history.map((m) => m.policyLoss), color: POSITIVE },
      { values: history.map((m) => m.valueLoss), color: NEGATIVE },
    ]);
    const actionIndices = ACT_NAMES.map((_, index) => index).sort((a, b) => Math.abs(this.source.action[b]) - Math.abs(this.source.action[a])).slice(0, 4);
    this.drawSeries(document.getElementById('cockpit-action-chart'), actionIndices.map((index) => ({ values: this.history.map((frame) => frame.action[index]), color: COLORS[index % COLORS.length] })));
    this.drawSeries(document.getElementById('cockpit-imu-chart'), [4, 5, 6].map((index) => ({ values: this.history.map((frame) => frame.obs[index]), color: COLORS[index - 4] })));
    this.drawSeries(document.getElementById('cockpit-phase-chart'), this.source.net.obs_dim === 43
      ? [38, 39].map((index) => ({ values: this.history.map((frame) => frame.obs[index]), color: index === 38 ? AMBER : NEGATIVE }))
      : [{ values: this.history.map((frame) => frame.upright), color: GREEN }, { values: this.history.map((frame) => frame.reward), color: AMBER }]);
  }

  pickNode(event) {
    if (!this.source || !this.nodes.length) return;
    const rect = this.networkCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    let nearest = null, distance = Infinity;
    for (const node of this.nodes) {
      const d = Math.hypot(node.x - x, node.y - y);
      if (d < distance) { nearest = node; distance = d; }
    }
    if (!nearest || distance > 18) return;
    this.selected = nearest;
    this.showNeuronDetail(nearest);
    this.renderNetwork(this.source);
  }

  showNeuronDetail(node) {
    const box = document.getElementById('cockpit-neuron-detail');
    if (node.layer === 0) {
      box.textContent = `${node.name} = ${finite(node.value, 6)}。这是观测向量第 ${node.index} 个数，直接进入第一层，不经过 tanh。`;
      return;
    }
    const layer = node.layer < 3 ? this.net.layers[node.layer - 1] : this.net.action_head;
    const inputs = this.source.activations[node.layer - 1];
    const weights = layer.w[node.index];
    const bias = layer.b[node.index];
    let pre = bias;
    const contributions = weights.map((weight, index) => {
      const contribution = weight * inputs[index]; pre += contribution;
      return { index, weight, input: inputs[index], contribution };
    });
    contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    const rows = contributions.slice(0, 6).map((item) => `${this.nodeName(node.layer - 1, item.index)}：${finite(item.weight, 4)} × ${finite(item.input, 4)} = ${finite(item.contribution, 5)}`).join('\n');
    const activation = node.layer < 3 ? `tanh(${finite(pre, 5)}) = ${finite(node.value, 5)}` : `线性动作均值 = ${finite(node.value, 5)}`;
    box.textContent = `${node.name}\nbias ${finite(bias, 5)}；完整求和后再激活：${activation}\n贡献最大的 6 条真实入边：\n${rows}`;
  }
}
