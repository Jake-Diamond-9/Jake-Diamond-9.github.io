/*
 * Football field plot rendered on two stacked <canvas> layers.
 *
 * - Base layer: field turf, yard lines, hashes, and 2-step / 4-step gridlines.
 *   Drawn once on load, and only redrawn if the plot extent changes (e.g. the
 *   observer is moved further off the field) or the window is resized.
 * - Overlay layer: performer start/end markers, movement path, and observer
 *   marker. Redrawn on every calculation.
 */
"use strict";

class FieldPlot {
  constructor(container) {
    this.container = container;
    this.baseCanvas = container.querySelector(".field-base");
    this.overlayCanvas = container.querySelector(".field-overlay");

    // Current data extent (yards). Set to a sane default covering the field
    // plus the judges box apron; recomputed as markers demand.
    this.extent = null;
    this.markers = null;

    // Redraw everything on resize (base layer scale changes with CSS width).
    const ro = new ResizeObserver(() => {
      if (this.extent) {
        this._drawBase();
        this._drawOverlay();
      }
    });
    ro.observe(container);
  }

  /**
   * Show markers: { start: {x,y}, end: {x,y}, obs: {x,y} }.
   * Only redraws the base (gridline) layer when the required extent changes.
   */
  setMarkers(markers) {
    this.markers = markers;
    const required = this._requiredExtent(markers);
    if (!this.extent || !FieldPlot._extentEqual(this.extent, required)) {
      this.extent = required;
      this._drawBase();
    }
    this._drawOverlay();
  }

  _requiredExtent(markers) {
    const pad = 3;
    // Always show the whole field plus a small margin.
    let xMin = -pad;
    let xMax = FIELD.length + pad;
    let yMin = -pad;
    let yMax = FIELD.width + pad;
    if (markers) {
      for (const p of Object.values(markers)) {
        xMin = Math.min(xMin, p.x - pad);
        xMax = Math.max(xMax, p.x + pad);
        yMin = Math.min(yMin, p.y - pad);
        yMax = Math.max(yMax, p.y + pad);
      }
    }
    // Round outward to whole yards so tiny marker moves don't force redraws.
    return {
      xMin: Math.floor(xMin),
      xMax: Math.ceil(xMax),
      yMin: Math.floor(yMin),
      yMax: Math.ceil(yMax),
    };
  }

  static _extentEqual(a, b) {
    return (
      a.xMin === b.xMin && a.xMax === b.xMax && a.yMin === b.yMin && a.yMax === b.yMax
    );
  }

  /** Size a canvas to the container width with equal-aspect yards, HiDPI aware. */
  _setupCanvas(canvas) {
    const { xMin, xMax, yMin, yMax } = this.extent;
    const cssWidth = this.container.clientWidth;
    const cssHeight = (cssWidth * (yMax - yMin)) / (xMax - xMin);
    const dpr = window.devicePixelRatio || 1;

    canvas.style.width = cssWidth + "px";
    canvas.style.height = cssHeight + "px";
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    this.container.style.height = cssHeight + "px";

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._scale = cssWidth / (xMax - xMin);
    return ctx;
  }

  /** Field coords (yards) -> canvas CSS pixels. y axis is flipped. */
  _px(x, y) {
    return {
      px: (x - this.extent.xMin) * this._scale,
      py: (this.extent.yMax - y) * this._scale,
    };
  }

  _line(ctx, x1, y1, x2, y2) {
    const a = this._px(x1, y1);
    const b = this._px(x2, y2);
    ctx.beginPath();
    ctx.moveTo(a.px, a.py);
    ctx.lineTo(b.px, b.py);
    ctx.stroke();
  }

