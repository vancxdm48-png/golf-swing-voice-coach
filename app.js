const cameraFeed = document.querySelector("#cameraFeed");
const playback = document.querySelector("#playback");
const overlayCanvas = document.querySelector("#overlayCanvas");
const analysisCanvas = document.querySelector("#analysisCanvas");
const startCameraBtn = document.querySelector("#startCameraBtn");
const recordBtn = document.querySelector("#recordBtn");
const stopBtn = document.querySelector("#stopBtn");
const uploadVideo = document.querySelector("#uploadVideo");
const diagnoseBtn = document.querySelector("#diagnoseBtn");
const speakBtn = document.querySelector("#speakBtn");
const stopSpeakBtn = document.querySelector("#stopSpeakBtn");
const slowBtn = document.querySelector("#slowBtn");
const normalBtn = document.querySelector("#normalBtn");
const backFrameBtn = document.querySelector("#backFrameBtn");
const nextFrameBtn = document.querySelector("#nextFrameBtn");
const cameraStatus = document.querySelector("#cameraStatus");
const diagnosisMode = document.querySelector("#diagnosisMode");
const countdown = document.querySelector("#countdown");
const adviceText = document.querySelector("#adviceText");
const scoreValue = document.querySelector("#scoreValue");
const scoreNote = document.querySelector("#scoreNote");
const stabilityMeter = document.querySelector("#stabilityMeter");
const stabilityValue = document.querySelector("#stabilityValue");
const swayMeter = document.querySelector("#swayMeter");
const swayValue = document.querySelector("#swayValue");
const tempoMeter = document.querySelector("#tempoMeter");
const tempoValue = document.querySelector("#tempoValue");
const confidenceMeter = document.querySelector("#confidenceMeter");
const confidenceValue = document.querySelector("#confidenceValue");
const practicePlan = document.querySelector("#practicePlan");
const historyList = document.querySelector("#historyList");
const clearHistoryBtn = document.querySelector("#clearHistoryBtn");
const cameraSelect = document.querySelector("#cameraSelect");
const durationSelect = document.querySelector("#durationSelect");
const retakeBtn = document.querySelector("#retakeBtn");
const evidenceList = document.querySelector("#evidenceList");
const qualityGrid = document.querySelector("#qualityGrid");
const exportReportBtn = document.querySelector("#exportReportBtn");
const copyReportBtn = document.querySelector("#copyReportBtn");
const installBtn = document.querySelector("#installBtn");

const agentCards = {
  capture: document.querySelector("#captureAgent"),
  motion: document.querySelector("#motionAgent"),
  coach: document.querySelector("#coachAgent"),
  practice: document.querySelector("#practiceAgent"),
};

const state = {
  stream: null,
  recorder: null,
  chunks: [],
  frames: [],
  previousFrame: null,
  poseFrames: [],
  currentPose: null,
  poseEngine: {
    ready: false,
    loading: false,
    failed: false,
    landmarker: null,
  },
  recording: false,
  recordedUrl: "",
  sourceMode: "none",
  lastAdvice: "",
  lastReport: null,
  deferredInstallPrompt: null,
  overlayRaf: 0,
  analysisRaf: 0,
  autoStopTimer: 0,
  recordingStartedAt: 0,
  sessionHistory: loadHistory(),
};

const statusLabels = {
  idle: "カメラ未接続",
  ready: "撮影できます",
  recording: "録画中",
  playback: "録画を確認中",
  error: "確認が必要",
};

function setStatus(mode, text = statusLabels[mode]) {
  cameraStatus.textContent = text;
  cameraStatus.className = `status-pill ${mode === "ready" ? "ready" : ""} ${
    mode === "recording" ? "recording" : ""
  }`;
}

function setDiagnosisMode(mode, text) {
  diagnosisMode.textContent = text;
  diagnosisMode.className = `mode-pill ${mode}`;
}

function setAgent(key, status, text) {
  const card = agentCards[key];
  card.className = `agent-card ${status}`;
  card.querySelector("span").textContent = text;
}

function resetAgents() {
  setAgent("capture", "", "待機中");
  setAgent("motion", "", "待機中");
  setAgent("coach", "", "待機中");
  setAgent("practice", "", "待機中");
}

function getViewMode() {
  return document.querySelector("input[name='viewMode']:checked").value;
}

function selectedIssues() {
  return [...document.querySelectorAll(".issue-check:checked")].map(
    (input) => input.value,
  );
}

function enabledGuides() {
  return new Set(
    [...document.querySelectorAll(".guide-toggle:checked")].map((input) => input.value),
  );
}

async function startCamera() {
  try {
    if (state.stream) {
      state.stream.getTracks().forEach((track) => track.stop());
    }

    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: cameraSelect.value,
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });

    cameraFeed.srcObject = state.stream;
    await cameraFeed.play();
    switchToCamera();
    recordBtn.disabled = false;
    startCameraBtn.textContent = "1 カメラ再接続";
    setStatus("ready");
    setDiagnosisMode("", "手動ガイドのみ");
    adviceText.textContent =
      "カメラを固定して、全身とクラブが入る位置で1スイングを録画してください。";
    startOverlayLoop();
  } catch (error) {
    setStatus("error", "カメラ許可が必要");
    setDiagnosisMode("error", "動画読込に切替可");
    adviceText.textContent =
      "カメラを開始できませんでした。ブラウザのカメラ許可を確認するか、手元のスイング動画を読み込んで診断してください。";
  }
}

