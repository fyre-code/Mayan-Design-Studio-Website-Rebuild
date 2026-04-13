/* ═══════════════════════════════════════════════════════════
   MAYAN DESIGN STUDIO — main.js
   1. Floor-plan canvas animation (hero background)
   2. Header transparency on scroll
   3. Scroll-reveal for sections
   4. Footer year
   ═══════════════════════════════════════════════════════════ */

'use strict';

/* ── 1. FLOOR PLAN CANVAS ANIMATION ─────────────────────── */

/**
 * Room templates — each path is an array of [x, y] normalised
 * to a ~100×100 unit grid. The renderer scales and positions them.
 */
const ROOM_TEMPLATES = {
  kitchen: {
    baseW: 110, baseH: 90,
    paths: [
      // Perimeter
      [[0,0],[110,0],[110,90],[0,90],[0,0]],
      // Island
      [[22,22],[70,22],[70,58],[22,58],[22,22]],
      // Sink ledge (top-right notch)
      [[82,0],[82,18],[110,18]],
      // Right counter
      [[100,18],[100,82]],
      // Door opening (bottom-left)
      [[0,72],[0,90]],
    ]
  },

  livingRoom: {
    baseW: 130, baseH: 105,
    paths: [
      // Perimeter
      [[0,0],[130,0],[130,105],[0,105],[0,0]],
      // Sofa
      [[8,65],[82,65],[82,90],[8,90],[8,65]],
      // Coffee table
      [[22,44],[68,44],[68,60],[22,60],[22,44]],
      // TV unit / media wall
      [[12,0],[12,12],[98,12],[98,0]],
      // Fireplace nook (right wall)
      [[112,28],[112,68],[130,68],[130,28]],
      // Door (bottom)
      [[55,105],[80,105]],
    ]
  },

  study: {
    baseW: 95, baseH: 85,
    paths: [
      // Perimeter
      [[0,0],[95,0],[95,85],[0,85],[0,0]],
      // L-shaped desk
      [[10,8],[62,8],[62,32],[36,32],[36,58],[10,58],[10,8]],
      // Bookcase (right wall)
      [[72,4],[82,4],[82,80],[72,80],[72,4]],
      // Shelf dividers
      [[72,24],[82,24]],
      [[72,44],[82,44]],
      [[72,64],[82,64]],
      // Chair (small square)
      [[16,40],[30,40],[30,56],[16,56],[16,40]],
      // Door
      [[0,68],[0,85]],
    ]
  },

  office: {
    baseW: 170, baseH: 125,
    paths: [
      // Perimeter
      [[0,0],[170,0],[170,125],[0,125],[0,0]],
      // Workstation cluster A (top)
      [[10,8],[52,8],[52,36],[10,36],[10,8]],
      [[58,8],[100,8],[100,36],[58,36],[58,8]],
      [[106,8],[148,8],[148,36],[106,36],[106,8]],
      // Conference table (centre)
      [[18,55],[152,55],[152,110],[18,110],[18,55]],
      // Chair marks — top of table
      [[36,53],[36,57]], [[58,53],[58,57]], [[80,53],[80,57]],
      [[102,53],[102,57]], [[124,53],[124,57]],
      // Chair marks — bottom of table
      [[36,108],[36,112]], [[58,108],[58,112]], [[80,108],[80,112]],
      [[102,108],[102,112]], [[124,108],[124,112]],
      // Side door
      [[0,85],[0,110]],
    ]
  }
};

/* ── Canvas drawing helpers ─────────────────────────────── */

/**
 * Calculate the total arc length of a polyline.
 * Returns an array of segment descriptors + totalLength.
 */
function measurePath(points) {
  const segments = [];
  let totalLen = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    const len = Math.sqrt(dx * dx + dy * dy);
    segments.push({ from: points[i - 1], to: points[i], len, cumStart: totalLen });
    totalLen += len;
  }
  return { segments, totalLen };
}

/**
 * Draw a fraction `progress` (0–1) of a measured polyline.
 */
function drawPartialPath(ctx, segments, totalLen, progress) {
  if (!segments.length || progress <= 0) return;
  const drawLen = progress * totalLen;
  ctx.beginPath();
  ctx.moveTo(segments[0].from[0], segments[0].from[1]);
  for (const seg of segments) {
    if (seg.cumStart >= drawLen) break;
    const available = drawLen - seg.cumStart;
    const t = Math.min(1, available / seg.len);
    ctx.lineTo(
      seg.from[0] + (seg.to[0] - seg.from[0]) * t,
      seg.from[1] + (seg.to[1] - seg.from[1]) * t
    );
  }
  ctx.stroke();
}

