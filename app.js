const bgCanvas = document.getElementById("bg");

// --- YouTube click-to-load embed (avoids common iframe embed errors) ---
function initYouTubeEmbeds() {
  const nodes = document.querySelectorAll(".yt[data-video-id]");
  for (const node of nodes) {
    const videoId = node.getAttribute("data-video-id");
    const title = node.getAttribute("data-title") || "YouTube video";
    const btn = node.querySelector(".yt-btn");
    if (!btn || !videoId) continue;
    btn.addEventListener("click", () => {
      // Replace content with the real iframe only when requested by the user.
      node.innerHTML = "";
      const iframe = document.createElement("iframe");
      iframe.title = title;
      iframe.loading = "lazy";
      iframe.allowFullscreen = true;
      // Keep the allow list minimal to reduce browser console noise.
      iframe.allow = "autoplay; encrypted-media; picture-in-picture; web-share";

      // YouTube embed can error (e.g. "Error 153") without an explicit origin.
      // Use the standard domain + origin for best compatibility.
      const origin = encodeURIComponent(window.location.origin);
      iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(
        videoId
      )}?rel=0&modestbranding=1&playsinline=1&autoplay=1&origin=${origin}`;
      node.appendChild(iframe);
    });
  }
}

// --- Shader-ish background (WebGL) ---
function createShader(gl, type, source) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const err = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(err || "Shader compile failed");
  }
  return sh;
}

function createProgram(gl, vsSrc, fsSrc) {
  const prog = gl.createProgram();
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const err = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(err || "Program link failed");
  }
  return prog;
}

function startWebGLBackground() {
  const gl =
    bgCanvas.getContext("webgl", { alpha: true, antialias: false }) ||
    bgCanvas.getContext("experimental-webgl", { alpha: true, antialias: false });

  if (!gl) return false;

  const vsSrc = `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main(){
      v_uv = (a_pos + 1.0) * 0.5;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  // Port of Minus One's Love2D background shader from `main.lua` (cosmic-inline).
  // Adapted to WebGL fragment shader (gl_FragCoord / u_resolution).
  const fsSrc = `
    precision mediump float;
    varying vec2 v_uv;
    uniform vec2 u_res;
    uniform float u_time;
    uniform vec3 u_themeA;
    uniform vec3 u_themeB;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float vnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
      float a = hash21(i);
      float b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0));
      float d = hash21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }

    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
      for (int it = 0; it < 6; it++) {
        v += a * vnoise(p);
        p = rot * p * 2.07;
        a *= 0.5;
      }
      return v;
    }

    float starField(vec2 uv, float density, float twinkleSpeed, float seed) {
      vec2 cell = floor(uv);
      vec2 f = fract(uv);
      float h = hash21(cell + vec2(seed));
      if (h > density) return 0.0;
      vec2 pos = vec2(
        hash21(cell + vec2(seed + 13.7)),
        hash21(cell + vec2(seed + 27.3))
      );
      float d = length(f - pos);
      float twinkle = 0.55 + 0.45 * sin(u_time * twinkleSpeed + h * 100.0);
      float intensity = (1.0 - smoothstep(0.0, 0.06, d)) * twinkle;
      if (h < density * 0.18) {
        vec2 dl = abs(f - pos);
        float sx = (1.0 - smoothstep(0.0, 0.18, dl.y)) * (1.0 - smoothstep(0.0, 0.006, dl.x));
        float sy = (1.0 - smoothstep(0.0, 0.18, dl.x)) * (1.0 - smoothstep(0.0, 0.006, dl.y));
        intensity += max(sx, sy) * twinkle * 0.65;
      }
      return intensity;
    }

    void main(){
      vec2 uv = gl_FragCoord.xy / max(u_res, vec2(1.0, 1.0));
      vec2 cuv = uv - vec2(0.5);
      float aspect = u_res.x / max(u_res.y, 1.0);
      cuv.x *= aspect;

      // Deep space gradient (top -> bottom).
      vec3 base = mix(u_themeA, u_themeB, smoothstep(0.0, 1.0, uv.y));

      // Domain-warped FBM nebula.
      vec2 npos = cuv * 3.4 + vec2(u_time * 0.020, u_time * 0.012);
      vec2 warp = vec2(
        fbm(npos + vec2(0.0, 0.0)),
        fbm(npos + vec2(5.2, 1.3))
      );
      float n1 = fbm(npos + warp * 1.8);
      float n2 = fbm(npos * 1.6 + warp * 1.2 - vec2(u_time * 0.015, 0.0));

      vec3 nebMagenta = mix(vec3(0.50, 0.13, 0.58), u_themeB * 2.2, 0.55);
      vec3 nebBlue    = mix(vec3(0.10, 0.28, 0.70), u_themeB * 2.5, 0.65);
      vec3 nebPurple  = mix(vec3(0.25, 0.08, 0.45), u_themeA * 2.4, 0.55);
      vec3 nebula = mix(nebPurple, nebMagenta, n1);
      nebula = mix(nebula, nebBlue, n2);

      float nebMask =
        smoothstep(0.40, 0.85, n1) * 0.45 +
        smoothstep(0.55, 0.90, n2) * 0.30;
      base += nebula * nebMask;

      // Parallax star layers.
      float stars = 0.0;
      stars += starField(uv * vec2(40.0 * aspect, 22.5)  + vec2(u_time * 0.15, 0.0),         0.060, 1.5, 0.0)  * 0.45;
      stars += starField(uv * vec2(80.0 * aspect, 45.0)  + vec2(u_time * 0.40, u_time*0.05), 0.040, 3.0, 7.0)  * 0.75;
      stars += starField(uv * vec2(160.0 * aspect, 90.0) + vec2(u_time * 0.90, u_time*0.20), 0.025, 5.0, 19.0) * 1.00;
      base += vec3(0.85, 0.92, 1.0) * stars;

      // Slow plasma sheen.
      float plasma = sin(uv.x * 4.0 + u_time * 0.4 + sin(uv.y * 6.0 + u_time * 0.3) * 1.5) * 0.5 + 0.5;
      base += vec3(0.20, 0.35, 0.70) * plasma * 0.05;

      // Soft vignette.
      float vd = length(cuv * vec2(0.85, 1.05));
      float vig = 1.0 - smoothstep(0.45, 1.05, vd);
      base *= 0.40 + 0.60 * vig;

      gl_FragColor = vec4(base, 1.0);
    }
  `;

  let program;
  try {
    program = createProgram(gl, vsSrc, fsSrc);
  } catch {
    return false;
  }

  gl.useProgram(program);

  const posLoc = gl.getAttribLocation(program, "a_pos");
  const resLoc = gl.getUniformLocation(program, "u_res");
  const timeLoc = gl.getUniformLocation(program, "u_time");
  const themeALoc = gl.getUniformLocation(program, "u_themeA");
  const themeBLoc = gl.getUniformLocation(program, "u_themeB");

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );

  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function hexToRgb01(hex) {
    const h = hex.replace("#", "").trim();
    if (h.length !== 6) return [0.03, 0.03, 0.06];
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    return [r, g, b];
  }

  // Match the game vibe: drive shader themes from CSS vars.
  const themeA = hexToRgb01(cssVar("--bg0", "#05060a"));
  const themeB = hexToRgb01(cssVar("--bg1", "#090b12"));
  if (themeALoc) gl.uniform3f(themeALoc, themeA[0], themeA[1], themeA[2]);
  if (themeBLoc) gl.uniform3f(themeBLoc, themeB[0], themeB[1], themeB[2]);

  function resize() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    bgCanvas.width = Math.floor(window.innerWidth * dpr);
    bgCanvas.height = Math.floor(window.innerHeight * dpr);
    bgCanvas.style.width = `${window.innerWidth}px`;
    bgCanvas.style.height = `${window.innerHeight}px`;
    gl.viewport(0, 0, bgCanvas.width, bgCanvas.height);
    gl.uniform2f(resLoc, bgCanvas.width, bgCanvas.height);
  }

  resize();
  window.addEventListener("resize", resize);

  function frame(t) {
    gl.uniform1f(timeLoc, t / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
  return true;
}

initYouTubeEmbeds();

function start2DBackgroundFallback() {
  const ctx = bgCanvas.getContext("2d", { alpha: true });
  if (!ctx) return false;

  function resize() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    bgCanvas.width = Math.floor(window.innerWidth * dpr);
    bgCanvas.height = Math.floor(window.innerHeight * dpr);
    bgCanvas.style.width = `${window.innerWidth}px`;
    bgCanvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  resize();
  window.addEventListener("resize", resize);

  const STAR_COUNT = 260;
  const stars = [];
  const rand = (min, max) => min + Math.random() * (max - min);

  function resetStar(s) {
    s.x = rand(0, window.innerWidth);
    s.y = rand(0, window.innerHeight);
    s.z = rand(0.15, 1);
    s.r = rand(0.7, 2.1) * (0.35 + s.z);
    s.v = rand(6, 22) * (0.25 + s.z);
    s.hue = rand(205, 260);
    s.alpha = rand(0.35, 0.95);
  }

  for (let i = 0; i < STAR_COUNT; i++) {
    const s = {};
    resetStar(s);
    stars.push(s);
  }

  let lastT = performance.now();
  function tick(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;

    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    const wob = t * 0.00018;
    ctx.globalCompositeOperation = "lighter";
    const g1 = ctx.createRadialGradient(
      window.innerWidth * (0.32 + Math.sin(wob) * 0.02),
      window.innerHeight * (0.18 + Math.cos(wob) * 0.03),
      20,
      window.innerWidth * 0.35,
      window.innerHeight * 0.22,
      Math.max(window.innerWidth, window.innerHeight) * 0.78
    );
    g1.addColorStop(0, "rgba(122,162,255,0.08)");
    g1.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    const g2 = ctx.createRadialGradient(
      window.innerWidth * (0.72 + Math.cos(wob * 1.2) * 0.02),
      window.innerHeight * (0.58 + Math.sin(wob * 1.15) * 0.02),
      20,
      window.innerWidth * 0.68,
      window.innerHeight * 0.6,
      Math.max(window.innerWidth, window.innerHeight) * 0.82
    );
    g2.addColorStop(0, "rgba(178,107,255,0.06)");
    g2.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    ctx.globalCompositeOperation = "source-over";
    for (const s of stars) {
      s.y += s.v * dt;
      if (s.y > window.innerHeight + 10) {
        s.y = -10;
        s.x = rand(0, window.innerWidth);
      }
      const tw = 0.65 + 0.35 * Math.sin(t * 0.0015 + s.x * 0.01);
      const a = s.alpha * tw;
      ctx.fillStyle = `hsla(${s.hue}, 85%, 78%, ${a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
  return true;
}

const okWebgl = startWebGLBackground();
if (!okWebgl) {
  const ok2d = start2DBackgroundFallback();
  if (!ok2d) {
    // Ensure we don't cover the CSS gradients with a black canvas.
    bgCanvas.style.display = "none";
  }
}

