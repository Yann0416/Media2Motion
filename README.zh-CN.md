<div align="center">

# Media2Motion

**图片 / 视频 → 3D 骨骼驱动**

一张照片或一段视频，直接驱动绑定了骨骼的 3D 人形角色 —— 全程浏览器本地运行。

[English](README.md)

| 图片驱动 | 图片驱动 |
| --- | --- |
| ![图片驱动-挥手](docs/demo_waving.png) | ![图片驱动-踢腿](docs/demo_kick.png) |

![视频驱动](docs/demo_video.gif)

</div>

## 这是什么

上传一张**图片或视频**，[MediaPipe Pose](https://developers.google.com/mediapipe) 检测 33 个人体关键点，实时驱动器将其映射到 [three.js](https://threejs.org) 渲染的 **Mixamo 命名人形骨骼**上。3D 角色跟随照片/视频中的人物姿势 —— 头部俯仰/偏转/侧倾、四肢、手腕、脚腕全部驱动。

所有依赖（JS 库、MediaPipe 模型文件）全部打包在本仓库内，**完全本地运行。**

## 功能

- **图片 / 视频输入** ---支持多格式
- **视频进度条** ---可拖动跳转，拖动时自动暂停，落到哪帧识别哪帧
- **米制 3D 姿态** --- 使用 `poseWorldLandmarks`（米制 3D 世界坐标），而非噪声极大的 2D 归一化点
- **头部姿态估计** --- 实时显示俯仰 / 偏转 / 侧倾角度，由五官关键点（鼻/眼/耳）解算
- **重新识别 + 检测阈值滑条** --- 当前帧一键重新检测，灵敏度可调
- **平滑** --- 视频输入的指数平滑
- **调试骨架** --- 可选在模型旁叠加显示 MediaPipe 原始 3D 骨架

## 快速开始

任意静态文件服务器即可，在仓库根目录：

```bash
python -m http.server 8344
# 浏览器打开 http://localhost:8344
```

> 必须走本地服务器 —— 浏览器不允许 `file://` 协议加载 WASM/worker。

## 换自己的模型

仅支持GLB模型，若您的模型为FBX或其他格式则需转换。

内置 `model/character.glb` 使用标准 **Mixamo 骨骼命名**（`Hips`、`Spine`、`LeftArm`、`LeftForeArm`、`LeftHand`、`LeftUpLeg`……），任何同名绑定的模型开箱即用。  
FBX 转 GLB（Blender ≥ 4.x）：

```bash
blender --background --python convert.py -- input.fbx model/character.glb
```

注意：

- 兼容无 `mixamorig:` 前缀 ，驱动器按后缀匹配
- 不驱动手指，因内置模型没有手指骨骼，且手指细节噪声较大，故采取手部整体旋转
- 转换后务必确认模型尺寸正常， 部分 FBX 导出会在网格上带非均匀缩放，会导致朴素包围盒归一化彻底失效，本仓库改用骨骼世界位置归一化规避了这个问题。

## 驱动器原理

```
图片/视频 ─▶ MediaPipe Pose ─▶ poseWorldLandmarks (33 × 米制3D)
                                     │
                                     ▼
                     (x, -y, -z) → 角色空间(髋部为原点)
                                     │
                                     ▼
              逐骨骼最小旋转对齐：对每条链段，
              q_local = q_parentWorld⁻¹ ∘ q_align(静止朝向 → 目标朝向) ∘ q_current
                                     │
                                     ▼
                     SkinnedMesh (three.js GLTFLoader)
```

几个关键实现细节（朴素实现必踩的坑）：

1. **用世界坐标关键点，不用归一化关键点。** 归一化的 `z` 是"深度×图像宽度"，噪声极大；世界坐标是米制、髋部为原点，稳定得多。
2. **对齐四元数必须左乘骨骼当前世界旋转**，再转回父级空间：`local = parentWorld⁻¹ ∘ qAlign ∘ currentWorld`。漏掉 `currentWorld` 这一项，在绑定姿态带 roll 的骨架上（比如 `Hips` 自带 90° Y 轴旋转）整条肢体链会翻转 180°。
3. **每帧先复位到绑定姿态**，自上而下驱动（先父后子），子骨骼世界方向实时重新测量。

关键点 → 骨骼映射：

| MediaPipe 关键点                       | 骨骼链                               |
| ----------------------------------- | --------------------------------- |
| 肩 11/12 → 肘 13/14                   | `Spine`、`Neck`                    |
| 肘 → 腕 15/16 → 食指根 19 / 小指根 17/18/20 | `Left/Right Arm → ForeArm → Hand` |
| 鼻 0、眼 2/5、耳 7/8                     | `Head`（独立朝向解算）                    |
| 髋 23/24 → 膝 25/26 → 踝 27/28         | `Left/Right UpLeg → Leg`          |
| 脚跟 29/30 → 脚尖 31/32                 | `Left/Right Foot`                 |

## 已知限制

- 单目 2D 输入的姿态估计：深度是推断的不是测量的 —— 朝向镜头的前后动作（手臂伸向屏幕）只是近似
- **非全身动作识别效果不佳** —— 半身 / 局部入镜时，未入镜的肢体由模型"脑补"，对应骨骼姿势可能不准
- 手腕只定方向不做拧转，Pose 模型手部仅 3 个粗关键点，拧转噪声大易抖；掌心朝向不可控
- 不支持手指关节

## 项目结构

```
├── index.html            # 页面
├── i18n.js               # 中英文案 + 切换逻辑
├── main.js               # 姿态驱动器：关键点 → 骨骼旋转
├── convert.py            # Blender 无头 FBX → GLB 转换脚本
├── model/character.glb   # 内置演示角色（Mixamo 命名）
├── libs/
│   ├── three.min.js      # three.js r128（本地副本）
│   ├── GLTFLoader.js
│   └── pose/             # MediaPipe Pose 0.5.x（wasm + tflite，本地副本）
└── docs/
```

## 致谢

- [MediaPipe Pose](https://developers.google.com/mediapipe)（Google，Apache-2.0）—— 姿态估计
- [three.js](https://threejs.org)（MIT）—— 渲染
- [MP2MM / Anim (Nor-s)](https://github.com/Nor-s/Anim) —— 世界坐标数据源思路的启发

## 许可证

MIT
