"use strict";

const { app, core, action, constants } = require("photoshop");
const { storage } = require("uxp");
const { normalizeBounds, sanitizeFileName } = require("./utils");

const fs = storage.localFileSystem;
const { formats } = storage;

async function runModal(commandName, callback) {
  return core.executeAsModal(async () => callback(), { commandName });
}

function getActiveDocumentOrThrow() {
  const document = app.activeDocument;
  if (!document) {
    throw new Error("Please open a Photoshop document first.");
  }
  return document;
}

async function getSelectionInfo() {
  const document = getActiveDocumentOrThrow();

  try {
    const bounds = normalizeBounds(await document.selection.bounds);
    return {
      document,
      bounds,
      resolution: Number(document.resolution) || 72
    };
  } catch (error) {
    throw new Error("Please create a valid selection in Photoshop first.");
  }
}

function cloneBounds(bounds) {
  const normalized = normalizeBounds(bounds);
  return {
    left: normalized.left,
    top: normalized.top,
    right: normalized.right,
    bottom: normalized.bottom,
    width: normalized.width,
    height: normalized.height
  };
}

async function createSelectionSnapshot(selectionInfo) {
  const snapshot = {
    documentId: selectionInfo.document && selectionInfo.document.id,
    bounds: cloneBounds(selectionInfo.bounds),
    resolution: selectionInfo.resolution
  };

  snapshot.channelName = `OpenWeb Selection ${Date.now()}`;
  await runModal("Capture OpenWeb Selection", async () => {
    activateDocument(selectionInfo.document);
    await selectionInfo.document.selection.save(snapshot.channelName);
  });

  return snapshot;
}

function getSelectionChannel(document, selectionSnapshot) {
  if (!document || !selectionSnapshot || !selectionSnapshot.channelName) {
    return null;
  }

  try {
    return document.channels.getByName(selectionSnapshot.channelName);
  } catch (error) {
    return null;
  }
}

async function loadSelectionSnapshot(document, selectionSnapshot, featherPx = 0) {
  activateDocument(document);

  const channel = getSelectionChannel(document, selectionSnapshot);
  if (channel) {
    await document.selection.load(channel);
    if (Number(featherPx) > 0) {
      await document.selection.feather(Number(featherPx));
    }
    return true;
  }

  if (selectionSnapshot && selectionSnapshot.bounds) {
    await selectRectangleBounds(document, selectionSnapshot.bounds, featherPx);
    return true;
  }

  return false;
}

async function removeSelectionSnapshot(document, selectionSnapshot) {
  const channel = getSelectionChannel(document, selectionSnapshot);
  if (channel && typeof channel.remove === "function") {
    await channel.remove();
  }
}

function getDocumentById(documentId) {
  const documents = Array.isArray(app.documents) ? app.documents : [];
  return documents.find((document) => document && document.id === documentId) || null;
}

function activateDocument(document) {
  if (document && app.activeDocument !== document) {
    app.activeDocument = document;
  }
}

async function resolvePlacementTarget(options = {}) {
  if (options.selectionSnapshot && options.selectionSnapshot.documentId) {
    const targetDocument = getDocumentById(options.selectionSnapshot.documentId);
    if (!targetDocument) {
      throw new Error("The original Photoshop document is no longer available.");
    }

    return {
      document: targetDocument,
      bounds: cloneBounds(options.selectionSnapshot.bounds),
      resolution: Number(options.selectionSnapshot.resolution) || Number(targetDocument.resolution) || 72
    };
  }

  const currentSelection = await getSelectionInfo();
  return {
    document: currentSelection.document,
    bounds: cloneBounds(currentSelection.bounds),
    resolution: currentSelection.resolution
  };
}

async function selectRectangleBounds(document, bounds, featherPx = 0) {
  await document.selection.selectRectangle(
    {
      top: bounds.top,
      left: bounds.left,
      bottom: bounds.bottom,
      right: bounds.right
    },
    constants.SelectionType.REPLACE,
    Number(featherPx) > 0 ? Number(featherPx) : 0
  );
}

async function deselectSelection(document) {
  if (document && document.selection && typeof document.selection.deselect === "function") {
    await document.selection.deselect();
  }
}

async function alignSelectedLayerToSelection(alignment) {
  await action.batchPlay(
    [
      {
        _obj: "align",
        _target: [
          {
            _enum: "ordinal",
            _ref: "layer"
          }
        ],
        using: {
          _enum: "alignDistributeSelector",
          _value: alignment
        },
        alignToCanvas: false
      }
    ],
    {
      synchronousExecution: true
    }
  );
}

async function selectLayerById(layerId) {
  if (layerId === undefined || layerId === null) {
    return;
  }

  await action.batchPlay(
    [
      {
        _obj: "select",
        _target: [
          {
            _ref: "layer",
            _id: layerId
          }
        ],
        makeVisible: false
      }
    ],
    {
      synchronousExecution: true
    }
  );
}

