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
    pieces: [],
    previewRefsEnabled: false,
    previewRefEntries: [],
    previewRefsRaf: 0
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
    els.previewRefs = document.getElementById('asmPreviewRefs');
    els.previewRefsSvg = document.getElementById('asmPreviewRefsSvg');
    els.previewRefsLayer = document.getElementById('asmPreviewRefsLayer');
    els.importInput = document.getElementById('asmImportInput');
    els.addBtn = document.getElementById('asmAddBtn');
    els.dupBtn = document.getElementById('asmDuplicateBtn');
    els.removeBtn = document.getElementById('asmRemoveBtn');
    els.exportBtn = document.getElementById('asmExportBtn');
    els.importBtn = document.getElementById('asmImportBtn');
    els.exportTxtBtn = document.getElementById('asmExportTxtBtn');
    els.viewRefsBtn = document.getElementById('asmViewRefsBtn');
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
    els.exportTxtBtn.addEventListener('click', onExportTxt);
    if (els.viewRefsBtn) els.viewRefsBtn.addEventListener('click', togglePreviewRefsMode);
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
    installPreviewRefsHooks();
    state.viewer.clear();
    syncPreviewRefsViewport();
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
        syncPreviewRefsViewport();
        renderPreviewRefs();
      } catch (error) {}
    });
  }

  function installPreviewRefsHooks() {
    if (!state.viewer || state.viewer.__asmPreviewRefsWrapped) return;
    var originalOnDraw = typeof state.viewer.onDraw === 'function' ? state.viewer.onDraw.bind(state.viewer) : null;
    state.viewer.__asmPreviewRefsWrapped = true;
    state.viewer.onDraw = function () {
      var result = originalOnDraw ? originalOnDraw.apply(state.viewer, arguments) : undefined;
      schedulePreviewRefsOverlayUpdate();
      return result;
    };
  }

  function togglePreviewRefsMode() {
    setPreviewRefsEnabled(!state.previewRefsEnabled);
  }

  function setPreviewRefsEnabled(enabled) {
    state.previewRefsEnabled = !!enabled;
    if (els.viewRefsBtn) {
      els.viewRefsBtn.setAttribute('aria-pressed', state.previewRefsEnabled ? 'true' : 'false');
      els.viewRefsBtn.classList.toggle('is-active', state.previewRefsEnabled);
    }
    if (els.previewRefs) {
      els.previewRefs.classList.toggle('is-active', state.previewRefsEnabled);
      els.previewRefs.setAttribute('aria-hidden', state.previewRefsEnabled ? 'false' : 'true');
    }
    renderPreviewRefs();
  }

  function syncPreviewRefsViewport() {
    if (!els.previewRefs || !els.viewerHost) return;
    var width = Math.max(els.viewerHost.clientWidth || 0, 0);
    var height = Math.max(els.viewerHost.clientHeight || 0, 0);
    els.previewRefs.style.left = (els.viewerHost.offsetLeft || 0) + 'px';
    els.previewRefs.style.top = (els.viewerHost.offsetTop || 0) + 'px';
    els.previewRefs.style.width = width + 'px';
    els.previewRefs.style.height = height + 'px';
  }

  function schedulePreviewRefsOverlayUpdate() {
    if (state.previewRefsRaf) return;
    state.previewRefsRaf = requestAnimationFrame(function () {
      state.previewRefsRaf = 0;
      updatePreviewRefsOverlay();
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

  function selectPieceById(pieceId) {
    if (!pieceId) return;
    var exists = false;
    for (var i = 0; i < state.pieces.length; i += 1) {
      if (state.pieces[i] && state.pieces[i].id === pieceId) {
        exists = true;
        break;
      }
    }
    if (!exists) return;
    state.selectedPieceId = pieceId;
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
    state.pieces.forEach(function (piece, index) {
      var li = document.createElement('li');

      var ref = document.createElement('span');
      ref.className = 'asm-piece-ref';
      ref.textContent = String(index + 1);
      li.appendChild(ref);

      li.appendChild(document.createTextNode(piece.title + ' (' + piece.id + ')'));
      if (piece.id === state.selectedPieceId) li.classList.add('is-selected');
      if (piece.loading) li.classList.add('is-loading');
      if (piece.error) li.classList.add('is-error');
      li.addEventListener('click', function () {
        selectPieceById(piece.id);
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
    renderPreviewRefs();
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
    var previewEntries = [];
    state.pieces.forEach(function (piece, index) {
      var sourceObjects = piece.builtObjects || piece.lastGoodObjects;
      if (!sourceObjects || !sourceObjects.length) return;

      var hadTransformError = false;
      var pieceBounds = null;
      sourceObjects.forEach(function (obj) {
        try {
          var transformedBase = applyPieceTransform(obj, piece);
          pieceBounds = extendPreviewBounds(pieceBounds, getObjectBounds(transformedBase));
          var transformed = transformedBase;
          if (piece.id === state.selectedPieceId) {
            transformed = colorizeSelected(transformed);
          }
          all.push(transformed);
        } catch (error) {
          hadTransformError = true;
          piece.error = 'Transform failed: ' + errorMessage(error);
        }
      });

      if (pieceBounds) {
        previewEntries.push({
          pieceId: piece.id,
          refNumber: index + 1,
          title: piece.title,
          customName: piece.id,
          selected: piece.id === state.selectedPieceId,
          bounds: cloneBounds(pieceBounds),
          origin: {
            x: Number(piece.position.x) || 0,
            y: Number(piece.position.y) || 0,
            z: Number(piece.position.z) || 0
          }
        });
      }

      if (!hadTransformError && piece.error && piece.error.indexOf('Transform failed:') === 0) {
        piece.error = null;
      }
    });

    state.previewRefEntries = previewEntries;

    renderAssemblyList();
    if (getSelectedPiece()) renderInspector();

    if (!all.length) {
      state.viewer.clear();
      renderPreviewRefs();
      return;
    }

    try {
      var merged = state.engine.mergeSolids(all);
      state.viewer.setCsg(merged);
      renderPreviewRefs();
    } catch (error) {
      setGlobalStatus('Render failed: ' + errorMessage(error), 'error');
      renderPreviewRefs();
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

  function renderPreviewRefs() {
    syncPreviewRefsViewport();
    if (!state.previewRefsEnabled) {
      clearPreviewRefsOverlay();
      return;
    }
    schedulePreviewRefsOverlayUpdate();
  }

  function clearPreviewRefsOverlay() {
    if (els.previewRefsLayer) els.previewRefsLayer.innerHTML = '';
    if (els.previewRefsSvg) els.previewRefsSvg.innerHTML = '';
  }

  function updatePreviewRefsOverlay() {
    syncPreviewRefsViewport();

    if (!state.previewRefsEnabled || !els.previewRefs || !els.previewRefsLayer || !els.previewRefsSvg || !state.viewer || !state.viewer.gl) {
      clearPreviewRefsOverlay();
      return;
    }

    var width = els.previewRefs.clientWidth || 0;
    var height = els.previewRefs.clientHeight || 0;
    if (!width || !height) {
      clearPreviewRefsOverlay();
      return;
    }

    var projectedItems = projectPreviewRefEntries(width, height);
    els.previewRefsLayer.innerHTML = '';
    els.previewRefsSvg.innerHTML = '';
    if (!projectedItems.length) return;

    projectedItems.sort(function (a, b) {
      return a.screenY - b.screenY;
    });

    projectedItems.forEach(function (item) {
      item.labelEl = buildPreviewRefLabel(item);
      item.labelEl.style.visibility = 'hidden';
      els.previewRefsLayer.appendChild(item.labelEl);
      var rect = item.labelEl.getBoundingClientRect();
      item.labelWidth = Math.max(32, Math.ceil(rect.width));
      item.labelHeight = Math.max(32, Math.ceil(rect.height));
    });

    layoutPreviewRefItems(projectedItems, width, height);

    projectedItems.forEach(function (item) {
      item.labelEl.style.left = item.labelRect.x + 'px';
      item.labelEl.style.top = item.labelRect.y + 'px';
      item.labelEl.style.visibility = 'visible';
      item.renderRect = getOverlayRelativeRect(item.labelEl, els.previewRefs) || item.labelRect;
    });

    projectedItems.forEach(function (item) {
      appendPreviewGuide(els.previewRefsSvg, item);
    });
  }

  function projectPreviewRefEntries(width, height) {
    var gl = state.viewer && state.viewer.gl;
    var canvas = state.viewer && (state.viewer.canvas || (gl && gl.canvas));
    if (!gl || !canvas || !els.previewRefs) return [];

    var overlayRect = els.previewRefs.getBoundingClientRect();
    var canvasRect = canvas.getBoundingClientRect();
    var viewport = gl.getParameter(gl.VIEWPORT);
    if (!viewport || viewport.length < 4 || !canvasRect.width || !canvasRect.height) return [];

    return state.previewRefEntries.reduce(function (out, entry) {
      if (!entry || !entry.bounds) return out;

      var originWorld = entry.origin || getBoundsCenter(entry.bounds);
      var originPoint = projectWorldPointToOverlay(gl, originWorld, overlayRect, canvasRect, viewport);
      if (!originPoint || !Number.isFinite(originPoint.z) || originPoint.z < 0 || originPoint.z > 1) return out;

      var center = getBoundsCenter(entry.bounds);
      var centerPoint = projectWorldPointToOverlay(gl, center, overlayRect, canvasRect, viewport) || originPoint;

      var cornerPoints = getBoundsCorners(entry.bounds).map(function (corner) {
        return projectWorldPointToOverlay(gl, corner, overlayRect, canvasRect, viewport);
      }).filter(function (point) {
        return point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z) && point.z >= 0 && point.z <= 1;
      });

      if (!cornerPoints.length) cornerPoints = [originPoint];

      var projectedHull = getConvexHull2D(cornerPoints.concat([originPoint]));
      var projectedRect = getProjectedPieceRect(projectedHull.length ? projectedHull : cornerPoints, originPoint, width, height);
      if (!projectedRect) return out;

      out.push({
        pieceId: entry.pieceId,
        refNumber: entry.refNumber,
        title: entry.title,
        customName: entry.customName,
        selected: !!entry.selected,
        anchorX: originPoint.x,
        anchorY: originPoint.y,
        screenX: originPoint.x,
        screenY: originPoint.y,
        pieceRect: projectedRect,
        projectedHull: projectedHull,
        originPoint: originPoint,
        centerPoint: centerPoint
      });
      return out;
    }, []);
  }

  function buildPreviewRefLabel(item) {
    var label = document.createElement('button');
    label.type = 'button';
    label.className = 'asm-preview-ref-label';
    if (item.selected) label.classList.add('is-selected');
    label.title = item.refNumber + ' · ' + item.title + ' · ' + item.customName;
    label.setAttribute('aria-label', 'Select part reference ' + item.refNumber + ' for ' + item.title);
    label.dataset.pieceId = item.pieceId;

    function swallowPointer(event) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    }

    label.addEventListener('pointerdown', function (event) {
      swallowPointer(event);
      selectPieceById(item.pieceId);
    });
    label.addEventListener('mousedown', function (event) {
      swallowPointer(event);
      selectPieceById(item.pieceId);
    });
    label.addEventListener('mouseup', swallowPointer);
    label.addEventListener('click', function (event) {
      swallowPointer(event);
      selectPieceById(item.pieceId);
    });

    var ref = document.createElement('span');
    ref.className = 'asm-preview-ref-index';
    ref.textContent = String(item.refNumber);
    label.appendChild(ref);

    return label;
  }

  function layoutPreviewRefItems(items, width, height) {
    if (!items || !items.length) return;

    var margin = 8;
    var placedRects = [];
    var placedLines = [];

    items.sort(function (a, b) {
      if (!!a.selected !== !!b.selected) return a.selected ? -1 : 1;
      var aCentrality = Math.min(a.anchorX, width - a.anchorX, a.anchorY, height - a.anchorY);
      var bCentrality = Math.min(b.anchorX, width - b.anchorX, b.anchorY, height - b.anchorY);
      if (aCentrality !== bCentrality) return bCentrality - aCentrality;
      return a.anchorY - b.anchorY;
    });

    items.forEach(function (item) {
      var candidates = buildPreviewPlacementCandidates(item, width, height);
      var best = null;
      var bestScore = Infinity;

      candidates.forEach(function (candidate, index) {
        var rect = {
          x: clamp(candidate.x, margin, Math.max(margin, width - item.labelWidth - margin)),
          y: clamp(candidate.y, margin, Math.max(margin, height - item.labelHeight - margin)),
          w: item.labelWidth,
          h: item.labelHeight
        };
        var attachPoint = getNearestPointOnRect(rect, item.anchorX, item.anchorY);
        var line = {
          x1: item.originPoint.x,
          y1: item.originPoint.y,
          x2: attachPoint.x,
          y2: attachPoint.y
        };
        var score = getPreviewPlacementScore(rect, placedRects, item, index, line, placedLines, width, height);
        if (score < bestScore) {
          bestScore = score;
          best = {
            rect: rect,
            attachPoint: attachPoint,
            line: line
          };
        }
      });

      if (!best) {
        var fallbackRect = {
          x: clamp(item.anchorX + 18, margin, Math.max(margin, width - item.labelWidth - margin)),
          y: clamp(item.anchorY - (item.labelHeight / 2), margin, Math.max(margin, height - item.labelHeight - margin)),
          w: item.labelWidth,
          h: item.labelHeight
        };
        var fallbackAttach = getNearestPointOnRect(fallbackRect, item.anchorX, item.anchorY);
        best = {
          rect: fallbackRect,
          attachPoint: fallbackAttach,
          line: {
            x1: item.originPoint.x,
            y1: item.originPoint.y,
            x2: fallbackAttach.x,
            y2: fallbackAttach.y
          }
        };
      }

      item.labelRect = best.rect;
      item.attachPoint = best.attachPoint;
      item.guidePoint = item.originPoint || { x: item.anchorX, y: item.anchorY };
      placedRects.push({
        x: best.rect.x,
        y: best.rect.y,
        w: best.rect.w,
        h: best.rect.h,
        pieceId: item.pieceId
      });
      placedLines.push({
        x1: best.line.x1,
        y1: best.line.y1,
        x2: best.line.x2,
        y2: best.line.y2,
        pieceId: item.pieceId
      });
    });
  }

  function buildPreviewPlacementCandidates(item, width, height) {
    var labelWidth = item.labelWidth;
    var labelHeight = item.labelHeight;
    var pieceRect = item.pieceRect;
    var horizontalGap = 16;
    var verticalGap = 14;
    var diagonalGapX = 14;
    var diagonalGapY = 10;
    var verticalStep = Math.max(12, Math.round(labelHeight * 0.75));
    var horizontalStep = Math.max(12, Math.round(labelWidth * 0.18));
    var preferRight = item.anchorX < width * 0.5;
    var preferBottom = item.anchorY < height * 0.5;
    var primarySides = preferRight ? ['right', 'left'] : ['left', 'right'];
    var verticalSides = preferBottom ? ['bottom', 'top'] : ['top', 'bottom'];
    var diagonalSides = [];
    if (preferRight && preferBottom) diagonalSides = ['bottom-right', 'top-right', 'bottom-left', 'top-left'];
    else if (preferRight && !preferBottom) diagonalSides = ['top-right', 'bottom-right', 'top-left', 'bottom-left'];
    else if (!preferRight && preferBottom) diagonalSides = ['bottom-left', 'top-left', 'bottom-right', 'top-right'];
    else diagonalSides = ['top-left', 'bottom-left', 'top-right', 'bottom-right'];

    var sides = primarySides.concat(diagonalSides).concat(verticalSides);
    var offsets = [0, -1, 1, -2, 2, -3, 3];
    var candidates = [];

    sides.forEach(function (side) {
      offsets.forEach(function (offset) {
        var x = item.anchorX;
        var y = item.anchorY;

        if (side === 'right') {
          x = pieceRect.x + pieceRect.w + horizontalGap + (Math.max(0, Math.abs(offset) - 1) * 4);
          y = item.anchorY - (labelHeight / 2) + (offset * verticalStep);
        } else if (side === 'left') {
          x = pieceRect.x - horizontalGap - labelWidth - (Math.max(0, Math.abs(offset) - 1) * 4);
          y = item.anchorY - (labelHeight / 2) + (offset * verticalStep);
        } else if (side === 'bottom') {
          x = item.anchorX - (labelWidth / 2) + (offset * horizontalStep);
          y = pieceRect.y + pieceRect.h + verticalGap + (Math.max(0, Math.abs(offset) - 1) * 4);
        } else if (side === 'top') {
          x = item.anchorX - (labelWidth / 2) + (offset * horizontalStep);
          y = pieceRect.y - labelHeight - verticalGap - (Math.max(0, Math.abs(offset) - 1) * 4);
        } else if (side === 'top-right') {
          x = pieceRect.x + pieceRect.w + diagonalGapX + (Math.max(0, Math.abs(offset) - 1) * 4);
          y = pieceRect.y - labelHeight - diagonalGapY + (offset * Math.round(verticalStep * 0.6));
        } else if (side === 'top-left') {
          x = pieceRect.x - labelWidth - diagonalGapX - (Math.max(0, Math.abs(offset) - 1) * 4);
          y = pieceRect.y - labelHeight - diagonalGapY + (offset * Math.round(verticalStep * 0.6));
        } else if (side === 'bottom-right') {
          x = pieceRect.x + pieceRect.w + diagonalGapX + (Math.max(0, Math.abs(offset) - 1) * 4);
          y = pieceRect.y + pieceRect.h + diagonalGapY + (offset * Math.round(verticalStep * 0.6));
        } else if (side === 'bottom-left') {
          x = pieceRect.x - labelWidth - diagonalGapX - (Math.max(0, Math.abs(offset) - 1) * 4);
          y = pieceRect.y + pieceRect.h + diagonalGapY + (offset * Math.round(verticalStep * 0.6));
        }

        candidates.push({ x: x, y: y, side: side });
      });
    });

    return candidates;
  }

  function getPreviewPlacementScore(rect, placed, item, candidateIndex, line, placedLines, width, height) {
    var score = candidateIndex * 18;
    var centerX = rect.x + (rect.w / 2);
    var centerY = rect.y + (rect.h / 2);
    var dx = centerX - item.anchorX;
    var dy = centerY - item.anchorY;
    score += Math.sqrt((dx * dx) + (dy * dy)) * 0.7;

    var pieceOverlapWidth = Math.min(rect.x + rect.w, item.pieceRect.x + item.pieceRect.w) - Math.max(rect.x, item.pieceRect.x);
    var pieceOverlapHeight = Math.min(rect.y + rect.h, item.pieceRect.y + item.pieceRect.h) - Math.max(rect.y, item.pieceRect.y);
    if (pieceOverlapWidth > 0 && pieceOverlapHeight > 0) {
      score += 20000 + (pieceOverlapWidth * pieceOverlapHeight);
    }

    placed.forEach(function (other) {
      var overlapWidth = Math.min(rect.x + rect.w, other.x + other.w) - Math.max(rect.x, other.x);
      var overlapHeight = Math.min(rect.y + rect.h, other.y + other.h) - Math.max(rect.y, other.y);
      if (overlapWidth > 0 && overlapHeight > 0) {
        score += 100000 + (overlapWidth * overlapHeight);
      } else {
        var gapX = Math.max(0, Math.max(other.x - (rect.x + rect.w), rect.x - (other.x + other.w)));
        var gapY = Math.max(0, Math.max(other.y - (rect.y + rect.h), rect.y - (other.y + other.h)));
        if (gapX < 8 && gapY < 8) score += 250;
      }
    });

    placedLines.forEach(function (otherLine) {
      if (segmentsIntersect(line.x1, line.y1, line.x2, line.y2, otherLine.x1, otherLine.y1, otherLine.x2, otherLine.y2)) {
        score += 16000;
      }
    });

    placed.forEach(function (otherRect) {
      if (segmentIntersectsRect(line.x1, line.y1, line.x2, line.y2, otherRect)) {
        score += 14000;
      }
    });

    if (segmentIntersectsRect(line.x1, line.y1, line.x2, line.y2, rect)) {
      score += 6000;
    }

    var edgePadding = Math.min(rect.x, rect.y, Math.max(0, width - (rect.x + rect.w)), Math.max(0, height - (rect.y + rect.h)));
    if (edgePadding < 6) score += (6 - edgePadding) * 120;

    return score;
  }

  function getNearestPointOnRect(rect, px, py) {
    var cx = clamp(px, rect.x, rect.x + rect.w);
    var cy = clamp(py, rect.y, rect.y + rect.h);

    var distances = [
      { x: cx, y: rect.y, d: Math.abs(py - rect.y) },
      { x: cx, y: rect.y + rect.h, d: Math.abs(py - (rect.y + rect.h)) },
      { x: rect.x, y: cy, d: Math.abs(px - rect.x) },
      { x: rect.x + rect.w, y: cy, d: Math.abs(px - (rect.x + rect.w)) }
    ];

    distances.sort(function (a, b) { return a.d - b.d; });
    return { x: distances[0].x, y: distances[0].y };
  }

  function segmentIntersectsRect(x1, y1, x2, y2, rect) {
    if (!rect) return false;
    var inside1 = x1 > rect.x && x1 < rect.x + rect.w && y1 > rect.y && y1 < rect.y + rect.h;
    var inside2 = x2 > rect.x && x2 < rect.x + rect.w && y2 > rect.y && y2 < rect.y + rect.h;
    if (inside1 || inside2) return true;

    var rx1 = rect.x;
    var ry1 = rect.y;
    var rx2 = rect.x + rect.w;
    var ry2 = rect.y + rect.h;

    return segmentsIntersect(x1, y1, x2, y2, rx1, ry1, rx2, ry1)
      || segmentsIntersect(x1, y1, x2, y2, rx2, ry1, rx2, ry2)
      || segmentsIntersect(x1, y1, x2, y2, rx2, ry2, rx1, ry2)
      || segmentsIntersect(x1, y1, x2, y2, rx1, ry2, rx1, ry1);
  }

  function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    var o1 = segmentOrientation(ax, ay, bx, by, cx, cy);
    var o2 = segmentOrientation(ax, ay, bx, by, dx, dy);
    var o3 = segmentOrientation(cx, cy, dx, dy, ax, ay);
    var o4 = segmentOrientation(cx, cy, dx, dy, bx, by);

    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && pointOnSegment(ax, ay, cx, cy, bx, by)) return true;
    if (o2 === 0 && pointOnSegment(ax, ay, dx, dy, bx, by)) return true;
    if (o3 === 0 && pointOnSegment(cx, cy, ax, ay, dx, dy)) return true;
    if (o4 === 0 && pointOnSegment(cx, cy, bx, by, dx, dy)) return true;
    return false;
  }

  function segmentOrientation(ax, ay, bx, by, cx, cy) {
    var value = ((by - ay) * (cx - bx)) - ((bx - ax) * (cy - by));
    if (Math.abs(value) < 0.0001) return 0;
    return value > 0 ? 1 : 2;
  }

  function pointOnSegment(ax, ay, px, py, bx, by) {
    return px <= Math.max(ax, bx) + 0.0001 && px + 0.0001 >= Math.min(ax, bx)
      && py <= Math.max(ay, by) + 0.0001 && py + 0.0001 >= Math.min(ay, by);
  }

  function appendPreviewGuide(svgRoot, item) {
    if (!svgRoot || !item || !item.guidePoint || !item.labelRect) return;

    var visualRect = item.renderRect || item.labelRect;
    var attachPoint = {
      x: visualRect.x + (visualRect.w / 2),
      y: visualRect.y + (visualRect.h / 2)
    };

    var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('class', 'asm-preview-ref-line');
    line.setAttribute('x1', item.guidePoint.x.toFixed(2));
    line.setAttribute('y1', item.guidePoint.y.toFixed(2));
    line.setAttribute('x2', attachPoint.x.toFixed(2));
    line.setAttribute('y2', attachPoint.y.toFixed(2));
    svgRoot.appendChild(line);

    var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('class', 'asm-preview-ref-dot');
    dot.setAttribute('cx', item.guidePoint.x.toFixed(2));
    dot.setAttribute('cy', item.guidePoint.y.toFixed(2));
    dot.setAttribute('r', '3.5');
    svgRoot.appendChild(dot);
  }

  function getOverlayRelativeRect(element, overlayEl) {
    if (!element || !overlayEl) return null;
    var rect = element.getBoundingClientRect();
    var overlayRect = overlayEl.getBoundingClientRect();
    return {
      x: rect.left - overlayRect.left,
      y: rect.top - overlayRect.top,
      w: rect.width,
      h: rect.height
    };
  }

  function projectWorldPointToOverlay(gl, worldPoint, overlayRect, canvasRect, viewport) {
    if (!gl || !worldPoint || !overlayRect || !canvasRect || !viewport) return null;
    var point = gl.project(worldPoint.x, worldPoint.y, worldPoint.z);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) return null;

    var viewportWidth = Number(viewport[2]) || 0;
    var viewportHeight = Number(viewport[3]) || 0;
    if (!viewportWidth || !viewportHeight) return null;

    var relativeX = (point.x - viewport[0]) / viewportWidth;
    var relativeY = (point.y - viewport[1]) / viewportHeight;

    return {
      x: (canvasRect.left - overlayRect.left) + (relativeX * canvasRect.width),
      y: (canvasRect.top - overlayRect.top) + ((1 - relativeY) * canvasRect.height),
      z: point.z
    };
  }

  function getBoundsCenter(bounds) {
    return {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: (bounds.min.z + bounds.max.z) / 2
    };
  }

  function getBoundsCorners(bounds) {
    var min = bounds.min;
    var max = bounds.max;
    return [
      { x: min.x, y: min.y, z: min.z },
      { x: min.x, y: min.y, z: max.z },
      { x: min.x, y: max.y, z: min.z },
      { x: min.x, y: max.y, z: max.z },
      { x: max.x, y: min.y, z: min.z },
      { x: max.x, y: min.y, z: max.z },
      { x: max.x, y: max.y, z: min.z },
      { x: max.x, y: max.y, z: max.z }
    ];
  }

  function getProjectedPieceRect(projectedPoints, centerPoint, width, height) {
    if (!projectedPoints || !projectedPoints.length) return null;

    var xs = projectedPoints.map(function (point) { return point.x; });
    var ys = projectedPoints.map(function (point) { return point.y; });
    xs.push(centerPoint.x);
    ys.push(centerPoint.y);

    var minX = Math.min.apply(null, xs);
    var maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys);
    var maxY = Math.max.apply(null, ys);

    if (maxX < -24 || minX > width + 24 || maxY < -24 || minY > height + 24) return null;

    var rect = {
      x: clamp(minX, 0, width),
      y: clamp(minY, 0, height),
      w: clamp(maxX, 0, width) - clamp(minX, 0, width),
      h: clamp(maxY, 0, height) - clamp(minY, 0, height)
    };

    rect.w = Math.max(rect.w, 6);
    rect.h = Math.max(rect.h, 6);
    rect.cx = clamp(centerPoint.x, rect.x, rect.x + rect.w);
    rect.cy = clamp(centerPoint.y, rect.y, rect.y + rect.h);
    return rect;
  }

  function getConvexHull2D(points) {
    if (!points || points.length < 3) return points ? points.slice() : [];

    var unique = [];
    var seen = Object.create(null);
    points.forEach(function (point) {
      if (!point) return;
      var key = point.x.toFixed(3) + ':' + point.y.toFixed(3);
      if (seen[key]) return;
      seen[key] = true;
      unique.push({ x: point.x, y: point.y });
    });

    if (unique.length < 3) return unique;

    unique.sort(function (a, b) {
      if (a.x !== b.x) return a.x - b.x;
      return a.y - b.y;
    });

    function cross(o, a, b) {
      return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    }

    var lower = [];
    unique.forEach(function (point) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
        lower.pop();
      }
      lower.push(point);
    });

    var upper = [];
    unique.slice().reverse().forEach(function (point) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
        upper.pop();
      }
      upper.push(point);
    });

    upper.pop();
    lower.pop();
    return lower.concat(upper);
  }

  function getPolygonConnectionPoint(points, targetPoint) {
    if (!points || !points.length || !targetPoint) return null;
    if (points.length === 1) return { x: points[0].x, y: points[0].y };

    var bestPoint = null;
    var bestDistance = Infinity;

    for (var i = 0; i < points.length; i += 1) {
      var a = points[i];
      var b = points[(i + 1) % points.length];
      var candidate = getNearestPointOnSegment(a, b, targetPoint);
      var dx = candidate.x - targetPoint.x;
      var dy = candidate.y - targetPoint.y;
      var distSq = (dx * dx) + (dy * dy);
      if (distSq < bestDistance) {
        bestDistance = distSq;
        bestPoint = candidate;
      }
    }

    return bestPoint;
  }

  function getNearestPointOnSegment(a, b, p) {
    var abX = b.x - a.x;
    var abY = b.y - a.y;
    var abLenSq = (abX * abX) + (abY * abY);
    if (!abLenSq) return { x: a.x, y: a.y };

    var t = (((p.x - a.x) * abX) + ((p.y - a.y) * abY)) / abLenSq;
    t = clamp(t, 0, 1);
    return {
      x: a.x + (abX * t),
      y: a.y + (abY * t)
    };
  }

  function getRectConnectionPoint(rect, targetPoint) {
    return {
      x: clamp(targetPoint.x, rect.x, rect.x + rect.w),
      y: clamp(targetPoint.y, rect.y, rect.y + rect.h)
    };
  }

  function getObjectBounds(obj) {
    if (!obj || typeof obj.getBounds !== 'function') return null;
    try {
      var bounds = obj.getBounds();
      if (!bounds || bounds.length < 2) return null;
      return bounds;
    } catch (error) {
      return null;
    }
  }

  function extendPreviewBounds(current, bounds) {
    if (!bounds || bounds.length < 2) return current;
    var min = bounds[0];
    var max = bounds[1];
    if (!current) {
      return {
        min: { x: min.x, y: min.y, z: min.z },
        max: { x: max.x, y: max.y, z: max.z }
      };
    }

    current.min.x = Math.min(current.min.x, min.x);
    current.min.y = Math.min(current.min.y, min.y);
    current.min.z = Math.min(current.min.z, min.z);
    current.max.x = Math.max(current.max.x, max.x);
    current.max.y = Math.max(current.max.y, max.y);
    current.max.z = Math.max(current.max.z, max.z);
    return current;
  }

  function cloneBounds(bounds) {
    if (!bounds || !bounds.min || !bounds.max) return null;
    return {
      min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
      max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z }
    };
  }

  function formatPartParameterValue(value) {
    if (Array.isArray(value) || (value && typeof value === 'object')) return stableStringify(value);
    return String(value);
  }

  function getPieceExportParameters(piece) {
    var cache = state.sourceCache[piece.file];
    if (cache && Array.isArray(cache.paramDefinitions) && cache.paramDefinitions.length) {
      var effective = getEffectiveParams(piece, cache.defaultParams || {});
      return cache.paramDefinitions.reduce(function (parts, definition) {
        if (!definition || !definition.name) return parts;
        var type = String(definition.type || 'text').toLowerCase();
        if (type === 'group') return parts;
        parts.push(definition.name + ': ' + formatPartParameterValue(effective[definition.name]));
        return parts;
      }, []);
    }

    return Object.keys(piece.paramsDiff || {}).sort().map(function (key) {
      return key + ': ' + formatPartParameterValue(piece.paramsDiff[key]);
    });
  }

  function onExportTxt() {
    var lines = state.pieces.map(function (piece, index) {
      var params = getPieceExportParameters(piece);
      var paramsText = params.length ? params.join(', ') : 'NONE';
      return [String(index + 1), piece.title, piece.id, paramsText].join(' - ');
    });
    var body = lines.join('\n');
    var blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'assembly-reference.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setGlobalStatus('Exported assembly-reference.txt', 'info');
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
      renderPreviewRefs();
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
