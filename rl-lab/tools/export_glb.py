"""
把 MicroDuck 的 MJCF 导成一个带零件名的 glTF，给网页做「三维图鉴 + 拆解」。

不做物理，只要几何：每个 geom 在 STAND 姿态下的世界变换烘焙进去，
按 body 分组命名（trunk_base、upper_leg_left、leg…），网页里就能按零件点选、整体炸开。

跑法：
    .venv/bin/python tools/export_glb.py
产出：
    ../assets/duck/duck.glb
"""

import json
import os

import mujoco
import numpy as np
import trimesh

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCENE = os.path.join(HERE, "..", "assets", "mjcf", "microduck", "scene.xml")
OUT_DIR = os.path.join(HERE, "..", "assets", "duck")
os.makedirs(OUT_DIR, exist_ok=True)

m = mujoco.MjModel.from_xml_path(SCENE)
d = mujoco.MjData(m)
mujoco.mj_resetDataKeyframe(m, d, 1)          # 1 = STAND
mujoco.mj_forward(m, d)

scene = trimesh.Scene()
parts = []

# 先建立 body 层级（局部变换：相对父 body）
def body_local(b):
    T = np.eye(4)
    R = np.zeros(9)
    mujoco.mju_quat2Mat(R, np.array(m.body_quat[b], dtype=np.float64))
    T[:3, :3] = R.reshape(3, 3)
    T[:3, 3] = m.body_pos[b]
    return T

for b in range(1, m.nbody):
    name = mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, b)
    p_id = m.body_parentid[b]
    p_name = mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, p_id) if p_id > 0 else None
    if p_name:
        scene.graph.update(frame_to=f"body:{name}", frame_from=f"body:{p_name}", matrix=body_local(b))
    else:
        scene.graph.update(frame_to=f"body:{name}", matrix=body_local(b))

for g in range(m.ngeom):
    if m.geom_type[g] != mujoco.mjtGeom.mjGEOM_MESH:
        continue
    if m.geom_group[g] >= 3:                   # 跳过碰撞体
        continue
    mesh_id = m.geom_dataid[g]
    body_id = m.geom_bodyid[g]

    v_adr = m.mesh_vertadr[mesh_id]
    n_v = m.mesh_vertnum[mesh_id]
    f_adr = m.mesh_faceadr[mesh_id]
    n_f = m.mesh_facenum[mesh_id]

    verts = np.array(m.mesh_vert[v_adr:v_adr + n_v], dtype=np.float64).reshape(-1, 3)
    faces = np.array(m.mesh_face[f_adr:f_adr + n_f], dtype=np.int64).reshape(-1, 3)

    # geom 在 body 内的位姿
    q = np.array(m.geom_quat[g], dtype=np.float64)      # w,x,y,z
    R_g = np.zeros(9)
    mujoco.mju_quat2Mat(R_g, q)
    T_g = np.eye(4)
    T_g[:3, :3] = R_g.reshape(3, 3)
    T_g[:3, 3] = m.geom_pos[g]

    # 材质颜色
    rgba = np.array(m.geom_rgba[g], dtype=np.float64)
    if m.geom_matid[g] >= 0:
        rgba = np.array(m.mat_rgba[m.geom_matid[g]], dtype=np.float64)

    body_name = mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, body_id) or f"body{body_id}"
    geom_name = mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_GEOM, g) or f"geom{g}"

    mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
    mesh.visual = trimesh.visual.TextureVisuals(
        material=trimesh.visual.material.PBRMaterial(
            baseColorFactor=[int(c * 255) for c in rgba[:3]] + [int(rgba[3] * 255) if False else 255],
            metallicFactor=0.0,
            roughnessFactor=0.55,
        )
    )

    # 保留层级：body 节点挂在自己父 body 下，geom 挂在 body 下，都只存局部变换
    scene.add_geometry(mesh, node_name=f"geom:{g}", geom_name=f"geom:{g}", parent_node_name=f"body:{body_name}", transform=T_g)
    parts.append({"name": f"body:{body_name}/geom:{g}", "body": body_name, "geom": geom_name})

out = os.path.join(OUT_DIR, "duck.glb")
with open(out, "wb") as f:
    f.write(scene.export(file_type="glb"))

size = os.path.getsize(out) / 1024 / 1024
print(f"导出 {len(parts)} 个零件 → {out}（{size:.1f} MB）")
json.dump(parts, open(os.path.join(OUT_DIR, "parts.json"), "w"), ensure_ascii=False, indent=1)

# 顺便记录关节信息，网页里做局部动作要用
joints = []
for j in range(1, m.njnt):
    if m.jnt_type[j] != mujoco.mjtJoint.mjJNT_HINGE:
        continue
    joints.append({
        "name": mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_JOINT, j),
        "axis": [round(float(a), 3) for a in m.jnt_axis[j]],
        "pos": [round(float(p), 4) for p in m.jnt_pos[j]],
        "body": mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, m.jnt_bodyid[j]),
        "range": [round(float(np.degrees(r)), 1) for r in m.jnt_range[j]],
    })
json.dump(joints, open(os.path.join(OUT_DIR, "joints.json"), "w"), ensure_ascii=False, indent=1)
print("关节信息已存 joints.json")