async function createMaskFromSelection() {
  await action.batchPlay(
    [
      {
        _obj: "make",
        new: {
          _class: "channel"
        },
        at: {
          _ref: "channel",
          _enum: "channel",
          _value: "mask"
        },
        using: {
          _enum: "userMaskEnabled",
          _value: "revealSelection"
        }
      }
    ],
    {
      synchronousExecution: true
    }
  );
}

async function transformLayerById(layerId, params) {
  const scaleXPercent = Number(params.scaleXPercent);
  const scaleYPercent = Number(params.scaleYPercent);
  const offsetX = Number(params.offsetX);
  const offsetY = Number(params.offsetY);

  await selectLayerById(layerId);
  await action.batchPlay(
    [
      {
        _obj: "transform",
        _target: [
          {
            _ref: "layer",
            _id: layerId
          }
        ],
        freeTransformCenterState: {
          _enum: "quadCenterState",
          _value: "QCSAverage"
        },
        offset: {
          _obj: "offset",
          horizontal: {
            _unit: "pixelsUnit",
            _value: offsetX
          },
          vertical: {
            _unit: "pixelsUnit",
            _value: offsetY
          }
        },
        width: {
          _unit: "percentUnit",
          _value: scaleXPercent
        },
        height: {
          _unit: "percentUnit",
          _value: scaleYPercent
        },
        linked: false
      }
    ],
    {
      synchronousExecution: true
    }
  );
}

function getLayerBounds(layer) {
  const bounds = layer.boundsNoEffects || layer.bounds;
  return normalizeBounds(bounds);
}

function getDocumentLayerById(document, layerId) {
  if (!document || layerId === undefined || layerId === null) {
    return null;
  }

  const layers = Array.isArray(document.layers) ? document.layers : [];
  return layers.find((layer) => layer && layer.id === layerId) || null;
}

function getDocumentLayerIds(document) {
  const layers = Array.isArray(document && document.layers) ? document.layers : [];
  return layers
    .map((layer) => (layer ? layer.id : null))
    .filter((layerId) => layerId !== null && layerId !== undefined);
}

function resolveImportedLayer(targetDocument, duplicatedLayers, sourceLayerId, existingLayerIds = []) {
  const existingIds = new Set(existingLayerIds);
  const duplicated = Array.isArray(duplicatedLayers) ? duplicatedLayers[0] : null;
  const candidateId = duplicated && duplicated.id;

  if (
    candidateId !== undefined &&
    candidateId !== null &&
    candidateId !== sourceLayerId &&
    !existingIds.has(candidateId)
  ) {
    const matched = getDocumentLayerById(targetDocument, candidateId);
    if (matched) {
      return matched;
    }
  }

  const allLayers = Array.isArray(targetDocument && targetDocument.layers) ? targetDocument.layers : [];
  const newLayer = allLayers.find((layer) => layer && !existingIds.has(layer.id));
  if (newLayer) {
    return newLayer;
  }

  const activeLayers = Array.isArray(targetDocument && targetDocument.activeLayers)
    ? targetDocument.activeLayers
    : [];
  if (activeLayers.length) {
    return activeLayers[0];
  }

  return allLayers.length ? allLayers[0] : null;
}

async function fitLayerToBounds(layer, targetBounds, placementMode) {
  const currentBounds = getLayerBounds(layer);
  const currentWidth = Math.max(1, currentBounds.width);
  const currentHeight = Math.max(1, currentBounds.height);
  const widthRatio = targetBounds.width / currentWidth;
  const heightRatio = targetBounds.height / currentHeight;

  let scaleX = widthRatio;
  let scaleY = heightRatio;

  if (placementMode === "cover") {
    const uniform = Math.max(widthRatio, heightRatio);
    scaleX = uniform;
    scaleY = uniform;
  } else if (placementMode === "contain") {
    const uniform = Math.min(widthRatio, heightRatio);
    scaleX = uniform;
    scaleY = uniform;
  }

  await layer.scale(scaleX * 100, scaleY * 100);
}

async function createTempFile(fileName) {
  const tempFolder = await fs.getTemporaryFolder();
  return tempFolder.createFile(sanitizeFileName(fileName), { overwrite: true });
}

async function getDebugFolder() {
  const dataFolder = await fs.getDataFolder();
  let rootFolder;

  try {
    rootFolder = await dataFolder.getEntry("OpenWebBridgeDebug");
  } catch (error) {
    rootFolder = await dataFolder.createFolder("OpenWebBridgeDebug");
  }

  try {
    return await rootFolder.getEntry("debug");
  } catch (error) {
    return rootFolder.createFolder("debug");
  }
}

async function writeBinaryToDebugFile(arrayBuffer, suggestedName) {
  const debugFolder = await getDebugFolder();
  const debugFile = await debugFolder.createFile(sanitizeFileName(suggestedName), {
    overwrite: true
  });
  await debugFile.write(arrayBuffer, { format: formats.binary });
  return debugFile;
}

