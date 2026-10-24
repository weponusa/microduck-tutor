/**
 * MJCF → three.js 场景构建
 *
 * 把 MuJoCo 的 mjModel 翻译成 three.js 对象树：body 建组、geom 建网格，
 * 每帧用 data.xpos / data.xquat 直接写入世界变换。
 *
 * 思路参考 zalo/mujoco_wasm 的 src/mujocoUtils.js（MIT），
 * 这里做了两点简化：
 *   1. 不再做 Y-up 手性转换，整棵场景保持 MuJoCo 的 Z-up，相机的 up 设为 +Z；
 *   2. 不再用 Reflector 做地面反射，改程序生成的棋盘格纹理，少一个依赖。
 */
import * as THREE from 'three';

const GEOM_PLANE = 0;
const GEOM_SPHERE = 2;
const GEOM_CAPSULE = 3;
const GEOM_ELLIPSOID = 4;
const GEOM_CYLINDER = 5;
const GEOM_BOX = 6;
const GEOM_MESH = 7;

/** 棋盘格地面纹理，纯程序生成，不依赖图片文件 */
function checkerTexture(size = 512, cells = 16) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cell = size / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const dark = (x + y) % 2 === 0;
      ctx.fillStyle = dark ? '#dfe3e8' : '#f4f6f8';
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 从 mjModel 里取 body 名 */
function bodyName(mujoco, model, b) {
  try {
    return mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY.value, b) || `body_${b}`;
  } catch (e) {
    return `body_${b}`;
  }
}

