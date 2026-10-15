
    // Patch KaTeX to never throw — Milkdown uses globalThis.katex by reference,
    // so patching here affects the bundle too.
    (function() {
      ['render', 'renderToString'].forEach(function(fn) {
        var _orig = katex[fn].bind(katex);
        katex[fn] = function(latex, element, opts) {
          // render(latex, element, opts) vs renderToString(latex, opts)
          var options = (fn === 'render' ? opts : element) || {};
          var safeOpts = Object.assign({}, options, { throwOnError: false });
          try {
            return fn === 'render'
              ? _orig(latex, element, safeOpts)
              : _orig(latex, safeOpts);
          } catch(e) {
            if (fn === 'renderToString') return '<span class="katex-error" style="color:#cc0000" title="' + String(e.message).replace(/"/g,'&quot;') + '">' + latex + '</span>';
          }
        };
      });
    })();
  