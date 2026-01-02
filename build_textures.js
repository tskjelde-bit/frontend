// build_textures.js
// Lager mask-teksturer (2:1 equirect) fra ./oslo_bydeler.geojson
// Output:
//  - ./oslo_landmask.png  (hvit = Oslo-land, svart = hav)
//  - ./oslo_borders.png   (hvit = bydelsgrenser, svart = ellers)
//
// Kjør:
//   node build_textures.js
//
// Avhengigheter (har du allerede):
//   npm i canvas earcut

import fs from "node:fs";
import { createCanvas } from "canvas";

// ---------- CONFIG ----------
const CONFIG = {
  inputGeoJson: "./oslo_bydeler.geojson",
  width: 2048,
  height: 1024,
  padPx: 48,

  // Borders (på egen mask)
  borderWidth: 5, // tykkelse på “linjen” i masken
  borderBlurPx: 0, // 0 = skarp; du kan øke til 1–2 om du vil
};

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function loadGeoJSON(file) {
  const raw = fs.readFileSync(file, "utf8");
  const gj = JSON.parse(raw);
  assert(
    gj && gj.type === "FeatureCollection",
    "GeoJSON må være FeatureCollection",
  );
  assert(
    Array.isArray(gj.features) && gj.features.length > 0,
    "GeoJSON har ingen features",
  );
  return gj;
}

function computeBounds(features) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  const scanRing = (ring) => {
    for (const pt of ring) {
      const [x, y] = pt;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  };

  for (const f of features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "Polygon") {
      for (const ring of g.coordinates) scanRing(ring);
    } else if (g.type === "MultiPolygon") {
      for (const poly of g.coordinates) for (const ring of poly) scanRing(ring);
    }
  }

  assert(Number.isFinite(minX), "Klarte ikke å beregne bounds");
  return { minX, minY, maxX, maxY };
}

function makeProjector(bounds, width, height, padPx) {
  const innerW = width - padPx * 2;
  const innerH = height - padPx * 2;

  const dataW = bounds.maxX - bounds.minX;
  const dataH = bounds.maxY - bounds.minY;
  assert(dataW > 0 && dataH > 0, "Ugyldige bounds");

  const scale = Math.min(innerW / dataW, innerH / dataH);
  const drawW = dataW * scale;
  const drawH = dataH * scale;

  const offX = padPx + (innerW - drawW) / 2;
  const offY = padPx + (innerH - drawH) / 2;

  return (x, y) => {
    const px = offX + (x - bounds.minX) * scale;
    const py = offY + (bounds.maxY - y) * scale; // flip Y
    return [px, py];
  };
}

function drawPolygonPath(ctx, geom, project) {
  const moveRing = (ring) => {
    if (!ring || ring.length < 2) return;
    const [sx, sy] = project(ring[0][0], ring[0][1]);
    ctx.moveTo(sx, sy);
    for (let i = 1; i < ring.length; i++) {
      const [x, y] = project(ring[i][0], ring[i][1]);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
  };

  if (geom.type === "Polygon") {
    for (const ring of geom.coordinates) moveRing(ring);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates)
      for (const ring of poly) moveRing(ring);
  }
}

const gj = loadGeoJSON(CONFIG.inputGeoJson);

const feats = gj.features.filter(
  (f) =>
    f.geometry &&
    (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"),
);
assert(feats.length > 0, "Ingen Polygon/MultiPolygon features i GeoJSON.");

const bounds = computeBounds(feats);
const project = makeProjector(
  bounds,
  CONFIG.width,
  CONFIG.height,
  CONFIG.padPx,
);

// --- Land mask (fill: hvit) ---
const landCanvas = createCanvas(CONFIG.width, CONFIG.height);
const landCtx = landCanvas.getContext("2d");

// svart bakgrunn
landCtx.fillStyle = "#000000";
landCtx.fillRect(0, 0, CONFIG.width, CONFIG.height);

// fyll alle bydeler hvite (union på raster-nivå)
landCtx.fillStyle = "#ffffff";
for (const f of feats) {
  landCtx.beginPath();
  drawPolygonPath(landCtx, f.geometry, project);
  landCtx.fill("evenodd");
}

// --- Borders mask (stroke: hvit) ---
const borderCanvas = createCanvas(CONFIG.width, CONFIG.height);
const borderCtx = borderCanvas.getContext("2d");

// svart bakgrunn
borderCtx.fillStyle = "#000000";
borderCtx.fillRect(0, 0, CONFIG.width, CONFIG.height);

borderCtx.strokeStyle = "#ffffff";
borderCtx.lineWidth = CONFIG.borderWidth;
borderCtx.lineJoin = "round";
borderCtx.lineCap = "round";

if (CONFIG.borderBlurPx > 0) {
  borderCtx.shadowColor = "#ffffff";
  borderCtx.shadowBlur = CONFIG.borderBlurPx;
}

for (const f of feats) {
  borderCtx.beginPath();
  drawPolygonPath(borderCtx, f.geometry, project);
  borderCtx.stroke();
}

fs.writeFileSync("./oslo_landmask.png", landCanvas.toBuffer("image/png"));
fs.writeFileSync("./oslo_borders.png", borderCanvas.toBuffer("image/png"));

console.log("OK: skrev oslo_landmask.png og oslo_borders.png");
