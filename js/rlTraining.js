const DB_NAME = 'microduck-rl-training';
const STORE_NAME = 'checkpoints';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbPut(key, value) {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function idbGet(key) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function idbDelete(key) {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Main-thread client for the real MuJoCo + PPO worker. */
export class TrainingClient {
  constructor({ onMetrics, onTelemetry, onStatus, onError } = {}) {
    this.worker = null;
    this.task = 'stand';
    this.ready = false;
    this.running = false;
    this.requestId = 0;
    this.pending = new Map();
    this.onMetrics = onMetrics || (() => {});
    this.onTelemetry = onTelemetry || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onError = onError || (() => {});
  }

  async init({ task = 'stand', fromPretrained = false, checkpoint = null, seed = 20261024 } = {}) {
    this.dispose();
    this.task = task;
    this.ready = false;
    this.running = false;
    this.onStatus('loading', { task });
    const worker = new Worker(new URL('./rlWorker.js', import.meta.url), { type: 'module' });
    this.worker = worker;
    worker.onmessage = (event) => this.handleMessage(event.data || {});
    worker.onerror = (event) => {
      const error = new Error(event.message || '训练 Worker 启动失败');
      this.onError(error);
      this.rejectAll(error);
    };
    const ready = new Promise((resolve, reject) => {
      this.pending.set('ready', { resolve, reject });
    });
    worker.postMessage({ type: 'init', task, fromPretrained, checkpoint, seed });
    await ready;
    this.ready = true;
    this.onStatus('ready', { task });
    return true;
  }

  handleMessage(message) {
    const type = message.type;
    if (type === 'metrics') {
      this.running = message.running !== false;
      this.onMetrics(message);
      this.onStatus(this.running ? 'running' : 'paused', message);
      return;
    }
    if (type === 'telemetry') {
      this.onTelemetry(message);
      return;
    }
    if (type === 'ready' || type === 'restored') {
      const pending = this.pending.get('ready');
      if (pending) {
        this.pending.delete('ready');
        pending.resolve(message);
      }
      return;
    }
    if (type === 'error') {
      this.running = false;
      this.onStatus('error', message);
      const error = new Error(message.message || message.error || '训练失败');
      if (message.requestId != null && this.pending.has(message.requestId)) {
        const pending = this.pending.get(message.requestId);
        this.pending.delete(message.requestId);
        pending.reject(error);
      } else if (!this.ready && this.pending.has('ready')) {
        const pending = this.pending.get('ready');
        this.pending.delete('ready');
        pending.reject(error);
      } else {
        this.onError(error);
      }
      return;
    }
    const requestId = message.requestId;
    if (requestId != null && this.pending.has(requestId)) {
      const pending = this.pending.get(requestId);
      this.pending.delete(requestId);
      pending.resolve(message);
      return;
    }
    if (type === 'paused' || type === 'started' || type === 'reset') {
      this.running = type === 'started';
      this.onStatus(this.running ? 'running' : 'paused', message);
    }
  }

  start() {
    if (!this.ready) throw new Error('训练环境尚未就绪');
    this.worker.postMessage({ type: 'start' });
    this.running = true;
    this.onStatus('running', { task: this.task });
  }

  pause() {
    if (!this.ready) return;
    this.worker.postMessage({ type: 'pause' });
    this.running = false;
    this.onStatus('paused', { task: this.task });
  }

  request(type, payload = {}) {
    if (!this.worker) return Promise.reject(new Error('训练环境尚未创建'));
    const requestId = ++this.requestId;
    const response = new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
    });
    this.worker.postMessage({ type, requestId, ...payload });
    return response;
  }

  async exportActor() {
    const message = await this.request('export');
    return message.actor || message.policy || message.net;
  }

  async saveCheckpoint() {
    const message = await this.request('getCheckpoint');
    const checkpoint = message.checkpoint || message.state;
    if (!checkpoint) throw new Error('训练引擎没有返回检查点');
    await idbPut(this.task, { task: this.task, savedAt: new Date().toISOString(), checkpoint });
    return checkpoint;
  }

  async loadCheckpoint(task = this.task) {
    const saved = await idbGet(task);
    return saved ? saved.checkpoint : null;
  }

  async clearCheckpoint(task = this.task) {
    await idbDelete(task);
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  dispose() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.ready = false;
    this.running = false;
    this.rejectAll(new Error('训练环境已关闭'));
  }
}
