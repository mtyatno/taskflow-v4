"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

describe("Unified Offline Drawing Reactivity - Local Event Reactivity", () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");

  // Extract DrawingTabInstance component block (from function DrawingTabInstance up to function DrawPage)
  const dtiStart = indexHtml.indexOf("function DrawingTabInstance");
  const dtiEnd = indexHtml.indexOf("function DrawPage", dtiStart);
  const drawingTabInstanceCode = dtiStart !== -1 && dtiEnd !== -1 ? indexHtml.slice(dtiStart, dtiEnd) : "";

  // Extract QuickDrawModal component block
  const qdmStart = indexHtml.indexOf("function QuickDrawModal");
  const qdmEnd = indexHtml.indexOf("function ", qdmStart + 25);
  const quickDrawModalCode = qdmStart !== -1 && qdmEnd !== -1 ? indexHtml.slice(qdmStart, qdmEnd) : "";

  // Extract DrawPage selectDrawing block
  const selectDrawingMatch = indexHtml.match(/const selectDrawing = async d => \{[\s\S]*?\n  \};/);
  const selectDrawingCode = selectDrawingMatch ? selectDrawingMatch[0] : "";

  it("DrawingTabInstance handles local drawingSaved events without sync source guard", () => {
    assert.ok(drawingTabInstanceCode.length > 0, "DrawingTabInstance component must be present in index.html");
    assert.doesNotMatch(
      drawingTabInstanceCode,
      /if\s*\(\s*e\.detail\?\.source\s*===\s*['"]sync['"]\s*\|\|\s*e\.detail\?\.remote\s*\)/,
      "DrawingTabInstance must NOT filter drawingSaved with sync/remote guard"
    );
    assert.match(
      drawingTabInstanceCode,
      /window\.addEventListener\(\s*["']drawingSaved["']\s*,\s*handler\s*\)/,
      "DrawingTabInstance must listen to drawingSaved event"
    );
    assert.match(
      drawingTabInstanceCode,
      /api\.get\(`\/api\/drawings\/\$\{tab\.id\}`\)/,
      "DrawingTabInstance must fetch fresh drawing data via api.get"
    );
    assert.match(
      drawingTabInstanceCode,
      /fresh\.data_json\s*===\s*lastLoadedJsonRef\.current/,
      "DrawingTabInstance must deduplicate with lastLoadedJsonRef"
    );
  });

  it("QuickDrawModal handles local drawingSaved events without sync source guard", () => {
    assert.ok(quickDrawModalCode.length > 0, "QuickDrawModal component must be present in index.html");
    assert.doesNotMatch(
      quickDrawModalCode,
      /if\s*\(\s*e\.detail\?\.source\s*===\s*['"]sync['"]\s*\|\|\s*e\.detail\?\.remote\s*\)/,
      "QuickDrawModal must NOT filter drawingSaved with sync/remote guard"
    );
    assert.match(
      quickDrawModalCode,
      /window\.addEventListener\(\s*["']drawingSaved["']\s*,\s*handler\s*\)/,
      "QuickDrawModal must listen to drawingSaved event"
    );
    assert.match(
      quickDrawModalCode,
      /api\.get\(`\/api\/drawings\/\$\{drawingId\}`\)/,
      "QuickDrawModal must fetch fresh drawing data via api.get"
    );
    assert.match(
      quickDrawModalCode,
      /fresh\.data_json\s*===\s*lastLoadedJsonRef\.current/,
      "QuickDrawModal must deduplicate with lastLoadedJsonRef"
    );
    assert.match(
      quickDrawModalCode,
      /350/,
      "QuickDrawModal must use safe 350ms close timeout"
    );
  });

  it("DrawPage selectDrawing uses api.get instead of __syncRawFetch bypass", () => {
    assert.ok(selectDrawingCode, "selectDrawing function must be present in index.html");
    assert.doesNotMatch(
      selectDrawingCode,
      /__syncRawFetch/,
      "selectDrawing must NOT use __syncRawFetch network bypass"
    );
    assert.match(
      selectDrawingCode,
      /api\.get\(`\/api\/drawings\/\$\{(?:d\.id|drawId)\}`\)/,
      "selectDrawing must use offline router api.get"
    );
  });

  it("draw-app App.jsx signals ready on mount and eliminates rogue network fetch", () => {
    const appJsx = fs.readFileSync(path.join(__dirname, "../../draw-app/src/App.jsx"), "utf8");
    assert.match(
      appJsx,
      /window\.parent\.postMessage\(\{\s*type:\s*['"]ready['"],\s*noteId\s*\},/
    );
    assert.doesNotMatch(
      appJsx,
      /fetch\s*\(\s*`?\/api\/drawings\//,
      "App.jsx must NOT perform direct network fetch to /api/drawings/"
    );
    assert.match(
      appJsx,
      /e\.data\?\.type\s*===\s*['"]load['"]/,
      "App.jsx must listen for 'load' type messages from parent"
    );
  });

  it("compiled tldraw vendor bundle exists and contains ready handshake", () => {
    const bundlePath = path.join(__dirname, "../../static/vendor/tldraw/assets/index.js");
    assert.ok(fs.existsSync(bundlePath), "Production bundle index.js must exist");
    const bundleContent = fs.readFileSync(bundlePath, "utf8");
    assert.match(bundleContent, /type:\s*["']ready["']/);
    assert.match(bundleContent, /["']load["']/);
    assert.match(bundleContent, /["']requestSnapshot["']/);
  });
});


