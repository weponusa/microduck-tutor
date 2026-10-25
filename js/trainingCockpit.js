import { ACT_NAMES, OBS_NAMES, WALK_OBS_NAMES, forwardPolicyTrace } from './rlPolicy.js';

const POSITIVE = '#ff6b9f';
const NEGATIVE = '#62d9e8';
const MUTED = '#73838d';
const AMBER = '#f4c95d';

function finite(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}
function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

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
    this.selected = null;
    this.source = null;
    this.obsRows = [];
    this.actionRows = [];
    this.maxWeight = 0;

    document.getElementById('cockpit-start').addEventListener('click', onStart);
    document.getElementById('cockpit-pause').addEventListener('click', onPause);
    document.getElementById('cockpit-test').addEventListener('click', onTest);
    document.getElementById('cockpit-close').addEventListener('click', onClose);
    document.getElementById('cockpit-play').addEventListener('click', onTogglePlay);
    document.getElementById('cockpit-poke').addEventListener('click', onPoke);
    document.getElementById('cockpit-task').addEventListener('change', (event) => onTask(event.target.value));
    this.networkCanvas.addEventListener('click', (event) => this.pickNode(event));
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.root.hidden = !this.enabled;
    if (this.enabled) {
      this.net = null;
      this.lastUpdate = 0;
    }
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
    const source = this.sourceFromApp(app);
    this.source = source;
    this.updateButtons(app);
    if (!source) {
      document.getElementById('cockpit-source').textContent = '等待策略或训练数据';
      document.getElementById('cockpit-neuron-detail').textContent = '先运行真实策略，或开始一次训练。';
      return;
    }
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
    sizes.forEach((size, layer) => {
      for (let index = 0; index < size; index++) {
        this.nodes.push({ layer, index, x: 0, y: 0, value: 0, name: this.nodeName(layer, index) });
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
  }

  layoutGraph() {
    const width = this.networkCanvas.clientWidth || 600;
    const height = this.networkCanvas.clientHeight || 300;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (this.networkCanvas.width !== Math.round(width * dpr) || this.networkCanvas.height !== Math.round(height * dpr)) {
      this.networkCanvas.width = Math.round(width * dpr);
      this.networkCanvas.height = Math.round(height * dpr);
    }
    const xAt = [0.09, 0.37, 0.65, 0.92];
    const sizes = [this.net.obs_dim, 64, 64, this.net.act_dim];
    sizes.forEach((size, layer) => {
      const top = layer === 3 ? 40 : 24;
      const bottom = layer === 3 ? 36 : 30;
      this.nodes.filter((node) => node.layer === layer).forEach((node, index) => {
        node.x = width * xAt[layer];
        node.y = top + (size === 1 ? 0 : index / (size - 1)) * (height - top - bottom);
      });
    });
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
    for (const edge of this.edges) {
      const strength = clamp01(Math.abs(edge.weight) / Math.max(this.maxWeight, 1e-9));
      const activity = clamp01(Math.abs(edge.from.value));
      ctx.strokeStyle = edge.weight >= 0 ? POSITIVE : NEGATIVE;
      ctx.globalAlpha = 0.035 + strength * (0.1 + activity * 0.3);
      ctx.lineWidth = 0.25 + strength * 1.7;
      ctx.beginPath();
      ctx.moveTo(edge.from.x, edge.from.y);
      ctx.lineTo(edge.to.x, edge.to.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const node of this.nodes) {
      const activity = Math.tanh(Math.abs(node.value) * 1.8);
      const selected = this.selected === node;
      ctx.globalAlpha = 0.28 + activity * 0.72;
      ctx.fillStyle = node.value >= 0 ? POSITIVE : NEGATIVE;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.layer === 3 ? 4.2 : node.layer === 0 ? 2.8 : 2.25, 0, Math.PI * 2);
      ctx.fill();
      if (selected) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = AMBER;
        ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.arc(node.x, node.y, 8, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.font = '9px "SF Mono", Menlo, monospace';
    ctx.fillStyle = MUTED;
    const labels = [`OBS ${this.net.obs_dim}`, '64 TANH', '64 TANH', 'ACTION 14'];
    labels.forEach((label, layer) => ctx.fillText(label, this.nodes.find((node) => node.layer === layer).x - 25, 13));
  }

  renderObservations(source) {
    const box = document.getElementById('cockpit-observations');
    const names = source.net.obs_dim === 43 ? WALK_OBS_NAMES : OBS_NAMES;
    if (this.obsRows.length !== source.observation.length) {
      box.replaceChildren();
      this.obsRows = names.map((name, index) => {
        const row = document.createElement('div');
        row.className = 'cockpit-data-row';
        const label = document.createElement('span');
        label.textContent = `${String(index).padStart(2, '0')} ${name}`;
        const value = document.createElement('b');
        row.append(label, value);
        box.appendChild(row);
        return value;
      });
    }
    this.obsRows.forEach((row, index) => { row.textContent = finite(source.observation[index], 3); });
    document.getElementById('cockpit-obs-dim').textContent = `${source.observation.length} 维`;
  }

  renderActions(source) {
    const box = document.getElementById('cockpit-actions');
    if (!this.actionRows.length) {
      ACT_NAMES.forEach((name) => {
        const row = document.createElement('div');
        row.className = 'cockpit-action-row';
        const label = document.createElement('span'); label.textContent = name;
        const track = document.createElement('i'); track.className = 'cockpit-action-track';
        const fill = document.createElement('i'); fill.className = 'cockpit-action-fill';
        const value = document.createElement('b');
        track.appendChild(fill);
        row.append(label, track, value);
        box.appendChild(row);
        this.actionRows.push({ fill, value });
      });
    }
    this.actionRows.forEach((row, index) => {
      const value = source.action[index] || 0;
      row.fill.style.width = `${Math.min(100, Math.abs(value) * 100)}%`;
      row.fill.style.background = value >= 0 ? POSITIVE : NEGATIVE;
      row.value.textContent = finite(value, 3);
    });
    document.getElementById('cockpit-action-mode').textContent = source.kind === 'training' ? 'actor 均值 · 训练另加探索噪声' : '沙盒实际执行';
  }

  renderGait(source) {
    const walking = source.net.obs_dim === 43;
    const ctx = this.gaitCanvas.getContext('2d');
    const width = this.gaitCanvas.clientWidth || 220;
    const height = this.gaitCanvas.clientHeight || 84;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.gaitCanvas.width = Math.round(width * dpr);
    this.gaitCanvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    document.getElementById('cockpit-left-foot').className = `cockpit-foot ${source.contacts[0] ? 'contact' : ''}`;
    document.getElementById('cockpit-right-foot').className = `cockpit-foot ${source.contacts[1] ? 'contact' : ''}`;
    document.getElementById('cockpit-speed').textContent = `${(source.forwardSpeed * 100).toFixed(2)} cm/s`;
    if (!walking) {
      ctx.fillStyle = MUTED; ctx.font = '11px sans-serif';
      ctx.fillText('站立任务没有步态相位；显示直立度与高度。', 10, 22);
      ctx.fillStyle = '#1d2a32'; ctx.fillRect(10, 43, width - 20, 10);
      ctx.fillStyle = source.upright > 0.707 ? '#65d6a6' : AMBER;
      ctx.fillRect(10, 43, (width - 20) * clamp01(source.upright), 10);
      ctx.fillStyle = MUTED; ctx.fillText(`upright ${finite(source.upright)} · height ${(source.height * 100).toFixed(1)} cm`, 10, 73);
      return;
    }
    const sin = source.observation[38], cos = source.observation[39];
    const phase = (Math.atan2(sin, cos) + Math.PI * 2) % (Math.PI * 2);
    const cx = 43, cy = 43, radius = 27;
    ctx.strokeStyle = '#34444e'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = AMBER; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(phase) * radius, cy + Math.sin(phase) * radius); ctx.stroke();
    ctx.fillStyle = AMBER; ctx.beginPath(); ctx.arc(cx + Math.cos(phase) * radius, cy + Math.sin(phase) * radius, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = MUTED; ctx.font = '9px "SF Mono", Menlo, monospace';
    ctx.fillText(`phase ${(phase / (Math.PI * 2)).toFixed(2)}`, 18, 82);
    ctx.fillText(`sin ${finite(sin, 2)} / cos ${finite(cos, 2)}`, 87, 34);
    ctx.fillText(`目标 ${(source.observation[40] * 100).toFixed(0)} cm/s`, 87, 54);
  }

  renderMetrics(app, source) {
    const training = source.kind === 'training';
    document.getElementById('cockpit-source').textContent = training
      ? (app.trainer?.running ? '● 训练实时 · 当前 actor 前向' : 'Ⅱ 训练暂停 · 当前 actor 前向')
      : '◆ 测试快照 · 沙盒实际执行';
    document.getElementById('cockpit-task-note').textContent = source.net.obs_dim === 43
      ? '行走训练实验 · 尚未完成稳定步态验收'
      : '站立任务 · 36 维观测与 14 路动作';
    document.getElementById('cockpit-reward').textContent = finite(source.reward, 4);
    document.getElementById('cockpit-return').textContent = finite(source.totalReturn, 2);
    document.getElementById('cockpit-critic').textContent = finite(source.criticValue, 4);
    document.getElementById('cockpit-distance').textContent = `${(source.distance * 100).toFixed(1)} cm`;
    document.getElementById('cockpit-episode').textContent = `${source.episodeSteps} 步${source.done ? ' · 已结束' : ''}`;
    const metrics = app.trainingMetrics || {};
    document.getElementById('cockpit-policy-loss').textContent = finite(metrics.policyLoss, 4);
    document.getElementById('cockpit-value-loss').textContent = finite(metrics.valueLoss, 4);
    document.getElementById('cockpit-entropy').textContent = finite(metrics.entropy, 4);
    document.getElementById('cockpit-iteration').textContent = String(metrics.iteration ?? 0);
    this.renderLossChart(app.trainingHistory || []);
  }

  renderLossChart(history) {
    const canvas = this.chartCanvas;
    const width = canvas.clientWidth || 600, height = canvas.clientHeight || 70;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!history.length) {
      ctx.fillStyle = MUTED; ctx.font = '10px sans-serif';
      ctx.fillText('PPO 更新后，这里画真实回报与损失。', 12, 35);
      return;
    }
    const series = [
      { values: history.map((m) => m.meanReturn), color: '#65d6a6', label: '回报' },
      { values: history.map((m) => m.policyLoss), color: POSITIVE, label: 'actor loss' },
      { values: history.map((m) => m.valueLoss), color: NEGATIVE, label: 'critic loss' },
    ];
    series.forEach((line, row) => {
      const values = line.values.filter(Number.isFinite);
      if (!values.length) return;
      let lo = Math.min(...values), hi = Math.max(...values);
      if (hi - lo < 1e-8) { lo -= 0.5; hi += 0.5; }
      const y0 = 8 + row * 22;
      ctx.strokeStyle = '#26353e'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(45, y0 + 13); ctx.lineTo(width - 8, y0 + 13); ctx.stroke();
      ctx.strokeStyle = line.color; ctx.lineWidth = 1.4; ctx.beginPath();
      line.values.forEach((value, index) => {
        if (!Number.isFinite(value)) return;
        const x = 45 + (line.values.length === 1 ? 0 : index / (line.values.length - 1)) * (width - 55);
        const y = y0 + 13 - (value - lo) / (hi - lo) * 13;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.fillStyle = line.color; ctx.font = '8px "SF Mono", Menlo, monospace';
      ctx.fillText(line.label, 4, y0 + 10);
    });
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
    if (!nearest || distance > 16) return;
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
      const contribution = weight * inputs[index];
      pre += contribution;
      return { index, weight, input: inputs[index], contribution };
    });
    contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    const rows = contributions.slice(0, 6).map((item) =>
      `${this.nodeName(node.layer - 1, item.index)}：${finite(item.weight, 4)} × ${finite(item.input, 4)} = ${finite(item.contribution, 5)}`
    ).join('\n');
    const activation = node.layer < 3 ? `tanh(${finite(pre, 5)}) = ${finite(node.value, 5)}` : `线性动作均值 = ${finite(node.value, 5)}`;
    box.textContent = `${node.name}\nbias ${finite(bias, 5)}；完整求和后再激活：${activation}\n贡献最大的 6 条真实入边：\n${rows}`;
  }
}
