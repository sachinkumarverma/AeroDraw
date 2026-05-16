const Hands = window.Hands;
const Camera = window.Camera;

const state = {
  activeColor: '#ff00ea',
  thickness: 12,
  cameraOpacity: 0.5,
  strokes: [],
  currentStroke: null,
  smoothPos: null,
  particles: [],
  mode: 'none',
  lastSeenGesture: 'none',
  gestureHysteresis: 0,
  grabStartPos: null,
  lastTwoHandDist: null,
  lastTwoHandMid: null,
  selectedStroke: null,
  width: window.innerWidth,
  height: window.innerHeight,
};

const $ = (id) => document.getElementById(id);
const video = $('input_video');
const feedCanvas = $('feedback-canvas');
const drawCanvas = $('drawing-canvas');
const feedCtx = feedCanvas.getContext('2d');
const drawCtx = drawCanvas.getContext('2d');
const gestureBadge = $('gesture-badge');

function init() {
  resize();
  window.onresize = resize;
  setupUI();
  startAI();
}

function resize() {
  state.width = window.innerWidth;
  state.height = window.innerHeight;
  feedCanvas.width = drawCanvas.width = state.width;
  feedCanvas.height = drawCanvas.height = state.height;
}

function setupUI() {
  document.querySelectorAll('.color-opt').forEach(opt => {
    opt.onclick = () => {
      document.querySelector('.color-opt.active')?.classList.remove('active');
      opt.classList.add('active');
      state.activeColor = opt.dataset.color;
    };
  });
  $('size-slider').oninput = (e) => state.thickness = parseInt(e.target.value);
  $('opacity-slider').oninput = (e) => state.cameraOpacity = parseInt(e.target.value) / 100;
  $('clear-btn').onclick = () => { state.strokes = []; drawCtx.clearRect(0, 0, state.width, state.height); };
  $('save-btn').onclick = () => {
    const temp = document.createElement('canvas');
    temp.width = state.width; temp.height = state.height;
    const ctx = temp.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0,0,temp.width,temp.height);
    ctx.drawImage(drawCanvas, 0, 0);
    const link = document.createElement('a');
    link.download = 'air-draw-pro.png'; link.href = temp.toDataURL(); link.click();
  };
}

function startAI() {
  const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
  hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minHandDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
  hands.onResults(onResults);
  const camera = new Camera(video, { onFrame: async () => await hands.send({ image: video }), width: 1280, height: 720 });
  camera.start().then(() => $('loader').style.display = 'none');
}

