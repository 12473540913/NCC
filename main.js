(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const lightQuery = window.matchMedia("(prefers-color-scheme: light)");

  // Monochrome theme that follows the browser's light/dark preference (dark is the default).
  const theme = {};
  function applyTheme() {
    const light = lightQuery.matches;
    theme.light = light;
    theme.bg = light ? [255, 255, 255] : [0, 0, 0];
    theme.fg = light ? [0, 0, 0] : [255, 255, 255];
    // Maps 0..1 to a gray shade: 1 = strongest contrast against the background.
    theme.shade = (k) => {
      const v = light ? Math.round(150 * (1 - k)) : Math.round(110 + 145 * k);
      return [v, v, v];
    };
    theme.blend = light ? "source-over" : "lighter";
  }
  applyTheme();
  const themeListeners = [];
  lightQuery.addEventListener("change", () => {
    applyTheme();
    themeListeners.forEach((fn) => fn());
  });

  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  function fitCanvas(canvas, ctx) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: rect.width, h: rect.height };
  }

  /* ================= 3D spinning rings loader ================= */
  function createRings(canvas) {
    const ctx = canvas.getContext("2d");
    let size = fitCanvas(canvas, ctx);
    let running = true;

    // Equal-size rings, each spinning on its own axis inside the previous one so they interlace.
    const rings = [
      { r: 0.82, shade: 1, axis: "x", speed: 1.1, phase: 0 },
      { r: 0.82, shade: 0.7, axis: "y", speed: -1.5, phase: Math.PI / 4 },
      { r: 0.82, shade: 0.45, axis: "x", speed: 1.9, phase: Math.PI / 2 },
      { r: 0.82, shade: 0.8, axis: "y", speed: -2.4, phase: (3 * Math.PI) / 4 },
    ];
    const SEGMENTS = 120;

    const rotX = (p, a) => {
      const c = Math.cos(a), s = Math.sin(a);
      return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
    };
    const rotY = (p, a) => {
      const c = Math.cos(a), s = Math.sin(a);
      return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
    };

    function project(p) {
      const scale = size.w * 0.45;
      const persp = 3 / (3 + p.z);
      return { x: size.w / 2 + p.x * scale * persp, y: size.h / 2 + p.y * scale * persp, s: persp, z: p.z };
    }

    function frame(ms) {
      if (!running) return;
      const t = ms / 1000;
      ctx.clearRect(0, 0, size.w, size.h);

      const segs = [];
      rings.forEach((ring, ri) => {
        const color = theme.shade(ring.shade);
        for (let i = 0; i < SEGMENTS; i++) {
          const pts = [i, i + 1].map((k) => {
            const a = (k / SEGMENTS) * Math.PI * 2;
            let p = { x: Math.cos(a) * ring.r, y: Math.sin(a) * ring.r, z: 0 };
            // Apply this ring's spin, then every outer ring's spin (inner rings ride inside outer ones).
            for (let j = ri; j >= 0; j--) {
              const angle = t * rings[j].speed + rings[j].phase;
              p = rings[j].axis === "x" ? rotX(p, angle) : rotY(p, angle);
            }
            p = rotX(rotY(p, t * 0.35), 0.45 + Math.sin(t * 0.6) * 0.2);
            return project(p);
          });
          segs.push({ a: pts[0], b: pts[1], color, z: (pts[0].z + pts[1].z) / 2 });
        }
      });

      // Draw far-to-near so rings correctly pass in front of / behind each other.
      segs.sort((m, n) => n.z - m.z);
      ctx.lineCap = "round";
      ctx.shadowBlur = 6;
      ctx.shadowColor = rgba(theme.fg, theme.light ? 0.15 : 0.35);
      for (const s of segs) {
        const depth = (1 - s.z) / 2;
        ctx.strokeStyle = rgba(s.color, 0.3 + 0.7 * depth);
        ctx.lineWidth = size.w * 0.008 * s.a.s;
        ctx.beginPath();
        ctx.moveTo(s.a.x, s.a.y);
        ctx.lineTo(s.b.x, s.b.y);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      requestAnimationFrame(frame);
    }

    window.addEventListener("resize", () => (size = fitCanvas(canvas, ctx)));
    requestAnimationFrame(frame);
    return { stop: () => (running = false) };
  }

  /* ================= Swirling galaxy with central black hole ================= */
  function createGalaxy(canvas) {
    const ctx = canvas.getContext("2d");
    let size = fitCanvas(canvas, ctx);

    const ARMS = 4;
    const DISK_TILT = 0.22;
    const CALM_MS = 2800;
    // Swirl speed before the user clicks, and how hard it spins up during the click transition.
    const IDLE_SPEED = 2;
    const BURST_SPEED = 16;
    // Extra speed multiplier when the pointer is right at the center (before the click).
    const PROXIMITY_BOOST = 7;
    let burst = 0;
    let proximity = 0;
    let proximityTarget = 0;
    let stars = [];
    let field = [];
    let disk = [];
    let maxR = 0;
    let holeR = 0;
    // 0 = intense black-hole swirl, 1 = calm, gentle galaxy with no bright core.
    let calm = 0;
    let calmStart = null;
    let hover = 0;
    let hoverTarget = 0;

    function makeStar(i, r) {
      const arm = i % ARMS;
      const spread = (Math.random() - 0.5) * (0.4 + (r / maxR) * 0.9);
      return {
        r,
        angle: (arm / ARMS) * Math.PI * 2 + r * 0.006 + spread,
        size: Math.random() * 1.5 + 0.3,
        shade: Math.random(),
        alpha: 0.3 + Math.random() * 0.7,
        twinkle: Math.random() * Math.PI * 2,
      };
    }

    function build() {
      const { w, h } = size;
      const area = w * h;
      maxR = Math.hypot(w, h) * 0.6;
      holeR = Math.max(16, Math.min(w, h) * 0.05);

      const count = Math.min(4500, Math.round(area / 280));
      stars = Array.from({ length: count }, (_, i) =>
        makeStar(i, holeR * 2.5 + Math.pow(Math.random(), 1.4) * (maxR - holeR * 2.5))
      );

      field = Array.from({ length: Math.round(area / 2500) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        s: Math.random() * 1.1 + 0.2,
        t: Math.random() * Math.PI * 2,
      }));

      disk = Array.from({ length: 900 }, () => {
        const r = holeR * (1.5 + Math.pow(Math.random(), 1.8) * 2.8);
        return { r, angle: Math.random() * Math.PI * 2, size: Math.random() * 1.4 + 0.5 };
      });
    }

    const nebulae = [
      { ox: 0.25, oy: 0.3, r: 0.55, sp: 0.00007 },
      { ox: 0.75, oy: 0.65, r: 0.45, sp: 0.00009 },
      { ox: 0.5, oy: 0.85, r: 0.35, sp: 0.00011 },
    ];

    function paintBackground(alpha) {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = rgba(theme.bg, alpha);
      ctx.fillRect(0, 0, size.w, size.h);
    }

    const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

    let last = 0;
    function frame(ms) {
      const dt = Math.min(0.05, last ? (ms - last) / 1000 : 0.016) * (reducedMotion ? 0 : 1);
      last = ms;
      if (calmStart !== null) {
        const p = Math.min(1, (ms - calmStart) / CALM_MS);
        calm = easeInOut(p);
        // Rises fast right after the click, peaks early, then winds down into the calm state.
        burst = Math.pow(Math.sin(Math.PI * Math.pow(p, 0.6)), 2);
      }
      // Ease toward the pointer-proximity target so speed changes feel like momentum, not a jump.
      proximity += (proximityTarget * (1 - calm) - proximity) * Math.min(1, dt * 3);
      const boost = 1 + PROXIMITY_BOOST * proximity;
      const speed = (IDLE_SPEED * (1 - calm) * boost + 0.6 * calm + BURST_SPEED * burst);
      hover += (hoverTarget - hover) * 0.12;

      const { w, h } = size;
      const cx = w / 2;
      const cy = h / 2;

      // Fading overdraw creates soft swirling motion trails.
      paintBackground(0.22);
      ctx.globalCompositeOperation = theme.blend;

      // Drifting gray nebula clouds.
      nebulae.forEach((n, i) => {
        const x = w * (n.ox + Math.sin(ms * n.sp + i) * 0.15);
        const y = h * (n.oy + Math.cos(ms * n.sp * 1.3 + i) * 0.12);
        const rad = Math.max(w, h) * n.r;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, rgba(theme.fg, 0.025));
        g.addColorStop(1, rgba(theme.fg, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      });

      // Distant star field.
      field.forEach((s) => {
        const a = 0.25 + 0.35 * Math.sin(ms * 0.002 + s.t);
        ctx.fillStyle = rgba(theme.fg, a * 0.3);
        ctx.fillRect(s.x, s.y, s.s, s.s);
      });

      // Spiral arms. While the black hole is active, stars spin fast and spiral inward;
      // once calm, the swirl slows, stops infalling, and the empty center closes up softly.
      const tilt = 0.55 + Math.sin(ms * 0.00005) * 0.12;
      const globalRot = ms * 0.00002;
      const gap = holeR * 2.2 * calm;
      const dim = 1 - 0.35 * calm;
      for (let i = 0; i < stars.length; i++) {
        let s = stars[i];
        s.angle += (0.0072 + 3 / (s.r + 60)) * dt * speed;
        s.r -= (1.2 + 900 / s.r) * dt * (1 - calm) * (IDLE_SPEED * boost + BURST_SPEED * burst);
        if (s.r < holeR * 1.2) {
          s = stars[i] = makeStar(i, maxR * (0.75 + Math.random() * 0.25));
        }
        // Continuous, monotonic inward shift that fills the hole without bunching at the center.
        const dr = s.r < holeR * 4.4 ? s.r * (1 - gap / (holeR * 4.4)) : s.r - gap;
        const a = s.angle + globalRot;
        const x = cx + Math.cos(a) * dr;
        const y = cy + Math.sin(a) * dr * tilt;
        if (x < -5 || x > w + 5 || y < -5 || y > h + 5) continue;
        const centerFade = 1 - calm * (1 - Math.min(1, dr / (holeR * 6)));
        const tw = 0.6 + 0.4 * Math.sin(ms * 0.003 + s.twinkle);
        ctx.fillStyle = rgba(theme.shade(s.shade), s.alpha * tw * 0.8 * dim * centerFade);
        ctx.fillRect(x, y, s.size, s.size);
      }

      if (calm < 1) drawBlackHole(cx, cy, dt, ms, 1 - calm, boost);
      requestAnimationFrame(frame);
    }

    function drawBlackHole(cx, cy, dt, ms, vis, boost) {
      // As the hole fades out it also shrinks and collapses inward.
      const k = 0.35 + 0.65 * vis;
      const R = holeR * k;
      ctx.globalAlpha = vis;

      // Shadow region that swallows nearby starlight.
      ctx.globalCompositeOperation = "source-over";
      const shadow = ctx.createRadialGradient(cx, cy, R, cx, cy, R * 3);
      shadow.addColorStop(0, theme.light ? "rgba(0,0,0,0.12)" : "rgba(0,0,0,0.85)");
      shadow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = shadow;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalCompositeOperation = theme.blend;
      const back = [];
      const front = [];
      for (const p of disk) {
        // Keplerian-ish: inner material orbits much faster (and spins up as it collapses).
        p.angle += 1.6 * Math.pow(holeR / p.r, 1.5) * dt * (IDLE_SPEED * boost + BURST_SPEED * 1.5 * burst);
        const heat = 1 - (p.r - holeR * 1.5) / (holeR * 2.8);
        // Doppler beaming: the side moving toward the viewer looks brighter.
        const beam = 0.55 + 0.45 * Math.cos(p.angle);
        const alpha = (0.15 + 0.75 * heat) * beam * (1 + 0.4 * hover);
        (Math.sin(p.angle) < 0 ? back : front).push({ p, alpha, heat });

        // Gravitationally lensed image of the disk, wrapped around the horizon.
        const lr = R * (1.12 + (p.r / holeR - 1.5) * 0.18);
        ctx.fillStyle = rgba(theme.shade(heat), alpha * 0.35);
        ctx.fillRect(cx + Math.cos(p.angle) * lr, cy + Math.sin(p.angle) * lr, p.size * 0.8, p.size * 0.8);
      }

      const plot = ({ p, alpha, heat }) => {
        ctx.fillStyle = rgba(theme.shade(heat), alpha);
        ctx.fillRect(
          cx + Math.cos(p.angle) * p.r * k,
          cy + Math.sin(p.angle) * p.r * k * DISK_TILT,
          p.size,
          p.size
        );
      };
      back.forEach(plot);

      // Photon ring — breathes slowly, and brightens when the pointer is over the hole.
      ctx.globalCompositeOperation = "source-over";
      const pulse = Math.min(1, 0.75 + 0.25 * Math.sin(ms * 0.0015) + 0.35 * hover);
      ctx.shadowBlur = R * (0.6 + 0.6 * hover);
      ctx.shadowColor = rgba(theme.fg, theme.light ? 0.35 : 0.9);
      ctx.strokeStyle = rgba(theme.light ? [40, 40, 40] : [235, 235, 235], 0.85 * pulse);
      ctx.lineWidth = Math.max(1, R * (0.06 + 0.03 * hover));
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.04, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Event horizon.
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalCompositeOperation = theme.blend;
      front.forEach(plot);
      ctx.globalAlpha = 1;
    }

    window.addEventListener("pointermove", (e) => {
      // Full-screen gradient: 0 at the farthest corner, rising continuously to 1 at the center.
      const d = Math.hypot(e.clientX - size.w / 2, e.clientY - size.h / 2);
      const t = Math.max(0, 1 - d / Math.hypot(size.w / 2, size.h / 2));
      proximityTarget = Math.pow(t, 1.8);
    });
    document.addEventListener("pointerleave", () => (proximityTarget = 0));
    window.addEventListener("blur", () => (proximityTarget = 0));

    window.addEventListener("resize", () => {
      size = fitCanvas(canvas, ctx);
      build();
      paintBackground(1);
    });
    themeListeners.push(() => paintBackground(1));

    build();
    paintBackground(1);
    requestAnimationFrame(frame);

    return {
      get holeRadius() {
        return holeR;
      },
      setHover(on) {
        hoverTarget = on ? 1 : 0;
      },
      // Collapse the black hole into a calm galaxy; resolves when the transition finishes.
      calmDown() {
        if (calmStart === null) calmStart = performance.now();
        return new Promise((r) => setTimeout(r, reducedMotion ? 0 : CALM_MS));
      },
    };
  }

  /* ================= Boot sequence ================= */
  // Always start at the very top: stop the browser from restoring a previous scroll position.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  const toTop = () => window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  toTop();
  window.addEventListener("pageshow", toTop);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const loaderRings = createRings(document.getElementById("rings"));
  const loaded = new Promise((r) => (document.readyState === "complete" ? r() : window.addEventListener("load", r)));

  (async () => {
    // Stage 1: preloader rings.
    await Promise.all([loaded, sleep(reducedMotion ? 300 : 2600)]);

    // Stage 2: only the black hole swirl. The user must click its center to continue.
    const galaxyCanvas = document.getElementById("galaxy");
    galaxyCanvas.classList.add("visible");
    const galaxy = createGalaxy(galaxyCanvas);

    document.getElementById("loader").classList.add("hidden");
    setTimeout(loaderRings.stop, 1200);

    const enter = document.getElementById("enter");
    const sizeEnter = () => enter.style.setProperty("--hole", `${galaxy.holeRadius * 2.6}px`);
    sizeEnter();
    window.addEventListener("resize", sizeEnter);
    enter.hidden = false;
    enter.addEventListener("pointerenter", () => galaxy.setHover(true));
    enter.addEventListener("pointerleave", () => galaxy.setHover(false));
    enter.addEventListener("focus", () => galaxy.setHover(true));
    enter.addEventListener("blur", () => galaxy.setHover(false));

    await new Promise((r) => enter.addEventListener("click", r, { once: true }));

    // Stage 3: collapse into a calm galaxy, then reveal the text.
    enter.remove();
    galaxy.setHover(false);
    const calmed = galaxy.calmDown();
    await sleep(reducedMotion ? 0 : 1600);
    toTop();
    document.body.classList.remove("locked");
    toTop();

    const items = [
      document.getElementById("title"),
      ...document.querySelectorAll("#description .panel"),
      document.getElementById("flag"),
    ];
    for (const el of items) {
      el.classList.add("shown");
      await sleep(reducedMotion ? 0 : el.id === "title" ? 1400 : 950);
    }
    await calmed;
  })();
})();
