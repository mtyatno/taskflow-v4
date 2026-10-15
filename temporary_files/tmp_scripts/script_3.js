
    // Monkey-patch katex.render so it NEVER throws.
    // @milkdown/plugin-math's toDOM calls katex.render() WITHOUT throwOnError:false,
    // so invalid LaTeX crashes the entire Milkdown editor (whole editor goes blank).
    // Bundle captures `qc = globalThis.katex` by reference, so patching the .render
    // method on the same object propagates to the bundle's internal calls.
    (function() {
      if (!window.katex || !window.katex.render || window.katex._tfPatched) return;
      var orig = window.katex.render.bind(window.katex);
      window.katex.render = function(tex, element, options) {
        try {
          return orig(tex, element, Object.assign({}, options || {}, { throwOnError: false }));
        } catch (e) {
          if (element) {
            try {
              element.innerHTML = '';
              var err = document.createElement('span');
              err.style.cssText = 'color:#ef4444;font-family:monospace;font-size:0.9em;background:rgba(239,68,68,0.1);padding:0 4px;border-radius:3px;';
              err.textContent = String(tex == null ? '' : tex);
              err.title = (e && e.message) || 'KaTeX error';
              element.appendChild(err);
            } catch (_) {}
          }
        }
      };
      window.katex._tfPatched = true;
    })();
  