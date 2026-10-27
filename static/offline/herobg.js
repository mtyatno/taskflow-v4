;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.herobg = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  // Registri latar hero Dashboard + kartu Pomodoro (spec docs/superpowers/specs/2026-10-27-latar-hero-design.md §3).
  // Port generator mockup yang disetujui (docs/superpowers/specs/2026-10-27-latar-hero/mockup_gen.py: tabel MESH, LAND,
  // GAL, OBJ, OBJBASE dan bg()). Hanya string statis, tanpa DOM. render() → { base, ambient, feature }:
  //   base    = nilai CSS `background` kartu (matahari/bulan = radial-gradient berjari-jari px agar tetap bulat);
  //   ambient = SVG lapisan penuh kartu; tidak bergantung ukuran kartu (viewBox + preserveAspectRatio, persen, atau
  //             jangkar px ke tepi kartu);
  //   feature = SVG elemen utama untuk kotak fitur yang diposisikan CSS (hero 290×140, pomo 340×62, thumb 86×70).
  //             viewBox = ukuran kotak itu; isinya ditaruh relatif ke kotak persis seperti mockup (place_boxes), boleh
  //             sedikit keluar kotak (overflow visible).
  // Kontur dan Polos hanya memakai token CSS (ikut palet apa pun, Kontur = hero Dashboard lama). Latar lain memakai
  // SCHEMES[palet][mode]; palet tanpa entri → skema "default". Semua id SVG diawali uid. Acak berbiji = port
  // random.Random Python (MT19937) agar susunan piksel/bintang/titik sama persis dengan mockup.

  const KINDS = Object.freeze([
    Object.freeze({ id: "kontur", name: "Kontur", badge: "Bawaan" }),
    Object.freeze({ id: "gradasi", name: "Gradasi" }),
    Object.freeze({ id: "lanskap", name: "Lanskap" }),
    Object.freeze({ id: "galaksi", name: "Galaksi" }),
    Object.freeze({ id: "objek", name: "Objek 3D" }),
    Object.freeze({ id: "polos", name: "Polos" }),
  ]);
  const KIND_IDS = KINDS.map((k) => k.id);
  const PLACES = ["hero", "pomo", "thumb"];
  // Ukuran kotak fitur per tempat (px) = viewBox SVG fitur (spec §4).
  const BOX = { hero: [290, 140], pomo: [340, 62], thumb: [86, 70] };
  const CARD = "var(--bg-card)";

  // ---------- tabel warna (disalin dari mockup_gen.py; {card} = var(--bg-card)) ----------
  // Penyimpangan sengaja (dijaga tests/offline/herobg.test.js DEVIATIONS): lima warna Default terang di zona teks
  // dicerahkan minimal (dicampur putih) agar --text-secondary #64748b ≥ 4,5:1 — gradasi m0 #F2F8DE→#F7FBEA,
  // lanskap sky #E3F2EA→#F4FAF7 dan #F0F7DE→#F7FBED, galaksi 30% #F3F9E4→#F6FBEB, objek 28% #F3F9E3→#F6FBEA.
  const MESH = {
    default: {
      light: { m0: "#F7FBEA", m1: "#D9EFA0", m2: "#C8ECD6", m3: "#FFEDB5", m4: "#E4F2C2", line: "#6B8000", op: 0.2 },
      dark: { m0: "#1F2614", m1: "#3B4C08", m2: "#0E3A2C", m3: "#3E3410", m4: "#2B3910", line: "#FFFFFF", op: 0.13 },
    },
    sakura: {
      light: { m0: "#FCE8F1", m1: "#F5C1DA", m2: "#FCD5BF", m3: "#E9D0F5", m4: "#F8CFE0", line: "#B0287E", op: 0.17 },
      dark: { m0: "#3A1631", m1: "#701C51", m2: "#62262F", m3: "#401F58", m4: "#56183F", line: "#FFFFFF", op: 0.14 },
    },
    lavender: {
      light: { m0: "#F2EAFB", m1: "#D8C6F6", m2: "#F4CFE9", m3: "#D3DBF8", m4: "#E3D2F7", line: "#8A3AAE", op: 0.17 },
      dark: { m0: "#2A1F45", m1: "#4D2786", m2: "#5C1F60", m3: "#212A66", m4: "#3B2468", line: "#FFFFFF", op: 0.14 },
    },
  };
  // Pasangan [warna, opasitas] dan gradien [atas, bawah]; night = bulan + bintang.
  const LAND = {
    default: {
      light: { sky: ["#F4FAF7", "#F7FBED", "#FFF2C7"], sun: "#FFF4C2", glow: "rgba(255,236,160,0.8)", far1: ["#CDE4B8", 0.8], far2: ["#BFE0D0", 0.75], hill: ["#A6CC63", "#C7E297"], ridge: ["#B3D57B", 0.9], ridgeP: ["#8CC7B1", "#B3DDCD"], mist: ["#CBEBE2", 0.85], ground: ["#E2EFB2", "#D1E495"], tree: "#5E7F3E", trunk: "#4B6531", cloud: ["#FFFFFF", 0.55], night: false },
      dark: { sky: ["#0D1816", "#132721", "#22381D"], sun: "#F2F7DD", glow: "rgba(242,247,221,0.18)", far1: ["#1C3224", 0.9], far2: ["#1B2F2B", 0.85], hill: ["#223F2A", "#2B4C31"], ridge: ["#264530", 0.95], ridgeP: ["#1B3A33", "#24473F"], mist: ["#2E5147", 0.5], ground: ["#16291B", "#112016"], tree: "#08140D", trunk: "#060F0A", cloud: ["#FFFFFF", 0.05], night: true },
    },
    sakura: {
      light: { sky: ["#F2CFDB", "#FADFD2", "#FFD3A8"], sun: "#FFF3DA", glow: "rgba(255,236,200,0.85)", far1: ["#E9A9B6", 0.75], far2: ["#DCB6D6", 0.7], hill: ["#F0936C", "#F6BB90"], ridge: ["#F0A181", 0.92], ridgeP: ["#B39AD6", "#CFBBE6"], mist: ["#C9B5E3", 0.85], ground: ["#F7C899", "#F1B07F"], tree: "#94688A", trunk: "#7D5672", cloud: ["#FFFFFF", 0.45], night: false },
      dark: { sky: ["#1D1121", "#33182F", "#552240"], sun: "#FBE7F1", glow: "rgba(251,231,241,0.22)", far1: ["#3D1E39", 0.9], far2: ["#45264A", 0.85], hill: ["#4D2240", "#5C2A49"], ridge: ["#542646", 0.95], ridgeP: ["#38244F", "#47305F"], mist: ["#4B3266", 0.55], ground: ["#2B1627", "#22121E"], tree: "#170B15", trunk: "#120910", cloud: ["#FFFFFF", 0.05], night: true },
    },
    lavender: {
      light: { sky: ["#E2D9F6", "#EEDFF4", "#F9E3E4"], sun: "#FFF6EA", glow: "rgba(255,240,230,0.85)", far1: ["#CDB6EA", 0.75], far2: ["#D8C8F0", 0.75], hill: ["#A98BDA", "#C6B1EA"], ridge: ["#B9A0E2", 0.9], ridgeP: ["#8E78C8", "#B2A1DD"], mist: ["#D5CBF2", 0.85], ground: ["#E5D8F6", "#D6C5EF"], tree: "#6E558F", trunk: "#5A4577", cloud: ["#FFFFFF", 0.5], night: false },
      dark: { sky: ["#13122F", "#221D48", "#3A255F"], sun: "#EEE7FF", glow: "rgba(238,231,255,0.2)", far1: ["#2A2350", 0.9], far2: ["#2F2858", 0.85], hill: ["#322A5F", "#3D3271"], ridge: ["#352C66", 0.95], ridgeP: ["#2A2452", "#372E66"], mist: ["#4A3F7A", 0.5], ground: ["#1E1A3B", "#17132D"], tree: "#0F0C22", trunk: "#0B091A", cloud: ["#FFFFFF", 0.05], night: true },
    },
  };
  const GAL = {
    default: {
      light: { base: "radial-gradient(40% 120% at 100% 100%, rgba(168,197,0,0.24) 0%, transparent 70%), linear-gradient(90deg, " + CARD + " 0%, #F6FBEB 30%, #F8FBEF 52%, #EEF6DA 70%, #E1EFC0 86%, #D6EAAC 100%)", px1: ["#C9E37A", "#B9E2C6", "#D9EC9E", "#A8D8B5"], px2: ["#B6D84A", "#CDE58A", "#9CC93A", "#DDEDA8"], path: "#6B8000", node: "#FFFFFF", nodeStroke: "#6B8000", icon: "#B07A00", spark: "#6B8000", spark2: "#C88A00", dot: "#6B8000", dotOp: 0.4, tw: ["#D9EC9E", "#9CC93A", "#C9E37A", "#7FA61A"], gem: "#F3F9E4", gemStroke: "#6B8000", core: ["#B9F0DA", "#2FA889"] },
      dark: { base: "radial-gradient(45% 120% at 100% 100%, rgba(168,197,0,0.32) 0%, transparent 70%), linear-gradient(90deg, " + CARD + " 0%, #10201c 30%, #0b1a1e 52%, #0f2420 66%, #233c10 84%, #4f6e00 100%)", px1: ["#5fae6a", "#7fd08a", "#3f8f5a", "#a8c500"], px2: ["#a8c500", "#c9e04a", "#8fb000", "#d4ea6a"], path: "#b6e03a", node: "#14261c", nodeStroke: "#b6e03a", icon: "#ffd34a", spark: "#FFFFFF", spark2: "#9fffe0", dot: "#FFFFFF", dotOp: 1, tw: ["#c9e04a", "#4f8a1a", "#7fd08a", "#2f6b3a"], gem: "#1e3a22", gemStroke: "#b6e03a", core: ["#e8ffb0", "#a8c500"] },
    },
    sakura: {
      light: { base: "radial-gradient(40% 120% at 100% 100%, rgba(255,140,190,0.30) 0%, transparent 70%), linear-gradient(90deg, " + CARD + " 0%, #FCEBF3 30%, #FDF4F8 52%, #FBE8F1 70%, #F8D5E6 86%, #F6C5DC 100%)", px1: ["#F2A8CF", "#F7C4DE", "#E98FC0", "#F9D5E8"], px2: ["#EC86BC", "#F4A9CF", "#E06AA8", "#F7BCD9"], path: "#B0287E", node: "#FFFFFF", nodeStroke: "#B0287E", icon: "#B07A00", spark: "#B0287E", spark2: "#C88A00", dot: "#B0287E", dotOp: 0.4, tw: ["#F9D5E8", "#E07AB4", "#F7C4DE", "#D45DA2"], gem: "#FCEBF3", gemStroke: "#B0287E", core: ["#FFE3B0", "#F0A030"] },
      dark: { base: "radial-gradient(45% 120% at 100% 100%, rgba(255,60,160,0.5) 0%, transparent 70%), linear-gradient(90deg, " + CARD + " 0%, #2a1030 30%, #1c0c22 52%, #2a0f2c 66%, #6a1258 84%, #c81f86 100%)", px1: ["#d0438f", "#e45aa5", "#a8306f", "#f07ab8"], px2: ["#ff4fa8", "#ff7cc0", "#e0309a", "#ff9ad0"], path: "#ff6fc8", node: "#3a1033", nodeStroke: "#ff6fc8", icon: "#ffc94a", spark: "#FFFFFF", spark2: "#ffb1e8", dot: "#FFFFFF", dotOp: 1, tw: ["#ff9ad6", "#c02a7e", "#f070c0", "#a0205e"], gem: "#5a1846", gemStroke: "#ff9ad6", core: ["#9fe8ff", "#2f8cff"] },
    },
    lavender: {
      light: { base: "radial-gradient(40% 120% at 100% 100%, rgba(240,120,200,0.28) 0%, transparent 70%), linear-gradient(90deg, " + CARD + " 0%, #F3ECFC 30%, #F7F3FD 52%, #EFE6FB 70%, #E4D3F8 86%, #F1CFEA 100%)", px1: ["#B9A0EE", "#CDB8F5", "#A98BE6", "#D9C9F7"], px2: ["#F0A8D8", "#E58FCB", "#F6C2E2", "#D981C0"], path: "#8A3AAE", node: "#FFFFFF", nodeStroke: "#8A3AAE", icon: "#B07A00", spark: "#8A3AAE", spark2: "#C88A00", dot: "#8A3AAE", dotOp: 0.45, tw: ["#F2C1E5", "#B78AE6", "#D9C6F7", "#9C7BE0"], gem: "#F3ECFC", gemStroke: "#8A3AAE", core: ["#B9E6FF", "#5AA8F0"] },
      dark: { base: "radial-gradient(45% 120% at 100% 100%, rgba(255,40,150,0.5) 0%, transparent 70%), linear-gradient(90deg, " + CARD + " 0%, #241860 30%, #121845 52%, #1c1650 66%, #4a1888 84%, #b0168a 100%)", px1: ["#8a55e6", "#a465f0", "#6a3cc8", "#b77cff"], px2: ["#ff3fa8", "#e0309a", "#ff6fc1", "#c22a9e"], path: "#c45cf0", node: "#3a2370", nodeStroke: "#c45cf0", icon: "#ffc94a", spark: "#FFFFFF", spark2: "#8fe9ff", dot: "#FFFFFF", dotOp: 1, tw: ["#e05cf0", "#7a2fd0", "#9b5cf0", "#5a2bb8"], gem: "#4a2a90", gemStroke: "#b07cff", core: ["#9fe8ff", "#2f8cff"] },
    },
  };
  // Objek 3D: warna benda sama untuk terang/gelap; dasar per mode (gelap + cahaya `glow`).
  const OBJ = {
    default: { tile: ["#D4EC6A", "#86A300"], tileSide: "#5E7300", sph: ["#F3FAD0", "#B8D640", "#6E8A00"], sph2: ["#E1F7EC", "#7FD3AE", "#2F8F6B"], book: ["#DDEFA0", "#A8C540"], bookSide: "#7E9400", ring: "#F4FADC", face: ["#FFFEF8", "#EEF0DC"], bell: ["#FFEAB0", "#F2B33D"], hand: "#4E5C00", tick: "#86A300", dot2: "#F2B33D", legs: "#6E8A00", glow: "rgba(184,214,64,0.18)", shadow: "#6E8A00" },
    sakura: { tile: ["#F79BCB", "#C2307F"], tileSide: "#921F5E", sph: ["#FFE0EF", "#F07BB5", "#A8246B"], sph2: ["#EFE5FF", "#B39AF0", "#7A5CC8"], book: ["#FBC9E2", "#E27AB0"], bookSide: "#B94D86", ring: "#FFE8F3", face: ["#FFFDF9", "#F1E2E8"], bell: ["#FFE3C6", "#F0A060"], hand: "#8E1F63", tick: "#C2307F", dot2: "#F0A060", legs: "#A8246B", glow: "rgba(240,123,181,0.25)", shadow: "#A8246B" },
    lavender: { tile: ["#b49bff", "#6a4ae0"], tileSide: "#4b30b0", sph: ["#e3d6ff", "#9d7ff2", "#5233bd"], sph2: ["#ffe0d2", "#f4a08a", "#c2665c"], book: ["#d6c2fb", "#9b7aea"], bookSide: "#7c5bd0", ring: "#efe7ff", face: ["#fffdf8", "#ece0d0"], bell: ["#ffd9c6", "#e8866e"], hand: "#5a3dc4", tick: "#7a5ad8", dot2: "#f08a6e", legs: "#6a4ad0", glow: "rgba(157,127,242,0.28)", shadow: "#6a4ac0" },
  };
  const OBJBASE = {
    default: {
      light: "linear-gradient(90deg, " + CARD + " 0%, #F6FBEA 28%, #F7FBEC 48%, #FAFCF4 66%, #F2F8E3 84%, #E6F2CC 100%)",
      dark: "linear-gradient(90deg, " + CARD + " 0%, #222A16 55%, #29351A 100%)",
    },
    sakura: {
      light: "linear-gradient(90deg, " + CARD + " 0%, #FCE9F2 28%, #FDEEF1 48%, #FDF5F8 66%, #FCEFF4 84%, #F7DEEA 100%)",
      dark: "linear-gradient(90deg, " + CARD + " 0%, #3A1A35 55%, #47203F 100%)",
    },
    lavender: {
      light: "linear-gradient(90deg, " + CARD + " 0%, #EFE7FB 28%, #F6E3F1 48%, #F7F1FA 66%, #FBEEF4 84%, #F1E0EE 100%)",
      dark: "linear-gradient(90deg, " + CARD + " 0%, #2A1F45 55%, #33235A 100%)",
    },
  };

  function deepFreeze(o) {
    for (const k of Object.keys(o)) if (o[k] && typeof o[k] === "object") deepFreeze(o[k]);
    return Object.freeze(o);
  }
  // SCHEMES[palet][mode] = { gradasi, lanskap, galaksi, objek } (objek.base sudah memuat cahaya mode gelap).
  const SCHEMES = {};
  for (const p of Object.keys(MESH)) {
    SCHEMES[p] = {};
    for (const m of ["light", "dark"]) {
      const objBase = (m === "dark" ? "radial-gradient(40% 130% at 72% 40%, " + OBJ[p].glow + " 0%, transparent 70%), " : "") + OBJBASE[p][m];
      SCHEMES[p][m] = { gradasi: MESH[p][m], lanskap: LAND[p][m], galaksi: GAL[p][m], objek: Object.assign({ base: objBase }, OBJ[p]) };
    }
  }
  deepFreeze(SCHEMES);

  // ---------- acak berbiji: random.Random(seed) Python (MT19937 + init_by_array + _randbelow) ----------
  function pyRandom(seed) {
    const N = 624;
    const mt = new Uint32Array(N);
    const mix = (i, mul) => mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), mul);
    mt[0] = 19650218;
    for (let i = 1; i < N; i++) mt[i] = Math.imul(1812433253, mt[i - 1] ^ (mt[i - 1] >>> 30)) + i;
    let i = 1;
    for (let k = N; k; k--) {
      mt[i] = mix(i, 1664525) + seed; // kunci satu kata [seed], j selalu 0
      if (++i >= N) { mt[0] = mt[N - 1]; i = 1; }
    }
    for (let k = N - 1; k; k--) {
      mt[i] = mix(i, 1566083941) - i;
      if (++i >= N) { mt[0] = mt[N - 1]; i = 1; }
    }
    mt[0] = 0x80000000;
    let mti = N;
    function next() {
      if (mti >= N) {
        for (let kk = 0; kk < N; kk++) {
          const y = (mt[kk] & 0x80000000) | (mt[(kk + 1) % N] & 0x7fffffff);
          mt[kk] = mt[(kk + 397) % N] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
        }
        mti = 0;
      }
      let y = mt[mti++];
      y ^= y >>> 11;
      y ^= (y << 7) & 0x9d2c5680;
      y ^= (y << 15) & 0xefc60000;
      y ^= y >>> 18;
      return y >>> 0;
    }
    // _randbelow(n): getrandbits(n.bit_length()) diulang sampai < n.
    function below(n) {
      const shift = Math.clz32(n);
      let r = next() >>> shift;
      while (r >= n) r = next() >>> shift;
      return r;
    }
    return { below, randint: (a, b) => a + below(b - a + 1) };
  }

  // Urutan undian sama dengan mockup_gen.py: Random(11) → px1, px2 (randrange(0,80,8) x, y, warna, opasitas),
  // titik galaksi; Random(5) → bintang lanskap; Random(3) → titik galaksi kartu Pomodoro (960×304).
  // Disimpan sebagai indeks pilihan; dihitung sekali saat pertama dipakai.
  let RAND = null;
  function rand() {
    if (RAND) return RAND;
    const r11 = pyRandom(11);
    const px = () => {
      const a = [];
      for (let n = 0; n < 22; n++) a.push([8 * r11.below(10), 8 * r11.below(10), r11.below(4), r11.below(4)]);
      return a;
    };
    const px1 = px();
    const px2 = px();
    const dots = [];
    for (let n = 0; n < 45; n++) dots.push([r11.randint(300, 1440), r11.randint(0, 300), r11.below(4), r11.below(3)]);
    const r5 = pyRandom(5);
    const stars = [];
    for (let n = 0; n < 40; n++) stars.push([r5.randint(0, 1440), r5.randint(0, 120), r5.below(3), r5.below(3)]);
    const r3 = pyRandom(3);
    const pdots = [];
    for (let n = 0; n < 40; n++) pdots.push([r3.randint(0, 960), r3.randint(0, 304), r3.below(3), r3.below(3)]);
    RAND = { px1, px2, dots, stars, pdots };
    return RAND;
  }

  // ---------- pembantu SVG ----------
  const f1 = (v) => v.toFixed(1);
  const FULL = "inset: 0; width: 100%; height: 100%;";
  const FADE_LEFT =
    " -webkit-mask-image: linear-gradient(to right, transparent 0%, rgba(0,0,0,0.35) 30%, black 60%);" +
    " mask-image: linear-gradient(to right, transparent 0%, rgba(0,0,0,0.35) 30%, black 60%);";

  function svgAbs(inner, vb, par, pos, extra, cls) {
    return (
      '<svg aria-hidden="true" focusable="false"' + (cls ? ' class="' + cls + '"' : "") +
      (vb ? ' viewBox="' + vb + '" preserveAspectRatio="' + par + '"' : "") +
      ' style="position: absolute; ' + pos + " pointer-events: none;" + (extra || "") + '">' + inner + "</svg>"
    );
  }
  // Kotak di dalam SVG fitur (setara svg_abs(box=…) mockup; isi terpotong di tepi kotak seperti mockup).
  function nest(x, y, w, h, vb, par, inner) {
    return '<svg x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" viewBox="' + vb + '" preserveAspectRatio="' + par + '">' + inner + "</svg>";
  }
  function featureSvg(place, inner) {
    const b = BOX[place];
    return svgAbs(inner, "0 0 " + b[0] + " " + b[1], "xMidYMid meet", FULL, " overflow: visible;");
  }
  // Titik asal di posisi x/y (boleh persen) induknya; isi digambar relatif (0,0).
  function at(x, y, inner) {
    return '<svg x="' + x + '" y="' + y + '" overflow="visible">' + inner + "</svg>";
  }
  function stop(o, c, a) {
    return '<stop offset="' + o + '" style="stop-color: ' + c + ";" + (a !== undefined ? " stop-opacity: " + a + ";" : "") + '"></stop>';
  }
  function lin(id, x2, y2, stops) {
    return '<linearGradient id="' + id + '" x1="0" y1="0" x2="' + x2 + '" y2="' + y2 + '">' + stops + "</linearGradient>";
  }
  function rad(id, cx, cy, r, stops) {
    return '<radialGradient id="' + id + '" cx="' + cx + '" cy="' + cy + '" r="' + r + '">' + stops + "</radialGradient>";
  }

  function sparkle(x, y, s, col, glow) {
    const k = s * 0.12;
    const a = f1(x + k), b = f1(x - k), c = f1(y - k), d = f1(y + k);
    const path =
      "M" + x + " " + (y - s) + " C" + a + " " + c + " " + a + " " + c + " " + (x + s) + " " + y +
      " C" + a + " " + d + " " + a + " " + d + " " + x + " " + (y + s) +
      " C" + b + " " + d + " " + b + " " + d + " " + (x - s) + " " + y +
      " C" + b + " " + c + " " + b + " " + c + " " + x + " " + (y - s) + " Z";
    const g = glow === false ? "" : '<circle cx="' + x + '" cy="' + y + '" r="' + f1(s * 0.9) + '" fill="' + col + '" style="opacity: 0.16;"></circle>';
    return g + '<path d="' + path + '" fill="' + col + '"></path>';
  }

  function tree(x, y, h, w, col, trunk) {
    return (
      '<path d="M' + x + " " + (y - h) + " C" + f1(x + w * 1.1) + " " + f1(y - h * 0.55) + " " + (x + w) + " " + y + " " + x + " " + y +
      " C" + (x - w) + " " + y + " " + f1(x - w * 1.1) + " " + f1(y - h * 0.55) + " " + x + " " + (y - h) + ' Z" fill="' + col + '"></path>' +
      '<path d="M' + x + " " + f1(y - h * 0.15) + " L" + x + " " + f1(y + h * 0.18) + '" stroke="' + trunk +
      '" style="stroke-width: ' + f1(Math.max(1.2, w * 0.18)) + '; stroke-linecap: round;"></path>'
    );
  }

  // ---------- Kontur: garis topografi + ilustrasi kecil per palet (= hero Dashboard sebelum fitur latar) ----------
  const TOPO_KONTUR = [
    "M560 24 C570 10 610 6 630 18 C646 28 640 44 618 48 C594 52 552 40 560 24 Z",
    "M470 0 C500 40 560 70 620 64 C690 58 720 20 730 0",
    "M430 0 C460 60 540 104 620 98 C710 92 760 40 770 0",
    "M390 0 C420 80 520 140 620 134 C730 128 800 60 810 0",
    "M350 0 C380 100 500 176 630 170 C760 164 832 90 832 40",
    "M320 40 C340 140 480 214 640 206 C780 200 832 150 832 120",
    "M300 120 C330 200 460 252 620 246 C740 242 800 220 832 200",
    "M290 200 C320 250 400 272 470 272",
    "M730 272 C736 248 762 238 784 244 C804 250 816 262 818 272",
    "M690 272 C700 230 740 212 780 218 C812 224 832 244 832 252",
    "M650 272 C664 210 724 184 784 192 C812 196 832 210 832 216",
  ];
  // Gaya kelas dhi-* lama (app.css) sebagai style inline: hanya token tema.
  const ST_STEM = "fill: none; stroke: var(--text-secondary); stroke-linecap: round; opacity: 0.5;";
  const ST_LEAF_STEM = "fill: none; stroke: var(--accent-text-strong, var(--accent-text)); stroke-linecap: round;";
  const ST_LEAF = "fill: var(--accent-duo); stroke: var(--accent-text-strong, var(--accent-text));";
  const ST_DUO = "fill: var(--accent-duo); stroke: var(--accent);";
  const ST_FILL = "fill: var(--accent);";
  const el = (tag, attrs, style) => "<" + tag + " " + attrs + ' style="' + style + '"></' + tag + ">";

  // Ilustrasi hero (viewBox 150×110): Sakura = ranting bunga, Lavender = tangkai lavender, lainnya = daun.
  function illus(palette) {
    if (palette === "sakura") {
      const blossom = (t) =>
        '<g transform="' + t + '">' +
        [0, 72, 144, 216, 288].map((r) => el("ellipse", 'cx="0" cy="-7" rx="5.5" ry="7.5"' + (r ? ' transform="rotate(' + r + ')"' : "") + ' stroke-width="1"', ST_DUO)).join("") +
        el("circle", 'cx="0" cy="0" r="2.6"', ST_FILL) + "</g>";
      return (
        el("path", 'd="M150 14 C120 20 92 34 62 62" stroke-width="2.6"', ST_STEM) +
        el("path", 'd="M104 30 C98 50 100 70 112 86" stroke-width="2"', ST_STEM) +
        blossom("translate(62 62)") + blossom("translate(112 88) scale(1.25)") + blossom("translate(134 20) scale(0.85)") +
        el("ellipse", 'cx="0" cy="0" rx="3" ry="5" transform="translate(30 92) rotate(40)"', ST_FILL + " opacity: 0.45;") +
        el("ellipse", 'cx="0" cy="0" rx="2.6" ry="4.4" transform="translate(76 100) rotate(-30)"', ST_FILL + " opacity: 0.35;") +
        el("ellipse", 'cx="0" cy="0" rx="2.4" ry="4" transform="translate(18 40) rotate(70)"', ST_FILL + " opacity: 0.3;")
      );
    }
    if (palette === "lavender") {
      // [cx, cy, rx, ry, duo?]
      const buds = [[52, 36, 3.4, 5.2, 0], [49, 48, 3.6, 5.4, 1], [55, 58, 3.6, 5.4, 0], [51, 70, 3.6, 5.4, 1], [80, 20, 3.4, 5.2, 1], [77, 32, 3.6, 5.4, 0], [84, 42, 3.6, 5.4, 1], [79, 54, 3.6, 5.4, 0], [85, 66, 3.6, 5.4, 1], [114, 38, 3.4, 5.2, 0], [111, 50, 3.6, 5.4, 1], [117, 60, 3.6, 5.4, 0]];
      return (
        ["M58 110 C56 84 58 60 52 34", "M82 110 C82 80 84 50 80 18", "M106 110 C108 84 110 60 114 36"].map((d) => el("path", 'd="' + d + '" stroke-width="1.8"', ST_STEM)).join("") +
        buds.map((b) => el("ellipse", 'cx="' + b[0] + '" cy="' + b[1] + '" rx="' + b[2] + '" ry="' + b[3] + '"' + (b[4] ? ' stroke-width="1"' : ""), b[4] ? ST_DUO : ST_FILL)).join("") +
        el("circle", 'cx="28" cy="40" r="1.8"', ST_FILL + " opacity: 0.4;") +
        el("circle", 'cx="136" cy="22" r="1.6"', ST_FILL + " opacity: 0.35;")
      );
    }
    return (
      el("path", 'd="M70 108 C68 80 76 54 92 30" stroke-width="2"', ST_LEAF_STEM) +
      el("path", 'd="M71 80 C50 76 42 60 46 48 C62 52 71 64 71 80 Z" stroke-width="1.5"', ST_LEAF) +
      el("path", 'd="M77 60 C96 54 104 38 100 26 C84 32 77 44 77 60 Z" stroke-width="1.5"', ST_LEAF) +
      el("path", 'd="M86 40 C72 32 70 18 76 8 C88 16 89 28 86 40 Z" stroke-width="1.5"', ST_LEAF) +
      el("circle", 'cx="120" cy="30" r="12"', ST_FILL + " opacity: 0.22;")
    );
  }

  function kontur(palette, dark, place) {
    const paths = TOPO_KONTUR.map((d) => '<path d="' + d + '"></path>').join("");
    const ambient = svgAbs(
      '<g style="fill: none; stroke: var(--accent); stroke-width: 1.1; opacity: ' + (dark ? 0.32 : 0.28) + ';">' + paths + "</g>",
      "0 0 832 272", "xMaxYMid slice", FULL, FADE_LEFT
    );
    // Hero: posisi lama .dash-hero-illus (right 228px, top 14px) di dalam kotak fitur (right 226px, top 4px).
    const box = place === "hero" ? [138, 10, 150, 110] : place === "pomo" ? [220, -6, 110, 72] : [0, 10, 86, 50];
    const feature = featureSvg(place, nest(box[0], box[1], box[2], box[3], "0 0 150 110", "xMidYMid meet", illus(palette)));
    return { base: "linear-gradient(105deg, var(--bg-card) 30%, var(--accent-soft) 100%), var(--bg-card)", ambient, feature };
  }

  // ---------- Gradasi: mesh pastel/pekat + garis kontur halus ----------
  // = topo_gradasi_d.txt mockup (viewBox 1440×225) dipadatkan tanpa mengubah gambar: koordinat ×2 (bulat; viewBox dan tebal
  // garis ×2), perintah relatif, 14 subjalur yang seluruhnya di luar viewBox (tak tampak dengan slice) dibuang. Dijaga tes.
  const TOPO_MESH =
    "M788-80l24 22q24 22 53 36t61 20 65 6 65-3 65-7 65-10 64-11 64-11 64-12 64-12 64-12l32-6m886 0l30 18q30 18 62 30t66 20 68 12 69 4 70-2 69-7 68-10l34-5m-2228-60l24 22q24 22 52 40t59 28 64 13 65 1 65-6 65-9 65-11 65-12 64-11 65-11 65-13 64-13 65-12l33-6m716 0l26 20q26 20 56 34t61 22 64 14 66 10 65 6 65 1 66-4 66-8 65-10l32-5m-2286-80l26 21q26 21 52 42t56 35 62 20 66 7 67-2 66-9 65-12 65-12 66-12 66-12 65-12 65-12 66-12 65-12 65-12l33-6m542 0l23 22q23 22 45 45t53 33 63 12 64 4 64 5 64 5 64 2 64-1 64-5 64-8 64-9l32-5m-2362-100l29 16q29 16 54 36t52 38 58 31 63 18 65 5 65-3 65-8 65-11 64-13 64-13 64-12 64-12 65-12 65-12 64-11 64-11 65-11 65-10l32-5m334 0l28 18q28 18 42 47t28 59 45 36 64 3 66-8 66-7 67-2 67 1 66 1 66-2 66-5 66-8 66-10l33-5m-3040-42l32-5q32-5 63-10t63-10 64-10 63-9 63-8 64-7 64-5 64-2 64 6 61 19 55 31 53 36 56 31 60 20 63 9 64 0 64-6 63-10 63-13 63-13 63-12 63-12 63-11 63-11 63-12 63-11 63-10 64-10 63-9 63-7 64-5 64-2 64 5 60 19 41 43 10 61 6 60 40 33 63 0 63-13 62-17 62-15 63-10 64-5 64-1 64-1 64-3 64-6 63-8 63-9l32-5m-3040-42l32-5q32-5 64-10t64-9 64-8 64-7 64-6 64-5 64-3 64 2 63 12 59 24 56 32 57 31 60 23 62 13 64 4 65-4 63-9 63-12 63-14 63-13 64-12 63-12 63-11 64-11 64-11 63-10 63-9 64-8 64-7 64-4 65 0 64 7 55 27 23 52-12 61-15 61 26 41 62 7 64-9 63-14 61-18 61-20 62-19 63-14 64-7 64-3 64-2 64-4 64-6 64-8 64-10l32-5m-3040-40l32-5q32-5 64-9t64-7 64-6 64-5 65-4 65-2 64 1 64 7 62 17 59 25 58 27 60 23 63 16 64 8 64 0 64-6 64-10 63-13 63-14 63-14 63-13 64-11 64-10 64-10 63-10 63-9 64-8 65-6 65-3 64 1 63 11 45 36 4 57-26 58-26 59 13 48 56 16 64-6 63-12 63-15 62-17 61-20 61-22 62-20 62-16 63-10 65-5 65-3 64-4 64-6 64-8 64-9l32-4m-3040-40l32-4q32-4 64-7t65-6 65-4 64-1 65 1 65 4 64 7 64 11 63 17 61 21 61 20 63 15 64 9 65 3 65-3 64-8 64-12 63-14 63-15 63-14 63-11 64-10 64-10 65-10 65-9 64-7 64-5 65-2 65 4 59 21 26 48-16 59-30 57-16 61 27 45 60 12 64-7 64-14 63-16 62-17 62-19 62-20 61-22 61-22 62-17 64-11 65-6 64-4 65-5 65-6 64-7 64-9l32-5m-3040-36l32-3q32-3 64-6t64-4 65 0 65 4 64 9 63 12 63 12 64 11 64 10 63 11 63 12 64 10 64 5 64 0 65-5 64-9 63-12 63-15 62-15 63-14 64-12 64-9 64-9 64-9 64-7 64-5 64-1 64 5 58 22 23 49-16 61-25 60-9 61 31 45 60 14 64-5 63-13 62-16 62-17 62-18 62-19 61-21 61-22 61-21 62-18 63-12 64-7 65-5 64-5 64-6 64-7 64-8l32-4m-3040-34l32-2q32-2 64-3t64 0 64 6 63 13 61 19 61 20 63 12 64 3 64 0 64 2 64 4 64 4 64 3 64-1 64-6 63-9 63-13 63-16 62-15 62-14 63-12 64-9 64-7 64-7 64-6 64-2 64 4 59 19 30 45-7 61-20 61-8 61 28 49 58 21 64 0 63-10 62-15 62-17 62-18 61-18 61-19 61-21 60-22 61-21 62-18 62-13 63-8 64-5 64-5 64-6 64-7 64-8l32-4m-3040-26l33-2q33-2 65 0t64 6 63 15 60 25 59 27 63 18 65 4 64-5 65-7 65-5 65-2 66 1 65 0 65-4 65-7 64-11 64-14 63-16 63-16 64-13 64-11 65-8 65-6 65-5 65-1 64 6 57 25 24 52-10 63-15 63 7 61 43 41 62 13 64-3 64-10 64-15 63-18 62-18 62-19 62-20 62-21 62-22 62-21 62-19 63-15 65-9 65-5 65-5 65-6 65-6 65-7l32-4m-3040-20l32 1q32 1 65 5t64 14 59 25 57 31 60 25 63 10 65-2 65-9 64-12 64-9 64-5 65-3 65-3 65-5 65-7 64-11 63-14 63-16 63-17 63-14 64-10 65-7 65-5 65-2 65 3 62 15 40 42 3 62-13 64 0 63 32 50 58 24 65 3 65-7 64-12 63-16 62-18 62-19 62-19 62-19 62-21 62-22 61-21 62-19 64-15 64-9 64-6 65-5 65-5 65-6 65-6l32-3m-3040-10l32 3q32 3 63 12t60 24 57 32 58 29 62 16 64 3 64-6 64-11 64-13 64-13 64-9 65-5 65-5 64-6 64-8 64-11 64-13 63-16 62-17 63-15 64-11 65-6 65-3 64 1 64 10 53 31 20 55-7 64-5 64 21 57 51 34 63 11 64-1 64-9 64-13 63-16 62-19 62-19 62-19 62-20 62-20 61-21 61-21 62-19 63-15 64-9 65-6 65-5 64-5 65-5 65-5l32-3m-3040 4l31 7q31 7 61 21t57 31 57 31 61 21 63 8 65-2 64-8 63-13 64-15 63-14 63-11 64-8 65-7 65-6 64-8 64-11 63-14 62-17 63-17 63-15 63-11 65-5 65 0 64 6 60 21 36 47 3 63-7 64 10 61 41 44 61 20 64 4 64-5 64-10 63-14 63-17 62-18 61-19 62-20 62-19 62-19 62-21 61-21 62-19 63-15 63-9 65-6 65-5 64-4 65-4 65-4l32-2m-3040 22l30 12q30 12 58 29t56 31 59 23 64 12 65 2 64-5 64-10 63-14 62-16 63-15 64-12 64-9 64-8 64-8 64-9 64-11 63-14 62-16 62-17 63-16 64-10 64-3 64 3 63 14 49 37 17 58-5 64 2 63 29 52 54 29 64 10 65 0 64-6 64-11 63-15 62-17 62-18 62-19 62-20 61-19 61-19 62-20 62-20 62-19 63-15 64-9 64-6 64-5 64-3 65-3 65-2l32 0m-3040 46l28 16q28 16 57 31t60 24 63 14 64 5 64-3 64-7 63-11 63-15 63-16 62-15 63-13 64-11 64-9 64-9 64-10 64-11 63-13 62-16 62-18 63-15 64-9 64-2 63 9 56 28 31 51 2 63-4 64 17 59 46 39 61 16 64 4 65-3 64-8 63-12 63-15 62-17 62-19 62-19 62-19 62-19 61-19 61-20 62-19 62-17 63-14 64-10 64-6 64-4 64-3 65-2 65 0l32 1m-3040 78l29 15q29 15 59 25t62 15 64 6 65-1 65-6 63-9 63-12 63-15 62-16 62-16 63-14 64-11 64-10 64-10 63-10 63-11 63-14 62-16 62-17 63-15 64-7 64 3 60 19 41 44 11 61-6 64 5 62 36 47 59 24 64 8 64 0 64-5 64-9 63-12 62-16 62-18 62-18 62-18 62-19 62-19 61-18 61-19 62-19 62-17 63-14 64-10 64-6 64-3 65-1 65 0 64 2l32 2m-3040 104l30 10q30 10 62 16t64 8 64 1 64-4 63-7 63-10 63-13 62-15 62-17 62-16 63-14 63-13 63-10 63-9 63-10 64-11 63-13 62-16 61-18 62-14 64-5 63 8 53 30 24 54-3 64-5 63 17 57 47 37l30 11m226 0l33-5q33-5 66-11t66-14 65-17 64-19 64-19 64-19 64-19 64-19 63-19 63-19 65-18 65-15 66-11 67-5 66-2 67-1 67 2 66 6l33 4m-3040 118l32 6q32 6 65 9t65 2 65-3 65-6 64-9 64-12 64-14 64-16 63-17 63-16 64-14 64-12 65-11 65-10 64-10 64-11 64-14 63-17 63-16 65-10 64 5 52 31 22 56-5 65-7 64 18 57l19 25m410 0l32-7q32-7 64-15t63-17 63-18 63-19 63-19 63-18 63-18 63-18 63-18 64-17 64-13 65-9 66-5 66 0 65 3 65 5 65 10l32 7m-3040 118l32 3q32 3 65 4t66-1 65-5 64-8 64-11 64-12 64-14 63-16 63-16 64-16 64-15 64-13 64-11 64-9 64-9 64-11 64-13 64-16 64-16 64-7 60 15 36 46 1 63-13 63 2 62l8 31m540 0l32-8q32-8 64-17t63-18 63-19 64-19 63-18 63-18 64-17 64-17 64-16 65-12 66-8 66-3 66 2 66 6 65 11 63 18l31 11m-3040 102l32 1q32 1 65 0t65-3 65-6 65-9 64-11 63-13 63-14 63-16 63-17 63-16 63-14 64-12 64-11 65-10 65-9 64-9 64-11 63-14 63-13 64-1 48 31 10 59-14 63-7 63l1 32m650 0l33-9q33-9 65-18t65-19 65-19 64-18 65-17 65-17 65-17 66-15 67-11 67-6 67-1 67 5 66 11 64 20 61 28l30 15m-3040 74l33-1q33-1 67-3t67-5 66-8 66-11 65-12 65-13 65-15 64-16 65-16 65-16 65-15 66-12 66-10 66-9 66-8 66-8 66-9 66-9 64 6 33 42-7 64-11 65l-2 33m754 0l31-9q31-9 63-18t63-17 62-17 62-17 63-16 63-15 63-14 64-12 64-7 65-2 65 4 63 12 61 22 57 30 56 31l29 15m-2914 30l32-4q32-4 64-9t63-10 63-11 63-13 63-14 63-15 62-16 62-15 62-14 63-13 64-11 64-8 64-6 64-5 64-4 64 0 54 21 21 51-4 64l-3 32m856 0l32-9q32-9 64-18t64-17 64-16 65-16 65-15 65-13 66-10 66-5 66 2 65 11 62 22 57 33 57 35l30 16m-2734 0l32-6q32-6 65-12t65-13 64-14 64-15 64-16 64-15 64-14 64-12 65-9 66-7 65-4 65 0 65 9 48 35 16 60l0 33m960 0l33-9q33-9 67-18t67-16 67-15 68-14 68-11 68-8 69-1 68 10 64 24 58 37l27 21m-2534 0l33-7q33-7 66-14t65-14 65-15 66-16 66-15 66-12 66-9 67-7 67-3 66 5 61 24 36 51l8 32m-722 0l32-7q32-7 63-14t63-14 63-14 63-13 64-11 64-8 65-4 65 2 61 16 45 40l16 27";

  function gradasi(k) {
    const base =
      "radial-gradient(55% 130% at 100% 0%, " + k.m1 + " 0%, transparent 70%), radial-gradient(45% 120% at 72% 100%, " + k.m2 + " 0%, transparent 70%), " +
      "radial-gradient(40% 110% at 45% 0%, " + k.m3 + " 0%, transparent 70%), linear-gradient(100deg, " + CARD + " 0%, " + k.m0 + " 35%, " + k.m4 + " 100%)";
    const ambient = svgAbs(
      '<path d="' + TOPO_MESH + '" fill="none" stroke="' + k.line + '" style="stroke-width: 2.2; stroke-opacity: ' + k.op + ';"></path>',
      "0 0 2880 450", "xMaxYMid slice", FULL,
      " -webkit-mask-image: linear-gradient(to right, rgba(0,0,0,0.25) 0%, black 45%); mask-image: linear-gradient(to right, rgba(0,0,0,0.25) 0%, black 45%);"
    );
    return { base, ambient, feature: "" };
  }

  // ---------- Lanskap: langit, matahari/bulan, bukit berlapis, pohon ----------
  // [x%, y%, jari-jari px, top bukit %] matahari per tempat; bulan [x%, y%, r].
  const SUN = { hero: [58, 40, 34, 38], pomo: [78, 36, 30, 48], thumb: [56, 42, 10, 30] };
  const MOON = { hero: [66, 24, 16], pomo: [56, 20, 18], thumb: [70, 26, 7] };

  function lanskap(L, place, id) {
    const s = SUN[place];
    const sky = "linear-gradient(180deg, " + L.sky[0] + " 0%, " + L.sky[1] + " 55%, " + L.sky[2] + " 100%)";
    let base;
    if (L.night) {
      const mo = MOON[place];
      const pos = " at " + mo[0] + "% " + mo[1] + "%, ";
      base = "radial-gradient(circle " + mo[2] + "px" + pos + L.sun + " 0 " + (mo[2] - 1) + "px, transparent " + mo[2] + "px), radial-gradient(circle " + mo[2] * 4 + "px" + pos + L.glow + " 0%, transparent 100%), " + sky;
    } else {
      const pos = " at " + s[0] + "% " + s[1] + "%, ";
      base = "radial-gradient(circle " + s[2] + "px" + pos + L.sun + " 0 " + (s[2] - 1) + "px, transparent " + s[2] + "px), radial-gradient(circle " + Math.floor(s[2] * 2.6) + "px" + pos + L.glow + " 0%, transparent 100%), " + sky;
    }
    const op = (pair) => 'fill="' + pair[0] + '" style="opacity: ' + pair[1] + ';"';
    const hills =
      "<defs>" + lin(id("h"), 0, 1, stop(0, L.hill[0]) + stop(1, L.hill[1])) + lin(id("p"), 0, 1, stop(0, L.ridgeP[0]) + stop(1, L.ridgeP[1])) +
      lin(id("g"), 0, 1, stop(0, L.ground[0]) + stop(1, L.ground[1])) + "</defs>" +
      '<path d="M0 28 C120 18 260 22 380 30 C300 34 120 36 0 34 Z" ' + op(L.cloud) + "></path>" +
      '<path d="M980 26 C1100 14 1280 12 1440 20 L1440 30 C1280 26 1100 30 980 30 Z" ' + op(L.cloud) + "></path>" +
      // Bukit jauh: ujung kanan far1 dan ujung kiri far2 turun landai ke dasar (mockup memotong tegak di x 780/800, terlihat
      // sebagai tepi keras di celah antarbukit); tangen di sambungan sama, sisanya = mockup.
      '<path d="M0 118 C80 88 150 62 230 70 C300 78 340 100 410 94 C480 88 530 70 610 84 C670 95 720 110 780 122 C820 130 850 165 880 225 L0 225 Z" ' + op(L.far1) + "></path>" +
      '<path d="M740 225 C760 200 765 175 800 160 C870 130 960 96 1060 86 C1150 78 1230 84 1300 62 C1350 48 1410 46 1440 54 L1440 225 L740 225 Z" ' + op(L.far2) + "></path>" +
      '<path d="M0 150 C60 122 120 100 182 104 C240 108 262 126 322 128 C402 132 452 100 522 98 C602 96 682 140 762 168 C802 182 842 186 882 180 L882 225 L0 225 Z" fill="url(#' + id("h") + ')"></path>' +
      '<path d="M760 178 C840 162 920 142 1000 132 C1060 124 1100 100 1150 104 C1200 108 1232 130 1282 120 C1340 108 1392 72 1440 64 L1440 225 L760 225 Z" ' + op(L.ridge) + "></path>" +
      '<path d="M890 192 C970 172 1040 152 1110 152 C1180 152 1232 162 1282 142 C1340 118 1392 98 1440 94 L1440 225 L890 225 Z" fill="url(#' + id("p") + ')"></path>' +
      '<path d="M560 202 C700 190 820 180 960 184 C1080 188 1200 178 1300 172 C1360 168 1410 170 1440 172 L1440 225 L560 225 Z" ' + op(L.mist) + "></path>" +
      '<path d="M0 192 C120 178 240 174 380 182 C520 190 620 198 760 202 C900 206 1000 204 1100 200 C1250 194 1350 190 1440 188 L1440 225 L0 225 Z" fill="url(#' + id("g") + ')"></path>';
    let ambient = svgAbs(hills, "0 0 1440 225", "none", "left: 0; top: " + s[3] + "%; width: 100%; height: " + (100 - s[3]) + "%;");
    if (L.night) {
      const R = [0.8, 1, 1.3];
      const O = [0.4, 0.6, 0.85];
      const st = rand().stars.map((v) => '<circle cx="' + v[0] + '" cy="' + v[1] + '" r="' + R[v[2]] + '" fill="' + L.sun + '" style="opacity: ' + O[v[3]] + ';"></circle>').join("");
      ambient = svgAbs(st, "0 0 1440 300", "xMidYMin slice", FULL) + ambient;
    }
    let feature = "";
    const trees = (pts) => pts.map((t) => tree(t[0], t[1], t[2], t[3], L.tree, L.trunk)).join("");
    if (place === "hero") {
      // Tiga pohon di sisi kanan kotak fitur (mockup: fx+232.., y kartu 154..158 → y kotak −4), boleh keluar kotak.
      feature = featureSvg("hero", trees([[232, 152, 40, 9], [250, 154, 52, 11], [292, 150, 22, 5]]));
    } else if (place === "pomo") {
      // Pomodoro: dua pohon + satu kecil di pojok kiri bawah kartu (koordinat mockup 960×304, dijangkar ke bawah). Kelas
      // hb-trees: disembunyikan di HP (app.css), tempat pojok itu = input parkir.
      ambient += svgAbs(trees([[42, 292, 34, 8], [60, 294, 46, 10], [150, 290, 18, 4.5]]), "0 240 170 64", "xMinYMax meet", "left: 0; bottom: 0; width: 170px; height: 64px;", " overflow: visible;", "hb-trees");
    }
    return { base, ambient, feature };
  }

  // ---------- Galaksi: piksel, titik, jalur misi neon, menara kristal ----------
  function galaksi(G, place, id) {
    const R = rand();
    const PX_OP = [0.35, 0.5, 0.7, 0.9];
    const pxRects = (list, cols) => list.map((v) => '<rect x="' + v[0] + '" y="' + v[1] + '" width="7" height="7" fill="' + cols[v[2]] + '" style="opacity: ' + PX_OP[v[3]] + ';"></rect>').join("");
    const pattern = (name, list, cols, shift) =>
      '<pattern id="' + id(name) + '" width="80" height="80" patternUnits="userSpaceOnUse"' + (shift ? ' patternTransform="translate(37 21)"' : "") + ">" + pxRects(list, cols) + "</pattern>";
    const neon = (d) =>
      '<path d="' + d + '" fill="none" stroke="' + G.path + '" style="stroke-width: 7; stroke-opacity: 0.16; stroke-linejoin: round;"></path>' +
      '<path d="' + d + '" fill="none" stroke="' + G.path + '" style="stroke-width: 2.2; stroke-linejoin: round;"></path>';
    const diamond = (x, y, s) =>
      '<rect x="' + (x - s) + '" y="' + (y - s) + '" width="' + 2 * s + '" height="' + 2 * s + '" rx="5" transform="rotate(45 ' + x + " " + y + ')" fill="' + G.node + '" stroke="' + G.nodeStroke + '" style="stroke-width: 2;"></rect>' +
      sparkle(x, y, s * 0.62, G.icon, false);
    const W = "#FFFFFF";
    let ambient;
    if (place === "pomo") {
      // Kartu Pomodoro: piksel hanya ±10% tepi kanan, titik tersebar, dua kilau. Tanpa viewBox (satuan = px kartu):
      // pola piksel tetap 7 px, posisi titik/kilau dalam persen atau dijangkar ke tepi kanan-bawah.
      const PR = [0.8, 1, 1.3];
      const PO = [0.3, 0.45, 0.6];
      const dots = R.pdots.map((v) =>
        '<circle cx="' + ((v[0] / 960) * 100).toFixed(2) + '%" cy="' + ((v[1] / 304) * 100).toFixed(2) + '%" r="' + PR[v[2]] + '" fill="' + G.dot + '" style="opacity: ' + (PO[v[3]] * G.dotOp).toFixed(2) + ';"></circle>').join("");
      ambient = svgAbs(
        "<defs>" + pattern("p2", R.px2, G.px2, true) + lin(id("mr"), 1, 0, stop(0, W, 0) + stop(0.9, W, 0) + stop(1, W, 0.85)) +
        '<mask id="' + id("kr") + '"><rect width="100%" height="100%" fill="url(#' + id("mr") + ')"></rect></mask></defs>' +
        '<rect width="100%" height="100%" fill="url(#' + id("p2") + ')" mask="url(#' + id("kr") + ')"></rect>' + dots +
        at("47%", 34, sparkle(0, 0, 8, G.spark)) + at("100%", "100%", sparkle(-70, -26, 6, G.spark2)),
        "", "", FULL
      );
    } else {
      const DR = [0.8, 1, 1.3, 1.6];
      const DO = [0.35, 0.55, 0.8];
      const dots = R.dots.map((v) => '<circle cx="' + v[0] + '" cy="' + v[1] + '" r="' + DR[v[2]] + '" fill="' + G.dot + '" style="opacity: ' + (DO[v[3]] * G.dotOp).toFixed(2) + ';"></circle>').join("");
      ambient = svgAbs(
        "<defs>" + pattern("p1", R.px1, G.px1, false) + pattern("p2", R.px2, G.px2, true) +
        lin(id("ml"), 1, 0, stop(0, W, 0.55) + stop(0.07, W, 0) + stop(1, W, 0)) +
        lin(id("mr"), 1, 0, stop(0, W, 0) + stop(0.7, W, 0) + stop(0.86, W, 0.8) + stop(1, W, 1)) +
        '<mask id="' + id("kl") + '"><rect width="1440" height="300" fill="url(#' + id("ml") + ')"></rect></mask>' +
        '<mask id="' + id("kr") + '"><rect width="1440" height="300" fill="url(#' + id("mr") + ')"></rect></mask></defs>' +
        '<rect width="1440" height="300" fill="url(#' + id("p1") + ')" mask="url(#' + id("kl") + ')"></rect>' +
        '<rect width="1440" height="300" fill="url(#' + id("p2") + ')" mask="url(#' + id("kr") + ')"></rect>' + dots +
        neon("M780 300 L840 250 L1010 250 L1060 200 L1060 160 L1110 120 L1200 120 L1240 80 L1440 80") +
        '<circle cx="1010" cy="250" r="11" fill="' + G.node + '" stroke="' + G.nodeStroke + '" style="stroke-width: 2;"></circle>' + sparkle(1010, 250, 7, G.spark2, false) +
        diamond(1110, 120, 16) + diamond(1240, 80, 16) +
        sparkle(905, 40, 9, G.spark) + sparkle(1150, 205, 7, G.spark) + sparkle(1330, 170, 9, G.spark2) + sparkle(1390, 40, 6, G.spark),
        "0 0 1440 300", "xMaxYMid slice", FULL
      );
    }
    let feature = "";
    if (place !== "thumb") {
      const tw = G.tw;
      const tg = "<defs>" + lin(id("t1"), 1, 1, stop(0, tw[0]) + stop(1, tw[1])) + lin(id("t2"), 0, 1, stop(0, tw[2]) + stop(1, tw[3])) +
        lin(id("co"), 0, 1, stop(0, G.core[0]) + stop(1, G.core[1])) + "</defs>";
      if (place === "hero") {
        const tower = tg +
          '<path d="M22 225 L10 120 L40 150 L50 225 Z" fill="url(#' + id("t1") + ')"></path>' +
          '<path d="M52 225 L40 112 L80 140 L90 225 Z" fill="url(#' + id("t2") + ')"></path>' +
          '<path d="M128 225 L140 112 L100 140 L92 225 Z" fill="url(#' + id("t2") + ')"></path>' +
          '<path d="M158 225 L170 120 L140 150 L130 225 Z" fill="url(#' + id("t1") + ')"></path>' +
          '<path d="M40 112 L56 84 L80 140 Z M140 112 L124 84 L100 140 Z" fill="' + tw[0] + '" style="opacity: 0.9;"></path>' +
          '<path d="M52 70 L68 56 L112 56 L128 70 L112 84 L68 84 Z" fill="' + G.gem + '" stroke="' + G.gemStroke + '" style="stroke-width: 2;"></path>' +
          '<rect x="85" y="92" width="10" height="133" rx="5" fill="' + G.core[1] + '" style="opacity: 0.35;"></rect>' +
          '<rect x="87" y="92" width="6" height="133" rx="3" fill="url(#' + id("co") + ')"></rect>' +
          sparkle(20, 60, 7, G.spark) + sparkle(160, 40, 5, G.spark2);
        feature = featureSvg("hero", nest(60, 0, 180, 140, "0 0 180 225", "xMidYMax meet", tower));
      } else {
        // Kartu Pomodoro: jalur misi mendatar + permata kecil.
        const row = tg + neon("M0 40 L60 40 L80 22 L190 22 L210 40 L320 40") + diamond(80, 22, 12) + diamond(210, 40, 12) +
          '<path d="M262 40 L270 18 L282 30 L294 18 L302 40 Z" fill="url(#' + id("t1") + ')"></path>' +
          sparkle(140, 50, 6, G.spark) + sparkle(320, 12, 6, G.spark2);
        feature = featureSvg("pomo", nest(0, 0, 340, 62, "0 0 330 60", "xMidYMid meet", row));
      }
    }
    return { base: G.base, ambient, feature };
  }

  // ---------- Objek 3D: ubin centang, jam weker, buku spiral, bola ----------
  function objDefs(p, o) {
    return (
      "<defs>" +
      rad(p + "sp", 0.35, 0.3, 0.75, stop(0, o.sph[0]) + stop(0.38, o.sph[1]) + stop(1, o.sph[2])) +
      rad(p + "s2", 0.35, 0.3, 0.75, stop(0, o.sph2[0]) + stop(0.4, o.sph2[1]) + stop(1, o.sph2[2])) +
      lin(p + "ti", 1, 1, stop(0, o.tile[0]) + stop(1, o.tile[1])) +
      lin(p + "bk", 1, 1, stop(0, o.book[0]) + stop(1, o.book[1])) +
      rad(p + "fc", 0.4, 0.35, 0.7, stop(0, o.face[0]) + stop(1, o.face[1])) +
      rad(p + "bl", 0.35, 0.3, 0.8, stop(0, o.bell[0]) + stop(1, o.bell[1])) +
      rad(p + "sh", 0.5, 0.5, 0.5, stop(0, o.shadow, 0.26) + stop(1, o.shadow, 0)) +
      '<filter id="' + p + 'b1" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.4"></feGaussianBlur></filter>' +
      "</defs>"
    );
  }
  function oTile(p, o, x, y, s, rot) {
    const r = s * 0.24;
    const cs = f1(s * 0.14);
    const chk = "M" + f1(-s * 0.22) + " " + f1(s * 0.02) + " L" + f1(-s * 0.05) + " " + f1(s * 0.18) + " L" + f1(s * 0.25) + " " + f1(-s * 0.16);
    const line = "stroke-width: " + cs + "; stroke-linecap: round; stroke-linejoin: round;";
    return (
      '<g transform="translate(' + x + " " + y + ") rotate(" + rot + ')">' +
      '<rect x="' + -s / 2 + '" y="' + f1(-s / 2 + s * 0.09) + '" width="' + s + '" height="' + s + '" rx="' + f1(r) + '" fill="' + o.tileSide + '"></rect>' +
      '<rect x="' + -s / 2 + '" y="' + -s / 2 + '" width="' + s + '" height="' + s + '" rx="' + f1(r) + '" fill="url(#' + p + 'ti)"></rect>' +
      '<rect x="' + f1(-s / 2 + s * 0.08) + '" y="' + f1(-s / 2 + s * 0.06) + '" width="' + f1(s * 0.84) + '" height="' + f1(s * 0.3) + '" rx="' + f1(r * 0.8) + '" fill="#FFFFFF" style="opacity: 0.18;"></rect>' +
      '<path d="' + chk + '" transform="translate(0 ' + f1(s * 0.03) + ')" fill="none" stroke="' + o.tileSide + '" style="' + line + ' opacity: 0.45;"></path>' +
      '<path d="' + chk + '" fill="none" stroke="#FFFFFF" style="' + line + '"></path></g>'
    );
  }
  function oClock(p, o, x, y, s, rot) {
    let ticks = "";
    for (let k = 0; k < 12; k++) {
      const a = (k * Math.PI) / 6;
      ticks += '<path d="M' + f1(37 * Math.cos(a)) + " " + f1(37 * Math.sin(a)) + " L" + f1(32 * Math.cos(a)) + " " + f1(32 * Math.sin(a)) + '" stroke="' + o.tick + '" style="stroke-width: 3; stroke-linecap: round;"></path>';
    }
    return (
      '<g transform="translate(' + x + " " + y + ") rotate(" + rot + ") scale(" + s + ')">' +
      '<ellipse cx="0" cy="78" rx="56" ry="10" fill="url(#' + p + 'sh)"></ellipse>' +
      '<path d="M-30 46 L-42 70 M30 46 L42 70" stroke="' + o.legs + '" style="stroke-width: 7; stroke-linecap: round;"></path>' +
      '<path d="M-20 -62 L20 -62 M0 -62 L0 -52" stroke="' + o.legs + '" style="stroke-width: 6; stroke-linecap: round;"></path>' +
      '<g transform="rotate(-30)"><path d="M-17 -54 A19 19 0 0 1 21 -54 Z" fill="url(#' + p + 'bl)"></path></g>' +
      '<g transform="rotate(30)"><path d="M-21 -54 A19 19 0 0 1 17 -54 Z" fill="url(#' + p + 'bl)"></path></g>' +
      '<circle cx="4" cy="6" r="54" fill="' + o.tileSide + '"></circle>' +
      '<circle cx="0" cy="0" r="54" fill="url(#' + p + 'ti)"></circle>' +
      '<circle cx="0" cy="0" r="41" fill="url(#' + p + 'fc)"></circle>' + ticks +
      '<path d="M0 0 L0 -26 M0 0 L18 10" stroke="' + o.hand + '" style="stroke-width: 5; stroke-linecap: round;"></path>' +
      '<circle cx="0" cy="0" r="5" fill="' + o.dot2 + '"></circle>' +
      '<path d="M-36 -24 A44 44 0 0 1 -6 -42" fill="none" stroke="#FFFFFF" style="stroke-width: 5; stroke-linecap: round; opacity: 0.35;"></path></g>'
    );
  }
  function oBook(p, o, x, y, s, rot) {
    let rings = "";
    for (let yy = -36; yy < 46; yy += 12) rings += '<path d="M-46 ' + yy + " A7 7 0 0 1 -34 " + yy + '" fill="none" stroke="' + o.ring + '" style="stroke-width: 3; stroke-linecap: round;"></path>';
    return (
      '<g transform="translate(' + x + " " + y + ") rotate(" + rot + ") scale(" + s + ')">' +
      '<rect x="-40" y="-46" width="84" height="98" rx="10" fill="' + o.bookSide + '" transform="translate(5 7)"></rect>' +
      '<rect x="-40" y="-46" width="84" height="98" rx="10" fill="url(#' + p + 'bk)"></rect>' +
      '<rect x="-6" y="-34" width="40" height="22" rx="5" fill="#FFFFFF" style="opacity: 0.9;"></rect>' + rings +
      '<rect x="-34" y="-42" width="72" height="10" rx="5" fill="#FFFFFF" style="opacity: 0.18;"></rect></g>'
    );
  }
  function oSphere(p, x, y, r, g, blur) {
    return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="url(#' + p + g + ')"' + (blur ? ' filter="url(#' + p + 'b1)"' : "") + "></circle>";
  }

  function objek(o, place, id) {
    const p = id("");
    let ambient = "";
    let feature;
    if (place === "thumb") {
      const cl = objDefs(p, o) + oBook(p, o, 50, 70, 0.55, -26) + oClock(p, o, 112, 70, 0.55, 8) + oTile(p, o, 160, 120, 52, -12) + oSphere(p, 80, 138, 18, "sp");
      feature = featureSvg("thumb", nest(-20, 0, 106, 70, "0 0 200 160", "xMidYMid meet", cl));
    } else if (place === "hero") {
      const a = id("a");
      ambient = svgAbs(objDefs(a, o) + oSphere(a, 1300, 250, 26, "sp", true) + oSphere(a, 1420, 40, 30, "s2", true), "0 0 1440 300", "xMaxYMid slice", FULL);
      const cl = objDefs(p, o) + oSphere(p, 18, 150, 11, "sp", true) + oBook(p, o, 62, 70, 0.68, -26) + oSphere(p, 118, 160, 22, "sp") +
        oClock(p, o, 196, 96, 0.82, 8) + oTile(p, o, 312, 120, 78, -12) + oSphere(p, 380, 36, 18, "s2", true);
      feature = featureSvg("hero", nest(0, 0, 290, 140, "0 0 400 190", "xMidYMid meet", cl));
    } else {
      const cl = objDefs(p, o) + oSphere(p, 30, 60, 16, "sp", true) + oBook(p, o, 90, 62, 0.55, -18) + oClock(p, o, 190, 64, 0.62, 6) +
        oTile(p, o, 290, 70, 60, -10) + oSphere(p, 360, 76, 22, "sp") + oSphere(p, 400, 30, 14, "s2", true);
      feature = featureSvg("pomo", nest(0, -4, 340, 70, "0 0 420 125", "xMidYMid meet", cl));
    }
    return { base: o.base, ambient, feature };
  }

  // ---------- render ----------
  let seq = 0;
  // uid dipakai di atribut id dan url(#…): hanya [A-Za-z0-9_-] (karakter lain dikodekan), diawali huruf.
  function cleanUid(uid) {
    const s = uid === undefined || uid === null || uid === "" ? "hb" + ++seq : String(uid);
    const out = s.replace(/[^A-Za-z0-9_-]/g, (c) => "_" + c.charCodeAt(0).toString(16));
    return /^[A-Za-z]/.test(out) ? out : "hb" + out;
  }

  const has = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);

  // render({ kind, palette, mode, place, uid }) → { base, ambient, feature } (string). kind asing → "kontur", palet
  // tanpa skema → "default" (Kontur/Polos tetap memakai token palet aktif), mode selain "dark" → terang, place asing →
  // "hero".
  function render(opts) {
    const o = opts || {};
    const kind = KIND_IDS.includes(o.kind) ? o.kind : "kontur";
    const dark = o.mode === "dark";
    const place = PLACES.includes(o.place) ? o.place : "hero";
    const sc = SCHEMES[has(SCHEMES, o.palette) ? o.palette : "default"][dark ? "dark" : "light"];
    const u = cleanUid(o.uid);
    const id = (name) => u + "-" + name;
    if (kind === "kontur") return kontur(o.palette, dark, place);
    if (kind === "gradasi") return gradasi(sc.gradasi);
    if (kind === "lanskap") return lanskap(sc.lanskap, place, id);
    if (kind === "galaksi") return galaksi(sc.galaksi, place, id);
    if (kind === "objek") return objek(sc.objek, place, id);
    return {
      base: dark
        ? "linear-gradient(105deg, var(--bg-card) 40%, var(--bg-page) 100%), var(--bg-card)"
        : "linear-gradient(105deg, var(--bg-card) 45%, var(--accent-soft) 100%), var(--bg-card)",
      ambient: "",
      feature: "",
    };
  }

  return Object.freeze({ KINDS, SCHEMES, render });
});
