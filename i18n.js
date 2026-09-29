/* Media2Motion i18n —— 中英双语,localStorage 记忆选择 */
(function () {
  'use strict';

  const DICT = {
    zh: {
      appTitle: 'Media2Motion · 图片/视频 → 3D 骨骼驱动',
      appSubtitle: '图片/视频 → 3D 骨骼驱动',
      modelLoading: '模型加载中…',
      modelReady: '模型已加载',
      modelFail: '模型加载失败: ',
      poseLoading: '姿态引擎加载中…',
      poseReady: '姿态引擎就绪',
      poseFail: '姿态引擎加载失败',
      waiting: '等待输入',
      detectOk: '检测成功',
      noPerson: '未检测到人体',
      head: '头',
      headAngles: (p, y, r) => `头 俯仰${p}° / 偏转${y}° / 侧倾${r}°`,
      headNA: '头: --',
      uploadTitle: '拖入 图片 / 视频，或直接 Ctrl+V 粘贴图片',
      uploadHint: '支持 jpg / png / mp4 / webm 等，支持截图后直接粘贴',
      btnImage: '选图片',
      btnVideo: '选视频',
      btnPause: '暂停',
      btnPlay: '播放',
      btnRedetect: '重新识别',
      placeholder: '未加载媒体',
      chkSkeleton: '关键点叠加',
      chkInput3d: '3D输入骨架',
      lblSmooth: '平滑',
      lblThresh: '检测阈值',
      viewport: '3D 视口 · 拖拽旋转 / 滚轮缩放',
    },
    en: {
      appTitle: 'Media2Motion · Image/Video → 3D Skeleton Motion',
      appSubtitle: 'Image/Video → 3D Skeleton Motion',
      modelLoading: 'Loading model…',
      modelReady: 'Model loaded',
      modelFail: 'Model load failed: ',
      poseLoading: 'Loading pose engine…',
      poseReady: 'Pose engine ready',
      poseFail: 'Pose engine failed',
      waiting: 'Waiting for input',
      detectOk: 'Detected',
      noPerson: 'No person detected',
      head: 'Head',
      headAngles: (p, y, r) => `Head pitch ${p}° / yaw ${y}° / roll ${r}°`,
      headNA: 'Head: --',
      uploadTitle: 'Drop image / video here, or Ctrl+V paste a screenshot',
      uploadHint: 'jpg / png / mp4 / webm supported; screenshots welcome',
      btnImage: 'Image',
      btnVideo: 'Video',
      btnPause: 'Pause',
      btnPlay: 'Play',
      btnRedetect: 'Re-detect',
      placeholder: 'No media',
      chkSkeleton: 'Overlay',
      chkInput3d: '3D input skeleton',
      lblSmooth: 'Smoothing',
      lblThresh: 'Min confidence',
      viewport: '3D Viewport · drag to orbit / scroll to zoom',
    },
  };

  let lang = localStorage.getItem('m2m_lang') || 'zh';
  if (!DICT[lang]) lang = 'zh';

  /** 取当前语言文案 */
  window.t = key => DICT[lang][key];

  /** 应用语言到所有静态标记元素 + 按钮自身 */
  window.applyLang = function (l) {
    if (l && DICT[l]) { lang = l; localStorage.setItem('m2m_lang', l); }
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = DICT[lang].appTitle;
    document.querySelectorAll('[data-i18n]').forEach(n => {
      const v = DICT[lang][n.dataset.i18n];
      if (typeof v === 'string') n.textContent = v;
    });
    document.getElementById('btnLang').textContent = lang === 'zh' ? 'EN' : '中文';
  };

  document.getElementById('btnLang').addEventListener('click', () => {
    applyLang(lang === 'zh' ? 'en' : 'zh');
    if (window.__onLangChange) window.__onLangChange(); // 刷新动态状态文案
  });
  applyLang();
})();