function switchToCamera() {
  playback.pause();
  playback.classList.remove("active");
  cameraFeed.classList.add("active");
}

function switchToPlayback() {
  cameraFeed.classList.remove("active");
  playback.classList.add("active");
  enablePlaybackTools(true);
}

function enablePlaybackTools(enabled) {
  slowBtn.disabled = !enabled;
  normalBtn.disabled = !enabled;
  backFrameBtn.disabled = !enabled;
  nextFrameBtn.disabled = !enabled;
}

async function startRecording() {
  if (!state.stream || state.recording) return;

  await runCountdown();
  state.chunks = [];
  state.frames = [];
  state.poseFrames = [];
  state.currentPose = null;
  state.previousFrame = null;
  state.recording = true;
  state.recordingStartedAt = performance.now();
  resetAgents();

  const mimeType = pickMimeType();
  state.recorder = new MediaRecorder(state.stream, mimeType ? { mimeType } : {});

  state.recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) state.chunks.push(event.data);
  });

  state.recorder.addEventListener("stop", finishRecording);
  state.recorder.start(150);

  recordBtn.disabled = true;
  stopBtn.disabled = false;
  diagnoseBtn.disabled = true;
  speakBtn.disabled = true;
  stopSpeakBtn.disabled = true;
  setStatus("recording");
  setDiagnosisMode("active", "自動解析準備中");
  startAnalysisLoop();

  const maxDuration = Number(durationSelect.value);
  if (maxDuration > 0) {
    clearTimeout(state.autoStopTimer);
    state.autoStopTimer = setTimeout(stopRecording, maxDuration * 1000);
  }
}

function pickMimeType() {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function stopRecording() {
  if (!state.recorder || state.recorder.state === "inactive") return;
  state.recorder.stop();
  state.recording = false;
  cancelAnimationFrame(state.analysisRaf);
  clearTimeout(state.autoStopTimer);
  stopBtn.disabled = true;
}

function finishRecording() {
  if (state.recordedUrl) URL.revokeObjectURL(state.recordedUrl);
  const blob = new Blob(state.chunks, { type: state.recorder.mimeType });
  state.recordedUrl = URL.createObjectURL(blob);
  state.sourceMode = "recorded";
  playback.src = state.recordedUrl;
  switchToPlayback();

  recordBtn.disabled = false;
  diagnoseBtn.disabled = false;
  retakeBtn.disabled = false;
  setStatus("playback");
  setDiagnosisMode("", "診断待ち");
  adviceText.textContent =
    "録画できました。これから自動で診断します。";
  setTimeout(() => {
    if (!diagnoseBtn.disabled) diagnoseSwing();
  }, 150);
}

function handleVideoUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (state.recordedUrl) URL.revokeObjectURL(state.recordedUrl);
  state.recordedUrl = URL.createObjectURL(file);
  state.sourceMode = "uploaded";
  state.frames = [];
  state.poseFrames = [];
  state.currentPose = null;
  state.previousFrame = null;
  playback.src = state.recordedUrl;
  playback.playbackRate = 1;
  switchToPlayback();
  diagnoseBtn.disabled = false;
  retakeBtn.disabled = false;
  speakBtn.disabled = true;
  stopSpeakBtn.disabled = true;
  setStatus("playback", "動画読込済み");
  setDiagnosisMode("", "診断待ち");
  resetAgents();
  adviceText.textContent =
    "動画を読み込みました。再生、コマ送り、ガイド線で確認し、診断を押してください。";
}

function runCountdown() {
  const steps = ["3", "2", "1", "Swing"];
  return new Promise((resolve) => {
    let index = 0;
    countdown.textContent = steps[index];
    const timer = setInterval(() => {
      index += 1;
      if (index >= steps.length) {
        clearInterval(timer);
        countdown.textContent = "";
        resolve();
        return;
      }
      countdown.textContent = steps[index];
    }, 650);
  });
}

function startOverlayLoop() {
  cancelAnimationFrame(state.overlayRaf);
  const ctx = overlayCanvas.getContext("2d");

  function draw() {
    resizeCanvasToElement(overlayCanvas);
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    drawGuides(ctx, overlayCanvas.width, overlayCanvas.height);
    drawMotionTrace(ctx, overlayCanvas.width, overlayCanvas.height);
    drawPoseOverlay(ctx, overlayCanvas.width, overlayCanvas.height);
    state.overlayRaf = requestAnimationFrame(draw);
  }

  draw();
}

