(function () {
  "use strict";

  var config = Object.assign(
    {
      appBase: "./",
      hoverDelay: 120,
      warmCount: 6
    },
    window.ViewerGalleryConfig || {}
  );

  var APP_BASE = new URL(
    document.documentElement.getAttribute("data-app-base") || config.appBase || "./",
    document.baseURI
  ).href;

  var hoverDelayValue = Number(config.hoverDelay);
  var warmCountValue = Number(config.warmCount);

  var HOVER_DELAY = Number.isFinite(hoverDelayValue) ? hoverDelayValue : 120;
  var WARM_COUNT = Number.isFinite(warmCountValue) ? warmCountValue : 6;

  var PREVIEW_LABEL = "3D Preview";
  var CLOSE_LABEL = "Close 3D Preview";

  var DEFAULT_CAMERA = {
    fov: 45,
    position: { x: 0, y: 0, z: 75 },
    angle: { x: -45, y: 0, z: -45 }
  };

  var DEFAULT_ROTATE = {
    enabled: false,
    axis: "z",
    speed: 50,
    origin: { x: 0, y: 0, z: 0 }
  };

  var cards = Array.prototype.slice.call(
    document.querySelectorAll(".viewer-card[model-file]")
  );

  if (!cards.length) return;

  var supportsHover = true;
  try {
    supportsHover = window.matchMedia("(hover: hover)").matches;
  } catch (error) {
    supportsHover = true;
  }

  var sharedFrame = createSharedFrame();
  var activeCard = null;
  var hoverTimer = null;
  var readyTimer = null;
  var prefetchedDesigns = new Set();

  hydrateFallbackImages(cards);
  installEvents(cards);
  warmFirstDesigns(cards);

  function createSharedFrame() {
    var frame = document.createElement("iframe");
    frame.className = "viewer-preview-frame";
    frame.setAttribute("title", "3D preview");
    frame.setAttribute("loading", "eager");
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.setAttribute("aria-hidden", "true");
    frame.srcdoc = buildBlankDocument();
    frame.dataset.previewKey = "";
    return frame;
  }

  function installEvents(list) {
    list.forEach(function (card) {
      var mode = getPreviewMode(card);
      var button = card.querySelector(".viewer-preview-button");

      if (mode === "hover" && supportsHover) {
        card.addEventListener("mouseenter", function () {
          queuePreview(card, false);
        });

        card.addEventListener("mouseleave", function () {
          cancelQueuedPreview();
          if (activeCard === card) {
            detachPreview(card);
          }
        });

        card.addEventListener("focusin", function () {
          queuePreview(card, true);
        });

        card.addEventListener("focusout", function () {
          if (activeCard === card) {
            detachPreview(card);
          }
        });
      }

      if (mode === "button" && button) {
        button.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();

          if (activeCard === card) {
            detachPreview(card);
            return;
          }

          cancelQueuedPreview();
          prefetchDesign(getModelFileUrl(card));
          showPreview(card);
        });
      }

      card.addEventListener("click", function (event) {
        if (event.target && event.target.closest(".viewer-preview-button")) return;
        navigateCard(card);
      });

      card.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          navigateCard(card);
        }
      });
    });

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        releasePreview();
      }
    });

    window.addEventListener("pagehide", releasePreview);
    window.addEventListener("blur", releasePreview);
  }

  function getPreviewMode(card) {
    return (card.getAttribute("model-preview-mode") || "hover").toLowerCase();
  }

  function getOpenMode(card) {
    return (card.getAttribute("model-href-window") || "new").toLowerCase();
  }

  function getModelHrefUrl(card) {
    var href = card.getAttribute("model-href");
    if (!href) return "";
    return new URL(href, APP_BASE).href;
  }

  function navigateCard(card) {
    var href = getModelHrefUrl(card);
    if (!href) return;

    var openMode = getOpenMode(card);

    if (openMode === "same") {
      window.location.href = href;
      return;
    }

    var popup = window.open(href, "_blank");
    if (popup) {
      try {
        popup.opener = null;
      } catch (error) {}
    }
  }

  function queuePreview(card, immediate) {
    var designUrl = getModelFileUrl(card);
    if (!designUrl) return;

    cancelQueuedPreview();
    prefetchDesign(designUrl);

    if (immediate || !supportsHover) {
      showPreview(card);
      return;
    }

    hoverTimer = window.setTimeout(function () {
      showPreview(card);
    }, HOVER_DELAY);
  }

  function cancelQueuedPreview() {
    if (hoverTimer) {
      window.clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  }

  function showPreview(card) {
    var slot = card.querySelector(".viewer-preview");
    var designUrl = getModelFileUrl(card);
    var previewKey = getPreviewKey(card);

    if (!slot || !designUrl) return;

    if (activeCard && activeCard !== card) {
      detachPreview(activeCard);
    }

    activeCard = card;
    card.classList.remove("is-ready");
    card.classList.add("is-loading");
    updateButtonState(card, true);

    if (sharedFrame.parentElement !== slot) {
      slot.innerHTML = "";
      slot.appendChild(sharedFrame);
    }

    if (sharedFrame.dataset.previewKey === previewKey && sharedFrame.srcdoc) {
      watchUntilReady(card);
      return;
    }

    sharedFrame.dataset.previewKey = previewKey;
    sharedFrame.srcdoc = buildPreviewDocument(designUrl, getCameraOptions(card), getRotateOptions(card));
    watchUntilReady(card);
  }

  function resetSharedFrame() {
    sharedFrame.dataset.previewKey = "";
    sharedFrame.srcdoc = buildBlankDocument();
  }

  function detachPreview(card) {
    stopReadyWatcher();

    if (card) {
      card.classList.remove("is-loading", "is-ready");
      updateButtonState(card, false);
    }

    if (sharedFrame.parentElement) {
      sharedFrame.parentElement.removeChild(sharedFrame);
    }

    resetSharedFrame();

    if (activeCard === card) {
      activeCard = null;
    }
  }

  function releasePreview() {
    cancelQueuedPreview();
    stopReadyWatcher();

    if (activeCard) {
      activeCard.classList.remove("is-loading", "is-ready");
      updateButtonState(activeCard, false);
      activeCard = null;
    }

    if (sharedFrame.parentElement) {
      sharedFrame.parentElement.removeChild(sharedFrame);
    }

    resetSharedFrame();
  }

  function updateButtonState(card, isActive) {
    var button = card.querySelector(".viewer-preview-button");
    if (!button) return;

    button.textContent = isActive ? CLOSE_LABEL : PREVIEW_LABEL;
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  }

  function stopReadyWatcher() {
    if (readyTimer) {
      window.clearInterval(readyTimer);
      readyTimer = null;
    }
  }

  function watchUntilReady(card) {
    stopReadyWatcher();

    var tries = 0;
    readyTimer = window.setInterval(function () {
      if (activeCard !== card) {
        stopReadyWatcher();
        return;
      }

      var doc;
      try {
        doc = sharedFrame.contentDocument;
      } catch (error) {
        doc = null;
      }

      var isReady = false;

      if (doc) {
        var canvas = doc.querySelector("canvas");
        var statusNode = doc.getElementById("statusdiv");
        var statusText = statusNode && statusNode.textContent
          ? statusNode.textContent.replace(/\s+/g, " ").trim()
          : "";

        var busy = /\b(loading|processing)\b/i.test(statusText);

        if (canvas && !busy) {
          isReady = true;
        }
      }

      if (isReady) {
        card.classList.remove("is-loading");
        card.classList.add("is-ready");
        stopReadyWatcher();
        return;
      }

      tries += 1;

      if (tries > 75) {
        card.classList.remove("is-loading");
        stopReadyWatcher();
      }
    }, 80);
  }

  function getModelFileUrl(card) {
    var modelFile = card.getAttribute("model-file");
    if (!modelFile) return "";
    return new URL(modelFile, APP_BASE).href;
  }

  function getNumberAttr(card, attrName, fallbackValue) {
    var raw = card.getAttribute(attrName);
    if (raw === null || raw === "") return fallbackValue;

    var value = Number(raw);
    return Number.isFinite(value) ? value : fallbackValue;
  }

  function getBooleanAttr(card, attrName, fallbackValue) {
    var raw = card.getAttribute(attrName);
    if (raw === null || raw === "") return fallbackValue;

    raw = String(raw).trim().toLowerCase();

    if (raw === "true" || raw === "1" || raw === "yes" || raw === "on") return true;
    if (raw === "false" || raw === "0" || raw === "no" || raw === "off") return false;

    return fallbackValue;
  }

  function getStringAttr(card, attrName, fallbackValue) {
    var raw = card.getAttribute(attrName);
    if (raw === null || raw === "") return fallbackValue;
    return String(raw).trim();
  }

  function getCameraOptions(card) {
    return {
      fov: getNumberAttr(card, "model-camera-fov", DEFAULT_CAMERA.fov),
      position: {
        x: getNumberAttr(card, "model-camera-position-x", DEFAULT_CAMERA.position.x),
        y: getNumberAttr(card, "model-camera-position-y", DEFAULT_CAMERA.position.y),
        z: getNumberAttr(card, "model-camera-position-z", DEFAULT_CAMERA.position.z)
      },
      angle: {
        x: getNumberAttr(card, "model-camera-angle-x", DEFAULT_CAMERA.angle.x),
        y: getNumberAttr(card, "model-camera-angle-y", DEFAULT_CAMERA.angle.y),
        z: getNumberAttr(card, "model-camera-angle-z", DEFAULT_CAMERA.angle.z)
      }
    };
  }

  function getRotateOptions(card) {
    var axis = getStringAttr(card, "model-rotate-axis", DEFAULT_ROTATE.axis).toLowerCase();

    if (axis !== "x" && axis !== "y" && axis !== "z") {
      axis = DEFAULT_ROTATE.axis;
    }

    return {
      enabled: getBooleanAttr(card, "model-rotate", DEFAULT_ROTATE.enabled),
      axis: axis,
      speed: getNumberAttr(card, "model-rotate-speed", DEFAULT_ROTATE.speed),
      origin: {
        x: getNumberAttr(card, "model-rotate-origin-x", DEFAULT_ROTATE.origin.x),
        y: getNumberAttr(card, "model-rotate-origin-y", DEFAULT_ROTATE.origin.y),
        z: getNumberAttr(card, "model-rotate-origin-z", DEFAULT_ROTATE.origin.z)
      }
    };
  }

  function getPreviewKey(card) {
    return JSON.stringify({
      model: getModelFileUrl(card),
      camera: getCameraOptions(card),
      rotate: getRotateOptions(card)
    });
  }

  function prefetchDesign(url) {
    if (!url || prefetchedDesigns.has(url)) return;

    prefetchedDesigns.add(url);

    fetch(url, {
      method: "GET",
      credentials: "same-origin",
      cache: "force-cache"
    }).then(function (response) {
      if (!response.ok) {
        prefetchedDesigns.delete(url);
      }
    }).catch(function () {
      prefetchedDesigns.delete(url);
    });
  }

  function warmFirstDesigns(list) {
    var urls = list
      .map(function (card) {
        return getModelFileUrl(card);
      })
      .filter(Boolean)
      .slice(0, WARM_COUNT);

    var warm = function () {
      urls.forEach(prefetchDesign);
    };

    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(warm, { timeout: 1200 });
    } else {
      window.setTimeout(warm, 350);
    }
  }

  function hydrateFallbackImages(list) {
    list.forEach(function (card) {
      var img = card.querySelector(".viewer-image");
      if (!img) return;

      var src = (img.getAttribute("src") || "").trim();
      var title = img.getAttribute("data-title") || img.getAttribute("alt") || "Piece";

      if (!src) {
        img.src = buildPlaceholderSvg(title);
        return;
      }

      img.addEventListener("error", function () {
        img.src = buildPlaceholderSvg(title);
      });
    });
  }

  function buildPlaceholderSvg(title) {
    var safeTitle = escapeXml(title);

    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 900">' +
        '<rect width="900" height="900" rx="24" fill="#e8eef5"/>' +
        '<rect x="70" y="70" width="760" height="760" rx="18" fill="none" stroke="#b8c7d8" stroke-width="4" stroke-dasharray="12 10"/>' +
        '<text x="450" y="400" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="700" fill="#4a5a70">' + safeTitle + '</text>' +
        '<text x="450" y="470" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="30" fill="#6c7b8d">No preview image available</text>' +
      '</svg>';

    return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  }

  function buildBlankDocument() {
    return [
      "<!doctype html>",
      "<html>",
      "<head>",
      '<meta charset="utf-8">',
      "<style>",
      "html, body { margin: 0; width: 100%; height: 100%; background: #eef3f8; }",
      "</style>",
      "</head>",
      "<body></body>",
      "</html>"
    ].join("");
  }

  function buildPreviewDocument(designUrl, cameraOptions, rotateOptions) {
    var safeBase = escapeHtml(APP_BASE);
    var safeDesign = escapeHtml(designUrl);
    var cameraJson = JSON.stringify(cameraOptions);
    var rotateJson = JSON.stringify(rotateOptions);

    return [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '<base href="' + safeBase + '">',
      '<link rel="stylesheet" href="min.css" type="text/css">',
      "<style>",
      "html, body {",
      "  margin: 0;",
      "  width: 100%;",
      "  height: 100%;",
      "  overflow: hidden;",
      "  background: #eef3f8;",
      "}",
      ".jscad-container {",
      "  margin: 0 !important;",
      "  padding: 0 !important;",
      "  border: 0 !important;",
      "  min-width: 0 !important;",
      "  width: 100%;",
      "  height: 100%;",
      "}",
      "#header, #tail {",
      "  display: none !important;",
      "}",
      "#viewerContext {",
      "  margin: 0 !important;",
      "  border: 0 !important;",
      "  width: 100% !important;",
      "  height: 100% !important;",
      "  background: #eef3f8 !important;",
      "}",
      "#viewerContext canvas {",
      "  display: block;",
      "  width: 100% !important;",
      "  height: 100% !important;",
      "  pointer-events: none;",
      "}",
      "#errordiv {",
      "  display: none !important;",
      "}",
      "</style>",
      "</head>",
      "<body>",
      '<div class="jscad-container">',
      '  <div id="header"><div id="errordiv"></div></div>',
	  
		'<div oncontextmenu="return false;" id="viewerContext" design-url="' + safeDesign + '"></div>',
		'  <div id="tail"><div id="statusdiv"></div></div>',
		"</div>",
      "<script>",
      "window.__VIEWER_CAMERA_OVERRIDE__ = " + cameraJson + ";",
      "window.__VIEWER_ROTATE_OVERRIDE__ = " + rotateJson + ";",
      "<\/script>",
      '<script src="dist/min.js"><\/script>',
      "<script>",
      "(function () {",
      "  var TARGET_CAMERA = " + cameraJson + ";",
      "  var TARGET_ROTATE = " + rotateJson + ";",
      "  function initPreview() {",
      "    if (typeof window.__setPreviewCamera === 'function') {",
      "      window.__setPreviewCamera(TARGET_CAMERA);",
      "    }",
      "    if (typeof window.__setPreviewRotate === 'function') {",
      "      window.__setPreviewRotate(TARGET_ROTATE);",
      "    }",
      "  }",
      "",
      "  if (document.readyState === 'loading') {",
      "    document.addEventListener('DOMContentLoaded', initPreview);",
      "  } else {",
      "    initPreview();",
      "  }",
      "})();",
      "<\/script>",
      "</body>",
      "</html>"
    ].join("");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/\"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeXml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
})();