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
    inspectorMode: 'hidden',
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
      prepareOutput: null,
      Viewer: null
    },
    sourceCache: {},
    sourceCachePromises: {},
    pieces: [],
    previewRefsEnabled: false,
    previewRefEntries: [],
    previewRefsRaf: 0,
    previewRefsAnimRaf: 0,
    previewRefDisplayMap: {},
    previewRefsAnimLastTs: 0,
    exportBusy: false,
    exportDeduplicateStls: false
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
      var _r8 = bundleRequire(8);
      var getParameterDefinitions = bundleRequire(118);
      var _r121 = bundleRequire(121);
      var Viewer = bundleRequire(239);

      state.engine.rebuildSolids = _r1.rebuildSolids;
      state.engine.rebuildSolidsInWorker = _r1.rebuildSolidsInWorker;
      state.engine.getParameterDefinitions = getParameterDefinitions;
      state.engine.mergeSolids = _r121.mergeSolids;
      state.engine.prepareOutput = _r8.prepareOutput;
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
    els.partIdWrap = document.getElementById('asmPartIdWrap');
    els.transformForm = document.getElementById('asmTransformForm');
    els.paramsWrap = document.getElementById('asmParamsWrap');
    els.params = document.getElementById('asmParams');
    els.pieceStatus = document.getElementById('asmPieceStatus');
    els.pieceStatusWrap = document.getElementById('asmPieceStatusWrap');
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
    els.exportPanel = document.getElementById('asmExportPanel');
    els.exportSummary = document.getElementById('asmExportSummary');
    els.exportGroups = document.getElementById('asmExportGroups');
    els.exportZipBtn = document.getElementById('asmExportZipBtn');
    els.exportDedupeStlsCbx = document.getElementById('asmExportDedupeStlsCbx');
  }

  function wireEvents() {
    els.addBtn.addEventListener('click', onAddPiece);
    els.dupBtn.addEventListener('click', onDuplicatePiece);
    els.removeBtn.addEventListener('click', onRemovePiece);
    els.clearBtn.addEventListener('click', onClearPieces);
    els.exportBtn.addEventListener('click', onExport);
    els.importBtn.addEventListener('click', function () { els.importInput.click(); });
    els.exportTxtBtn.addEventListener('click', enterExportMode);
    if (els.viewRefsBtn) els.viewRefsBtn.addEventListener('click', togglePreviewRefsMode);
    els.importInput.addEventListener('change', onImportChange);
    els.catalogToggle.addEventListener('click', toggleCatalogList);
    els.deselectBtn.addEventListener('click', deselectSelectedPiece);
    els.inspectorCloseBtn.addEventListener('click', onInspectorCloseClick);
    els.hidePanelsBtn.addEventListener('click', hidePanels);
    if (els.exportZipBtn) els.exportZipBtn.addEventListener('click', onExportZip);
    if (els.exportDedupeStlsCbx) {
      els.exportDedupeStlsCbx.addEventListener('change', function () {
        state.exportDeduplicateStls = !!els.exportDedupeStlsCbx.checked;
        renderInspector();
      });
    }
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
    if (state.inspectorMode === 'export') {
      exitExportMode();
    }
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
    state.inspectorMode = 'hidden';
    renderAssemblyList();
    renderInspector();
    scheduleRender();
  }

  function deselectSelectedPiece() {
    if (!state.selectedPieceId) return;
    state.selectedPieceId = null;
    state.inspectorMode = 'hidden';
    renderAssemblyList();
    renderInspector();
    scheduleRender();
  }

  function onInspectorCloseClick() {
    if (state.inspectorMode === 'export') {
      exitExportMode();
      return;
    }
    deselectSelectedPiece();
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
    state.inspectorMode = 'piece';
    state.selectedPieceId = pieceId;
    renderAssemblyList();
    renderInspector();
    scheduleRender();
  }

  function renderLayoutState() {
    var inspectorVisible = !state.panelsHidden && (state.inspectorMode === 'export' || (state.inspectorMode === 'piece' && !!state.selectedPieceId));
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
    els.inspectorCloseBtn.disabled = !(state.inspectorMode === 'export' || (state.inspectorMode === 'piece' && !!state.selectedPieceId));

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
    var inspectorRoot = document.getElementById('asmInspector');
    if (inspectorRoot) inspectorRoot.classList.toggle('is-export-mode', state.inspectorMode === 'export');
    if (els.exportPanel) els.exportPanel.hidden = state.inspectorMode !== 'export';
    if (state.inspectorMode === 'export') {
      renderExportInspector();
      renderLayoutState();
      return;
    }

    var piece = getSelectedPiece();
    if (!piece) {
      els.inspectorHeader.textContent = 'No selection';
      els.partIdInput.value = '';
      els.partIdInput.disabled = true;
      setTransformEnabled(false);
      writeTransformInputs({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
      els.params.innerHTML = '';
      els.paramsWrap.hidden = true;
      if (els.partIdWrap) els.partIdWrap.hidden = false;
      if (els.transformForm) els.transformForm.hidden = false;
      if (els.pieceStatusWrap) els.pieceStatusWrap.hidden = false;
      setPieceStatus('', 'info');
      renderLayoutState();
      return;
    }

    if (els.partIdWrap) els.partIdWrap.hidden = false;
    if (els.transformForm) els.transformForm.hidden = false;
    if (els.pieceStatusWrap) els.pieceStatusWrap.hidden = false;

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

  function renderExportInspector() {
    els.inspectorHeader.textContent = 'Export Assembly Package';
    els.partIdInput.disabled = true;
    els.partIdInput.value = '';
    setTransformEnabled(false);
    writeTransformInputs({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    els.paramsWrap.hidden = true;
    if (els.partIdWrap) els.partIdWrap.hidden = true;
    if (els.transformForm) els.transformForm.hidden = true;
    if (els.pieceStatusWrap) els.pieceStatusWrap.hidden = true;
    renderExportPanelContent();
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
    state.inspectorMode = 'piece';
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
    state.inspectorMode = 'piece';
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
      state.inspectorMode = 'piece';
    } else {
      state.selectedPieceId = null;
      state.inspectorMode = 'hidden';
    }

    renderAssemblyList();
    renderInspector();
    scheduleRender();
  }

  function onClearPieces() {
    if (!window.confirm('Clear the entire assembly? This will remove all parts.')) return;
    state.pieces = [];
    state.selectedPieceId = null;
    state.inspectorMode = 'hidden';
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
    if (state.inspectorMode === 'export' || getSelectedPiece()) renderInspector();

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
    if (state.previewRefsAnimRaf) {
      cancelAnimationFrame(state.previewRefsAnimRaf);
      state.previewRefsAnimRaf = 0;
    }
    state.previewRefsAnimLastTs = 0;
    state.previewRefDisplayMap = {};
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
    if (!projectedItems.length) {
      clearPreviewRefsOverlay();
      return;
    }

    projectedItems.sort(function (a, b) {
      return a.screenY - b.screenY;
    });

    projectedItems.forEach(function (item) {
      var display = ensurePreviewRefDisplayItem(item);
      item.labelEl = display.labelEl;
      item.labelEl.style.visibility = 'hidden';
      var rect = item.labelEl.getBoundingClientRect();
      item.labelWidth = Math.max(32, Math.ceil(rect.width));
      item.labelHeight = Math.max(32, Math.ceil(rect.height));
    });

    layoutPreviewRefItems(projectedItems, width, height);
    syncPreviewRefDisplayTargets(projectedItems);
  }

  function ensurePreviewRefDisplayItem(item) {
    var display = state.previewRefDisplayMap[item.pieceId];
    if (!display) {
      var labelEl = buildPreviewRefLabel(item);
      var lineEl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      lineEl.setAttribute('class', 'asm-preview-ref-line');
      var dotEl = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dotEl.setAttribute('class', 'asm-preview-ref-dot');
      dotEl.setAttribute('r', '3.5');
      if (els.previewRefsSvg) {
        els.previewRefsSvg.appendChild(lineEl);
        els.previewRefsSvg.appendChild(dotEl);
      }
      if (els.previewRefsLayer) els.previewRefsLayer.appendChild(labelEl);
      display = {
        pieceId: item.pieceId,
        labelEl: labelEl,
        lineEl: lineEl,
        dotEl: dotEl,
        currentRect: null,
        targetRect: null,
        guidePoint: null
      };
      state.previewRefDisplayMap[item.pieceId] = display;
    }

    updatePreviewRefLabel(display.labelEl, item);
    return display;
  }

  function updatePreviewRefLabel(labelEl, item) {
    if (!labelEl || !item) return;
    labelEl.dataset.pieceId = item.pieceId;
    labelEl.title = item.refNumber + ' · ' + item.title + ' · ' + item.customName;
    labelEl.setAttribute('aria-label', 'Select part reference ' + item.refNumber + ' for ' + item.title);
    labelEl.classList.toggle('is-selected', !!item.selected);
    if (labelEl._asmRefIndexEl) labelEl._asmRefIndexEl.textContent = String(item.refNumber);
  }

  function syncPreviewRefDisplayTargets(items) {
    var seen = {};

    items.forEach(function (item) {
      var display = ensurePreviewRefDisplayItem(item);
      seen[item.pieceId] = true;
      display.guidePoint = item.originPoint || item.guidePoint || { x: item.anchorX, y: item.anchorY };
      display.targetRect = {
        x: item.labelRect.x,
        y: item.labelRect.y,
        w: item.labelRect.w,
        h: item.labelRect.h
      };
      if (!display.currentRect) {
        display.currentRect = {
          x: display.targetRect.x,
          y: display.targetRect.y,
          w: display.targetRect.w,
          h: display.targetRect.h
        };
      } else {
        display.currentRect.w = display.targetRect.w;
        display.currentRect.h = display.targetRect.h;
      }
      display.labelEl.style.zIndex = item.selected ? '3' : '1';
      display.labelEl.style.visibility = 'visible';
      display.lineEl.style.display = '';
      display.dotEl.style.display = '';
    });

    Object.keys(state.previewRefDisplayMap).forEach(function (pieceId) {
      if (seen[pieceId]) return;
      var display = state.previewRefDisplayMap[pieceId];
      if (display) {
        if (display.labelEl && display.labelEl.parentNode) display.labelEl.parentNode.removeChild(display.labelEl);
        if (display.lineEl && display.lineEl.parentNode) display.lineEl.parentNode.removeChild(display.lineEl);
        if (display.dotEl && display.dotEl.parentNode) display.dotEl.parentNode.removeChild(display.dotEl);
      }
      delete state.previewRefDisplayMap[pieceId];
    });

    renderPreviewRefDisplayFrame(false);
    schedulePreviewRefAnimation();
  }

  function schedulePreviewRefAnimation() {
    if (state.previewRefsAnimRaf || !state.previewRefsEnabled) return;
    state.previewRefsAnimRaf = requestAnimationFrame(stepPreviewRefAnimation);
  }

  function stepPreviewRefAnimation(timestamp) {
    state.previewRefsAnimRaf = 0;
    if (!state.previewRefsEnabled) return;
    var keepAnimating = renderPreviewRefDisplayFrame(false, timestamp);
    if (keepAnimating) schedulePreviewRefAnimation();
  }

  function renderPreviewRefDisplayFrame(forceSync, timestamp) {
    var displays = state.previewRefDisplayMap;
    var ids = Object.keys(displays);
    if (!ids.length) {
      state.previewRefsAnimLastTs = 0;
      return false;
    }

    var dt = 16;
    if (!forceSync && typeof timestamp === 'number' && state.previewRefsAnimLastTs) {
      dt = Math.max(8, Math.min(40, timestamp - state.previewRefsAnimLastTs));
    }
    state.previewRefsAnimLastTs = typeof timestamp === 'number' ? timestamp : 0;

    var baseFactor = 1 - Math.pow(0.001, dt / 180);
    var factor = forceSync ? 1 : clamp(baseFactor, 0.18, 0.34);
    var moving = false;

    ids.forEach(function (pieceId) {
      var display = displays[pieceId];
      if (!display || !display.targetRect || !display.guidePoint) return;

      if (!display.currentRect || forceSync) {
        display.currentRect = {
          x: display.targetRect.x,
          y: display.targetRect.y,
          w: display.targetRect.w,
          h: display.targetRect.h
        };
      } else {
        display.currentRect.x = approachValue(display.currentRect.x, display.targetRect.x, factor);
        display.currentRect.y = approachValue(display.currentRect.y, display.targetRect.y, factor);
        display.currentRect.w = display.targetRect.w;
        display.currentRect.h = display.targetRect.h;
      }

      var dx = Math.abs(display.currentRect.x - display.targetRect.x);
      var dy = Math.abs(display.currentRect.y - display.targetRect.y);
      if (dx > 0.35 || dy > 0.35) moving = true;

      applyPreviewRefDisplay(display);
    });

    return moving;
  }

  function applyPreviewRefDisplay(display) {
    if (!display || !display.labelEl || !display.currentRect || !display.guidePoint) return;

    display.labelEl.style.left = display.currentRect.x.toFixed(2) + 'px';
    display.labelEl.style.top = display.currentRect.y.toFixed(2) + 'px';
    display.labelEl.style.visibility = 'visible';

    var attachPoint = {
      x: display.currentRect.x + (display.currentRect.w / 2),
      y: display.currentRect.y + (display.currentRect.h / 2)
    };

    display.lineEl.setAttribute('x1', display.guidePoint.x.toFixed(2));
    display.lineEl.setAttribute('y1', display.guidePoint.y.toFixed(2));
    display.lineEl.setAttribute('x2', attachPoint.x.toFixed(2));
    display.lineEl.setAttribute('y2', attachPoint.y.toFixed(2));

    display.dotEl.setAttribute('cx', display.guidePoint.x.toFixed(2));
    display.dotEl.setAttribute('cy', display.guidePoint.y.toFixed(2));
  }

  function approachValue(current, target, factor) {
    if (!Number.isFinite(current)) return target;
    if (!Number.isFinite(target)) return current;
    return current + ((target - current) * factor);
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
    label._asmRefIndexEl = ref;

    return label;
  }

  function layoutPreviewRefItems(items, width, height) {
    if (!items || !items.length) return;

    var margin = 8;
    var placedRects = [];
    var placedLines = [];
    var orbit = buildPreviewOrbit(items, width, height, margin);

    items.sort(function (a, b) {
      if (!!a.selected !== !!b.selected) return a.selected ? -1 : 1;
      var angleA = Math.atan2(a.anchorY - orbit.centerY, a.anchorX - orbit.centerX);
      var angleB = Math.atan2(b.anchorY - orbit.centerY, b.anchorX - orbit.centerX);
      return angleA - angleB;
    });

    items.forEach(function (item) {
      var candidates = buildPreviewPlacementCandidates(item, width, height, orbit);
      var best = null;
      var bestScore = Infinity;

      candidates.forEach(function (candidate, index) {
        var rect = {
          x: clamp(candidate.x, margin, Math.max(margin, width - item.labelWidth - margin)),
          y: clamp(candidate.y, margin, Math.max(margin, height - item.labelHeight - margin)),
          w: item.labelWidth,
          h: item.labelHeight
        };
        var attachPoint = {
          x: rect.x + (rect.w / 2),
          y: rect.y + (rect.h / 2)
        };
        var line = {
          x1: item.originPoint.x,
          y1: item.originPoint.y,
          x2: attachPoint.x,
          y2: attachPoint.y
        };
        var score = getPreviewPlacementScore(rect, placedRects, item, index, line, placedLines, width, height, orbit, candidate);
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
        var fallbackAttach = {
          x: fallbackRect.x + (fallbackRect.w / 2),
          y: fallbackRect.y + (fallbackRect.h / 2)
        };
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

  function buildPreviewOrbit(items, width, height, margin) {
    var modelRect = null;
    items.forEach(function (item) {
      if (!item || !item.pieceRect) return;
      modelRect = unionRects(modelRect, item.pieceRect);
    });

    if (!modelRect) {
      modelRect = {
        x: width * 0.32,
        y: height * 0.28,
        w: width * 0.36,
        h: height * 0.44
      };
    }

    var centerX = clamp(modelRect.x + (modelRect.w / 2), margin, Math.max(margin, width - margin));
    var centerY = clamp(modelRect.y + (modelRect.h / 2), margin, Math.max(margin, height - margin));
    var minRx = Math.min(width * 0.24, 120);
    var minRy = Math.min(height * 0.22, 96);
    var maxRx = Math.max(minRx, Math.min(width * 0.48, (width / 2) - margin));
    var maxRy = Math.max(minRy, Math.min(height * 0.46, (height / 2) - margin));
    var rx = clamp((modelRect.w / 2) + 42, minRx, maxRx);
    var ry = clamp((modelRect.h / 2) + 38, minRy, maxRy);

    return {
      centerX: centerX,
      centerY: centerY,
      innerRx: rx,
      innerRy: ry,
      modelRect: modelRect
    };
  }

  function buildPreviewPlacementCandidates(item, width, height, orbit) {
    var labelWidth = item.labelWidth;
    var labelHeight = item.labelHeight;
    var centerX = orbit.centerX;
    var centerY = orbit.centerY;
    var dx = item.anchorX - centerX;
    var dy = item.anchorY - centerY;
    var baseAngle = Math.atan2(dy, dx);
    if (!Number.isFinite(baseAngle)) baseAngle = 0;

    var angleOffsets = [0, -0.18, 0.18, -0.34, 0.34, -0.52, 0.52, -0.72, 0.72, -0.95, 0.95];
    var radialOffsets = [0, 16, 32, 48];
    var tangentOffsets = [0, -10, 10, -18, 18];
    var candidates = [];

    radialOffsets.forEach(function (radialOffset, radialIndex) {
      angleOffsets.forEach(function (angleOffset, angleIndex) {
        var angle = baseAngle + angleOffset;
        var ellipseX = centerX + Math.cos(angle) * (orbit.innerRx + radialOffset);
        var ellipseY = centerY + Math.sin(angle) * (orbit.innerRy + radialOffset);
        var tangentX = -Math.sin(angle);
        var tangentY = Math.cos(angle);

        tangentOffsets.forEach(function (tangentOffset, tangentIndex) {
          var centerPosX = ellipseX + (tangentX * tangentOffset);
          var centerPosY = ellipseY + (tangentY * tangentOffset);
          candidates.push({
            x: centerPosX - (labelWidth / 2),
            y: centerPosY - (labelHeight / 2),
            angle: angle,
            radialOffset: radialOffset,
            tangentOffset: tangentOffset,
            order: (radialIndex * 100) + (angleIndex * 10) + tangentIndex
          });
        });
      });
    });

    return candidates;
  }

  function getPreviewPlacementScore(rect, placed, item, candidateIndex, line, placedLines, width, height, orbit, candidate) {
    var score = (candidate && Number.isFinite(candidate.order) ? candidate.order : candidateIndex) * 3;
    var centerX = rect.x + (rect.w / 2);
    var centerY = rect.y + (rect.h / 2);
    var dx = centerX - item.anchorX;
    var dy = centerY - item.anchorY;
    var lineLength = Math.sqrt((dx * dx) + (dy * dy));
    score += lineLength * 0.55;

    var pieceOverlapWidth = Math.min(rect.x + rect.w, item.pieceRect.x + item.pieceRect.w) - Math.max(rect.x, item.pieceRect.x);
    var pieceOverlapHeight = Math.min(rect.y + rect.h, item.pieceRect.y + item.pieceRect.h) - Math.max(rect.y, item.pieceRect.y);
    if (pieceOverlapWidth > 0 && pieceOverlapHeight > 0) {
      score += 25000 + (pieceOverlapWidth * pieceOverlapHeight);
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
        score += 18000;
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

    if (orbit && rectIntersectsEllipse(rect, orbit.centerX, orbit.centerY, orbit.innerRx - 10, orbit.innerRy - 10)) {
      score += 22000;
    }

    if (orbit && orbit.modelRect) {
      var expandedModelRect = expandRect(orbit.modelRect, 10);
      var modelCrossings = countSegmentSamplesInRect(line.x1, line.y1, line.x2, line.y2, expandedModelRect, 8);
      if (modelCrossings > 1) score += (modelCrossings - 1) * 2600;
    }

    if (orbit) {
      var centerCrossings = countSegmentSamplesInEllipse(line.x1, line.y1, line.x2, line.y2, orbit.centerX, orbit.centerY, orbit.innerRx * 0.92, orbit.innerRy * 0.92, 8);
      if (centerCrossings > 2) score += (centerCrossings - 2) * 2200;

      var preferredAngle = Math.atan2(item.anchorY - orbit.centerY, item.anchorX - orbit.centerX);
      var candidateAngle = candidate && Number.isFinite(candidate.angle) ? candidate.angle : preferredAngle;
      score += Math.abs(normalizeAngle(candidateAngle - preferredAngle)) * 2600;
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

  function unionRects(base, rect) {
    if (!rect) return base;
    if (!base) {
      return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    }
    var minX = Math.min(base.x, rect.x);
    var minY = Math.min(base.y, rect.y);
    var maxX = Math.max(base.x + base.w, rect.x + rect.w);
    var maxY = Math.max(base.y + base.h, rect.y + rect.h);
    return {
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY
    };
  }

  function expandRect(rect, padding) {
    if (!rect) return null;
    var pad = Number(padding) || 0;
    return {
      x: rect.x - pad,
      y: rect.y - pad,
      w: rect.w + (pad * 2),
      h: rect.h + (pad * 2)
    };
  }

  function rectIntersectsEllipse(rect, cx, cy, rx, ry) {
    if (!rect || !rx || !ry) return false;
    var samples = [
      [rect.x, rect.y],
      [rect.x + rect.w, rect.y],
      [rect.x, rect.y + rect.h],
      [rect.x + rect.w, rect.y + rect.h],
      [rect.x + (rect.w / 2), rect.y + (rect.h / 2)]
    ];
    for (var i = 0; i < samples.length; i += 1) {
      if (pointInsideEllipse(samples[i][0], samples[i][1], cx, cy, rx, ry)) return true;
    }
    return false;
  }

  function pointInsideRect(x, y, rect) {
    if (!rect) return false;
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }

  function pointInsideEllipse(x, y, cx, cy, rx, ry) {
    if (!rx || !ry) return false;
    var nx = (x - cx) / rx;
    var ny = (y - cy) / ry;
    return ((nx * nx) + (ny * ny)) <= 1;
  }

  function countSegmentSamplesInRect(x1, y1, x2, y2, rect, steps) {
    var total = 0;
    var sampleSteps = Math.max(2, Number(steps) || 2);
    for (var i = 1; i < sampleSteps; i += 1) {
      var t = i / sampleSteps;
      var x = x1 + ((x2 - x1) * t);
      var y = y1 + ((y2 - y1) * t);
      if (pointInsideRect(x, y, rect)) total += 1;
    }
    return total;
  }

  function countSegmentSamplesInEllipse(x1, y1, x2, y2, cx, cy, rx, ry, steps) {
    var total = 0;
    var sampleSteps = Math.max(2, Number(steps) || 2);
    for (var i = 1; i < sampleSteps; i += 1) {
      var t = i / sampleSteps;
      var x = x1 + ((x2 - x1) * t);
      var y = y1 + ((y2 - y1) * t);
      if (pointInsideEllipse(x, y, cx, cy, rx, ry)) total += 1;
    }
    return total;
  }

  function normalizeAngle(angle) {
    var value = Number(angle) || 0;
    while (value > Math.PI) value -= Math.PI * 2;
    while (value < -Math.PI) value += Math.PI * 2;
    return value;
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
    var attachPoint = getNearestPointOnRect(visualRect, item.guidePoint.x, item.guidePoint.y);

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

  function enterExportMode() {
    state.selectedPieceId = null;
    state.inspectorMode = 'export';
    setPreviewRefsEnabled(false);
    renderAssemblyList();
    renderInspector();
    scheduleRender();
  }

  function exitExportMode() {
    state.inspectorMode = state.selectedPieceId ? 'piece' : 'hidden';
    renderInspector();
    renderAssemblyList();
    scheduleRender();
  }

  function renderExportPanelContent() {
    var meta = buildExportMetaSync();
    if (els.exportSummary) {
      els.exportSummary.textContent = meta.instances.length
        ? ('Review ' + meta.instances.length + ' parts grouped into ' + meta.groups.length + ' manufacturing references.')
        : 'No parts in the current assembly.';
    }
    if (els.exportDedupeStlsCbx) {
      els.exportDedupeStlsCbx.checked = !!state.exportDeduplicateStls;
      els.exportDedupeStlsCbx.disabled = state.exportBusy || !meta.instances.length;
    }
    renderExportGroups(meta.groups);
    if (els.exportZipBtn) {
      els.exportZipBtn.disabled = state.exportBusy || !meta.instances.length;
      els.exportZipBtn.textContent = state.exportBusy ? 'Generating ZIP…' : 'Generate ZIP Package';
    }
  }

  function renderExportGroups(groups) {
    if (!els.exportGroups) return;
    els.exportGroups.innerHTML = '';
    groups.forEach(function (group, index) {
      var card = document.createElement('section');
      card.className = 'asm-export-group';
      var title = document.createElement('h4');
      title.textContent = 'Group ' + String(index + 1) + ' · Qty ' + group.quantity;
      card.appendChild(title);
      var info = document.createElement('p');
      info.className = 'asm-export-meta';
      info.innerHTML = '<b>Source</b>: ' + escapeHtml(formatSourceName(group.file));
      card.appendChild(info);
      var partListLabel = document.createElement('p');
      partListLabel.className = 'asm-export-meta';
      var refsText = (group.partRefs || []).join(', ');
      partListLabel.innerHTML = '<b>Parts list</b>: ' + escapeHtml(refsText);
      card.appendChild(partListLabel);
      var paramsToggle = buildCollapsibleParams(group.effectiveParams);
      if (paramsToggle) card.appendChild(paramsToggle);
      els.exportGroups.appendChild(card);
    });
  }

  function buildCollapsibleParams(params) {
    var keys = Object.keys(params || {});
    if (!keys.length) return null;
    var details = document.createElement('details');
    details.className = 'asm-export-params-toggle';
    var summary = document.createElement('summary');
    summary.textContent = 'Parameters';
    details.appendChild(summary);
    details.appendChild(buildParamsList(params));
    return details;
  }

  function buildParamsList(params) {
    var entries = Object.keys(params || {}).sort();
    var list = document.createElement('ul');
    list.className = 'asm-export-param-list';
    if (!entries.length) {
      var empty = document.createElement('li');
      empty.textContent = 'No parameters';
      list.appendChild(empty);
      return list;
    }
    entries.forEach(function (key) {
      var row = document.createElement('li');
      row.textContent = key + ': ' + formatPartParameterValue(params[key]);
      list.appendChild(row);
    });
    return list;
  }

  function buildExportMetaSync() {
    var usedNames = {};
    var instances = state.pieces.map(function (piece, index) {
      var normalizedFile = normalizeModelFilePath(piece.file);
      var cache = state.sourceCache[normalizedFile];
      var defaults = cache ? (cache.defaultParams || {}) : {};
      var effectiveParams = getEffectiveParams(piece, defaults);
      return {
        index: index,
        id: piece.id,
        partRef: makePartReference(index + 1, piece.id),
        title: piece.title,
        file: normalizedFile,
        effectiveParams: effectiveParams,
        stlFilename: makeUniqueStlFileName(index + 1, normalizedFile, piece.id, usedNames)
      };
    });
    var groups = groupExportInstances(instances);
    return { instances: instances, groups: groups };
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

  async function onExportZip() {
    if (state.exportBusy) return;
    state.exportBusy = true;
    renderInspector();
    try {
      var prepared = await buildExportPreparationData();
      var textBody = buildReferenceTxt(prepared.instances, prepared.groups);
      var files = [{ name: 'assembly-reference.txt', data: encodeUtf8(textBody), type: 'text/plain;charset=utf-8' }];

      var stlEntries = state.exportDeduplicateStls
        ? getDeduplicatedStlEntries(prepared.instances, prepared.groups)
        : prepared.instances;

      for (var i = 0; i < stlEntries.length; i += 1) {
        var entry = stlEntries[i];
        files.push({
          name: entry.stlFilename,
          data: entry.stlBytes,
          type: 'model/stl'
        });
      }

      var zipBlob = buildZipBlob(files);
      triggerDownload(zipBlob, 'assembly-manufacturing-export.zip');
      setGlobalStatus('Exported assembly-manufacturing-export.zip', 'info');
    } catch (error) {
      setGlobalStatus('Manufacturing export failed: ' + errorMessage(error), 'error');
    } finally {
      state.exportBusy = false;
      renderInspector();
    }
  }

  async function buildExportPreparationData() {
    await ensureAssemblyStableState();
    var usedNames = {};
    var instances = [];

    for (var i = 0; i < state.pieces.length; i += 1) {
      var piece = state.pieces[i];
      var cache = await ensureSource(piece);
      var effectiveParams = getEffectiveParams(piece, cache.defaultParams || {});
      var token = piece.buildToken + 1;
      piece.buildToken = token;
      var result = await buildWithWorkerOrMain(piece, cache, effectiveParams, token);
      if (result && result.stale) throw new Error('Stale export build for ' + piece.id + '.');
      var objects = Array.isArray(result.objects) ? result.objects : [];
      if (!objects.length) throw new Error('No geometry produced for ' + piece.id + '.');
      var stlBytes = serializeObjectsToStlBytes(objects);
      instances.push({
        index: i,
        id: piece.id,
        partRef: makePartReference(i + 1, piece.id),
        title: piece.title,
        file: normalizeModelFilePath(piece.file),
        effectiveParams: effectiveParams,
        stlFilename: makeUniqueStlFileName(i + 1, piece.file, piece.id, usedNames),
        stlBytes: stlBytes
      });
    }

    return {
      instances: instances,
      groups: groupExportInstances(instances)
    };
  }

  async function ensureAssemblyStableState() {
    var timeoutAt = Date.now() + 12000;
    while (state.pieces.some(function (piece) { return piece.loading; })) {
      if (Date.now() > timeoutAt) throw new Error('Timed out waiting for part rebuild to finish.');
      await delay(80);
    }
    var failing = state.pieces.find(function (piece) { return !!piece.error; });
    if (failing) throw new Error('Part has build errors: ' + failing.id + ' (' + failing.error + ')');
  }

  function serializeObjectsToStlBytes(objects) {
    if (!state.engine.prepareOutput) throw new Error('STL serializer unavailable.');
    var output = state.engine.prepareOutput(objects, { format: 'stlb', version: '0.0.0' });
    var data = output && output.data;
    if (!Array.isArray(data) || !data.length) throw new Error('STL serializer returned no data.');
    return normalizeBinaryData(data[0]);
  }

  function normalizeBinaryData(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (value && value.buffer instanceof ArrayBuffer) {
      return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength || value.length || 0);
    }
    if (typeof value === 'string') {
      var trimmed = value.trim();
      if (looksLikeBase64(trimmed)) {
        try {
          return decodeBase64ToBytes(trimmed);
        } catch (error) {}
      }
      return encodeUtf8(value);
    }
    if (Array.isArray(value)) return new Uint8Array(value);
    throw new Error('Unsupported binary output format.');
  }

  function looksLikeBase64(text) {
    if (!text || text.length < 16) return false;
    if (text.length % 4 !== 0) return false;
    return /^[A-Za-z0-9+/=\s]+$/.test(text);
  }

  function decodeBase64ToBytes(text) {
    var clean = text.replace(/\s+/g, '');
    var bin = atob(clean);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) {
      bytes[i] = bin.charCodeAt(i) & 0xff;
    }
    return bytes;
  }

  function groupExportInstances(instances) {
    var map = Object.create(null);
    instances.forEach(function (instance) {
      var key = stableStringify({
        file: normalizeModelFilePath(instance.file),
        effectiveParams: instance.effectiveParams || {}
      });
      if (!map[key]) {
        map[key] = {
          file: normalizeModelFilePath(instance.file),
          effectiveParams: cloneValue(instance.effectiveParams || {}),
          quantity: 0,
          instanceIds: [],
          partRefs: [],
          stlFilenames: []
        };
      }
      map[key].quantity += 1;
      map[key].instanceIds.push(instance.id);
      map[key].partRefs.push(instance.partRef || instance.id);
      map[key].stlFilenames.push(instance.stlFilename);
    });
    return Object.keys(map).map(function (key) { return map[key]; }).sort(compareGroupsByPartId);
  }

  function buildReferenceTxt(instances, groups) {
    var lines = [];
    lines.push('ASSEMBLY MANUFACTURING EXPORT');
    lines.push('');
    lines.push('TOTAL PARTS: ' + instances.length);
    lines.push('GROUPS: ' + groups.length);
    lines.push('');
    lines.push('GROUPED BOM');
    groups.forEach(function (group, idx) {
      lines.push('');
      lines.push('[' + (idx + 1) + '] Qty ' + group.quantity);
      lines.push('NAME: ' + formatSourceName(group.file));
      lines.push('Part Reference: ' + group.instanceIds.join(', '));
      lines.push('STL files: ' + group.stlFilenames.join(', '));
      var keys = Object.keys(group.effectiveParams || {}).sort();
      if (!keys.length) {
        lines.push('Parameters: NONE');
      } else {
        lines.push('Parameters:');
        keys.forEach(function (key) {
          lines.push('  - ' + key + ': ' + formatPartParameterValue(group.effectiveParams[key]));
        });
      }
    });
    lines.push('');
    return lines.join('\n');
  }

  function formatSourceName(filePath) {
    var normalized = normalizeModelFilePath(filePath);
    var name = normalized.split('/').pop() || normalized;
    name = name.replace(/\.jscad$/i, '');
    name = name.replace(/[-_]+/g, ' ').trim();
    if (!name) return 'Part';
    return name.split(/\s+/).map(function (chunk) {
      return chunk.charAt(0).toUpperCase() + chunk.slice(1);
    }).join(' ');
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function compareGroupsByPartId(a, b) {
    var aNum = getSmallestPartIdNumber(a.instanceIds || []);
    var bNum = getSmallestPartIdNumber(b.instanceIds || []);
    if (aNum !== bNum) return aNum - bNum;
    var aRef = (a.instanceIds && a.instanceIds[0]) || '';
    var bRef = (b.instanceIds && b.instanceIds[0]) || '';
    return String(aRef).localeCompare(String(bRef));
  }

  function getSmallestPartIdNumber(ids) {
    var best = Number.POSITIVE_INFINITY;
    (ids || []).forEach(function (id) {
      var match = String(id || '').match(/\d+/);
      if (!match) return;
      var n = Number(match[0]);
      if (Number.isFinite(n)) best = Math.min(best, n);
    });
    return Number.isFinite(best) ? best : Number.MAX_SAFE_INTEGER;
  }

  function makePartReference(instanceNumber, partName) {
    var numericId = String(Number(instanceNumber) || 0).padStart(3, '0');
    var safePartName = sanitizePieceId(partName, 'piece');
    return numericId + '_' + safePartName;
  }

  function makeUniqueStlFileName(instanceNumber, filePath, partName, usedNames) {
    var numericId = String(Number(instanceNumber) || 0).padStart(3, '0');
    var normalized = normalizeModelFilePath(filePath);
    var fileBase = normalized.split('/').pop() || 'part';
    fileBase = fileBase.replace(/\.jscad$/i, '');
    var safeFileBase = sanitizePieceId(fileBase, 'part');
    var safePartName = sanitizePieceId(partName, 'piece');
    var base = numericId + '_' + safeFileBase + '_' + safePartName;
    var candidate = base + '.stl';
    var suffix = 2;
    while (usedNames[candidate]) {
      candidate = base + '_' + suffix + '.stl';
      suffix += 1;
    }
    usedNames[candidate] = true;
    return candidate;
  }

  function buildZipBlob(files) {
    var writer = createSimpleZipWriter();
    files.forEach(function (file) {
      writer.addFile(file.name, file.data);
    });
    return writer.toBlob();
  }

  function getDeduplicatedStlEntries(instances, groups) {
    var byName = Object.create(null);
    (instances || []).forEach(function (instance) {
      if (!instance || !instance.stlFilename) return;
      byName[instance.stlFilename] = instance;
    });
    return (groups || []).map(function (group) {
      if (!group || !group.stlFilenames || !group.stlFilenames.length) return null;
      return byName[group.stlFilenames[0]] || null;
    }).filter(Boolean);
  }

  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function encodeUtf8(text) {
    return new TextEncoder().encode(String(text || ''));
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms || 0); });
  }

  function createSimpleZipWriter() {
    var localParts = [];
    var centralParts = [];
    var offset = 0;

    return {
      addFile: function (name, bytes) {
        var fileNameBytes = encodeUtf8(name);
        var data = normalizeBinaryData(bytes);
        var crc = crc32(data);
        var localHeader = createLocalFileHeader(fileNameBytes, crc, data.length);
        localParts.push(localHeader, data);
        var localSize = localHeader.length + data.length;
        var centralHeader = createCentralDirectoryHeader(fileNameBytes, crc, data.length, offset);
        centralParts.push(centralHeader);
        offset += localSize;
      },
      toBlob: function () {
        var centralSize = centralParts.reduce(function (sum, part) { return sum + part.length; }, 0);
        var endRecord = createEndOfCentralDirectory(centralParts.length, centralSize, offset);
        return new Blob(localParts.concat(centralParts).concat([endRecord]), { type: 'application/zip' });
      }
    };
  }

  function createLocalFileHeader(nameBytes, crc, size) {
    var out = new Uint8Array(30 + nameBytes.length);
    var view = new DataView(out.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, crc >>> 0, true);
    view.setUint32(18, size, true);
    view.setUint32(22, size, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    out.set(nameBytes, 30);
    return out;
  }

  function createCentralDirectoryHeader(nameBytes, crc, size, localOffset) {
    var out = new Uint8Array(46 + nameBytes.length);
    var view = new DataView(out.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0, true);
    view.setUint32(16, crc >>> 0, true);
    view.setUint32(20, size, true);
    view.setUint32(24, size, true);
    view.setUint16(28, nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, localOffset, true);
    out.set(nameBytes, 46);
    return out;
  }

  function createEndOfCentralDirectory(fileCount, centralSize, centralOffset) {
    var out = new Uint8Array(22);
    var view = new DataView(out.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(4, 0, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, fileCount, true);
    view.setUint16(10, fileCount, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, centralOffset, true);
    view.setUint16(20, 0, true);
    return out;
  }

  var CRC32_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var i = 0; i < 256; i += 1) {
      var c = i;
      for (var j = 0; j < 8; j += 1) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0 ^ (-1);
    for (var i = 0; i < bytes.length; i += 1) {
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[i]) & 0xff];
    }
    return (crc ^ (-1)) >>> 0;
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
    state.inspectorMode = newPieces.length ? 'piece' : 'hidden';
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