function onResults(results) {
  feedCtx.save();
  feedCtx.clearRect(0, 0, state.width, state.height);
  
  // ASPECT COVER
  const sA = state.width / state.height;
  const vA = results.image.width / results.image.height;
  let dW, dH, oW, oH;
  if (sA > vA) { 
    dW = state.width; 
    dH = state.width / vA; 
    oW = 0; 
    oH = (state.height - dH) / 2; 
  } else { 
    dW = state.height * vA; 
    dH = state.height; 
    oW = (state.width - dW) / 2; 
    oH = 0; 
  }

  feedCtx.translate(state.width, 0);
  feedCtx.scale(-1, 1);
  feedCtx.globalAlpha = state.cameraOpacity;
  feedCtx.drawImage(results.image, -oW, oH, dW, dH);
  feedCtx.restore();

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    // TWO HAND ZOOM/PAN - Stability Fix: Require Left+Right AND minimum distance
    if (results.multiHandLandmarks.length === 2 && results.multiHandedness) {
      const labels = results.multiHandedness.map(h => h.label);
      const scores = results.multiHandedness.map(h => h.score);
      const isBothHands = labels.includes('Left') && labels.includes('Right');
      const highConfidence = scores.every(s => s > 0.75);
      
      const h1 = results.multiHandLandmarks[0].map(l => ({ x: (1 - l.x) * dW - oW, y: l.y * dH + oH }));
      const h2 = results.multiHandLandmarks[1].map(l => ({ x: (1 - l.x) * dW - oW, y: l.y * dH + oH }));
      const dist = Math.hypot(h1[9].x - h2[9].x, h1[9].y - h2[9].y);

      if (isBothHands && highConfidence && dist > 100) {
        finalize();
        gestureBadge.innerText = 'ZOOM & PAN';
        
        const p1 = h1[9];
        const p2 = h2[9];
        const mid = { x: (p1.x + p2.x)/2, y: (p1.y + p2.y)/2 };

        if (!state.selectedStroke) state.selectedStroke = findNearestStroke(mid);

        if (state.lastTwoHandDist && state.selectedStroke) {
          const scale = dist / state.lastTwoHandDist;
          const dx = mid.x - state.lastTwoHandMid.x;
          const dy = mid.y - state.lastTwoHandMid.y;

          state.selectedStroke.points.forEach(p => {
            p.x = mid.x + (p.x - mid.x) * scale;
            p.y = mid.y + (p.y - mid.y) * scale;
            p.x += dx; p.y += dy;
          });
          state.selectedStroke.size *= scale;
          render();
        }
        state.lastTwoHandDist = dist;
        state.lastTwoHandMid = mid;
        
        [p1, p2].forEach(p => {
          feedCtx.beginPath(); feedCtx.arc(p.x, p.y, 15, 0, Math.PI*2);
          feedCtx.strokeStyle = '#fff'; feedCtx.lineWidth = 2; feedCtx.stroke();
        });
        return;
      }
    }

    state.lastTwoHandDist = null;
    state.lastTwoHandMid = null;

    const hl = results.multiHandLandmarks[0];
    const mirrored = hl.map(l => ({ 
      x: (1 - l.x) * dW - oW, 
      y: l.y * dH + oH 
    }));
    
    // VIVID SKELETON
    feedCtx.strokeStyle = 'rgba(255,255,255,0.4)';
    feedCtx.lineWidth = 1.5;
    [ [0,1], [1,2], [2,3], [3,4], [0,5], [5,6], [6,7], [7,8], [5,9], [9,10], [10,11], [11,12], [9,13], [13,14], [14,15], [15,16], [13,17], [17,18], [18,19], [19,20], [0,17] ].forEach(([a, b]) => {
      feedCtx.beginPath(); feedCtx.moveTo(mirrored[a].x, mirrored[a].y); feedCtx.lineTo(mirrored[b].x, mirrored[b].y); feedCtx.stroke();
    });

    const palm = { x: (mirrored[0].x + mirrored[9].x) / 2, y: (mirrored[0].y + mirrored[9].y) / 2 };
    
    // GESTURE INDICATORS
    const tip = mirrored[8];
    const pinchPoint = { x: (mirrored[4].x + mirrored[8].x)/2, y: (mirrored[4].y + mirrored[8].y)/2 };

    // INDEX DOT
    feedCtx.beginPath(); feedCtx.arc(tip.x, tip.y, 10, 0, Math.PI*2);
    feedCtx.strokeStyle = state.activeColor; feedCtx.lineWidth = 2; feedCtx.stroke();

    // GESTURE
    const g = detectGesture(hl);
    if (g === state.lastSeenGesture) {
      state.gestureHysteresis++;
      if (state.gestureHysteresis > 4) {
        if (state.mode !== g) { finalize(); state.mode = g; }
      }
    } else {
      state.lastSeenGesture = g;
      state.gestureHysteresis = 0;
    }

    if (state.mode === 'pan') {
      feedCtx.beginPath(); feedCtx.arc(pinchPoint.x, pinchPoint.y, 20, 0, Math.PI*2);
      feedCtx.strokeStyle = '#ff8800'; feedCtx.lineWidth = 3; feedCtx.shadowBlur = 10; feedCtx.shadowColor = '#ff8800';
      feedCtx.stroke(); feedCtx.shadowBlur = 0;
    } else if (state.mode === 'erase') {
      feedCtx.beginPath(); feedCtx.arc(palm.x, palm.y, 50, 0, Math.PI*2);
      feedCtx.strokeStyle = 'rgba(255, 20, 100, 0.8)'; 
      feedCtx.fillStyle = 'rgba(255, 20, 100, 0.15)';
      feedCtx.setLineDash([5, 5]);
      feedCtx.fill();
      feedCtx.lineWidth = 3;
      feedCtx.stroke(); 
      feedCtx.setLineDash([]);
    }

    handleMode(mirrored[8], palm, pinchPoint);
  } else {
    finalize();
    gestureBadge.innerText = 'Show Hand';
  }
  renderParticles();
}

function detectGesture(hl) {
  // Check if a finger is extended by comparing distance from wrist to tip vs wrist to joint
  const isExt = (tip, mid, base) => {
    const d1 = Math.hypot(hl[0].x - hl[tip].x, hl[0].y - hl[tip].y);
    const d2 = Math.hypot(hl[0].x - hl[base].x, hl[0].y - hl[base].y);
    return d1 > d2 * 1.2;
  };

  const thumbUp = Math.hypot(hl[4].x - hl[2].x, hl[4].y - hl[2].y) > 0.04;
  const indexUp = isExt(8, 7, 6);
  const middleUp = isExt(12, 11, 10);
  const ringUp = isExt(16, 15, 14);
  const pinkyUp = isExt(20, 19, 18);

  const pinch = Math.hypot(hl[4].x - hl[8].x, hl[4].y - hl[8].y) < 0.04;
  if (pinch) return 'pan';
  
  if (indexUp && middleUp && ringUp && pinkyUp) {
    const handWidth = Math.hypot(hl[5].x - hl[17].x, hl[5].y - hl[17].y);
    const handLength = Math.hypot(hl[0].x - hl[9].x, hl[0].y - hl[9].y);
    // Even more lenient facing check
    if ((handWidth / handLength) > 0.35) return 'erase';
  }

  if (indexUp) return 'draw';
  return 'idle';
}