/* ── Pre-measure all room templates ─────────────────────── */
const ROOM_MEASURED = {};
for (const [key, tmpl] of Object.entries(ROOM_TEMPLATES)) {
  const measured = tmpl.paths.map(pts => measurePath(pts));
  const totalLen = measured.reduce((s, m) => s + m.totalLen, 0);
  ROOM_MEASURED[key] = { ...tmpl, measured, totalLen };
}
const TEMPLATE_KEYS = Object.keys(ROOM_MEASURED);

/* ── FloorPlanCanvas class ──────────────────────────────── */
class FloorPlanCanvas {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.rooms  = [];

    // Timing
    this.DRAW_DURATION  = 4200;  // ms to draw a full room
    this.HOLD_DURATION  = 2400;  // ms to hold at full opacity
    this.FADE_DURATION  = 1800;  // ms to fade out
    this.MAX_ACTIVE     = 5;     // rooms visible at once
    this.SPAWN_INTERVAL = 1600;  // ms between spawns

    // Appearance
    this.LINE_COLOR = '#8FAF8C';
    this.MAX_ALPHA  = 0.28;
    this.LINE_WIDTH = 1.5;

    this._lastTime  = null;
    this._spawnTimer = 0;

    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Stagger initial spawn
    const initCount = Math.min(3, this.MAX_ACTIVE);
    for (let i = 0; i < initCount; i++) {
      setTimeout(() => this._spawnRoom(), i * this.SPAWN_INTERVAL * 0.6);
    }

    requestAnimationFrame(t => this._tick(t));
  }

  resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  _spawnRoom() {
    const key  = TEMPLATE_KEYS[Math.floor(Math.random() * TEMPLATE_KEYS.length)];
    const tmpl = ROOM_MEASURED[key];

    // Random scale — slightly larger on wide screens
    const baseScale = 1.6 + Math.random() * 1.8;

    const scaledW = tmpl.baseW * baseScale;
    const scaledH = tmpl.baseH * baseScale;

    const margin = 60;
    const maxX   = this.canvas.width  - scaledW - margin;
    const maxY   = this.canvas.height - scaledH - margin;

    const x = margin + Math.random() * Math.max(0, maxX - margin);
    const y = margin + Math.random() * Math.max(0, maxY - margin);

    this.rooms.push({
      key, tmpl,
      x, y,
      scale: baseScale,
      elapsed: 0,
      alpha: 0,
      phase: 'drawing',   // drawing | holding | fading
    });
  }

  _easeInOut(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  _tick(timestamp) {
    const dt = this._lastTime === null ? 16 : Math.min(timestamp - this._lastTime, 60);
    this._lastTime = timestamp;

    // Clear
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Spawn logic
    this._spawnTimer += dt;
    if (this._spawnTimer >= this.SPAWN_INTERVAL && this.rooms.length < this.MAX_ACTIVE) {
      this._spawnRoom();
      this._spawnTimer = 0;
    }

    // Update + draw each room
    this.rooms = this.rooms.filter(room => {
      room.elapsed += dt;

      if (room.phase === 'drawing') {
        const t = Math.min(1, room.elapsed / this.DRAW_DURATION);
        room.drawProgress = this._easeInOut(t);
        room.alpha = Math.min(this.MAX_ALPHA, (t / 0.15) * this.MAX_ALPHA);
        if (t >= 1) { room.phase = 'holding'; room.elapsed = 0; }

      } else if (room.phase === 'holding') {
        room.drawProgress = 1;
        room.alpha = this.MAX_ALPHA;
        if (room.elapsed >= this.HOLD_DURATION) { room.phase = 'fading'; room.elapsed = 0; }

      } else if (room.phase === 'fading') {
        const t = Math.min(1, room.elapsed / this.FADE_DURATION);
        room.drawProgress = 1;
        room.alpha = this.MAX_ALPHA * (1 - this._easeInOut(t));
        if (t >= 1) {
          // Replace this room with a fresh one
          this._spawnRoom();
          return false;
        }
      }

      this._drawRoom(room);
      return true;
    });

    requestAnimationFrame(t => this._tick(t));
  }

  _drawRoom(room) {
    const ctx  = this.ctx;
    const tmpl = room.tmpl;

    ctx.save();
    ctx.globalAlpha = room.alpha;
    ctx.strokeStyle = this.LINE_COLOR;
    ctx.lineWidth   = this.LINE_WIDTH / room.scale;  // keeps lines crisp at any scale
    ctx.lineCap     = 'square';
    ctx.lineJoin    = 'miter';
    ctx.translate(room.x, room.y);
    ctx.scale(room.scale, room.scale);

    // Distribute drawProgress across all paths by cumulative length
    const drawLen = room.drawProgress * tmpl.totalLen;
    let drawn = 0;

    for (let pi = 0; pi < tmpl.measured.length; pi++) {
      if (drawn >= drawLen) break;
      const m = tmpl.measured[pi];
      if (m.totalLen === 0) continue;
      const available = drawLen - drawn;
      const pathProgress = Math.min(1, available / m.totalLen);
      drawPartialPath(ctx, m.segments, m.totalLen, pathProgress);
      drawn += m.totalLen;
    }

    ctx.restore();
  }
}