/** 把 mjModel 的一个 mesh 资产读成 three.js BufferGeometry（带缓存） */
function meshGeometry(model, meshID) {
  const vertexCount = model.mesh_vertnum[meshID];
  const faceCount = model.mesh_facenum[meshID];
  const vAdr = model.mesh_vertadr[meshID] * 3;
  const fAdr = model.mesh_faceadr[meshID] * 3;

  const positions = new Float32Array(model.mesh_vert.subarray(vAdr, vAdr + vertexCount * 3));
  const indices = new Uint32Array(model.mesh_face.subarray(fAdr, fAdr + faceCount * 3));

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals(); // STL 是三角面片，直接按面重算法向
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * @param {object} mujoco  已初始化的 MuJoCo 模块
 * @param {object} model   mjModel
 * @param {object} options
 * @returns {{root: THREE.Group, bodies: Map<number, THREE.Group>, collisionMeshes: THREE.Mesh[], visualMeshes: THREE.Mesh[]}}
 */
export function buildMujocoScene(mujoco, model, options = {}) {
  const root = new THREE.Group();
  root.name = 'mujoco-root';

  const bodies = new Map();          // bodyID -> Group（扁平挂在 root 下，用世界坐标）
  const collisionMeshes = [];
  const visualMeshes = [];
  const geometryCache = new Map();   // meshID -> BufferGeometry
  const materialCache = new Map();   // 颜色 -> Material

  const groundTexture = checkerTexture();
  groundTexture.repeat.set(options.groundRepeat ?? 24, options.groundRepeat ?? 24);

  const ensureBody = (b) => {
    if (!bodies.has(b)) {
      const group = new THREE.Group();
      group.name = bodyName(mujoco, model, b);
      group.userData.bodyID = b;
      bodies.set(b, group);
      root.add(group);
    }
    return bodies.get(b);
  };

  const mjColor = (r, g, bl, a) => new THREE.Color().setRGB(r, g, bl, THREE.SRGBColorSpace);

  for (let g = 0; g < model.ngeom; g++) {
    const b = model.geom_bodyid[g];
    const type = model.geom_type[g];
    const group = model.geom_group[g];
    const isCollision = group >= 3;

    const size = [model.geom_size[g * 3], model.geom_size[g * 3 + 1], model.geom_size[g * 3 + 2]];

    let geometry = null;

    if (type === GEOM_PLANE) {
      const extent = options.groundSize ?? 4;
      geometry = new THREE.PlaneGeometry(extent, extent); // Z-up 下本来就在 XY 平面
    } else if (type === GEOM_SPHERE) {
      geometry = new THREE.SphereGeometry(size[0], 24, 16);
    } else if (type === GEOM_CAPSULE) {
      geometry = new THREE.CapsuleGeometry(size[0], size[1] * 2, 8, 16);
      geometry.rotateX(Math.PI / 2); // MuJoCo 胶囊沿 Z，three.js 沿 Y
    } else if (type === GEOM_CYLINDER) {
      geometry = new THREE.CylinderGeometry(size[0], size[0], size[1] * 2, 24, 1);
      geometry.rotateX(Math.PI / 2);
    } else if (type === GEOM_BOX) {
      geometry = new THREE.BoxGeometry(size[0] * 2, size[1] * 2, size[2] * 2);
    } else if (type === GEOM_ELLIPSOID) {
      geometry = new THREE.SphereGeometry(1, 24, 16);
      geometry.scale(size[0], size[1], size[2]);
    } else if (type === GEOM_MESH) {
      const meshID = model.geom_dataid[g];
      if (!geometryCache.has(meshID)) geometryCache.set(meshID, meshGeometry(model, meshID));
      geometry = geometryCache.get(meshID);
    } else {
      continue; // hfield / sdf 暂不渲染
    }

    // 颜色与材质
    let rgba = [model.geom_rgba[g * 4], model.geom_rgba[g * 4 + 1], model.geom_rgba[g * 4 + 2], model.geom_rgba[g * 4 + 3]];
    let shininess = 0.3;
    const matId = model.geom_matid[g];
    if (matId >= 0) {
      rgba = [model.mat_rgba[matId * 4], model.mat_rgba[matId * 4 + 1], model.mat_rgba[matId * 4 + 2], model.mat_rgba[matId * 4 + 3]];
      shininess = model.mat_shininess[matId];
    }

    let material;
    if (type === GEOM_PLANE) {
      material = new THREE.MeshStandardMaterial({
        map: groundTexture,
        color: 0xffffff,
        roughness: 0.95,
        metalness: 0.0,
      });
    } else if (isCollision) {
      material = new THREE.MeshBasicMaterial({
        color: 0xff5a5f,
        wireframe: true,
        transparent: true,
        opacity: 0.55,
        depthTest: true,
      });
    } else {
      const key = rgba.map((v) => v.toFixed(3)).join(',') + '|' + shininess.toFixed(2);
      if (!materialCache.has(key)) {
        materialCache.set(
          key,
          new THREE.MeshStandardMaterial({
            color: mjColor(rgba[0], rgba[1], rgba[2], 1),
            roughness: THREE.MathUtils.clamp(1 - shininess, 0.15, 0.95),
            metalness: 0.05,
            transparent: rgba[3] < 1,
            opacity: rgba[3],
            side: THREE.FrontSide,
          })
        );
      }
      material = materialCache.get(key);
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = !isCollision && type !== GEOM_PLANE;
    mesh.receiveShadow = type === GEOM_PLANE;

    // geom 相对 body 的位姿
    mesh.position.set(model.geom_pos[g * 3], model.geom_pos[g * 3 + 1], model.geom_pos[g * 3 + 2]);
    mesh.quaternion.set(
      model.geom_quat[g * 4 + 1],
      model.geom_quat[g * 4 + 2],
      model.geom_quat[g * 4 + 3],
      model.geom_quat[g * 4 + 0]
    );

    mesh.userData.bodyID = b;
    mesh.userData.geomID = g;
    mesh.userData.geomName = (() => {
      try { return mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_GEOM.value, g) || ''; } catch (e) { return ''; }
    })();

    if (isCollision) {
      mesh.visible = false;
      collisionMeshes.push(mesh);
    } else {
      visualMeshes.push(mesh);
    }

    ensureBody(b).add(mesh);
  }

  // 只为机器人本体建组（世界 body 0 若没有 geom 就不建）
  return { root, bodies, collisionMeshes, visualMeshes };
}

/** 用 MjData 的世界位姿刷新 three.js 各 body 组 */
export function updateBodyTransforms(engine) {
  const { model, data, bodies } = engine;
  for (let b = 0; b < model.nbody; b++) {
    const group = bodies.get(b);
    if (!group) continue;
    group.position.set(data.xpos[b * 3], data.xpos[b * 3 + 1], data.xpos[b * 3 + 2]);
    group.quaternion.set(data.xquat[b * 4 + 1], data.xquat[b * 4 + 2], data.xquat[b * 4 + 3], data.xquat[b * 4 + 0]);
  }
}

/** 机器人整体包围盒（用于自动取景） */
export function sceneBounds(root) {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.15, -0.15, 0), new THREE.Vector3(0.15, 0.15, 0.3));
  return box;
}