async function copyFileToDebug(fileEntry, suggestedName) {
  const buffer = await fileEntry.read({ format: formats.binary });
  return writeBinaryToDebugFile(buffer, suggestedName || fileEntry.name);
}

async function getDebugFolderPath() {
  const debugFolder = await getDebugFolder();
  return debugFolder.nativePath || debugFolder.name || "OpenWebBridgeDebug/debug";
}

async function exportSelectionToPng(options = {}) {
  const info = await resolvePlacementTarget(options);
  const tempFile = await createTempFile(`openweb-selection-${Date.now()}.png`);

  await runModal("Export OpenWeb Selection", async () => {
    activateDocument(info.document);
    const tempDocument = await info.document.duplicate("OpenWeb Selection", true);
    await tempDocument.crop(info.bounds);
    await tempDocument.saveAs.png(tempFile, {}, true);
    tempDocument.closeWithoutSaving();
  });

  return {
    ...info,
    file: tempFile
  };
}

async function writeBinaryToTempFile(arrayBuffer, suggestedName) {
  const tempFile = await createTempFile(suggestedName || `openweb-result-${Date.now()}.png`);
  await tempFile.write(arrayBuffer, { format: formats.binary });
  return tempFile;
}

async function placeGeneratedImage(options) {
  const selectionInfo = await resolvePlacementTarget(options);
  const targetDocument = selectionInfo.document;
  const tempFile = await writeBinaryToTempFile(options.buffer, options.fileName);

  return runModal("Place OpenWeb Result", async () => {
    let generatedDocument = null;

    try {
      activateDocument(targetDocument);
      await deselectSelection(targetDocument);
      const existingLayerIds = getDocumentLayerIds(targetDocument);
      generatedDocument = await app.open(tempFile);
      const sourceLayer = generatedDocument.layers[0];

      if (!sourceLayer) {
        throw new Error("The generated result document does not contain a layer to import.");
      }

      const sourceLayerId = sourceLayer.id;
      const duplicatedLayers = await generatedDocument.duplicateLayers([sourceLayer], targetDocument);

      generatedDocument.closeWithoutSaving();
      generatedDocument = null;
      activateDocument(targetDocument);

      let importedLayer = resolveImportedLayer(
        targetDocument,
        duplicatedLayers,
        sourceLayerId,
        existingLayerIds
      );

      if (!importedLayer) {
        throw new Error("Could not locate the imported result layer in the target Photoshop document.");
      }

      await selectLayerById(importedLayer.id);
      activateDocument(targetDocument);
      importedLayer = getDocumentLayerById(targetDocument, importedLayer.id) || importedLayer;
      importedLayer.name = `OpenWeb ${new Date().toLocaleTimeString()}`;

      await fitLayerToBounds(importedLayer, selectionInfo.bounds, options.placementMode || "cover");
      await selectRectangleBounds(targetDocument, selectionInfo.bounds, 0);
      await alignSelectedLayerToSelection("ADSTops");
      await alignSelectedLayerToSelection("ADSLefts");
      importedLayer = getDocumentLayerById(targetDocument, importedLayer.id) || importedLayer;
      const placedBounds = getLayerBounds(importedLayer);

      if (options.applySelectionMask) {
        await selectLayerById(importedLayer.id);
        const loadedOriginalSelection = await loadSelectionSnapshot(
          targetDocument,
          options.selectionSnapshot,
          options.featherPx
        );
        if (!loadedOriginalSelection) {
          await selectRectangleBounds(targetDocument, selectionInfo.bounds, options.featherPx);
        }
        await createMaskFromSelection();
      }

      await deselectSelection(targetDocument);

      return {
        layerName: importedLayer.name,
        bounds: selectionInfo.bounds,
        placedBounds
      };
    } finally {
      if (generatedDocument) {
        generatedDocument.closeWithoutSaving();
      }

      activateDocument(targetDocument);

      try {
        await deselectSelection(targetDocument);
      } catch (error) {
      }

      try {
        await removeSelectionSnapshot(targetDocument, options.selectionSnapshot);
      } catch (error) {
      }
    }
  });
}

async function readFileAsDataUrl(fileEntry, mimeType = "image/png") {
  const buffer = await fileEntry.read({ format: formats.binary });
  const uint8Array = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < uint8Array.length; index += chunkSize) {
    const chunk = uint8Array.subarray(index, index + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }

  return `data:${mimeType};base64,${btoa(binary)}`;
}

module.exports = {
  copyFileToDebug,
  createSelectionSnapshot,
  exportSelectionToPng,
  getDebugFolderPath,
  getSelectionInfo,
  placeGeneratedImage,
  readFileAsDataUrl,
  writeBinaryToDebugFile
};