/* ── Initialise canvas ──────────────────────────────────── */
function initHeroCanvas() {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;
  new FloorPlanCanvas(canvas);
}

/* ── 2. HEADER SCROLL BEHAVIOUR ─────────────────────────── */
// Header scrolls with the page — no scroll listener needed.
function initHeader() {}

/* ── 3. SCROLL REVEAL — removed per design ──────────────── */
function initScrollReveal() {}

/* ── 4. FOOTER YEAR ─────────────────────────────────────── */
function initFooterYear() {
  const el = document.getElementById('footer-year');
  if (el) el.textContent = new Date().getFullYear();
}

/* ── 5. TESTIMONIAL CAROUSEL ────────────────────────────── */
function initTestimonialCarousel() {
  const imgs    = Array.from(document.querySelectorAll('.tc-img'));
  const dots    = Array.from(document.querySelectorAll('.tc-dot'));
  const prevBtn = document.querySelector('.tc-prev');
  const nextBtn = document.querySelector('.tc-next');
  const qText   = document.querySelector('.tc-quote__text');
  const qName   = document.querySelector('.tc-quote__name');
  const qRole   = document.querySelector('.tc-quote__role');

  if (!imgs.length) return;

  const QUOTES = [
    {
      text: '"Working with Mayan Design Studio completely transformed our office. The team understood our brand vision immediately and delivered something that exceeded every expectation. Our clients notice the difference the moment they walk in."',
      name: 'Sarah M.',
      role: 'Law Firm Owner, Brevard County'
    },
    {
      text: '"Our home renovation was a dream experience from consultation through installation. Every detail was thoughtful and intentional. We finally have a home that feels like us — and we couldn\'t be happier."',
      name: 'James & Lisa T.',
      role: 'Residential Clients, Indian Harbour Beach'
    },
    {
      text: '"As a local contractor, partnering with Mayan Design Studio has been invaluable. Their specifications are clear, their communication is excellent, and their clients are always thrilled. It\'s a pleasure to build what they design."',
      name: 'Roberto A.',
      role: 'General Contractor, Space Coast'
    }
  ];

  // Each slide maps to a quote (2 slides per quote)
  const SLIDE_QUOTE = [0, 0, 1, 1, 2, 2];

  let current = 0;
  let autoTimer;

  const INTERVAL = 5000;

  function show(index) {
    const next = ((index % imgs.length) + imgs.length) % imgs.length;

    imgs[current].classList.remove('active');
    dots[current].classList.remove('active');
    dots[current].setAttribute('aria-selected', 'false');

    current = next;

    imgs[current].classList.add('active');
    dots[current].classList.add('active');
    dots[current].setAttribute('aria-selected', 'true');

    // Update quote
    const q = QUOTES[SLIDE_QUOTE[current]];
    qText.style.opacity = '0';
    setTimeout(() => {
      qText.textContent  = q.text;
      qName.textContent  = q.name;
      qRole.textContent  = q.role;
      qText.style.opacity = '1';
    }, 220);
  }

  function startTimer() {
    clearInterval(autoTimer);
    autoTimer = setInterval(() => show(current + 1), INTERVAL);
  }

  prevBtn.addEventListener('click', () => { show(current - 1); startTimer(); });
  nextBtn.addEventListener('click', () => { show(current + 1); startTimer(); });
  dots.forEach((dot, i) => dot.addEventListener('click', () => { show(i); startTimer(); }));

  // Initialise first slide
  show(0);
  startTimer();
}

/* ── 6. CALL NOW — DESKTOP CLICK PREVENTION ─────────────── */
/**
 * On desktop (mouse/trackpad devices), the "Call Now" button
 * shows as a button but takes no action when clicked.
 * On mobile/touch devices the tel: href works normally.
 *
 * Detection: `(hover: hover) and (pointer: fine)` matches
 * desktops/laptops with a precise pointer; touch-only devices
 * do not match this query.
 */
function initCallButtons() {
  const isDesktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (!isDesktop) return;

  document.querySelectorAll('.btn--call').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
    });
  });
}

/* ── Bootstrap ──────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initHeroCanvas();
  initHeader();
  initScrollReveal();
  initTestimonialCarousel();
  initFooterYear();
  initCallButtons();
});