function drawGuides(ctx, width, height) {
  const guides = enabledGuides();
  const viewMode = getViewMode();
  const centerX = width * 0.5;
  const headY = height * 0.21;
  const shoulderY = height * 0.37;
  const hipY = height * 0.56;
  const ballY = height * 0.83;

  ctx.save();
  ctx.lineWidth = Math.max(4, width * 0.006);
  ctx.font = `800 ${Math.max(22, Math.min(42, width * 0.028))}px system-ui, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.88)";

  if (guides.has("ball")) {
    ctx.strokeStyle = "rgba(255,255,255,0.72)";
    ctx.setLineDash([16, 14]);
    ctx.beginPath();
    ctx.moveTo(width * 0.08, ballY);
    ctx.lineTo(width * 0.92, ballY);
    ctx.stroke();
    ctx.setLineDash([]);
    drawLabel(ctx, "ボール", width * 0.08, ballY - height * 0.06);
  }

  if (guides.has("head")) {
    ctx.strokeStyle = "rgba(64, 207, 143, 0.82)";
    ctx.strokeRect(
      centerX - width * 0.08,
      headY - height * 0.055,
      width * 0.16,
      height * 0.11,
    );
    drawLabel(ctx, "頭ゾーン", centerX - width * 0.08, headY - height * 0.085);
  }

  if (guides.has("spine")) {
    ctx.strokeStyle = "rgba(255, 208, 92, 0.9)";
    ctx.beginPath();
    if (viewMode === "face") {
      ctx.moveTo(centerX, headY + height * 0.03);
      ctx.lineTo(centerX, hipY);
    } else {
      ctx.moveTo(centerX - width * 0.11, headY + height * 0.04);
      ctx.lineTo(centerX + width * 0.04, hipY);
    }
    ctx.stroke();
    drawLabel(ctx, viewMode === "face" ? "中心軸" : "前傾", centerX + width * 0.035, hipY - height * 0.05);
  }

  if (guides.has("shoulderHip")) {
    ctx.strokeStyle = "rgba(107, 190, 255, 0.86)";
    ctx.beginPath();
    ctx.moveTo(centerX - width * 0.18, shoulderY);
    ctx.lineTo(centerX + width * 0.18, shoulderY + (viewMode === "face" ? 0 : height * 0.04));
    ctx.moveTo(centerX - width * 0.15, hipY);
    ctx.lineTo(centerX + width * 0.15, hipY + (viewMode === "face" ? 0 : height * 0.03));
    ctx.stroke();
    drawLabel(ctx, "肩", centerX + width * 0.19, shoulderY + height * 0.02);
    drawLabel(ctx, "腰", centerX + width * 0.16, hipY + height * 0.035);
  }

  ctx.restore();
}

function drawLabel(ctx, text, x, y) {
  const metrics = ctx.measureText(text);
  const paddingX = 12;
  const paddingY = 8;
  const sizeMatch = ctx.font.match(/(\d+(?:\.\d+)?)px/);
  const fontSize = sizeMatch ? Number(sizeMatch[1]) : 24;
  const height = fontSize + paddingY * 2;
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
  ctx.fillRect(x - paddingX, y - height + paddingY, metrics.width + paddingX * 2, height);
  ctx.fillStyle = "rgba(255, 255, 255, 0.98)";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawMotionTrace(ctx, width, height) {
  if (state.frames.length < 2) return;
  const recent = state.frames.slice(-45).filter((frame) => frame.energy > 4);
  if (recent.length < 2) return;

  ctx.save();
  ctx.lineWidth = Math.max(2, width * 0.004);
  ctx.strokeStyle = "rgba(65, 151, 255, 0.86)";
  ctx.beginPath();
  recent.forEach((frame, index) => {
    const x = frame.cx * width;
    const y = frame.cy * height;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  const last = recent[recent.length - 1];
  ctx.fillStyle = "rgba(65, 151, 255, 0.95)";
  ctx.beginPath();
  ctx.arc(last.cx * width, last.cy * height, Math.max(5, width * 0.009), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPoseOverlay(ctx, width, height) {
  if (!state.currentPose?.length) return;
  const pairs = [
    [11, 12],
    [11, 13],
    [13, 15],
    [12, 14],
    [14, 16],
    [11, 23],
    [12, 24],
    [23, 24],
    [23, 25],
    [25, 27],
    [24, 26],
    [26, 28],
  ];

  ctx.save();
  ctx.lineWidth = Math.max(3, width * 0.004);
  ctx.strokeStyle = "rgba(31, 220, 150, 0.92)";
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  for (const [a, b] of pairs) {
    const p1 = state.currentPose[a];
    const p2 = state.currentPose[b];
    if (!isVisiblePoint(p1) || !isVisiblePoint(p2)) continue;
    ctx.beginPath();
    ctx.moveTo(p1.x * width, p1.y * height);
    ctx.lineTo(p2.x * width, p2.y * height);
    ctx.stroke();
  }

  for (const point of state.currentPose) {
    if (!isVisiblePoint(point)) continue;
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, Math.max(3, width * 0.005), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function isVisiblePoint(point) {
  return point && (point.visibility == null || point.visibility > 0.45);
}

function resizeCanvasToElement(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const nextWidth = Math.max(1, Math.round(rect.width * ratio));
  const nextHeight = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }
}

function startAnalysisLoop() {
  const ctx = analysisCanvas.getContext("2d", { willReadFrequently: true });
  analysisCanvas.width = 192;
  analysisCanvas.height = 108;

  function analyze() {
    if (!state.recording) return;
    if (cameraFeed.readyState >= 2) {
      captureMotionFrameFromMedia(cameraFeed, ctx, performance.now() - state.recordingStartedAt);
    }
    state.analysisRaf = requestAnimationFrame(analyze);
  }

  analyze();
}

function captureMotionFrameFromMedia(media, ctx, elapsedMs) {
  ctx.drawImage(media, 0, 0, analysisCanvas.width, analysisCanvas.height);
  const imageData = ctx.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height);
  const frame = extractMotionFrame(imageData, elapsedMs / 1000);
  if (frame) state.frames.push(frame);
}

function extractMotionFrame(imageData, timeSec) {
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  const gray = new Uint8ClampedArray(width * height);

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    gray[p] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  }

  if (!state.previousFrame) {
    state.previousFrame = gray;
    return null;
  }

  let total = 0;
  let weightedX = 0;
  let weightedY = 0;
  let activePixels = 0;

  for (let p = 0; p < gray.length; p += 2) {
    const diff = Math.abs(gray[p] - state.previousFrame[p]);
    if (diff > 18) {
      const x = p % width;
      const y = Math.floor(p / width);
      total += diff;
      weightedX += x * diff;
      weightedY += y * diff;
      activePixels += 1;
    }
  }

  state.previousFrame = gray;

  if (activePixels < 16) return null;
  return {
    t: timeSec,
    cx: weightedX / total / width,
    cy: weightedY / total / height,
    energy: Math.min(100, total / 12000),
  };
}

async function ensurePoseEngine() {
  if (state.poseEngine.ready || state.poseEngine.loading) return state.poseEngine.ready;
  state.poseEngine.loading = true;
  setDiagnosisMode("active", "AI姿勢推定を準備中");

  try {
    const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14");
    const filesetResolver = await vision.FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
    );
    state.poseEngine.landmarker = await vision.PoseLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
    });
    state.poseEngine.ready = true;
    state.poseEngine.failed = false;
  } catch (error) {
    state.poseEngine.failed = true;
    state.poseEngine.ready = false;
  } finally {
    state.poseEngine.loading = false;
  }

  return state.poseEngine.ready;
}

function capturePoseFrameFromMedia(media, timeSec) {
  if (!state.poseEngine.ready || !state.poseEngine.landmarker) return null;
  try {
    const result = state.poseEngine.landmarker.detectForVideo(media, Math.round(timeSec * 1000));
    const landmarks = result.landmarks?.[0];
    if (!landmarks?.length) return null;
    const visible = landmarks.filter(isVisiblePoint).length;
    const poseFrame = {
      t: timeSec,
      landmarks,
      confidence: Math.round((visible / landmarks.length) * 100),
      angles: calculatePoseAngles(landmarks),
    };
    state.currentPose = landmarks;
    state.poseFrames.push(poseFrame);
    return poseFrame;
  } catch {
    return null;
  }
}

function calculatePoseAngles(landmarks) {
  const shoulder = midpoint(landmarks[11], landmarks[12]);
  const hip = midpoint(landmarks[23], landmarks[24]);
  const leftKnee = angleAt(landmarks[23], landmarks[25], landmarks[27]);
  const rightKnee = angleAt(landmarks[24], landmarks[26], landmarks[28]);
  const shoulderTilt = lineAngle(landmarks[11], landmarks[12]);
  const hipTilt = lineAngle(landmarks[23], landmarks[24]);
  const spineLean = lineAngle(hip, shoulder);

  return {
    leftKnee,
    rightKnee,
    shoulderTilt,
    hipTilt,
    spineLean,
  };
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z || 0) + (b.z || 0)) / 2,
    visibility: Math.min(a.visibility || 1, b.visibility || 1),
  };
}

function lineAngle(a, b) {
  if (!a || !b) return 0;
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

function angleAt(a, b, c) {
  if (!a || !b || !c) return 0;
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const mag = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if (!mag) return 0;
  return Math.round((Math.acos(clamp(dot / mag, -1, 1)) * 180) / Math.PI);
}

async function analyzePlaybackVideo() {
  if (!playback.src) return;
  await waitForVideoReady(playback);
  const poseReady = await ensurePoseEngine();

  const ctx = analysisCanvas.getContext("2d", { willReadFrequently: true });
  analysisCanvas.width = 192;
  analysisCanvas.height = 108;
  const originalTime = playback.currentTime;
  const wasPaused = playback.paused;
  playback.pause();
  state.frames = [];
  state.poseFrames = [];
  state.currentPose = null;
  state.previousFrame = null;

  const duration = Math.min(Number.isFinite(playback.duration) ? playback.duration : 4, 8);
  const samples = 42;
  for (let index = 0; index < samples; index += 1) {
    await seekVideo(playback, (duration * index) / Math.max(1, samples - 1));
    captureMotionFrameFromMedia(playback, ctx, playback.currentTime * 1000);
    if (poseReady) capturePoseFrameFromMedia(playback, playback.currentTime);
  }

  playback.currentTime = Math.min(originalTime, playback.duration || originalTime);
  if (!wasPaused) playback.play();
}

function waitForVideoReady(video) {
  if (video.readyState >= 1 && Number.isFinite(video.duration)) return Promise.resolve();
  return new Promise((resolve) => {
    video.addEventListener("loadedmetadata", resolve, { once: true });
  });
}

function seekVideo(video, time) {
  const nextTime = clamp(time, 0, Number.isFinite(video.duration) ? video.duration : time);
  if (Math.abs(video.currentTime - nextTime) < 0.005) return Promise.resolve();

  video.currentTime = nextTime;
  return new Promise((resolve) => {
    const fallback = setTimeout(resolve, 350);
    video.addEventListener(
      "seeked",
      () => {
        clearTimeout(fallback);
        resolve();
      },
      { once: true },
    );
  });
}

async function diagnoseSwing() {
  diagnoseBtn.disabled = true;
  resetAgents();
  setDiagnosisMode("active", "自動解析中");
  setAgent("capture", "working", "映像と撮影条件を確認中");
  adviceText.textContent = "AIエージェントがスイングを確認しています。";

  if (playback.src) {
    await analyzePlaybackVideo();
  }

  const metrics = calculateMetrics();
  setAgent("capture", "done", metrics.hasMotion ? "動き検出あり" : "動きが少なめ");
  setAgent("motion", "working", "左右ブレ、上下ブレ、テンポを確認中");

  const issues = selectedIssues();
  const result = runAgentPipeline(metrics, issues);
  renderResult(result);
  saveSession(result);

  setAgent("motion", "done", `左右ブレ:${result.swayCmLike} / テンポ:${result.tempoLabel}`);
  setAgent("coach", "done", "音声コメントを作成済み");
  setAgent("practice", "done", "次回課題を1つに整理済み");
  setDiagnosisMode(result.autoAnalyzed ? "active" : "error", result.autoAnalyzed ? "自動解析完了" : "手動ガイド中心");
  diagnoseBtn.disabled = false;
  speakAdvice();
}

function calculateMetrics() {
  const usefulFrames = state.frames.filter((frame) => frame.energy > 4);
  const poseMetrics = calculatePoseMetrics();
  if (usefulFrames.length < 8) {
    return {
      hasMotion: poseMetrics.hasPose,
      lateralRange: 0.18,
      verticalRange: 0.14,
      energyPeakAt: 0.55,
      energyBurst: 40,
      frameCount: usefulFrames.length,
      ...poseMetrics,
    };
  }

  const xs = usefulFrames.map((frame) => frame.cx);
  const ys = usefulFrames.map((frame) => frame.cy);
  const energies = usefulFrames.map((frame) => frame.energy);
  const peakIndex = energies.indexOf(Math.max(...energies));
  const totalDuration = usefulFrames[usefulFrames.length - 1].t - usefulFrames[0].t || 1;
  const peakAt = (usefulFrames[peakIndex].t - usefulFrames[0].t) / totalDuration;

  return {
    hasMotion: true,
    lateralRange: Math.max(...xs) - Math.min(...xs),
    verticalRange: Math.max(...ys) - Math.min(...ys),
    energyPeakAt: Math.min(1, Math.max(0, peakAt)),
    energyBurst: Math.max(...energies),
    frameCount: usefulFrames.length,
    ...poseMetrics,
  };
}

function calculatePoseMetrics() {
  const frames = state.poseFrames.filter((frame) => frame.confidence >= 45);
  if (frames.length < 5) {
    return {
      hasPose: false,
      confidence: state.poseEngine.failed ? 35 : 52,
      headRange: null,
      hipRange: null,
      spineChange: null,
      kneeMin: null,
      analysisMethod: state.poseEngine.failed ? "簡易解析" : "簡易解析",
    };
  }

  const noses = frames.map((frame) => frame.landmarks[0]).filter(isVisiblePoint);
  const hips = frames.map((frame) => midpoint(frame.landmarks[23], frame.landmarks[24]));
  const spineAngles = frames.map((frame) => frame.angles.spineLean);
  const kneeAngles = frames.flatMap((frame) => [frame.angles.leftKnee, frame.angles.rightKnee]).filter(Boolean);
  const confidence = Math.round(
    frames.reduce((total, frame) => total + frame.confidence, 0) / frames.length,
  );

  return {
    hasPose: true,
    confidence,
    headRange: rangeOf(noses, "x"),
    hipRange: rangeOf(hips, "x"),
    spineChange: rangeOf(spineAngles),
    kneeMin: Math.min(...kneeAngles),
    analysisMethod: "AI姿勢推定",
  };
}

function rangeOf(values, key) {
  const nums = values
    .map((value) => (key ? value?.[key] : value))
    .filter((value) => Number.isFinite(value));
  if (!nums.length) return null;
  return Math.max(...nums) - Math.min(...nums);
}

function runAgentPipeline(metrics, issues) {
  const motion = motionAgent(metrics);
  const coach = coachAgent(motion, issues);
  const practice = practiceAgent(coach);
  return {
    ...coach,
    ...practice,
    stability: motion.stability,
    swayScore: motion.swayScore,
    swayCmLike: motion.swayCmLike,
    tempoScore: motion.tempoScore,
    tempoLabel: motion.tempoLabel,
    confidence: motion.confidence,
    analysisMethod: motion.analysisMethod,
    evidence: coach.evidence,
    quality: motion.quality,
    autoAnalyzed: metrics.hasMotion,
  };
}

function motionAgent(metrics) {
  const lateralSource = metrics.hasPose && metrics.headRange != null ? metrics.headRange : metrics.lateralRange;
  const verticalPenalty = clamp(Math.round(metrics.verticalRange * 120), 0, 22);
  const lateralPenalty = clamp(Math.round(lateralSource * (metrics.hasPose ? 260 : 190)), 0, 34);
  const tempoPenalty = Math.abs(metrics.energyPeakAt - 0.58) > 0.22 ? 14 : 4;
  const posturePenalty =
    metrics.hasPose && metrics.spineChange != null ? clamp(Math.round(metrics.spineChange / 4), 0, 14) : 0;
  const stability = clamp(100 - lateralPenalty - verticalPenalty, 0, 100);
  const swayScore = clamp(Math.round(lateralSource * (metrics.hasPose ? 360 : 240)), 0, 100);
  const tempoScore = clamp(100 - tempoPenalty * 4, 0, 100);
  const confidence = clamp(metrics.confidence || (metrics.hasMotion ? 58 : 35), 0, 100);

  return {
    lateralPenalty,
    verticalPenalty,
    tempoPenalty,
    posturePenalty,
    stability,
    swayScore,
    swayCmLike: swayScore < 32 ? "小" : swayScore < 66 ? "中" : "大",
    tempoScore,
    tempoLabel: tempoScore > 80 ? "良" : tempoScore > 58 ? "やや速い" : "速い",
    hasMotion: metrics.hasMotion,
    hasPose: metrics.hasPose,
    confidence,
    analysisMethod: metrics.analysisMethod,
    quality: {
      body: metrics.hasPose ? `${confidence}%` : "未検出",
      method: metrics.analysisMethod,
      duration: playback.duration && Number.isFinite(playback.duration) ? `${playback.duration.toFixed(1)}秒` : "--",
      compare: state.sessionHistory.length ? "前回履歴あり" : "初回",
    },
    pose: {
      headRange: metrics.headRange,
      hipRange: metrics.hipRange,
      spineChange: metrics.spineChange,
      kneeMin: metrics.kneeMin,
    },
  };
}

function coachAgent(motion, issues) {
  const club = document.querySelector("#clubSelect").value;
  const goal = document.querySelector("#levelSelect").value;
  const viewMode = getViewMode();
  const manualPenalty = issues.length * 7;
  const score = clamp(
    92 -
      motion.lateralPenalty -
      motion.verticalPenalty -
      motion.tempoPenalty -
      motion.posturePenalty -
      manualPenalty,
    38,
    96,
  );

  const points = [];
  const priorities = [];
  const evidence = [
    `解析方式: ${motion.analysisMethod}`,
    `信頼度: ${motion.confidence}%`,
    `左右ブレ判定: ${motion.swayCmLike}`,
    `テンポ判定: ${motion.tempoLabel}`,
  ];

  if (!motion.hasMotion && !motion.hasPose) {
    points.push("自動検出が少ないため、今回は手動ガイド中心の参考診断です。次回は全身とクラブが大きく映る距離で撮影してください。");
    priorities.push("全身とクラブが入る位置にカメラを固定して再撮影");
    evidence.push("動体検出または姿勢検出が少ないため、撮影条件の影響が大きい可能性があります。");
  }
  if (motion.hasPose && motion.pose.spineChange != null) {
    evidence.push(`前傾変化の目安: ${motion.pose.spineChange.toFixed(1)}度`);
  }
  if (motion.hasPose && motion.pose.kneeMin != null) {
    evidence.push(`膝角度の最小値: ${Math.round(motion.pose.kneeMin)}度`);
  }
  if (motion.swayScore > 48 || issues.includes("sway")) {
    points.push(
      viewMode === "face"
        ? "頭と胸が右に流れやすい可能性があります。右股関節に体重を乗せても、頭は画面中央の枠内に残す意識が有効です。"
        : "後方から見ると体の中心が前後に動きやすい可能性があります。つま先側へ突っ込まず、かかと寄りの圧を残して回ってください。",
    );
    priorities.push("頭の許容ゾーンから出ない範囲でハーフスイング");
  }
  if (motion.stability < 68 || motion.posturePenalty > 8 || issues.includes("earlyExtend")) {
    points.push("インパクト付近で上体が伸びる可能性があります。骨盤の前傾を保ち、左のお尻を後ろへ引く意識を入れてください。");
    priorities.push("フィニッシュまで前傾を保つ素振りを5回");
  }
  if (motion.tempoScore < 78 || issues.includes("fastTempo")) {
    points.push("切り返しのテンポが急ぎやすい可能性があります。左足を踏んでから腕が下りる順番を作ると安定します。");
    priorities.push("トップから左足を踏むだけのゆっくり素振りを5回");
  }
  if (issues.includes("handFloat")) {
    points.push("手元が浮きやすい自己申告があります。インパクトでグリップを体から遠ざけず、左太ももの前を低く通すイメージで素振りしてください。");
    priorities.push("左太ももの前を低く通す片手素振り");
  }
  if (points.length === 0) {
    points.push("全体の動きは大きく崩れていません。次は同じテンポで、フィニッシュを2秒止められるかを確認してください。");
    priorities.push("同じテンポで3球連続フィニッシュを止める");
  }

  const clubTip = {
    driver: "ドライバーでは、横ブレを抑えるほど打点と打ち出しが安定します。",
    fairway: "フェアウェイウッドでは、上から打ち込みすぎず体の回転で低く長く抜く意識が合います。",
    iron: "アイアンでは、最下点をボールの少し先に置くために前傾と左足荷重を保つことが重要です。",
    wedge: "ウェッジでは、大きな体重移動より胸の向きと距離感の再現性を優先してください。",
  }[club];

  const goalTip = {
    stable: "まずは芯に当たる再現性を優先しましょう。",
    distance: "飛距離を狙う日は、力感よりも切り返しの順番を整える方がヘッドスピードに繋がります。",
    slice: "スライス対策では、体が開く前にクラブが下りる余裕を作ることが大切です。",
    hook: "左へのミス対策では、手で返す量を減らして胸の回転でフェースを管理しましょう。",
  }[goal];

  const summary =
    score >= 80 ? "大きな崩れは少なめ" : score >= 65 ? "改善ポイントあり" : "撮影条件と動きを再確認";
  const advice = `${points.join(" ")} ${clubTip} ${goalTip}`;

  return {
    score,
    summary,
    advice,
    spokenAdvice: `診断結果は${score}点です。${advice}`,
    priority: priorities[0],
    evidence,
  };
}

function practiceAgent(coach) {
  const history = state.sessionHistory;
  const previous = history[0];
  const comparison = previous
    ? coach.score > previous.score
      ? `前回より${coach.score - previous.score}点改善しています。`
      : coach.score < previous.score
        ? `前回より${previous.score - coach.score}点下がっています。撮影条件も確認してください。`
        : "前回と同じスコアです。課題を1つに絞ると変化を見やすくなります。"
    : "今回が最初の記録です。次回は同じ撮影位置で比較します。";

  return {
    comparison,
    plan: [
      coach.priority,
      "同じ位置からもう一度撮影",
      "スコアよりも左右ブレとテンポの変化を見る",
    ],
  };
}

function renderResult(result) {
  stabilityMeter.value = result.stability;
  stabilityValue.textContent = `${result.stability}`;
  swayMeter.value = result.swayScore;
  swayValue.textContent = result.swayCmLike;
  tempoMeter.value = result.tempoScore;
  tempoValue.textContent = result.tempoLabel;
  confidenceMeter.value = result.confidence;
  confidenceValue.textContent = `${result.confidence}`;
  scoreValue.textContent = result.score;
  scoreNote.textContent = `${result.summary} / ${result.comparison}`;
  adviceText.textContent = result.advice;
  practicePlan.innerHTML = result.plan.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  evidenceList.innerHTML = result.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  qualityGrid.innerHTML = [
    `全身検出: ${result.quality.body}`,
    `解析方式: ${result.quality.method}`,
    `動画長さ: ${result.quality.duration}`,
    `比較条件: ${result.quality.compare}`,
  ]
    .map((item) => `<span>${escapeHtml(item)}</span>`)
    .join("");
  state.lastAdvice = result.spokenAdvice;
  state.lastReport = {
    createdAt: new Date().toISOString(),
    score: result.score,
    summary: result.summary,
    advice: result.advice,
    evidence: result.evidence,
    practicePlan: result.plan,
    metrics: {
      stability: result.stability,
      sway: result.swayCmLike,
      tempo: result.tempoLabel,
      confidence: result.confidence,
      analysisMethod: result.analysisMethod,
    },
  };
  speakBtn.disabled = false;
  stopSpeakBtn.disabled = false;
  exportReportBtn.disabled = false;
  copyReportBtn.disabled = false;
}

function saveSession(result) {
  const entry = {
    score: result.score,
    summary: result.summary,
    sway: result.swayCmLike,
    tempo: result.tempoLabel,
    confidence: result.confidence,
    method: result.analysisMethod,
    advice: result.advice,
    plan: result.plan,
    date: new Date().toLocaleString("ja-JP", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
  state.sessionHistory = [entry, ...state.sessionHistory].slice(0, 5);
  safeSetStorage("golfSwingVoiceCoachHistory", JSON.stringify(state.sessionHistory));
  renderHistory();
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem("golfSwingVoiceCoachHistory")) || [];
  } catch {
    return [];
  }
}

function renderHistory() {
  if (!state.sessionHistory.length) {
    historyList.textContent = "まだ履歴がありません";
    return;
  }

  historyList.innerHTML = state.sessionHistory
    .map(
      (item) =>
        `<div class="history-item">${escapeHtml(item.date)} / ${item.score}点 / 左右ブレ:${escapeHtml(
          item.sway,
        )} / テンポ:${escapeHtml(item.tempo)} / ${escapeHtml(item.method || "簡易解析")}</div>`,
    )
    .join("");
}

function clearHistory() {
  state.sessionHistory = [];
  safeRemoveStorage("golfSwingVoiceCoachHistory");
  renderHistory();
}

function retake() {
  stopSpeaking();
  switchToCamera();
  diagnoseBtn.disabled = true;
  retakeBtn.disabled = true;
  exportReportBtn.disabled = true;
  copyReportBtn.disabled = true;
  setDiagnosisMode("", "再撮影待ち");
  adviceText.textContent = "同じ位置で再撮影してください。前回と比較しやすくなります。";
}

function safeSetStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    setStatus("error", "履歴保存不可");
  }
}

function safeRemoveStorage(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    setStatus("error", "履歴削除不可");
  }
}

function exportReport() {
  if (!state.lastReport) return;
  const blob = new Blob([JSON.stringify(state.lastReport, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `golf-swing-report-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function copyReport() {
  if (!state.lastReport) return;
  const report = [
    `診断スコア: ${state.lastReport.score}`,
    `要約: ${state.lastReport.summary}`,
    `解析方式: ${state.lastReport.metrics.analysisMethod}`,
    `信頼度: ${state.lastReport.metrics.confidence}`,
    `助言: ${state.lastReport.advice}`,
    `次回課題: ${state.lastReport.practicePlan.join(" / ")}`,
  ].join("\n");

  try {
    await navigator.clipboard.writeText(report);
    setStatus("ready", "レポートコピー済み");
  } catch {
    setStatus("error", "コピー不可");
  }
}

function setPlaybackRate(rate) {
  playback.playbackRate = rate;
}

function stepFrame(direction) {
  playback.pause();
  const frame = 1 / 30;
  playback.currentTime = clamp(playback.currentTime + frame * direction, 0, playback.duration || 0);
}

function speakAdvice() {
  if (!state.lastAdvice || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(state.lastAdvice);
  utterance.lang = "ja-JP";
  utterance.rate = 0.95;
  utterance.pitch = 1;
  const voice = window.speechSynthesis
    .getVoices()
    .find((candidate) => candidate.lang.toLowerCase().startsWith("ja"));
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

function stopSpeaking() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function handleVisibility() {
  if (document.hidden) stopSpeaking();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return map[char];
  });
}

startCameraBtn.addEventListener("click", startCamera);
recordBtn.addEventListener("click", startRecording);
stopBtn.addEventListener("click", stopRecording);
uploadVideo.addEventListener("change", handleVideoUpload);
diagnoseBtn.addEventListener("click", diagnoseSwing);
speakBtn.addEventListener("click", speakAdvice);
stopSpeakBtn.addEventListener("click", stopSpeaking);
slowBtn.addEventListener("click", () => setPlaybackRate(0.5));
normalBtn.addEventListener("click", () => setPlaybackRate(1));
backFrameBtn.addEventListener("click", () => stepFrame(-1));
nextFrameBtn.addEventListener("click", () => stepFrame(1));
clearHistoryBtn.addEventListener("click", clearHistory);
retakeBtn.addEventListener("click", retake);
exportReportBtn.addEventListener("click", exportReport);
copyReportBtn.addEventListener("click", copyReport);
cameraSelect.addEventListener("change", () => {
  if (state.stream) startCamera();
});
document.addEventListener("visibilitychange", handleVisibility);
window.addEventListener("resize", startOverlayLoop);
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.deferredInstallPrompt = event;
  installBtn.hidden = false;
});
installBtn.addEventListener("click", async () => {
  if (!state.deferredInstallPrompt) return;
  state.deferredInstallPrompt.prompt();
  await state.deferredInstallPrompt.userChoice;
  state.deferredInstallPrompt = null;
  installBtn.hidden = true;
});
document.querySelectorAll("input[name='viewMode'], .guide-toggle").forEach((input) => {
  input.addEventListener("change", startOverlayLoop);
});

if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
  setStatus("error", "録画は非対応");
  setDiagnosisMode("error", "動画読込に切替可");
  adviceText.textContent =
    "このブラウザではカメラ録画が使えない可能性があります。動画読込からスイング動画を選んで診断してください。";
  startCameraBtn.disabled = true;
}

setStatus("idle");
setDiagnosisMode("", "手動ガイドのみ");
enablePlaybackTools(false);
renderHistory();
startOverlayLoop();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