function handleMode(tip, palm, pinch) {
  gestureBadge.innerText = state.mode.toUpperCase();
  if (state.mode === 'draw') {
    if (!state.smoothPos) state.smoothPos = { x: tip.x, y: tip.y };
    else { state.smoothPos.x = state.smoothPos.x * 0.7 + tip.x * 0.3; state.smoothPos.y = state.smoothPos.y * 0.7 + tip.y * 0.3; }
    if (!state.currentStroke) state.currentStroke = { points: [{...state.smoothPos}], color: state.activeColor, size: state.thickness };
    else state.currentStroke.points.push({...state.smoothPos});
    emitParticles(state.smoothPos.x, state.smoothPos.y, state.activeColor);
    render();
  } else if (state.mode === 'erase') {
    const radius = 50;
    const newStrokes = [];
    for (const s of state.strokes) {
      let cur = [];
      for (const p of s.points) {
        if (Math.hypot(p.x - palm.x, p.y - palm.y) > radius) cur.push(p);
        else { if (cur.length > 1) newStrokes.push({ ...s, points: cur }); cur = []; }
      }
      if (cur.length > 1) newStrokes.push({ ...s, points: cur });
    }
    state.strokes = newStrokes; render();
  } else if (state.mode === 'pan') {
    if (state.grabStartPos) {
      if (!state.selectedStroke) state.selectedStroke = findNearestStroke(pinch);
      if (state.selectedStroke) {
        const dx = pinch.x - state.grabStartPos.x;
        const dy = pinch.y - state.grabStartPos.y;
        state.selectedStroke.points.forEach(p => { p.x += dx; p.y += dy; });
      }
    }
    state.grabStartPos = { ...pinch }; render();
  }
}

function findNearestStroke(pos) {
  let nearest = null;
  let minDist = 100; // Selection radius
  state.strokes.forEach(s => {
    s.points.forEach(p => {
      const d = Math.hypot(p.x - pos.x, p.y - pos.y);
      if (d < minDist) { minDist = d; nearest = s; }
    });
  });
  return nearest;
}

function finalize() {
  if (state.currentStroke && state.currentStroke.points.length > 1) state.strokes.push(state.currentStroke);
  state.currentStroke = null; state.smoothPos = null; state.mode = 'idle'; state.grabStartPos = null; state.selectedStroke = null;
}

function render() {
  drawCtx.clearRect(0, 0, state.width, state.height);
  const all = [...state.strokes];
  if (state.currentStroke) all.push(state.currentStroke);
  all.forEach(s => {
    if (s.points.length < 2) return;
    
    // PASS 1: DEEP GLOW (Darker)
    drawCtx.beginPath(); drawCtx.strokeStyle = s.color; drawCtx.lineWidth = s.size * 1.5;
    drawCtx.lineCap = 'round'; drawCtx.lineJoin = 'round'; drawCtx.shadowBlur = 20; drawCtx.shadowColor = s.color;
    drawCtx.globalAlpha = 0.3; drawPath(s.points); drawCtx.stroke();
    
    // PASS 2: VIBRANT SHINE (Selected Color)
    drawCtx.globalAlpha = 1.0; drawCtx.lineWidth = s.size; drawCtx.shadowBlur = 10;
    drawCtx.beginPath(); drawPath(s.points); drawCtx.stroke();
    
    // PASS 3: AI WHITE CORE
    drawCtx.beginPath(); drawCtx.strokeStyle = '#fff'; drawCtx.lineWidth = s.size * 0.3;
    drawCtx.shadowBlur = 0; drawPath(s.points); drawCtx.stroke();
  });
}

function drawPath(pts) {
  drawCtx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const xc = (pts[i].x + pts[i-1].x) / 2;
    const yc = (pts[i].y + pts[i-1].y) / 2;
    drawCtx.quadraticCurveTo(pts[i-1].x, pts[i-1].y, xc, yc);
  }
}

function emitParticles(x, y, color) {
  for (let i = 0; i < 3; i++) {
    state.particles.push({
      x, y, vx: (Math.random()-0.5)*4, vy: (Math.random()-0.5)*4,
      life: 1.0, size: Math.random()*2, color
    });
  }
}

function renderParticles() {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.x += p.vx; p.y += p.vy; p.life -= 0.02;
    if (p.life <= 0) { state.particles.splice(i, 1); continue; }
    feedCtx.fillStyle = '#fff'; feedCtx.shadowBlur = 5; feedCtx.shadowColor = p.color;
    feedCtx.globalAlpha = p.life; feedCtx.beginPath(); feedCtx.arc(p.x, p.y, p.size, 0, Math.PI*2); feedCtx.fill();
  }
  feedCtx.globalAlpha = 1; feedCtx.shadowBlur = 0;
}

init();