  _drawBase() {
    const ctx = this._setupCanvas(this.baseCanvas);
    const { xMin, xMax, yMin, yMax } = this.extent;
    const W = (xMax - xMin) * this._scale;
    const H = (yMax - yMin) * this._scale;

    // Out-of-bounds apron (darker turf) and playing field
    ctx.fillStyle = "#2f5e34";
    ctx.fillRect(0, 0, W, H);
    const tl = this._px(0, FIELD.width);
    ctx.fillStyle = "#41804a";
    ctx.fillRect(tl.px, tl.py, FIELD.length * this._scale, FIELD.width * this._scale);

    const step = FIELD.ydLineDist; // 5 yd

    // Alternating 5-yard mowing stripes
    ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
    for (let x = step; x < FIELD.length; x += 2 * step) {
      const p = this._px(x, FIELD.width);
      ctx.fillRect(p.px, p.py, step * this._scale, FIELD.width * this._scale);
    }

    // 2-step gridlines (every 1.25 yd), faint
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= FIELD.length + 1e-9; x += step / 4) {
      this._line(ctx, x, 0, x, FIELD.width);
    }
    for (let y = 0; y < FIELD.width; y += step / 4) {
      this._line(ctx, 0, y, FIELD.length, y);
    }

    // 4-step gridlines (every 2.5 yd)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 0.75;
    for (let x = 0; x <= FIELD.length + 1e-9; x += step / 2) {
      this._line(ctx, x, 0, x, FIELD.width);
    }
    for (let y = 0; y < FIELD.width; y += step / 2) {
      this._line(ctx, 0, y, FIELD.length, y);
    }

    // Yard lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 1.25;
    for (let x = 0; x <= FIELD.length + 1e-9; x += step) {
      this._line(ctx, x, 0, x, FIELD.width);
    }

    // Sidelines and hashes
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    this._line(ctx, 0, 0, FIELD.length, 0);
    this._line(ctx, 0, FIELD.width, FIELD.length, FIELD.width);
    ctx.lineWidth = 1.5;
    this._line(ctx, 0, FIELD.frontHash, FIELD.length, FIELD.frontHash);
    this._line(ctx, 0, FIELD.backHash, FIELD.length, FIELD.backHash);

    // Yard number labels just below the front sideline
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.font =
      "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const labels = ["G", "10", "20", "30", "40", "50", "40", "30", "20", "10", "G"];
    labels.forEach((label, i) => {
      const p = this._px(i * 10, 0);
      ctx.fillText(label, p.px, p.py + 5);
    });
  }

  _drawOverlay() {
    const ctx = this._setupCanvas(this.overlayCanvas);
    if (!this.markers) return;
    const { start, end, obs } = this.markers;

    this._arrow(ctx, start, end);
    this._marker(ctx, start, "circle-open", "#d63a3a");
    this._marker(ctx, end, "circle", "#d63a3a");
    this._marker(ctx, obs, "square", "#2b62d9");
  }

  /** Arrow from start to end, trimmed so it doesn't cover the markers. */
  _arrow(ctx, start, end) {
    const a = this._px(start.x, start.y);
    const b = this._px(end.x, end.y);
    const dx = b.px - a.px;
    const dy = b.py - a.py;
    const len = Math.hypot(dx, dy);
    const trim = 9; // marker radius + a little breathing room
    if (len < 2 * trim + 4) return; // too short to draw an arrow
    const ux = dx / len;
    const uy = dy / len;
    const x1 = a.px + ux * trim;
    const y1 = a.py + uy * trim;
    const x2 = b.px - ux * trim;
    const y2 = b.py - uy * trim;

    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.lineWidth = 2;

    // Shaft (stop short of the arrowhead)
    const head = 10;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2 - ux * head * 0.8, y2 - uy * head * 0.8);
    ctx.stroke();

    // Filled arrowhead
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - ux * head - uy * head * 0.45, y2 - uy * head + ux * head * 0.45);
    ctx.lineTo(x2 - ux * head + uy * head * 0.45, y2 - uy * head - ux * head * 0.45);
    ctx.closePath();
    ctx.fill();
  }

  _marker(ctx, pos, shape, color) {
    const { px, py } = this._px(pos.x, pos.y);
    const r = 6;
    ctx.beginPath();
    if (shape === "circle-open") {
      // Open circle: red border, no fill
      ctx.arc(px, py, r, 0, 2 * Math.PI);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    } else if (shape === "circle") {
      ctx.arc(px, py, r, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (shape === "square") {
      ctx.rect(px - r, py - r, 2 * r, 2 * r);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}
