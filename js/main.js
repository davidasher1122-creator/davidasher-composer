/* David Asher — Composer. Pixel-dissolve video hero, scored loop with a sound
   toggle, wallpaper background per section, and a custom SoundCloud player.
   The pixel field is the Elephant Shoez engine (itself from David Asher Music). */
(function () {
  const root = document.documentElement;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(pointer: fine)").matches;
  const params = new URLSearchParams(location.search);

  let gateDone = false;
  try {
    gateDone = sessionStorage.getItem("da-entered") === "1";
  } catch {}
  // Phones open on a full-screen wipe. Reduced motion skips it so Enter is never trapped.
  const showGate = !finePointer && !gateDone && !reduceMotion && params.get("gate") !== "off";
  root.classList.add(finePointer ? "is-mouse" : "is-touch");
  if (reduceMotion) root.classList.add("is-reduced");
  if (!finePointer) root.classList.add(showGate ? "is-gate" : "is-entered");

  document.querySelectorAll("[data-year]").forEach((el) => {
    el.textContent = String(new Date().getFullYear());
  });

  /* =========================================================
     Pixel field
     The source (image or video) is painted to the canvas, cut into a
     grid of cells. Cells near the pointer get pushed off their home
     spot, leaving a hole, and spring back. Only moving cells are drawn
     one by one, so a full-screen video stays cheap.
     ========================================================= */
  function createPixelField(canvas, opts) {
    const cfg = Object.assign(
      {
        cell: 7,
        radius: 140,
        force: 7,
        jitter: 1.6,
        spring: 0.045,
        drag: 0.86,
        look: "crisp", // "crisp" = real video at rest, "pixels" = mosaic at rest
        opacity: 1,
        globalPointer: false,
        interactive: true,
        stick: false,
        stickDist: 16,
        ring: false,
        focusX: 0.5,
        focusY: 0.5,
      },
      opts
    );

    const ctx = canvas.getContext("2d");
    const off = document.createElement("canvas");
    const octx = off.getContext("2d", { willReadFrequently: true });

    let sources = cfg.sources;
    let srcIndex = 0;
    let w = 0;
    let h = 0;
    let cols = 0;
    let rows = 0;
    let dx, dy, vx, vy, flags; // flags: 1 = moving, 2 = stuck (gate)
    let active = [];
    let crop = null;
    let cropKey = "";
    let pixels = null;
    let canRead = true;
    let lastSampleTime = -1;
    let lastSrc = null;
    let everReady = false;
    let mx = -1e4;
    let my = -1e4;
    let down = false;
    let visible = true;
    let revealTick = 0;
    let revealed = false;
    let frames = 0;

    function srcSize(src) {
      if (src instanceof HTMLVideoElement) {
        return src.readyState >= 2 && src.videoWidth ? [src.videoWidth, src.videoHeight] : null;
      }
      return src.complete && src.naturalWidth ? [src.naturalWidth, src.naturalHeight] : null;
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      if (w < 2 || h < 2) return;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / cfg.cell);
      rows = Math.ceil(h / cfg.cell);
      const n = cols * rows;
      dx = new Float32Array(n);
      dy = new Float32Array(n);
      vx = new Float32Array(n);
      vy = new Float32Array(n);
      flags = new Uint8Array(n);
      active = [];
      off.width = cols;
      off.height = rows;
      crop = null;
      cropKey = "";
      pixels = null;
    }

    // Cover-fit the source over the whole grid.
    function fit(size) {
      const key = size.join("x");
      if (crop && key === cropKey) return;
      cropKey = key;
      const [sw0, sh0] = size;
      const gw = cols * cfg.cell;
      const gh = rows * cfg.cell;
      const scale = Math.max(gw / sw0, gh / sh0);
      const sw = gw / scale;
      const sh = gh / scale;
      crop = { sx: (sw0 - sw) * cfg.focusX, sy: (sh0 - sh) * cfg.focusY, sw, sh };
      pixels = null;
    }

    function sample(src) {
      octx.drawImage(src, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, cols, rows);
      if (!canRead) return;
      try {
        pixels = octx.getImageData(0, 0, cols, rows).data;
      } catch {
        // file:// pages can't read video pixels; moving cells fall back to grey.
        canRead = false;
        pixels = null;
        console.warn("Pixel colours unavailable. Serve the site over http (see README).");
      }
    }

    function wake(i) {
      if (!(flags[i] & 1)) {
        flags[i] |= 1;
        active.push(i);
      }
    }

    function push() {
      if (mx < -1000 || !cfg.interactive) return;
      const R = down ? cfg.radius * 1.35 : cfg.radius;
      const force = down ? cfg.force * 1.5 : cfg.force;
      const cell = cfg.cell;
      const c0 = Math.max(0, Math.floor((mx - R) / cell));
      const c1 = Math.min(cols - 1, Math.floor((mx + R) / cell));
      const r0 = Math.max(0, Math.floor((my - R) / cell));
      const r1 = Math.min(rows - 1, Math.floor((my + R) / cell));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const i = r * cols + c;
          const px = c * cell + cell / 2 + dx[i] - mx;
          const py = r * cell + cell / 2 + dy[i] - my;
          const d2 = px * px + py * py;
          if (d2 >= R * R) continue;
          const d = Math.sqrt(d2) || 1;
          const f = (1 - d / R) * force;
          vx[i] += (px / d) * f + (Math.random() - 0.5) * cfg.jitter;
          vy[i] += (py / d) * f + (Math.random() - 0.5) * cfg.jitter;
          wake(i);
        }
      }
    }

    function step() {
      const stick2 = cfg.stickDist * cfg.stickDist;
      for (let k = active.length - 1; k >= 0; k--) {
        const i = active[k];
        if (flags[i] & 2) {
          vx[i] *= 0.86;
          vy[i] *= 0.86;
        } else {
          vx[i] = (vx[i] - dx[i] * cfg.spring) * cfg.drag;
          vy[i] = (vy[i] - dy[i] * cfg.spring) * cfg.drag;
        }
        dx[i] += vx[i];
        dy[i] += vy[i];
        if (cfg.stick && !(flags[i] & 2) && dx[i] * dx[i] + dy[i] * dy[i] > stick2) {
          flags[i] |= 2;
        }
        if (
          !(flags[i] & 2) &&
          Math.abs(dx[i]) < 0.3 && Math.abs(dy[i]) < 0.3 &&
          Math.abs(vx[i]) < 0.05 && Math.abs(vy[i]) < 0.05
        ) {
          dx[i] = dy[i] = vx[i] = vy[i] = 0;
          flags[i] = 0;
          active[k] = active[active.length - 1];
          active.pop();
        }
      }
    }

    function draw(src) {
      ctx.clearRect(0, 0, w, h);
      if (!crop) return;
      const cell = cfg.cell;
      const gw = cols * cell;
      const gh = rows * cell;
      ctx.globalAlpha = cfg.opacity;
      if (cfg.look === "pixels") {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(off, 0, 0, cols, rows, 0, 0, gw, gh);
      } else {
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(src, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, gw, gh);
      }

      // Holes where cells have left home.
      for (let k = 0; k < active.length; k++) {
        const i = active[k];
        ctx.clearRect((i % cols) * cell, ((i / cols) | 0) * cell, cell, cell);
      }
      // The cells themselves, in flight.
      const s = cell * 0.9;
      for (let k = 0; k < active.length; k++) {
        const i = active[k];
        const p = i * 4;
        ctx.fillStyle = pixels ? `rgb(${pixels[p]},${pixels[p + 1]},${pixels[p + 2]})` : "#77756c";
        ctx.fillRect((i % cols) * cell + dx[i], ((i / cols) | 0) * cell + dy[i], s, s);
      }
      ctx.globalAlpha = 1;

      if (cfg.ring && mx > -1000) {
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = "rgba(243,236,224,0.75)";
        ctx.beginPath();
        ctx.arc(mx, my, down ? 26 : 18, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,91,58,0.65)";
        ctx.beginPath();
        ctx.arc(mx, my, down ? 46 : 34, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Gate: once enough of the Enter button is wiped bare, unlock it.
    function checkReveal() {
      if (revealed || !cfg.revealTarget || !cfg.onReveal) return;
      revealTick = (revealTick + 1) % 8;
      if (revealTick) return;
      const t = cfg.revealTarget();
      if (!t || t.w <= 0) return;
      const cell = cfg.cell;
      const c0 = Math.max(0, Math.floor(t.x / cell));
      const c1 = Math.min(cols - 1, Math.floor((t.x + t.w) / cell));
      const r0 = Math.max(0, Math.floor(t.y / cell));
      const r1 = Math.min(rows - 1, Math.floor((t.y + t.h) / cell));
      let total = 0;
      let open = 0;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          total++;
          if (flags[r * cols + c] & 2) open++;
        }
      }
      if (total && open / total >= 0.22) {
        revealed = true;
        cfg.onReveal();
      }
    }

    function frame() {
      requestAnimationFrame(frame);
      if (!visible || document.hidden || !cols) return;
      let src = sources[srcIndex];
      let size = srcSize(src);
      // Until the video's first frame, paint its poster so the stage is never empty.
      // Between clips, just hold the last frame.
      if (size) everReady = true;
      else if (cfg.poster && !everReady) {
        src = cfg.poster;
        size = srcSize(src);
      }
      if (!size) return;
      if (src !== lastSrc) {
        lastSrc = src;
        pixels = null;
      }
      if (cfg.pan) {
        const f = cfg.pan();
        if (Math.abs(f - cfg.focusX) > 0.0002) {
          cfg.focusX = f;
          crop = null;
        }
      }
      fit(size);
      frames++;
      const isVideo = src instanceof HTMLVideoElement;
      if (!pixels || (isVideo && src.currentTime !== lastSampleTime)) {
        sample(src);
        lastSampleTime = isVideo ? src.currentTime : 0;
      }
      push();
      step();
      draw(src);
      checkReveal();
      if (cfg.onFirstDraw) {
        cfg.onFirstDraw();
        cfg.onFirstDraw = null;
      }
    }

    /* ——— Input ——— */
    function setPointer(x, y) {
      const rect = canvas.getBoundingClientRect();
      if (!cfg.globalPointer && (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom)) {
        mx = my = -1e4;
        return;
      }
      mx = x - rect.left;
      my = y - rect.top;
      if (cfg.onTouch) cfg.onTouch();
    }
    const target = cfg.globalPointer ? window : canvas;
    target.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "touch") setPointer(e.clientX, e.clientY);
    }, { passive: true });
    target.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch") down = true;
    }, { passive: true });
    window.addEventListener("pointerup", () => (down = false));
    if (!cfg.globalPointer) {
      canvas.addEventListener("pointerleave", (e) => {
        if (e.pointerType !== "touch") mx = my = -1e4;
      });
    }
    // Touch events keep firing while the page scrolls, so a scrolling finger still pushes pixels.
    const onTouch = (e) => {
      const t = e.touches[0];
      if (t) setPointer(t.clientX, t.clientY);
    };
    target.addEventListener("touchstart", onTouch, { passive: true });
    target.addEventListener("touchmove", onTouch, { passive: true });
    target.addEventListener("touchend", () => (mx = my = -1e4), { passive: true });
    target.addEventListener("touchcancel", () => (mx = my = -1e4), { passive: true });

    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (cfg.onVisible) cfg.onVisible(visible);
    }).observe(canvas);

    // Watch the canvas itself, not the window: on phones the hero changes
    // height on Enter without any window resize, which left it stretched.
    new ResizeObserver(() => {
      if (canvas.clientWidth !== w || canvas.clientHeight !== h) resize();
    }).observe(canvas);
    resize();
    requestAnimationFrame(frame);

    return {
      // Scatter a share of all cells at once, used as a transition.
      scramble(share = 0.3, power = 9) {
        const n = cols * rows;
        const count = Math.floor(n * share);
        for (let k = 0; k < count; k++) {
          const i = (Math.random() * n) | 0;
          const a = Math.random() * Math.PI * 2;
          const p = power * (0.3 + Math.random());
          vx[i] += Math.cos(a) * p;
          vy[i] += Math.sin(a) * p;
          wake(i);
        }
      },
      setSource(idx) {
        if (idx === srcIndex) return;
        srcIndex = idx;
        crop = null;
        pixels = null;
        this.scramble(0.35, 10);
      },
      debug() {
        return { visible, frames, w, h, focusX: cfg.focusX };
      },
      // Let stuck cells (from the gate) fly home.
      release() {
        cfg.stick = false;
        for (const i of active) flags[i] &= ~2;
      },
      set(key, value) {
        cfg[key] = value;
        if (key === "focusX" || key === "focusY") crop = null;
      },
    };
  }

  /* =========================================================
     Hero loop + sound
     The loop carries the music, so it starts muted (browsers insist)
     and the Sound button, a click on the hero, or Enter on a phone
     turns it up.
     ========================================================= */
  const hero = document.querySelector(".hero");
  const heroVideo = document.querySelector("#hero-video");
  const heroCanvas = document.querySelector("#hero-canvas");
  const enterBtn = document.querySelector("#hero-enter");
  const soundBtn = document.querySelector("#sound-toggle");
  let soundOn = false;
  let soundChosen = false; // once the visitor picks, a stray click won't flip it
  let pauseScorePlayer = () => {};

  function setSound(on) {
    soundOn = on;
    heroVideo.muted = !on;
    if (on) {
      heroVideo.play().catch(() => {});
      pauseScorePlayer();
    }
    soundBtn.setAttribute("aria-pressed", String(on));
    soundBtn.querySelector(".sound-toggle__label").textContent = on ? "Sound off" : "Sound on";
  }

  soundBtn.addEventListener("click", () => {
    soundChosen = true;
    setSound(!soundOn);
  });

  if (reduceMotion) {
    heroVideo.preload = "none";
  } else {
    heroVideo.loop = true;
    heroVideo.muted = true;
    heroVideo.src = heroVideo.dataset.src;
    heroVideo.play().catch(() => {});
  }

  let heroField = null;
  if (!reduceMotion && heroCanvas instanceof HTMLCanvasElement) {
    const portrait = () => innerHeight > innerWidth;
    // A tall phone screen only fits a third of the wide frame, so the view
    // drifts from David (left) to the bass player and back once per loop.
    const PAN_FROM = 0.12;
    const PAN_TO = 0.65;
    const revealTarget = () => {
      const box = heroCanvas.getBoundingClientRect();
      const b = enterBtn.getBoundingClientRect();
      return { x: b.left - box.left, y: b.top - box.top, w: b.width, h: b.height };
    };
    const poster = new Image();
    poster.src = heroVideo.getAttribute("poster");
    heroField = createPixelField(heroCanvas, {
      sources: [heroVideo],
      poster,
      cell: finePointer ? 7 : 8,
      radius: finePointer ? 140 : 46,
      force: finePointer ? 7 : 5,
      jitter: finePointer ? 1.6 : 0.6,
      spring: finePointer ? 0.04 : 0.05,
      drag: finePointer ? 0.85 : 0.78,
      ring: finePointer,
      focusX: portrait() ? PAN_FROM : 0.5,
      pan: () => panFocus(),
      // Phones only play with the loop on the entry screen; after that a finger just scrolls.
      interactive: finePointer || showGate,
      stick: showGate,
      revealTarget: showGate ? revealTarget : null,
      onReveal: () => root.classList.add("is-gate-ready"),
      onTouch: () => hero.classList.add("is-touched"),
      onFirstDraw: () => {
        hero.classList.add("is-reel-ready");
        // The dissolve on arrival: the picture blows apart and settles.
        // On the gate, wipes only start sticking once it has settled.
        if (showGate) {
          heroField.set("stick", false);
          setTimeout(() => heroField.set("stick", true), 2400);
        }
        heroField.scramble(0.75, 15);
      },
      onVisible: (on) => {
        if (on) heroVideo.play().catch(() => {});
        else heroVideo.pause();
      },
    });
    // The pan runs on its own clock (Safari's video clock can't be trusted
    // to tick), and lines up with the video whenever the loop restarts.
    const loopLength = () => (isFinite(heroVideo.duration) && heroVideo.duration > 0 ? heroVideo.duration : 11.08);
    let loopStart = performance.now();
    let prevT = 0;
    const syncPan = () => {
      loopStart = performance.now() - heroVideo.currentTime * 1000;
      prevT = heroVideo.currentTime;
    };
    ["play", "seeked", "loadeddata"].forEach((ev) => heroVideo.addEventListener(ev, syncPan));
    function panFocus() {
      if (!portrait()) return 0.5;
      const t = heroVideo.currentTime;
      if (t + 0.5 < prevT) syncPan(); // the loop wrapped
      prevT = t;
      const dur = loopLength();
      const p = (((performance.now() - loopStart) / 1000) % dur) / dur;
      return PAN_FROM + (PAN_TO - PAN_FROM) * (0.5 - 0.5 * Math.cos(2 * Math.PI * p));
    }

    // ?debug=1 shows what the hero is doing, for checking on a real phone.
    if (params.get("debug") === "1") {
      const box = document.createElement("pre");
      box.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:9999;margin:0;padding:8px;background:rgba(0,0,0,.8);color:#7f7;font:11px/1.4 monospace;pointer-events:none;white-space:pre";
      document.body.append(box);
      let lastFrames = 0;
      setInterval(() => {
        const d = heroField.debug();
        box.textContent = [
          `video t ${heroVideo.currentTime.toFixed(2)} / ${heroVideo.duration}`,
          `paused ${heroVideo.paused} ready ${heroVideo.readyState}`,
          `focus ${d.focusX.toFixed(3)} portrait ${portrait()}`,
          `draws/s ${(d.frames - lastFrames) * 2} visible ${d.visible}`,
          `canvas ${d.w}x${d.h} screen ${innerWidth}x${innerHeight}`,
        ].join("\n");
        lastFrames = d.frames;
      }, 500);
    }

    if (showGate) {
      hero.querySelector(".hero__hint").textContent = "Wipe the screen to find Enter";
    }

    // Desktop: the first click on the picture brings the music in.
    heroCanvas.addEventListener("click", () => {
      if (!soundChosen && !soundOn && root.classList.contains("is-mouse")) {
        soundChosen = true;
        setSound(true);
      }
    });

    // Phone Enter: restart the loop with sound, scatter it, then open the site.
    enterBtn.addEventListener("click", () => {
      soundChosen = true;
      heroVideo.currentTime = 0;
      setSound(true);
      root.classList.remove("is-gate-ready");
      root.classList.add("is-entering");
      heroField.release();
      heroField.scramble(0.9, 18);
      try {
        sessionStorage.setItem("da-entered", "1");
      } catch {}
      setTimeout(() => {
        root.classList.remove("is-gate", "is-entering");
        root.classList.add("is-entered");
        heroField.set("interactive", false);
        window.scrollTo(0, 0);
      }, 1700);
    });
  }

  /* =========================================================
     Background: each section's wallpaper, dissolving into the next
     ========================================================= */
  const bgCanvas = document.querySelector("#bg-canvas");
  const moods = {
    quiet: { force: finePointer ? 5 : 3, radius: finePointer ? 150 : 60, opacity: 0.8 },
    loud: { force: finePointer ? 9 : 5, radius: finePointer ? 220 : 90, opacity: 1 },
  };
  let bgField = null;
  if (!reduceMotion && bgCanvas instanceof HTMLCanvasElement) {
    const walls = [1, 2, 3, 4].map((n) => {
      const img = new Image();
      img.src = `assets/img/wallpaper-${n}.jpg`;
      return img;
    });
    bgField = createPixelField(bgCanvas, {
      sources: walls,
      cell: finePointer ? 8 : 10,
      jitter: 1.2,
      spring: 0.03,
      drag: 0.88,
      globalPointer: true,
      interactive: finePointer,
      ...moods.quiet,
    });
  }

  const navLinks = document.querySelectorAll(".nav__links a");
  const sections = document.querySelectorAll("section[data-bg]");
  // Whichever section crosses the middle of the screen owns the background.
  const sectionWatch = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const s = e.target;
      const mood = s.dataset.mood || "quiet";
      document.body.classList.toggle("mood-loud", mood === "loud");
      navLinks.forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === `#${s.id}`));
      if (bgField) {
        bgField.setSource(Number(s.dataset.bg));
        Object.entries(moods[mood]).forEach(([k, v]) => bgField.set(k, v));
      }
    });
  }, { rootMargin: "-45% 0px -45% 0px" });
  sections.forEach((s) => sectionWatch.observe(s));

  /* =========================================================
     Score player: our controls, SoundCloud's widget underneath
     ========================================================= */
  const player = document.querySelector("#player");
  const scFrame = document.querySelector("#sc-widget");
  const fmt = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const fallback = () => player.classList.add("is-fallback");

  if (player && scFrame && window.SC && SC.Widget) {
    const widget = SC.Widget(scFrame);
    const E = SC.Widget.Events;
    const list = player.querySelector("#player-list");
    const titleEl = player.querySelector("#player-title");
    const artEl = player.querySelector("#player-art");
    const posEl = player.querySelector("#player-pos");
    const durEl = player.querySelector("#player-dur");
    const bar = player.querySelector("#player-bar");
    const fill = player.querySelector("#player-fill");
    let tracks = [];
    let duration = 0;
    let ready = false;
    let playTimer = 0;

    const readyTimer = setTimeout(() => !ready && fallback(), 12000);

    function renderList() {
      list.innerHTML = "";
      tracks.forEach((t, i) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        const name = document.createElement("span");
        name.textContent = (t && t.title) || `Track ${i + 1}`;
        const len = document.createElement("span");
        len.textContent = t && t.duration ? fmt(t.duration) : "";
        b.append(name, len);
        b.addEventListener("click", () => {
          requestPlay();
          widget.skip(i);
        });
        li.append(b);
        list.append(li);
      });
      if (!tracks.length) list.innerHTML = '<li class="player__loading">No tracks found. Open the reel on SoundCloud.</li>';
    }

    // A user page loads its tracks in stages, so ask again until the titles are in.
    function loadSounds(tries = 0) {
      widget.getSounds((sounds) => {
        tracks = sounds || [];
        renderList();
        markCurrent();
        if (tries < 6 && tracks.some((t) => !t || !t.title)) setTimeout(() => loadSounds(tries + 1), 1500);
      });
    }

    function markCurrent() {
      widget.getCurrentSoundIndex((idx) => {
        list.querySelectorAll("button").forEach((b, i) => b.classList.toggle("is-current", i === idx));
      });
    }

    function showSound(s) {
      if (!s) return;
      titleEl.textContent = s.title || "David Asher · Cinematic";
      const art = s.artwork_url || (s.user && s.user.avatar_url);
      if (art) artEl.src = art.replace("-large", "-t500x500");
      duration = s.duration || 0;
      durEl.textContent = fmt(duration);
    }

    // Some phones won't let a page start SoundCloud for you. If play never
    // arrives, hand over to SoundCloud's own player so one tap works.
    function requestPlay() {
      clearTimeout(playTimer);
      playTimer = setTimeout(() => {
        widget.isPaused((paused) => paused && fallback());
      }, 2500);
    }

    widget.bind(E.READY, () => {
      ready = true;
      clearTimeout(readyTimer);
      loadSounds();
      widget.getCurrentSound(showSound);
    });
    widget.bind(E.PLAY, () => {
      clearTimeout(playTimer);
      player.classList.add("is-playing");
      player.querySelector("#player-play").setAttribute("aria-label", "Pause");
      // One score at a time: the hero loop goes quiet.
      if (soundOn) setSound(false);
      widget.getCurrentSound(showSound);
      markCurrent();
    });
    const stopped = () => {
      player.classList.remove("is-playing");
      player.querySelector("#player-play").setAttribute("aria-label", "Play");
    };
    widget.bind(E.PAUSE, stopped);
    widget.bind(E.FINISH, stopped);
    widget.bind(E.PLAY_PROGRESS, (e) => {
      fill.style.width = `${e.relativePosition * 100}%`;
      posEl.textContent = fmt(e.currentPosition);
      bar.setAttribute("aria-valuenow", String(Math.round(e.relativePosition * 100)));
    });

    player.querySelector("#player-play").addEventListener("click", () => {
      widget.isPaused((paused) => {
        if (paused) requestPlay();
      });
      widget.toggle();
    });
    player.querySelector("#player-prev").addEventListener("click", () => widget.prev());
    player.querySelector("#player-next").addEventListener("click", () => widget.next());
    const seek = (ratio) => duration && widget.seekTo(Math.min(1, Math.max(0, ratio)) * duration);
    bar.addEventListener("click", (e) => {
      const r = bar.getBoundingClientRect();
      seek((e.clientX - r.left) / r.width);
    });
    bar.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      widget.getPosition((pos) => widget.seekTo(Math.max(0, pos + (e.key === "ArrowRight" ? 10000 : -10000))));
    });

    pauseScorePlayer = () => widget.pause();
  } else if (player) {
    fallback();
  }

  /* =========================================================
     Page chrome
     ========================================================= */
  const header = document.querySelector(".site-header");
  const onScroll = () => header.classList.toggle("is-scrolled", scrollY > 40);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const toggle = document.querySelector(".nav-toggle");
  const drawer = document.querySelector("#nav-drawer");
  if (toggle && drawer) {
    const setOpen = (open) => {
      toggle.setAttribute("aria-expanded", String(open));
      drawer.classList.toggle("is-open", open);
    };
    toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
    drawer.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setOpen(false)));
  }

  const reveals = document.querySelectorAll("[data-reveal]");
  if ("IntersectionObserver" in window && !reduceMotion) {
    // Replays every time: blocks fade out when they leave the screen and
    // rise back in from whichever edge they re-enter.
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        const el = e.target;
        if (e.isIntersecting) {
          el.classList.add("is-in");
        } else {
          el.dataset.from = e.boundingClientRect.top < 0 ? "above" : "below";
          el.classList.remove("is-in");
        }
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("is-in"));
  }

  /* ——— Contact form: composes an email ——— */
  const form = document.querySelector("#inquiry-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const get = (k) => String(data.get(k) || "").trim();
      const status = form.querySelector(".form-status");
      if (!get("name") || !get("email") || !get("message")) {
        status.textContent = "Please add your name, email, and a message.";
        return;
      }
      const subject = encodeURIComponent(`Scoring inquiry: ${get("project") || get("name")}`);
      const lines = [`Name: ${get("name")}`, `Email: ${get("email")}`];
      if (get("project")) lines.push(`Project: ${get("project")}`);
      lines.push("", get("message"));
      const body = encodeURIComponent(lines.join("\n"));
      status.textContent = "Opening your email app…";
      location.href = `mailto:${form.dataset.email}?subject=${subject}&body=${body}`;
    });
  }
})();
