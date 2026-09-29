/* Media2Motion —— 上传图片/视频,MediaPipe Pose 关键点驱动 Mixamo 命名人形骨骼 */
(function () {
  'use strict';

  // ---------- 状态 ----------
  const state = {
    model: null,
    mixer: null,
    driver: null,          // 骨骼驱动器
    mediaType: null,       // 'image' | 'video'
    lastLandmarks: null,   // 最近一次检测结果(归一化2D,仅用于叠加绘制)
    lastWorld: null,       // 世界坐标关键点(米制3D,用于驱动)
    smoothW: null,         // 平滑后的世界坐标关键点
    lastAng: null,         // 最近一次头部角度(i18n 切换时刷新用)
    lastDetect: null,      // 'ok' | 'none' | null
    lastDetectTime: null,
    busy: false,
    playing: true,
  };

  const el = id => document.getElementById(id);
  const stModel = el('stModel'), stPose = el('stPose'), stDetect = el('stDetect'), stHead = el('stHead');
  // 播放按钮文案(按钮内 span 走 i18n,不能直接覆盖 textContent)
  const setPlayBtn = playing => {
    el('btnPlay').querySelector('span').textContent = t(playing ? 'btnPause' : 'btnPlay');
  };
  // 语言切换时刷新动态状态文案(由 i18n.js 回调)
  window.__onLangChange = () => {
    stModel.textContent = stModel.classList.contains('ok') ? t('modelReady')
      : stModel.classList.contains('warn') ? stModel.textContent : t('modelLoading');
    stPose.textContent = stPose.classList.contains('ok') ? t('poseReady')
      : stPose.classList.contains('warn') ? stPose.textContent : t('poseLoading');
    if (state.lastDetect === 'ok') stDetect.textContent = t('detectOk') + ' · ' + state.lastDetectTime;
    else if (state.lastDetect === 'none') stDetect.textContent = t('noPerson');
    else stDetect.textContent = t('waiting');
    stHead.textContent = state.lastAng
      ? t('headAngles')(state.lastAng.pitch, state.lastAng.yaw, state.lastAng.roll)
      : t('headNA');
    if (state.mediaType === 'video') setPlayBtn(!video.paused);
  };

  // ---------- 3D 场景 ----------
  const canvas = el('threeCanvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1117);
  const grid = new THREE.GridHelper(4, 20, 0x30363d, 0x21262d);
  scene.add(grid);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
  camera.position.set(0, 1.2, 3);

  // 轨道控制(轻量手写,不引额外库)
  const orbit = { yaw: 0, pitch: 0.1, dist: 3, target: new THREE.Vector3(0, 1, 0) };
  function applyOrbit() {
    camera.position.set(
      orbit.target.x + orbit.dist * Math.sin(orbit.yaw) * Math.cos(orbit.pitch),
      orbit.target.y + orbit.dist * Math.sin(orbit.pitch),
      orbit.target.z + orbit.dist * Math.cos(orbit.yaw) * Math.cos(orbit.pitch)
    );
    camera.lookAt(orbit.target);
  }
  applyOrbit();
  let dragging = false, lx = 0, ly = 0;
  canvas.addEventListener('pointerdown', e => { dragging = true; lx = e.clientX; ly = e.clientY; });
  window.addEventListener('pointerup', () => dragging = false);
  window.addEventListener('pointermove', e => {
    if (!dragging) return;
    orbit.yaw -= (e.clientX - lx) * 0.006;
    orbit.pitch = Math.max(-0.5, Math.min(1.2, orbit.pitch + (e.clientY - ly) * 0.006));
    lx = e.clientX; ly = e.clientY;
    applyOrbit();
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    orbit.dist = Math.max(0.5, Math.min(10, orbit.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
    applyOrbit();
  }, { passive: false });

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  // 灯光
  scene.add(new THREE.HemisphereLight(0xffffff, 0x33383d, 1.0));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(2, 4, 3);
  scene.add(dir);

  // ---------- 加载模型 ----------
  new THREE.GLTFLoader().load('model/character.glb', gltf => {
    const model = gltf.scene;
    scene.add(model);
    state.model = model;
    model.updateMatrixWorld(true);

    // 用骨骼世界位置计算真实渲染包围盒
    // (SkinnedMesh 实际形状由骨骼决定,Box3.setFromObject 只看几何体会算错)
    const tmpV = new THREE.Vector3();
    let minY = Infinity, maxY = -Infinity;
    model.traverse(o => {
      if (o.isBone) {
        o.updateWorldMatrix(true, false);
        o.getWorldPosition(tmpV);
        minY = Math.min(minY, tmpV.y);
        maxY = Math.max(maxY, tmpV.y);
      }
    });
    const boneH = maxY - minY;
    // 归一化到真实人高(1.7单位),再抬到地面
    if (boneH > 1e-6) model.scale.setScalar(1.7 / boneH);
    model.updateMatrixWorld(true);
    minY = Infinity;
    model.traverse(o => {
      if (o.isBone) {
        o.updateWorldMatrix(true, false);
        o.getWorldPosition(tmpV);
        minY = Math.min(minY, tmpV.y);
      }
    });
    model.position.y -= minY;
    model.updateMatrixWorld(true);

    orbit.target.set(0, 0.95, 0);
    orbit.dist = 3.2;
    applyOrbit();

    state.driver = new BoneDriver(model);
    stModel.textContent = t('modelReady');
    stModel.classList.add('ok');
  }, undefined, err => {
    stModel.textContent = t('modelFail') + err;
    stModel.classList.add('warn');
    console.error(err);
  });

  // ---------- 骨骼驱动器 ----------
  // 逐骨骼方向匹配:目标世界方向 = 关键点算出的肢体方向,
  // localQuat = parentWorldQuat^-1 * quatFromUnitVectors(restDirWorld, targetDirWorld)
  const MP = { // MediaPipe 关键点索引
    nose: 0,
    eyeL: 2, eyeR: 5, earL: 7, earR: 8,
    lShoulder: 11, rShoulder: 12,
    lElbow: 13, rElbow: 14,
    lWrist: 15, rWrist: 16,
    lPinky: 17, rPinky: 18, lIndex: 19, rIndex: 20,
    lHip: 23, rHip: 24,
    lKnee: 25, rKnee: 26,
    lAnkle: 27, rAnkle: 28,
    lHeel: 29, rHeel: 30, lFootIdx: 31, rFootIdx: 32,
  };

  function findBone(root, name) {
    let found = null;
    root.traverse(o => { if (!found && (o.name === name || o.name.startsWith(name))) found = o; });
    return found;
  }

  class BoneDriver {
    constructor(model) {
      this.model = model;
      const B = {};
      ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
        'LeftShoulder', 'LeftArm', 'LeftForeArm',
        'RightShoulder', 'RightArm', 'RightForeArm',
        'LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg',
        'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot', 'Head_end',
        'LeftHand_end', 'RightHand_end', 'LeftToeBase', 'RightToeBase'].forEach(n => B[n] = findBone(model, n));
      this.bones = B;

      // 计算静止姿态参考(世界空间)
      model.updateMatrixWorld(true);

      // 每条驱动链: { bone, tail }
      // tail = 末端子骨,方向 bone→tail 即该骨骼指向
      const chain = (bone, tail) => ({ bone, tail });
      this.chains = [];
      const add = (...args) => { if (args.every(Boolean)) this.chains.push(chain(...args)); };
      // 躯干(先驱动,父级先更新)
      add(B.Spine, B.Spine2);
      add(B.Neck, B.Head);
      if (B.Head && B.Head_end) add(B.Head, B.Head_end); // 头骨独立驱动(用耳朵/眼睛/鼻子算朝向)
      // 手臂
      add(B.LeftArm, B.LeftForeArm);
      add(B.LeftForeArm, B.LeftHand);
      add(B.RightArm, B.RightForeArm);
      add(B.RightForeArm, B.RightHand);
      // 手(手腕角度): 手掌方向 Hand→Hand_end
      if (B.LeftHand && B.LeftHand_end) add(B.LeftHand, B.LeftHand_end);
      if (B.RightHand && B.RightHand_end) add(B.RightHand, B.RightHand_end);
      // 腿
      add(B.LeftUpLeg, B.LeftLeg);
      add(B.LeftLeg, B.LeftFoot);
      add(B.RightUpLeg, B.RightLeg);
      add(B.RightLeg, B.RightFoot);
      // 脚(脚腕角度): 脚背方向 Foot→ToeBase
      if (B.LeftFoot && B.LeftToeBase) add(B.LeftFoot, B.LeftToeBase);
      if (B.RightFoot && B.RightToeBase) add(B.RightFoot, B.RightToeBase);
      // 记录绑定姿态局部旋转,每帧先复位再驱动
      this.chains.forEach(c => c.bindQuat = c.bone.quaternion.clone());
    }

    /** lms: MediaPipe 世界坐标关键点数组(米制3D,髋部原点) */
    update(lms) {
      const P = i => {
        const l = lms[i];
        // 世界坐标(x右,y下,z朝镜头) → 角色空间(x右+X, 上+Y, 朝镜头+Z)
        return new THREE.Vector3(l.x, -l.y, -l.z);
      };
      // 左右关键点映射
      const S = { ls: MP.lShoulder, rs: MP.rShoulder, le: MP.lElbow, re: MP.rElbow, lw: MP.lWrist, rw: MP.rWrist, lh: MP.lHip, rh: MP.rHip, lk: MP.lKnee, rk: MP.rKnee, la: MP.lAnkle, ra: MP.rAnkle,
        ph: MP.lPinky, ih: MP.lIndex, hl: MP.lHeel, fi: MP.lFootIdx, ph2: MP.rPinky, ih2: MP.rIndex, hl2: MP.rHeel, fi2: MP.rFootIdx };

      const vis = i => !lms[i] || lms[i].visibility === undefined || lms[i].visibility > 0.4;
      const ls = P(S.ls), rs = P(S.rs), le = P(S.le), re = P(S.re),
        lw = P(S.lw), rw = P(S.rw), lh = P(S.lh), rh = P(S.rh),
        lk = P(S.lk), rk = P(S.rk), la = P(S.la), ra = P(S.ra);
      const hipsC = lh.clone().add(rh).multiplyScalar(0.5);
      const shdC = ls.clone().add(rs).multiplyScalar(0.5);

      const norm = v => { const n = v.length(); return n > 1e-6 ? v.multiplyScalar(1 / n) : null; };

      // 每帧先复位到绑定姿态,再自上而下驱动
      this.chains.forEach(c => c.bone.quaternion.copy(c.bindQuat));
      this.model.updateMatrixWorld(true);

      // 世界空间方向对齐:
      // qAlign = setFromUnitVectors(当前世界方向, 目标方向)(左乘)
      // 目标世界旋转 = qAlign ∘ 当前世界旋转
      // local = parentWorld⁻¹ ∘ 目标世界旋转
      const setDir = (chain, targetDir) => {
        if (!chain || !targetDir) return;
        const bone = chain.bone;
        bone.updateWorldMatrix(true, false);
        const curDir = chain.tail.getWorldPosition(new THREE.Vector3())
          .sub(bone.getWorldPosition(new THREE.Vector3()));
        if (curDir.lengthSq() < 1e-10) return;
        const qAlign = new THREE.Quaternion().setFromUnitVectors(curDir.normalize(), targetDir);
        const qNewWorld = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(qAlign);
        bone.parent.updateWorldMatrix(true, false);
        const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
        bone.quaternion.copy(pq.invert().multiply(qNewWorld));
        bone.updateWorldMatrix(false, true);
      };
      const D = (a, b) => norm(b.clone().sub(a));

      const find = name => this.chains.find(c => c.bone.name.startsWith(name));

      // 顺序: 躯干 → 头 → 左臂 → 右臂 → 左腿 → 右腿
      setDir(find('Spine'), D(hipsC, shdC));
      // 头部朝向: 鼻尖相对双耳中点 = 脸朝向向量; 双耳连线 = 左右轴
      const nose = P(MP.nose);
      const earC = P(MP.earL).clone().add(P(MP.earR)).multiplyScalar(0.5);
      const eyeC = P(MP.eyeL).clone().add(P(MP.eyeR)).multiplyScalar(0.5);
      const headFwd = norm(nose.clone().sub(earC));
      const headRight = norm(P(MP.earR).clone().sub(P(MP.earL)));
      const headUp = (headFwd && headRight)
        ? norm(new THREE.Vector3().crossVectors(headRight, headFwd))
        : null;
      // 脖子目标改用双眼中点(比鼻子更贴近颅轴,避免整头前倾造成的"低头")
      const neckDir = (vis(MP.eyeL) && vis(MP.eyeR)) ? D(shdC, eyeC)
        : (vis(MP.nose) ? D(shdC, nose) : null);
      if (neckDir) setDir(find('Neck'), neckDir);
      if (headUp && vis(MP.earL) && vis(MP.earR)) setDir(find('Head'), headUp);
      // 头部角度(按镜像前的原始朝向计算,反映照片/视频里头的真实姿态)
      let angles = null;
      if (headFwd && headRight) {
        const deg = r => Math.round(r * 180 / Math.PI);
        angles = {
          pitch: deg(Math.asin(Math.max(-1, Math.min(1, -headFwd.y)))), // 正=低头 负=抬头
          yaw: deg(Math.atan2(headFwd.x, headFwd.z)),                   // 正=转向本人左侧
          roll: deg(Math.atan2(headRight.y, Math.hypot(headRight.x, headRight.z))), // 正=右耳高
        };
      }
      if (vis(S.le)) setDir(find('LeftArm'), D(ls, le));
      if (vis(S.lw)) setDir(find('LeftForeArm'), D(le, lw));
      if (vis(S.re)) setDir(find('RightArm'), D(rs, re));
      if (vis(S.rw)) setDir(find('RightForeArm'), D(re, rw));
      if (vis(S.lk)) setDir(find('LeftUpLeg'), D(lh, lk));
      if (vis(S.la)) setDir(find('LeftLeg'), D(lk, la));
      if (vis(S.rk)) setDir(find('RightUpLeg'), D(rh, rk));
      if (vis(S.ra)) setDir(find('RightLeg'), D(rk, ra));
      // 手腕: 手掌方向 = 腕→食指/小指根中点(只定方向,不做拧转——pose手部点噪声大,拧转易抖成麻花)
      if (vis(S.ih) && vis(S.ph)) setDir(find('LeftHand'),
        D(P(S.lw), P(S.ih).clone().add(P(S.ph)).multiplyScalar(0.5)));
      if (vis(S.ih2) && vis(S.ph2)) setDir(find('RightHand'),
        D(P(S.rw), P(S.ih2).clone().add(P(S.ph2)).multiplyScalar(0.5)));
      // 脚腕: 脚背方向 = 脚跟→脚尖
      if (vis(S.hl) && vis(S.fi)) setDir(find('LeftFoot'), D(P(S.hl), P(S.fi)));
      if (vis(S.hl2) && vis(S.fi2)) setDir(find('RightFoot'), D(P(S.hl2), P(S.fi2)));

      this.model.updateMatrixWorld(true);
      return angles;
    }
  }

  // ---------- MediaPipe Pose ----------
  const pose = new Pose({
    locateFile: f => `libs/pose/${f}`,
  });
  pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  pose.onResults(onPoseResults);
  pose.initialize().then(() => {
    stPose.textContent = t('poseReady');
    stPose.classList.add('ok');
  }).catch(e => {
    stPose.textContent = t('poseFail');
    stPose.classList.add('warn');
    console.error(e);
  });

  // ---------- 关键点叠加绘制 ----------
  const POSE_CONNECTIONS = [
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
    [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
  ];
  const pvCanvas = el('previewCanvas'), pvCtx = pvCanvas.getContext('2d');
  const img = el('mediaImg'), video = el('mediaVideo');

  function drawOverlay(lms) {
    const show = el('showSkeleton').checked;
    const src = state.mediaType === 'video' ? video : img;
    const w = src.videoWidth || src.naturalWidth, h = src.videoHeight || src.naturalHeight;
    if (!w) return;
    // 用 canvas 替代原始 img/video 显示(把关键点画上去)
    img.style.display = 'none';
    video.style.display = 'none';
    pvCanvas.style.display = 'block';
    if (pvCanvas.width !== w || pvCanvas.height !== h) { pvCanvas.width = w; pvCanvas.height = h; }
    pvCtx.drawImage(src, 0, 0);
    if (!show || !lms) return;
    pvCtx.strokeStyle = '#58a6ff';
    pvCtx.lineWidth = Math.max(2, w / 300);
    POSE_CONNECTIONS.forEach(([a, b]) => {
      const A = lms[a], B = lms[b];
      if (!A || !B) return;
      pvCtx.beginPath();
      pvCtx.moveTo(A.x * w, A.y * h);
      pvCtx.lineTo(B.x * w, B.y * h);
      pvCtx.stroke();
    });
    pvCtx.fillStyle = '#3fb950';
    lms.forEach(p => {
      if (p.visibility !== undefined && p.visibility < 0.4) return;
      pvCtx.beginPath();
      pvCtx.arc(p.x * w, p.y * h, Math.max(3, w / 180), 0, Math.PI * 2);
      pvCtx.fill();
    });
  }

  // ---------- 检测结果处理 ----------
  function onPoseResults(res) {
    state.busy = false;
    const lms = res.poseLandmarks;
    const wlms = res.poseWorldLandmarks;
    if (!lms || !wlms) {
      stDetect.textContent = t('noPerson');
      stDetect.classList.add('warn');
      state.lastDetect = 'none';
      drawOverlay(state.lastLandmarks);
      return;
    }
    state.lastDetect = 'ok';
    state.lastDetectTime = new Date().toLocaleTimeString();
    stDetect.textContent = t('detectOk') + ' · ' + state.lastDetectTime;
    stDetect.classList.remove('warn');
    stDetect.classList.add('ok');
    state.lastLandmarks = lms;   // 归一化点,叠加绘制用
    state.lastWorld = wlms;      // 米制3D点,驱动用
    if (!state.smoothW) state.smoothW = wlms.map(p => ({ ...p }));
    drawOverlay(lms);
    const ang = applyPose(wlms);
    state.lastAng = ang;
    stHead.textContent = ang ? t('headAngles')(ang.pitch, ang.yaw, ang.roll) : t('headNA');
  }

  function applyPose(rawW) {
    if (!state.driver) return;
    const alpha = parseFloat(el('smooth').value);
    const k = state.mediaType === 'image' ? 1 : alpha; // 图片直接用原始值
    // 指数平滑
    state.smoothW.forEach((p, i) => {
      const r = rawW[i];
      p.x += (r.x - p.x) * k;
      p.y += (r.y - p.y) * k;
      p.z += (r.z - p.z) * k;
      if (r.visibility !== undefined) p.visibility = r.visibility;
    });
    return state.driver.update(state.smoothW); // 返回头部角度
  }

  // ---------- 媒体加载 ----------
  const fileInput = el('fileInput');
  let detectTimer = null;

  function loadFile(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    stopDetect();
    state.smoothW = null;
    state.lastLandmarks = null;
    state.lastWorld = null;
    pvCanvas.style.display = 'none';

    if (file.type.startsWith('image/')) {
      state.mediaType = 'image';
      el('btnImage').classList.add('active');
      el('btnVideo').classList.remove('active');
      el('btnPlay').style.display = 'none';
      el('btnRedetect').style.display = 'block';
      el('seekRow').style.display = 'none';
      video.pause(); video.removeAttribute('src'); video.load();
      img.onload = () => {
        img.style.display = 'block';
        el('placeholder').style.display = 'none';
        startDetect();
      };
      img.src = url;
    } else if (file.type.startsWith('video/')) {
      state.mediaType = 'video';
      el('btnVideo').classList.add('active');
      el('btnImage').classList.remove('active');
      el('btnPlay').style.display = 'block';
      setPlayBtn(true);
      el('btnRedetect').style.display = 'none';
      el('seekRow').style.display = 'flex';
      state.playing = true;
      img.removeAttribute('src');
      video.onloadeddata = () => {
        video.style.display = 'block';
        el('placeholder').style.display = 'none';
        startDetect();
      };
      video.src = url;
      video.play().catch(() => {});
    }
  }

  // 帧循环检测:视频逐帧,图片只在加载后一次
  function startDetect() {
    stopDetect();
    if (state.mediaType === 'video') {
      detectTimer = setInterval(pumpFrame, 33); // ~30fps
    } else {
      pumpFrame();
    }
  }
  function stopDetect() {
    if (detectTimer) { clearInterval(detectTimer); detectTimer = null; }
  }
  function pumpFrame() {
    if (state.busy) return;
    const src = state.mediaType === 'video' ? video : img;
    const ready = state.mediaType === 'video'
      ? (video.readyState >= 2 && !video.paused && !video.ended)
      : img.complete && img.naturalWidth;
    if (!ready || !state.driver) return;
    state.busy = true;
    pose.send({ image: src }).catch(e => { state.busy = false; console.error(e); });
  }

  // ---------- UI 事件 ----------
  el('dropArea').addEventListener('click', () => fileInput.click());
  el('btnImage').addEventListener('click', () => { fileInput.accept = 'image/*'; fileInput.click(); });
  el('btnVideo').addEventListener('click', () => { fileInput.accept = 'video/*'; fileInput.click(); });
  fileInput.addEventListener('change', e => loadFile(e.target.files[0]));
  const dropArea = el('dropArea');
  ['dragover', 'dragleave', 'drop'].forEach(ev => dropArea.addEventListener(ev, e => {
    e.preventDefault();
    dropArea.classList.toggle('dragover', ev === 'dragover');
    if (ev === 'drop') loadFile(e.dataTransfer.files[0]);
  }));

  // Ctrl+V 粘贴图片/文件直接加载
  document.addEventListener('paste', e => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.kind === 'file' && (it.type.startsWith('image/') || it.type.startsWith('video/'))) {
        const f = it.getAsFile();
        if (f) { loadFile(f); e.preventDefault(); return; }
      }
    }
  });

  el('smooth').addEventListener('input', e => {
    el('smoothVal').textContent = parseFloat(e.target.value).toFixed(2);
    // 滑动时用已有的关键点即时重算(视频会在下一帧自然更新)
    if (state.lastWorld && state.mediaType === 'image') applyPose(state.lastWorld);
  });
  el('btnPlay').addEventListener('click', () => {
    if (video.paused) { video.play(); setPlayBtn(true); }
    else { video.pause(); setPlayBtn(false); }
  });

  // 重新识别(图片模式): 重置平滑状态后再检测一次
  el('btnRedetect').addEventListener('click', () => {
    state.smoothW = null;
    pumpFrame();
  });

  // 检测阈值: 实时改 MediaPipe 置信度参数
  el('sens').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    el('sensVal').textContent = v.toFixed(2);
    pose.setOptions({ minDetectionConfidence: v, minTrackingConfidence: Math.max(0.3, v) });
  });

  // 视频进度条: 按下即暂停,拖动跳转,松手恢复原播放状态
  const seek = el('seek'), seekTime = el('seekTime');
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  let scrubbing = false, wasPlaying = false;
  video.addEventListener('loadedmetadata', () => { seek.max = video.duration || 0; });
  seek.addEventListener('pointerdown', () => {
    scrubbing = true;
    wasPlaying = !video.paused && !video.ended;
    if (wasPlaying) { video.pause(); setPlayBtn(false); } // 拖动期间暂停视频
  });
  seek.addEventListener('pointerup', () => {
    scrubbing = false;
    if (wasPlaying) { video.play().catch(() => {}); setPlayBtn(true); }
    wasPlaying = false;
  });
  seek.addEventListener('input', () => { video.currentTime = parseFloat(seek.value); });
  function detectOnce() {
    if (state.busy || video.readyState < 2) return;
    state.busy = true;
    pose.send({ image: video }).catch(e => { state.busy = false; console.error(e); });
  }
  video.addEventListener('seeked', detectOnce);

  // ---------- 3D 输入骨架可视化(模型旁的绿色骨架 = MediaPipe 数据原样) ----------
  const skelGroup = new THREE.Group();
  skelGroup.position.set(-1.5, 0.85, 0);
  scene.add(skelGroup);
  const skelMat = new THREE.LineBasicMaterial({ color: 0x3fb950 });
  function updateSkel3D() {
    while (skelGroup.children.length) {
      const c = skelGroup.children.pop();
      c.geometry.dispose();
    }
    if (!el('showInput').checked || !state.smoothW) return;
    const P = i => new THREE.Vector3(
      state.smoothW[i].x, -state.smoothW[i].y, -state.smoothW[i].z);
    POSE_CONNECTIONS.forEach(([a, b]) => {
      const geo = new THREE.BufferGeometry().setFromPoints([P(a), P(b)]);
      skelGroup.add(new THREE.Line(geo, skelMat));
    });
  }

  // ---------- 渲染循环 ----------
  (function loop() {
    requestAnimationFrame(loop);
    resize();
    updateSkel3D();
    renderer.render(scene, camera);
    // 视频模式下叠加层跟随播放重绘 + 进度条同步
    if (state.mediaType === 'video' && video.readyState >= 2) {
      if (video.duration && !scrubbing) seek.value = video.currentTime;
      if (video.duration) seekTime.textContent = fmt(video.currentTime) + ' / ' + fmt(video.duration);
      if (video.readyState >= 2 && state.lastLandmarks) {
        drawOverlay(state.lastLandmarks);
      }
    }
  })();
})();
