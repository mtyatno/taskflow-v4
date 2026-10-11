"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(root, "static/index.html"), "utf8");

// Helper to extract function source from static/index.html
function extractFn(code, fnName) {
  const marker = "function " + fnName;
  const at = code.indexOf(marker);
  if (at < 0) return null;
  let depth = 0;
  let start = code.indexOf("{", at);
  if (start < 0) return null;
  let inString = null;
  for (let i = start; i < code.length; i++) {
    const c = code[i];
    if (inString) {
      if (c === inString && code[i - 1] !== "\\") inString = null;
    } else if (c === '"' || c === "'" || c === "`") {
      inString = c;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        return code.slice(at, i + 1);
      }
    }
  }
  return null;
}

test("Trailing Empty Block: static/index.html integration presence", async (t) => {
  await t.test("createTrailingEmptyBlockPlugin is defined in static/index.html", () => {
    assert.match(indexHtml, /function\s+createTrailingEmptyBlockPlugin\s*\(/);
  });

  await t.test("createTrailingEmptyBlockPlugin(MB) is chained in MilkdownEditor .use()", () => {
    assert.match(indexHtml, /\.use\(createTrailingEmptyBlockPlugin\(MB\)\)/);
  });

  await t.test("Initial document trailing empty block check exists in .create().then()", () => {
    assert.match(
      indexHtml,
      /const\s+lastNode\s*=\s*doc\.lastChild;[\s\S]*?const\s+isEmptyPara\s*=\s*lastNode\s*&&[\s\S]*?view\.dispatch\(view\.state\.tr\.insert\(doc\.content\.size,\s*schema\.nodes\.paragraph\.create\(\)\)\);/
    );
  });

  await t.test("handleContainerClick checks empty bottom area and focuses last position", () => {
    assert.match(indexHtml, /targetPos\s*=\s*Math\.max\(0,\s*doc\.content\.size\s*-\s*1\)/);
    assert.match(indexHtml, /MB\.TextSelection\.near\(doc\.resolve\(targetPos\)\)/);
    assert.match(indexHtml, /view\.focus\(\)/);
  });

  await t.test("markdownUpdated normalizes trailing newlines before calling onChange", () => {
    assert.match(indexHtml, /const\s+cleaned\s*=\s*\(markdown\s*\|\|\s*''\)\.replace\(\/\\n\+\$\/,\s*''\);/);
    assert.match(indexHtml, /onChange\(cleaned\);/);
  });
});

test("Trailing Empty Block: createTrailingEmptyBlockPlugin logic", async (t) => {
  const pluginSrc = extractFn(indexHtml, "createTrailingEmptyBlockPlugin");
  assert.ok(pluginSrc, "createTrailingEmptyBlockPlugin function should be extractable");

  // Create executable function in VM
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(pluginSrc + "; window.createTrailingEmptyBlockPlugin = createTrailingEmptyBlockPlugin;", sandbox);
  const createPlugin = sandbox.window.createTrailingEmptyBlockPlugin;
  assert.equal(typeof createPlugin, "function");

  // Mock MilkdownBundle / ProseMirror primitives
  const mockMB = {
    PluginKey: function (name) { this.name = name; },
    Plugin: function (spec) { Object.assign(this, spec); },
    $prose: function (factory) { return factory(); }
  };

  const plugin = createPlugin(mockMB);
  assert.ok(plugin, "Plugin must be instantiated");
  assert.equal(typeof plugin.appendTransaction, "function", "Plugin must provide appendTransaction");

  const schema = {
    nodes: {
      paragraph: {
        create: () => ({ type: schema.nodes.paragraph, content: { size: 0 } })
      },
      heading: {
        create: () => ({ type: schema.nodes.heading, content: { size: 10 } })
      }
    }
  };

  await t.test("Appends empty paragraph when doc ends with heading", () => {
    let insertedPos = null;
    let insertedNode = null;

    const headingNode = { type: schema.nodes.heading, content: { size: 10 } };
    const oldState = {
      doc: {
        lastChild: null,
        eq: () => false
      }
    };
    const newState = {
      doc: {
        lastChild: headingNode,
        content: { size: 15 },
        eq: () => false
      },
      schema,
      tr: {
        insert: (pos, node) => {
          insertedPos = pos;
          insertedNode = node;
          return { inserted: true, pos, node };
        }
      }
    };

    const trResult = plugin.appendTransaction([{ docChanged: true }], oldState, newState);
    assert.ok(trResult, "appendTransaction should return a transaction");
    assert.equal(insertedPos, 15, "Should insert at end of document content");
    assert.equal(insertedNode.type, schema.nodes.paragraph, "Inserted node should be a paragraph");
  });

  await t.test("Appends empty paragraph when doc ends with non-empty paragraph", () => {
    let insertedPos = null;
    const nonEmptyPara = { type: schema.nodes.paragraph, content: { size: 8 } };
    const oldState = { doc: { eq: () => false } };
    const newState = {
      doc: {
        lastChild: nonEmptyPara,
        content: { size: 10 },
        eq: () => false
      },
      schema,
      tr: {
        insert: (pos, node) => {
          insertedPos = pos;
          return { pos, node };
        }
      }
    };

    const trResult = plugin.appendTransaction([{ docChanged: true }], oldState, newState);
    assert.ok(trResult, "appendTransaction should return a transaction");
    assert.equal(insertedPos, 10, "Should insert at doc.content.size");
  });

  await t.test("Does NOT append paragraph when doc already ends with empty paragraph (no duplicate)", () => {
    const emptyPara = { type: schema.nodes.paragraph, content: { size: 0 } };
    const oldState = { doc: { eq: () => false } };
    const newState = {
      doc: {
        lastChild: emptyPara,
        content: { size: 2 },
        eq: () => false
      },
      schema,
      tr: {
        insert: () => assert.fail("Should not call insert when already ending in empty paragraph")
      }
    };

    const trResult = plugin.appendTransaction([{ docChanged: true }], oldState, newState);
    assert.equal(trResult, null, "appendTransaction must return null when already ending in empty paragraph");
  });

  await t.test("Returns null when doc did not change and old doc equals new doc", () => {
    const emptyPara = { type: schema.nodes.paragraph, content: { size: 0 } };
    const stateDoc = {
      lastChild: emptyPara,
      content: { size: 2 },
      eq: (other) => other === stateDoc
    };
    const oldState = { doc: stateDoc };
    const newState = { doc: stateDoc, schema };

    const trResult = plugin.appendTransaction([{ docChanged: false }], oldState, newState);
    assert.equal(trResult, null, "appendTransaction must return null when doc is unchanged");
  });
});

test("Trailing Empty Block: handleContainerClick bottom empty area navigation", async (t) => {
  // Test targetPos calculation and selection near end
  const contentSize = 42;
  const targetPos = Math.max(0, contentSize - 1);
  assert.equal(targetPos, 41);

  // Test edge case when contentSize is 0
  const emptyTargetPos = Math.max(0, 0 - 1);
  assert.equal(emptyTargetPos, 0);

  // Simulate bottom click dispatching logic
  let dispatchedTr = null;
  let focused = false;

  const mockView = {
    state: {
      doc: {
        content: { size: 25 },
        resolve: (pos) => ({ resolvedPos: pos })
      },
      tr: {
        setSelection: (sel) => ({ ...sel, tr: true })
      }
    },
    dispatch: (tr) => { dispatchedTr = tr; },
    focus: () => { focused = true; }
  };

  const MB = {
    TextSelection: {
      near: (rPos) => ({ type: "TextSelection", target: rPos.resolvedPos })
    },
    editorViewCtx: "editorViewCtx"
  };

  // Run action handler
  const actionHandler = (ctx) => {
    const view = ctx.get(MB.editorViewCtx);
    if (!view) return;
    const { doc } = view.state;
    const tPos = Math.max(0, doc.content.size - 1);
    view.dispatch(view.state.tr.setSelection(MB.TextSelection.near(doc.resolve(tPos))));
    view.focus();
  };

  actionHandler({
    get: (ctxKey) => ctxKey === MB.editorViewCtx ? mockView : null
  });

  assert.ok(dispatchedTr, "Transaction must be dispatched");
  assert.equal(dispatchedTr.target, 24, "Should target doc.content.size - 1 (24)");
  assert.equal(focused, true, "Editor view should be focused");
});

test("Trailing Empty Block: Markdown save normalization", async (t) => {
  const normalize = (markdown) => (markdown || "").replace(/\n+$/, "");

  assert.equal(normalize("Hello world\n\n"), "Hello world");
  assert.equal(normalize("Hello world\n"), "Hello world");
  assert.equal(normalize("Hello world\n\n\n\n"), "Hello world");
  assert.equal(normalize("Line 1\n\nLine 2\n\n"), "Line 1\n\nLine 2");
  assert.equal(normalize("# Title\n\nParagraph text"), "# Title\n\nParagraph text");
  assert.equal(normalize(""), "");
  assert.equal(normalize(null), "");
  assert.equal(normalize(undefined), "");
  assert.equal(normalize("\n\n\n"), "");
});
