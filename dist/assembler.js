(function () {
  'use strict';

  var FALLBACK_CATALOG = [
    { file: 'examples/plate.jscad', title: 'Plate' },
    { file: 'examples/L-plate.jscad', title: 'L-Plate' },
    { file: 'examples/strip.jscad', title: 'Strip' },
    { file: 'examples/triangular-plate.jscad', title: 'Triangular Plate' },
    { file: 'examples/stl/Motor-Mount-28BYJ-48_M3INSERT.jscad', title: 'Motor Mount 28BYJ-48 M3 Insert' },
    { file: 'examples/stl/wheel-hex_M3TAP.jscad', title: 'Wheel Hex M3 TAP' }
  ];

  var state = {
    version: 1,
    catalog: FALLBACK_CATALOG.slice(),
    catalogCollapsed: false,
    panelsHidden: false,
    selectedCatalogIndex: 0,
    selectedPieceId: null,
    nextPieceCounter: 1,
    viewer: null,
    viewerResizeRaf: 0,
    viewerResizeObserver: null,
    engine: {
      rebuildSolids: null,
      rebuildSolidsInWorker: null,
      getParameterDefinitions: null,
      mergeSolids: null,
      Viewer: null
    },
    sourceCache: {},
    sourceCachePromises: {},
    pieces: []
  };

  var els = {};
  var renderQueued = false;

  function whenReady() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        setTimeout(bootstrap, 0);
      });
    } else {
      setTimeout(bootstrap, 0);
    }
  }

  async function bootstrap() {
    cacheElements();
    wireEvents();
    renderCatalog();
    renderAssemblyList();
    renderInspector();
    setGlobalStatus('Loading JSCAD core...', 'info');

    try {
      var response = await fetch('dist/min.js');
      if (!response.ok) throw new Error('Failed to fetch dist/min.js (' + response.status + ')');
      var source = await response.text();
      var bundleRequire = (0, eval)(source);
      if (typeof bundleRequire !== 'function') throw new Error('dist/min.js did not evaluate to a Browserify require function');

      var _r1 = bundleRequire(1);
      var getParameterDefinitions = bundleRequire(118);
      var _r121 = bundleRequire(121);
      var Viewer = bundleRequire(239);

      state.engine.rebuildSolids = _r1.rebuildSolids;
      state.engine.rebuildSolidsInWorker = _r1.rebuildSolidsInWorker;
      state.engine.getParameterDefinitions = getParameterDefinitions;
      state.engine.mergeSolids = _r121.mergeSolids;
      state.engine.Viewer = Viewer;

      initViewer();
      installViewerResizeHandlers();
      await loadCatalogFromIndex();
      renderCatalog();
      scheduleRender();
      setGlobalStatus('Assembler ready.', 'info');
    } catch (error) {
      setGlobalStatus('Failed to initialize assembler: ' + errorMessage(error), 'error');
    }
  }

  function cacheElements() {
    els.catalogList = document.getElementById('asmCatalogList');
    els.catalogToggle = document.getElementById('asmCatalogToggle');
    els.catalogRoot = document.getElementById('asmCatalog');
    els.layout = document.getElementById('asmLayout');
    els.pieceList = document.getElementById('asmPieceList');
    els.deselectBtn = document.getElementById('asmDeselectBtn');
    els.inspectorHeader = document.getElementById('asmInspectorHeader');
    els.inspectorCloseBtn = document.getElementById('asmInspectorCloseBtn');
    els.partIdInput = document.getElementById('asmPartIdInput');
    els.paramsWrap = document.getElementById('asmParamsWrap');
    els.params = document.getElementById('asmParams');
    els.pieceStatus = document.getElementById('asmPieceStatus');
    els.viewerHost = document.getElementById('asmViewer');
    els.viewerPanel = document.getElementById('asmViewerPanel');
    els.importInput = document.getElementById('asmImportInput');
    els.addBtn = document.getElementById('asmAddBtn');
    els.dupBtn = document.getElementById('asmDuplicateBtn');
    els.removeBtn = document.getElementById('asmRemoveBtn');
    els.exportBtn = document.getElementById('asmExportBtn');
    els.importBtn = document.getElementById('asmImportBtn');
    els.clearBtn = document.getElementById('asmClearBtn');
    els.hidePanelsBtn = document.getElementById('asmHidePanelsBtn');
    els.posX = document.getElementById('asmPosX');
    els.posY = document.getElementById('asmPosY');
    els.posZ = document.getElementById('asmPosZ');
    els.rotX = document.getElementById('asmRotX');
    els.rotY = document.getElementById('asmRotY');
    els.rotZ = document.getElementById('asmRotZ');
  }

  function wireEvents() {
    els.addBtn.addEventListener('click', onAddPiece);
    els.dupBtn.addEventListener('click', onDuplicatePiece);
    els.removeBtn.addEventListener('click', onRemovePiece);
    els.clearBtn.addEventListener('click', onClearPieces);
    els.exportBtn.addEventListener('click', onExport);
    els.importBtn.addEventListener('click', function () { els.importInput.click(); });
    els.importInput.addEventListener('change', onImportChange);
    els.catalogToggle.addEventListener('click', toggleCatalogList);
    els.deselectBtn.addEventListener('click', deselectSelectedPiece);
    els.inspectorCloseBtn.addEventListener('click', deselectSelectedPiece);
    els.hidePanelsBtn.addEventListener('click', hidePanels);
    els.partIdInput.addEventListener('change', commitPartIdChange);
    els.partIdInput.addEventListener('blur', commitPartIdChange);
    els.partIdInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitPartIdChange();
      }
    });

    [
      { el: els.posX, axis: 'x', type: 'position' },
      { el: els.posY, axis: 'y', type: 'position' },
      { el: els.posZ, axis: 'z', type: 'position' },
      { el: els.rotX, axis: 'x', type: 'rotation' },
      { el: els.rotY, axis: 'y', type: 'rotation' },
      { el: els.rotZ, axis: 'z', type: 'rotation' }
    ].forEach(function (entry) {
      entry.el.addEventListener('input', function () {
        commitTransform(entry.type, entry.axis, entry.el.value);
      });
    });
  }

  function initViewer() {
    if (!state.engine.Viewer || state.viewer) return;
    state.viewer = new state.engine.Viewer(els.viewerHost, {
      camera: {
        fov: 45,
        angle: { x: -50, y: 0, z: -35 },
        position: { x: 0, y: 0, z: 120 },
        clip: { min: 0.5, max: 1200 }
      },
      plate: { draw: true, size: 260 },
      axis: { draw: true },
      solid: { faces: true, lines: false }
    });
    state.viewer.clear();
  }

  function installViewerResizeHandlers() {
    if (!state.viewer) return;
    window.addEventListener('resize', scheduleViewerResize);

    if (typeof ResizeObserver !== 'undefined') {
      state.viewerResizeObserver = new ResizeObserver(function () {
        scheduleViewerResize();
      });
      state.viewerResizeObserver.observe(els.viewerPanel);
      state.viewerResizeObserver.observe(els.viewerHost);
    }

    scheduleViewerResize();
  }

  function scheduleViewerResize() {
    if (!state.viewer) return;
    if (state.viewerResizeRaf) cancelAnimationFrame(state.viewerResizeRaf);
    state.viewerResizeRaf = requestAnimationFrame(function () {
      state.viewerResizeRaf = 0;
      if (!state.viewer) return;
      try {
        if (typeof state.viewer.handleResize === 'function') {
          state.viewer.handleResize();
        } else if (typeof state.viewer.onDraw === 'function') {
          state.viewer.onDraw();
        }
      } catch (error) {}
    });
  }

  async function loadCatalogFromIndex() {
    try {
      var response = await fetch('dist/index.js');
      if (!response.ok) throw new Error('dist/index.js returned ' + response.status);
      var source = await response.text();
      var parsed = parseActiveExamplesFromIndex(source);
      if (!parsed.length) throw new Error('No examples found in active block.');
      state.catalog = parsed;
      state.selectedCatalogIndex = clamp(state.selectedCatalogIndex, 0, state.catalog.length - 1);
    } catch (error) {
      state.catalog = FALLBACK_CATALOG.slice();
      state.selectedCatalogIndex = clamp(state.selectedCatalogIndex, 0, state.catalog.length - 1);
      setGlobalStatus('Catalog fallback in use: ' + errorMessage(error), 'error');
    }
  }

  function parseActiveExamplesFromIndex(source) {
    var fnMarker = 'function createExamples(me)';
    var fnIndex = source.indexOf(fnMarker);
    if (fnIndex < 0) throw new Error('createExamples(me) block not found.');

    var marker = 'var examples = [';
    var startIndex = source.lastIndexOf(marker, fnIndex);
    if (startIndex < 0) throw new Error('active var examples block not found.');

    var arrayStart = source.indexOf('[', startIndex);
    if (arrayStart < 0) throw new Error('examples array start not found.');
    var arrayEnd = findArrayEnd(source, arrayStart);
    var literal = source.slice(arrayStart, arrayEnd + 1);

    var raw = (new Function('return (' + literal + ');'))();
    if (!Array.isArray(raw)) throw new Error('examples block is not an array.');

    return raw.map(function (entry) {
      if (!entry || typeof entry !== 'object' || typeof entry.file !== 'string') return null;
      var file = entry.file.indexOf('examples/') === 0 ? entry.file : 'examples/' + entry.file;
      file = normalizeModelFilePath(file);
      return {
        file: file,
        title: entry.title || entry.file,
        spacing: !!entry.spacing,
        new: !!entry.new,
        type: entry.type || '',
        wrap: !!entry.wrap
      };
    }).filter(Boolean);
  }

  function findArrayEnd(source, openBracketIndex) {
    var depth = 0;
    var inSingle = false;
    var inDouble = false;
    var inTemplate = false;
    var inLineComment = false;
    var inBlockComment = false;

    for (var i = openBracketIndex; i < source.length; i++) {
      var ch = source[i];
      var next = source[i + 1];

      if (inLineComment) {
        if (ch === '\n') inLineComment = false;
        continue;
      }
      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          i += 1;
        }
        continue;
      }
      if (inSingle) {
        if (ch === '\\') i += 1;
        else if (ch === '\'') inSingle = false;
        continue;
      }
      if (inDouble) {
        if (ch === '\\') i += 1;
        else if (ch === '"') inDouble = false;
        continue;
      }
      if (inTemplate) {
        if (ch === '\\') i += 1;
        else if (ch === '`') inTemplate = false;
        continue;
      }

      if (ch === '/' && next === '/') {
        inLineComment = true;
        i += 1;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i += 1;
        continue;
      }
      if (ch === '\'') { inSingle = true; continue; }
      if (ch === '"') { inDouble = true; continue; }
      if (ch === '`') { inTemplate = true; continue; }

      if (ch === '[') depth += 1;
      if (ch === ']') {
        depth -= 1;
        if (depth === 0) return i;
      }
    }

    throw new Error('examples array end not found.');
  }

  function toggleCatalogList() {
    state.catalogCollapsed = !state.catalogCollapsed;
    renderLayoutState();
  }

  function hidePanels() {
    state.panelsHidden = !state.panelsHidden;
    state.selectedPieceId = null;
    renderAssemblyList();
    renderInspector();
    scheduleRender();
  }

  function deselectSelectedPiece() {
    if (!state.selectedPieceId) return;
    state.selectedPieceId = null;
    renderAssemblyList();
    renderInspector();
    scheduleRender();
  }

  function renderLayoutState() {
    var inspectorVisible = !state.panelsHidden && !!state.selectedPieceId;
    var catalogVisible = !state.panelsHidden;

    els.layout.classList.toggle('is-panels-hidden', !catalogVisible);
    els.layout.classList.toggle('is-inspector-hidden', !inspectorVisible);
    els.catalogRoot.classList.toggle('is-catalog-collapsed', !!state.catalogCollapsed);

    els.catalogToggle.textContent = state.catalogCollapsed ? 'Expand' : 'Collapse';
    els.catalogToggle.setAttribute('aria-expanded', state.catalogCollapsed ? 'false' : 'true');

    var fullHidden = !!state.panelsHidden;
    els.addBtn.hidden = fullHidden;
    els.dupBtn.hidden = fullHidden;
    els.removeBtn.hidden = fullHidden;
    els.hidePanelsBtn.textContent = fullHidden ? 'Show Panel' : 'Hide Panel';
    els.deselectBtn.disabled = !state.selectedPieceId;
    els.inspectorCloseBtn.disabled = !state.selectedPieceId;

    scheduleViewerResize();
  }

  function renderCatalog() {
    renderLayoutState();
    els.catalogList.innerHTML = '';
    state.catalog.forEach(function (item, index) {
      if (item.spacing) {
        var divider = document.createElement('li');
        divider.className = 'asm-divider';
        divider.setAttribute('aria-hidden', 'true');
        els.catalogList.appendChild(divider);
      }

      var li = document.createElement('li');
      if (index === state.selectedCatalogIndex) li.classList.add('is-selected');
      li.addEventListener('click', function () {
        state.selectedCatalogIndex = index;
        renderCatalog();
      });

      var title = document.createElement('span');
      title.className = 'asm-catalog-item-title';
      title.textContent = item.title;
      li.appendChild(title);

      if (item.new) {
        var newBadge = document.createElement('span');
        newBadge.className = 'asm-new-badge';
        newBadge.textContent = 'NEW';
        li.appendChild(newBadge);
      }

      if (item.type) {
        var typeBadge = document.createElement('span');
        typeBadge.className = 'asm-type-badge';
        typeBadge.textContent = item.type;
        li.appendChild(typeBadge);
      }

      els.catalogList.appendChild(li);
    });
  }

  function renderAssemblyList() {
    els.pieceList.innerHTML = '';
    state.pieces.forEach(function (piece) {
      var li = document.createElement('li');
      li.textContent = piece.title + ' (' + piece.id + ')';
      if (piece.id === state.selectedPieceId) li.classList.add('is-selected');
      if (piece.loading) li.classList.add('is-loading');
      if (piece.error) li.classList.add('is-error');
      li.addEventListener('click', function () {
        state.selectedPieceId = piece.id;
        renderAssemblyList();
        renderInspector();
        scheduleRender();
      });
      els.pieceList.appendChild(li);
    });
  }

  function renderInspector() {
    var piece = getSelectedPiece();
    if (!piece) {
      els.inspectorHeader.textContent = 'No selection';
      els.partIdInput.value = '';
      els.partIdInput.disabled = true;
      setTransformEnabled(false);
      writeTransformInputs({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
      els.params.innerHTML = '';
      els.paramsWrap.hidden = true;
      setPieceStatus('', 'info');
      renderLayoutState();
      return;
    }

    els.inspectorHeader.textContent = piece.title;
    els.partIdInput.disabled = false;
    els.partIdInput.value = piece.id;
    setTransformEnabled(true);
    writeTransformInputs(piece.position, piece.rotation);
    var renderedParamCount = buildParameterUI(piece);
    els.paramsWrap.hidden = renderedParamCount === 0;
    if (piece.error) {
      setPieceStatus(errorMessage(piece.error), 'error');
    } else if (piece.loading) {
      setPieceStatus('Building...', 'info');
    } else {
      setPieceStatus('Ready', 'info');
    }
    renderLayoutState();
  }

  function setTransformEnabled(enabled) {
    [els.posX, els.posY, els.posZ, els.rotX, els.rotY, els.rotZ].forEach(function (el) {
      el.disabled = !enabled;
    });
  }

  function writeTransformInputs(position, rotation) {
    els.posX.value = safeNumber(position.x);
    els.posY.value = safeNumber(position.y);
    els.posZ.value = safeNumber(position.z);
    els.rotX.value = safeNumber(rotation.x);
    els.rotY.value = safeNumber(rotation.y);
    els.rotZ.value = safeNumber(rotation.z);
  }

  function safeNumber(value) {
    return Number.isFinite(Number(value)) ? String(Number(value)) : '0';
  }

  function getSelectedPiece() {
    for (var i = 0; i < state.pieces.length; i++) {
      if (state.pieces[i].id === state.selectedPieceId) return state.pieces[i];
    }
    return null;
  }

  function makePieceFromCatalog(item) {
    return {
      id: createPieceId(),
      file: normalizeModelFilePath(item.file),
      title: item.title,
      paramsDiff: {},
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      builtObjects: null,
      lastGoodObjects: null,
      buildKey: '',
      buildToken: 0,
      loading: false,
      error: null,
      _pendingImportParams: null
    };
  }

  function createPieceId() {
    var id;
    do {
      id = sanitizePieceId('piece_' + String(state.nextPieceCounter).padStart(3, '0'), 'piece');
      state.nextPieceCounter += 1;
      id = makeUniquePieceId(id);
    } while (!id);
    return id;
  }

  function commitPartIdChange() {
    var piece = getSelectedPiece();
    if (!piece) return;
    var nextId = makeUniquePieceId(sanitizePieceId(els.partIdInput.value, piece.id), piece);
    if (!nextId) nextId = piece.id;
    if (nextId === piece.id) {
      els.partIdInput.value = piece.id;
      return;
    }
    piece.id = nextId;
    state.selectedPieceId = nextId;
    els.partIdInput.value = nextId;
    renderAssemblyList();
    renderInspector();
    scheduleRender();
  }

  function sanitizePieceId(raw, fallback) {
    var text = String(raw == null ? '' : raw).trim();
    text = text.replace(/[^A-Za-z0-9_-]+/g, '_');
    text = text.replace(/^_+|_+$/g, '');
    if (!text) {
      text = String(fallback || 'piece').replace(/[^A-Za-z0-9_-]+/g, '_');
      text = text.replace(/^_+|_+$/g, '') || 'piece';
    }
    return text;
  }

  function makeUniquePieceId(baseId, exceptPiece) {
    var seed = sanitizePieceId(baseId, 'piece');
    var used = {};
    state.pieces.forEach(function (p) {
      if (!p || p === exceptPiece) return;
      used[p.id] = true;
    });
    if (!used[seed]) return seed;
    var counter = 2;
    var candidate = seed + '_' + counter;
    while (used[candidate]) {
      counter += 1;
      candidate = seed + '_' + counter;
    }
    return candidate;
  }

  function onAddPiece() {
    var item = state.catalog[state.selectedCatalogIndex] || state.catalog[0];
    if (!item) return;
    var piece = makePieceFromCatalog(item);
    state.pieces.push(piece);
    state.selectedPieceId = piece.id;
    renderAssemblyList();
    renderInspector();
    rebuildPiece(piece);
  }

  function onDuplicatePiece() {
    var piece = getSelectedPiece();
    if (!piece) return;
    var copy = {
      id: createPieceId(),
      file: piece.file,
      title: piece.title,
      paramsDiff: cloneValue(piece.paramsDiff),
      position: cloneValue(piece.position),
      rotation: cloneValue(piece.rotation),
      builtObjects: null,
      lastGoodObjects: null,
      buildKey: '',
      buildToken: 0,
      loading: false,
      error: null,
      _pendingImportParams: null
    };
    state.pieces.push(copy);
    state.selectedPieceId = copy.id;
    renderAssemblyList();
    renderInspector();
    rebuildPiece(copy);
  }

  function onRemovePiece() {
    var index = -1;
    for (var i = 0; i < state.pieces.length; i++) {
      if (state.pieces[i].id === state.selectedPieceId) {
        index = i;
        break;
      }
    }
    if (index < 0) return;

    state.pieces.splice(index, 1);
    if (state.pieces.length) {
      var nextIndex = Math.min(index, state.pieces.length - 1);
      state.selectedPieceId = state.pieces[nextIndex].id;
    } else {
      state.selectedPieceId = null;
    }

    renderAssemblyList();
    renderInspector();
    scheduleRender();
  }

  function onClearPieces() {
    if (!window.confirm('Clear the entire assembly? This will remove all parts.')) return;
    state.pieces = [];
    state.selectedPieceId = null;
    renderAssemblyList();
    renderInspector();
    if (state.viewer) state.viewer.clear();
  }

  function commitTransform(kind, axis, rawValue) {
    var piece = getSelectedPiece();
    if (!piece) return;
    if (!isCommittedNumber(rawValue)) return;
    var value = Number(rawValue);
    piece[kind][axis] = value;
    if (piece.error && piece.error.indexOf('Transform failed:') === 0) {
      piece.error = null;
      renderAssemblyList();
      renderInspector();
    }
    scheduleRender();
  }

  function isCommittedNumber(text) {
    if (typeof text !== 'string') return false;
    var trimmed = text.trim();
    if (!trimmed) return false;
    if (/^[+-]?$/.test(trimmed)) return false;
    if (/^[+-]?\d+\.$/.test(trimmed)) return false;
    var n = Number(trimmed);
    return Number.isFinite(n);
  }

  async function ensureSource(piece) {
    piece.file = normalizeModelFilePath(piece.file);
    var file = piece.file;
    if (state.sourceCache[file]) return state.sourceCache[file];
    if (state.sourceCachePromises[file]) return state.sourceCachePromises[file];

    state.sourceCachePromises[file] = (async function () {
      var fullUrl = new URL(file, location.href).href;
      var response = await fetch(file);
      if (!response.ok) throw new Error('Failed to load ' + file + ' (' + response.status + ')');
      var source = await response.text();

      var paramDefinitions = [];
      var defaultParams = {};
      try {
        paramDefinitions = state.engine.getParameterDefinitions ? (state.engine.getParameterDefinitions(source) || []) : [];
        defaultParams = getDefaultParams(paramDefinitions);
      } catch (error) {
        paramDefinitions = [];
        defaultParams = {};
      }

      var cache = {
        source: source,
        fullUrl: fullUrl,
        paramDefinitions: paramDefinitions,
        defaultParams: defaultParams
      };
      state.sourceCache[file] = cache;
      return cache;
    })();

    try {
      return await state.sourceCachePromises[file];
    } finally {
      delete state.sourceCachePromises[file];
    }
  }

  function getDefaultParams(definitions) {
    var out = {};
    (definitions || []).forEach(function (definition) {
      if (!definition || !definition.name) return;
      var type = String(definition.type || 'text').toLowerCase();
      if (type === 'group') return;

      if (type === 'checkbox') {
        out[definition.name] = !!definition.checked;
        return;
      }

      if (type === 'radio') {
        if ('checked' in definition) {
          out[definition.name] = definition.checked;
          return;
        }
        if ('initial' in definition) {
          out[definition.name] = definition.initial;
          return;
        }
        if ('default' in definition) {
          out[definition.name] = definition.default;
          return;
        }
        var rv = getChoiceValues(definition);
        out[definition.name] = rv.length ? rv[0] : '';
        return;
      }

      if (type === 'choice') {
        if ('default' in definition) {
          out[definition.name] = definition.default;
          return;
        }
        if ('initial' in definition) {
          out[definition.name] = definition.initial;
          return;
        }
        var values = getChoiceValues(definition);
        out[definition.name] = values.length ? values[0] : '';
        return;
      }

      if (type === 'int' || type === 'float' || type === 'number' || type === 'slider') {
        var numericBase = 'initial' in definition ? definition.initial : definition.default;
        var n = Number(numericBase);
        out[definition.name] = Number.isFinite(n) ? n : 0;
        return;
      }

      if (type === 'color') {
        out[definition.name] = 'initial' in definition ? String(definition.initial) : ('default' in definition ? String(definition.default) : '#808080');
        return;
      }

      out[definition.name] = 'initial' in definition ? definition.initial : ('default' in definition ? definition.default : '');
    });
    return out;
  }

  function getChoiceValues(definition) {
    if (Array.isArray(definition.values)) return definition.values;
    if (Array.isArray(definition.captions) && definition.captions.length) return definition.captions;
    return [];
  }

  function getEffectiveParams(piece, defaults) {
    return Object.assign({}, defaults || {}, piece.paramsDiff || {});
  }

  function normalizeParamsDiff(defaults, incoming) {
    var normalized = {};
    var src = incoming || {};
    Object.keys(src).forEach(function (key) {
      if (!(key in defaults)) return;
      var value = src[key];
      var defValue = defaults[key];
      if (!isEqualValue(value, defValue)) normalized[key] = value;
    });
    return normalized;
  }

  function isEqualValue(a, b) {
    if (typeof a === 'number' || typeof b === 'number') {
      return Number(a) === Number(b);
    }
    return String(a) === String(b);
  }

  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';

    var keys = Object.keys(value).sort();
    var fields = keys.map(function (k) {
      return JSON.stringify(k) + ':' + stableStringify(value[k]);
    });
    return '{' + fields.join(',') + '}';
  }

  function buildWithWorkerOrMain(piece, cache, effectiveParams, token) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var workerJob = null;

      function done(err, objects) {
        if (settled) return;
        settled = true;
        if (piece.buildToken !== token) return resolve({ stale: true });
        if (err) return reject(err);
        resolve({ objects: objects });
      }

      function runMainThread() {
        if (!state.engine.rebuildSolids) {
          reject(new Error('No rebuild engine available.'));
          return;
        }
        try {
          state.engine.rebuildSolids(cache.source, cache.fullUrl, effectiveParams, done, {});
        } catch (error) {
          reject(error);
        }
      }

      if (typeof state.engine.rebuildSolidsInWorker === 'function') {
        try {
          workerJob = state.engine.rebuildSolidsInWorker(cache.source, cache.fullUrl, effectiveParams, done, {});
        } catch (error) {
          workerJob = null;
        }
      }

      if (!workerJob) {
        runMainThread();
        return;
      }

      setTimeout(function () {
        if (settled) return;
        try {
          if (workerJob && typeof workerJob.cancel === 'function') workerJob.cancel();
        } catch (cancelErr) {}
        runMainThread();
      }, 3500);
    });
  }

  async function rebuildPiece(piece) {
    if (!state.engine.rebuildSolids && !state.engine.rebuildSolidsInWorker) return;

    piece.loading = true;
    piece.error = null;
    renderAssemblyList();
    if (piece.id === state.selectedPieceId) renderInspector();

    try {
      var cache = await ensureSource(piece);
      if (piece._pendingImportParams) {
        piece.paramsDiff = normalizeParamsDiff(cache.defaultParams, piece._pendingImportParams);
        piece._pendingImportParams = null;
      } else {
        piece.paramsDiff = normalizeParamsDiff(cache.defaultParams, piece.paramsDiff);
      }

      var effectiveParams = getEffectiveParams(piece, cache.defaultParams);
      var buildKey = stableStringify({ file: piece.file, effectiveParams: effectiveParams });
      if (piece.buildKey === buildKey && piece.builtObjects) {
        piece.loading = false;
        piece.error = null;
        renderAssemblyList();
        if (piece.id === state.selectedPieceId) renderInspector();
        scheduleRender();
        return;
      }

      piece.buildKey = buildKey;
      piece.buildToken += 1;
      var token = piece.buildToken;
      var result = await buildWithWorkerOrMain(piece, cache, effectiveParams, token);
      if (result && result.stale) return;

      piece.builtObjects = Array.isArray(result.objects) ? result.objects : [];
      piece.lastGoodObjects = piece.builtObjects;
      piece.error = null;
    } catch (error) {
      piece.error = errorMessage(error);
    } finally {
      piece.loading = false;
      renderAssemblyList();
      if (piece.id === state.selectedPieceId) renderInspector();
      scheduleRender();
    }
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () {
      renderQueued = false;
      renderAssembly();
    });
  }

  function renderAssembly() {
    if (!state.viewer || !state.engine.mergeSolids) return;

    var all = [];
    state.pieces.forEach(function (piece) {
      var sourceObjects = piece.builtObjects || piece.lastGoodObjects;
      if (!sourceObjects || !sourceObjects.length) return;

      var hadTransformError = false;
      sourceObjects.forEach(function (obj) {
        try {
          var transformed = applyPieceTransform(obj, piece);
          if (piece.id === state.selectedPieceId) {
            transformed = colorizeSelected(transformed);
          }
          all.push(transformed);
        } catch (error) {
          hadTransformError = true;
          piece.error = 'Transform failed: ' + errorMessage(error);
        }
      });

      if (!hadTransformError && piece.error && piece.error.indexOf('Transform failed:') === 0) {
        piece.error = null;
      }
    });

    renderAssemblyList();
    if (getSelectedPiece()) renderInspector();

    if (!all.length) {
      state.viewer.clear();
      return;
    }

    try {
      var merged = state.engine.mergeSolids(all);
      state.viewer.setCsg(merged);
    } catch (error) {
      setGlobalStatus('Render failed: ' + errorMessage(error), 'error');
    }
  }

  function colorizeSelected(obj) {
    try {
      if (obj && typeof obj.setColor === 'function') {
        return obj.setColor([1.0, 0.72, 0.2, 1.0]);
      }
    } catch (error) {}
    return obj;
  }

  function applyPieceTransform(obj, piece) {
    var out = obj;
    out = out.rotateX(Number(piece.rotation.x) || 0);
    out = out.rotateY(Number(piece.rotation.y) || 0);
    out = out.rotateZ(Number(piece.rotation.z) || 0);
    out = out.translate([
      Number(piece.position.x) || 0,
      Number(piece.position.y) || 0,
      Number(piece.position.z) || 0
    ]);
    return out;
  }

  function buildParameterUI(piece) {
    var cache = state.sourceCache[piece.file];
    if (!cache || !cache.paramDefinitions) {
      els.params.innerHTML = '';
      return 0;
    }

    var defaults = cache.defaultParams;
    var effective = getEffectiveParams(piece, defaults);
    els.params.innerHTML = '';
    var renderedCount = 0;

    cache.paramDefinitions.forEach(function (definition, idx) {
      if (!definition) return;
      var type = String(definition.type || 'text').toLowerCase();
      if (type === 'group') {
        var group = document.createElement('div');
        group.className = 'asm-group';
        var title = document.createElement('div');
        title.className = 'asm-group-title';
        renderCaption(title, definition.caption, definition.name || 'Group');
        group.appendChild(title);
        els.params.appendChild(group);
        return;
      }
      if (!definition.name) return;
      els.params.appendChild(createParamControl(piece, definition, effective[definition.name], defaults[definition.name], idx));
      renderedCount += 1;
    });
    return renderedCount;
  }

  function renderCaption(node, caption, fallbackText) {
    if (caption != null && caption !== '') {
      node.innerHTML = String(caption);
      return;
    }
    node.textContent = fallbackText || '';
  }

  function createParamControl(piece, definition, value, defaultValue, index) {
    var wrap = document.createElement('div');
    wrap.className = 'asm-param';

    var type = String(definition.type || 'text').toLowerCase();
    var input;

    if (type === 'choice') {
      input = document.createElement('select');
      var vals = getChoiceValues(definition);
      var captions = Array.isArray(definition.captions) ? definition.captions : vals;
      vals.forEach(function (v, i) {
        var opt = document.createElement('option');
        opt.value = String(v);
        opt.textContent = captions[i] != null ? String(captions[i]) : String(v);
        if (String(value) === String(v)) opt.selected = true;
        input.appendChild(opt);
      });
      input.addEventListener('change', function () {
        updateParam(piece, definition, input.value, defaultValue);
      });
    } else if (type === 'radio') {
      input = document.createElement('div');
      var radioVals = getChoiceValues(definition);
      var radioCaps = Array.isArray(definition.captions) ? definition.captions : radioVals;
      radioVals.forEach(function (v, i) {
        var row = document.createElement('label');
        var r = document.createElement('input');
        r.type = 'radio';
        r.name = 'asm_radio_' + piece.id + '_' + index;
        r.value = String(v);
        r.checked = String(value) === String(v);
        r.addEventListener('change', function () {
          if (r.checked) updateParam(piece, definition, r.value, defaultValue);
        });
        row.appendChild(r);
        row.appendChild(document.createTextNode(' ' + (radioCaps[i] != null ? radioCaps[i] : v)));
        input.appendChild(row);
      });
    } else {
      input = document.createElement('input');
      if (type === 'checkbox') {
        wrap.classList.add('asm-param-checkbox');
        input.type = 'checkbox';
        input.checked = !!value;
        input.id = 'asm_param_' + piece.id + '_' + index;
        input.addEventListener('change', function () {
          updateParam(piece, definition, input.checked, defaultValue);
        });
        wrap.appendChild(input);

        var checkboxLabel = document.createElement('label');
        checkboxLabel.setAttribute('for', input.id);
        renderCaption(checkboxLabel, definition.caption, definition.name);
        wrap.appendChild(checkboxLabel);
        return wrap;
      } else if (type === 'color') {
        input.type = 'color';
        input.value = normalizeColor(value);
        input.addEventListener('input', function () {
          updateParam(piece, definition, input.value, defaultValue);
        });
      } else if (type === 'slider') {
        input.type = 'range';
        if ('min' in definition) input.min = String(definition.min);
        if ('max' in definition) input.max = String(definition.max);
        input.step = 'step' in definition ? String(definition.step) : 'any';
        input.value = String(value);
        input.addEventListener('input', function () {
          updateParam(piece, definition, Number(input.value), defaultValue);
        });
      } else if (type === 'int' || type === 'float' || type === 'number') {
        input.type = 'number';
        input.step = type === 'int' ? '1' : 'any';
        if ('min' in definition) input.min = String(definition.min);
        if ('max' in definition) input.max = String(definition.max);
        input.value = String(value);
        input.addEventListener('input', function () {
          if (!isCommittedNumber(input.value)) return;
          var n = Number(input.value);
          if (!Number.isFinite(n)) return;
          if (type === 'int') n = Math.trunc(n);
          updateParam(piece, definition, n, defaultValue);
        });
      } else {
        input.type = 'text';
        input.value = value == null ? '' : String(value);
        input.addEventListener('input', function () {
          updateParam(piece, definition, input.value, defaultValue);
        });
      }
    }

    var label = document.createElement('label');
    renderCaption(label, definition.caption, definition.name);
    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  function normalizeColor(value) {
    var text = String(value || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(text)) return text;
    if (/^#[0-9a-fA-F]{3}$/.test(text)) {
      return '#' + text[1] + text[1] + text[2] + text[2] + text[3] + text[3];
    }
    return '#808080';
  }

  function updateParam(piece, definition, value, defaultValue) {
    var key = definition.name;
    if (!key) return;

    if (isEqualValue(value, defaultValue)) {
      delete piece.paramsDiff[key];
    } else {
      piece.paramsDiff[key] = value;
    }

    rebuildPiece(piece);
  }

  function onExport() {
    var payload = {
      version: 1,
      pieces: state.pieces.map(function (piece) {
        return {
          id: piece.id,
          file: piece.file,
          params: cloneValue(piece.paramsDiff || {}),
          position: {
            x: Number(piece.position.x) || 0,
            y: Number(piece.position.y) || 0,
            z: Number(piece.position.z) || 0
          },
          rotation: {
            x: Number(piece.rotation.x) || 0,
            y: Number(piece.rotation.y) || 0,
            z: Number(piece.rotation.z) || 0
          }
        };
      })
    };

    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'assembly.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setGlobalStatus('Exported assembly.json', 'info');
  }

  function onImportChange(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(String(reader.result || ''));
        importAssembly(parsed);
        setGlobalStatus('Imported assembly JSON.', 'info');
      } catch (error) {
        setGlobalStatus('Import failed: ' + errorMessage(error), 'error');
      } finally {
        els.importInput.value = '';
      }
    };
    reader.onerror = function () {
      setGlobalStatus('Import failed: unable to read file.', 'error');
      els.importInput.value = '';
    };
    reader.readAsText(file);
  }

  function importAssembly(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('Top-level JSON must be an object.');
    if (!Array.isArray(payload.pieces)) throw new Error('JSON must include a pieces array.');

    var usedIds = {};
    var newPieces = payload.pieces.map(function (raw) {
      if (!raw || typeof raw !== 'object') throw new Error('Each piece must be an object.');
      if (!raw.file || typeof raw.file !== 'string') throw new Error('Each piece must include a file path.');
      var normalizedFile = normalizeModelFilePath(raw.file);

      var baseId = sanitizePieceId(raw.id, 'piece');
      var uniqueId = baseId;
      var suffix = 2;
      while (usedIds[uniqueId]) {
        uniqueId = baseId + '_' + suffix;
        suffix += 1;
      }
      usedIds[uniqueId] = true;

      return {
        id: uniqueId,
        file: normalizedFile,
        title: inferTitle(normalizedFile),
        paramsDiff: {},
        position: normalizeVector(raw.position),
        rotation: normalizeVector(raw.rotation),
        builtObjects: null,
        lastGoodObjects: null,
        buildKey: '',
        buildToken: 0,
        loading: false,
        error: null,
        _pendingImportParams: raw.params && typeof raw.params === 'object' ? cloneValue(raw.params) : {}
      };
    });

    state.pieces = newPieces;
    state.selectedPieceId = newPieces.length ? newPieces[0].id : null;
    renderAssemblyList();
    renderInspector();

    newPieces.forEach(function (piece) {
      rebuildPiece(piece);
    });

    if (!newPieces.length && state.viewer) {
      state.viewer.clear();
    }
  }

  function inferTitle(file) {
    file = normalizeModelFilePath(file);
    for (var i = 0; i < state.catalog.length; i++) {
      if (normalizeModelFilePath(state.catalog[i].file) === file) return state.catalog[i].title;
    }
    var parts = String(file).split('/');
    return parts[parts.length - 1] || file;
  }

  function normalizeVector(raw) {
    raw = raw || {};
    return {
      x: Number.isFinite(Number(raw.x)) ? Number(raw.x) : 0,
      y: Number.isFinite(Number(raw.y)) ? Number(raw.y) : 0,
      z: Number.isFinite(Number(raw.z)) ? Number(raw.z) : 0
    };
  }

  function cloneValue(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  function normalizeModelFilePath(file) {
    var text = String(file || '');
    return /\.stl$/i.test(text) ? text.replace(/\.stl$/i, '.jscad') : text;
  }

  function setGlobalStatus(message, kind) {
    if (kind === 'error') {
      console.error('[assembler]', message || '');
      return;
    }
    console.log('[assembler]', message || '');
  }

  function setPieceStatus(message, kind) {
    els.pieceStatus.textContent = message || '';
    els.pieceStatus.className = kind === 'error' ? 'is-error' : 'is-info';
  }

  function errorMessage(error) {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    return error.message || String(error);
  }

  whenReady();
})();
