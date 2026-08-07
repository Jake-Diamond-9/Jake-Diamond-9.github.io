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

    // Apron (out of bounds) and turf
    ctx.fillStyle = "#e9ede9";
    ctx.fillRect(0, 0, W, H);
    const tl = this._px(0, FIELD.width);
    ctx.fillStyle = "#f2f7f0";
    ctx.fillRect(tl.px, tl.py, FIELD.length * this._scale, FIELD.width * this._scale);

    const step = FIELD.ydLineDist; // 5 yd

    // 2-step gridlines (every 1.25 yd), faint
    ctx.strokeStyle = "rgba(128, 128, 128, 0.35)";
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= FIELD.length + 1e-9; x += step / 4) {
      this._line(ctx, x, 0, x, FIELD.width);
    }
    for (let y = 0; y < FIELD.width; y += step / 4) {
      this._line(ctx, 0, y, FIELD.length, y);
    }

    // 4-step gridlines (every 2.5 yd)
    ctx.strokeStyle = "rgba(128, 128, 128, 0.7)";
    ctx.lineWidth = 0.75;
    for (let x = 0; x <= FIELD.length + 1e-9; x += step / 2) {
      this._line(ctx, x, 0, x, FIELD.width);
    }
    for (let y = 0; y < FIELD.width; y += step / 2) {
      this._line(ctx, 0, y, FIELD.length, y);
    }

    // Yard lines
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 1;
    for (let x = 0; x <= FIELD.length + 1e-9; x += step) {
      this._line(ctx, x, 0, x, FIELD.width);
    }

    // Sidelines and hashes
    ctx.lineWidth = 1.5;
    this._line(ctx, 0, 0, FIELD.length, 0);
    this._line(ctx, 0, FIELD.width, FIELD.length, FIELD.width);
    this._line(ctx, 0, FIELD.frontHash, FIELD.length, FIELD.frontHash);
    this._line(ctx, 0, FIELD.backHash, FIELD.length, FIELD.backHash);

    // Yard number labels just below the front sideline
    ctx.fillStyle = "#444";
    ctx.font =
      "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const labels = ["G", "10", "20", "30", "40", "50", "40", "30", "20", "10", "G"];
    labels.forEach((label, i) => {
      const p = this._px(i * 10, 0);
      ctx.fillText(label, p.px, p.py + 4);
    });
  }

  _drawOverlay() {
    const ctx = this._setupCanvas(this.overlayCanvas);
    if (!this.markers) return;
    const { start, end, obs } = this.markers;

    // Movement path
    ctx.strokeStyle = "rgba(60, 60, 60, 0.8)";
    ctx.lineWidth = 1.25;
    ctx.setLineDash([5, 4]);
    this._line(ctx, start.x, start.y, end.x, end.y);
    ctx.setLineDash([]);

    this._marker(ctx, start, "diamond", "#2e9e44");
    this._marker(ctx, end, "circle", "#d63a3a");
    this._marker(ctx, obs, "square", "#2b62d9");
  }

  _marker(ctx, pos, shape, color) {
    const { px, py } = this._px(pos.x, pos.y);
    const r = 6;
    ctx.fillStyle = color;
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (shape === "circle") {
      ctx.arc(px, py, r, 0, 2 * Math.PI);
    } else if (shape === "square") {
      ctx.rect(px - r, py - r, 2 * r, 2 * r);
    } else if (shape === "diamond") {
      ctx.moveTo(px, py - r * 1.2);
      ctx.lineTo(px + r * 1.2, py);
      ctx.lineTo(px, py + r * 1.2);
      ctx.lineTo(px - r * 1.2, py);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
  }
}
