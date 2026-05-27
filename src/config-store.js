"use strict";

const { storage } = require("uxp");
const { decodeSecureValue, encodeSecureValue, normalizeUrl, sanitizeSingleLineText } = require("./utils");

const secureStorage = storage.secureStorage;

const STORAGE_KEYS = {
  baseUrl: "ow.baseUrl",
  model: "ow.model",
  prompt: "ow.prompt",
  useSelectionRef: "ow.useSelectionRef",
  applySelectionMask: "ow.applySelectionMask",
  featherPx: "ow.featherPx",
  placementMode: "ow.placementMode",
  saveApiKey: "ow.saveApiKey",
  apiKey: "ow.apiKey"
};

const DEFAULTS = {
  baseUrl: "http://10.10.20.235:3000/",
  model: "",
  prompt: "",
  useSelectionRef: true,
  applySelectionMask: true,
  featherPx: 0,
  placementMode: "cover",
  saveApiKey: true,
  apiKey: ""
};

function readBoolean(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw === null) {
    return fallback;
  }
  return raw === "true";
}

function readNumber(key, fallback) {
  const raw = localStorage.getItem(key);
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
}

async function loadSettings() {
  let apiKey = "";

  try {
    apiKey = sanitizeSingleLineText(decodeSecureValue(await secureStorage.getItem(STORAGE_KEYS.apiKey)));
  } catch (error) {
    apiKey = "";
  }

  return {
    baseUrl: localStorage.getItem(STORAGE_KEYS.baseUrl) || DEFAULTS.baseUrl,
    model: localStorage.getItem(STORAGE_KEYS.model) || DEFAULTS.model,
    prompt: localStorage.getItem(STORAGE_KEYS.prompt) || DEFAULTS.prompt,
    useSelectionRef: readBoolean(STORAGE_KEYS.useSelectionRef, DEFAULTS.useSelectionRef),
    applySelectionMask: readBoolean(STORAGE_KEYS.applySelectionMask, DEFAULTS.applySelectionMask),
    featherPx: readNumber(STORAGE_KEYS.featherPx, DEFAULTS.featherPx),
    placementMode: localStorage.getItem(STORAGE_KEYS.placementMode) || DEFAULTS.placementMode,
    saveApiKey: readBoolean(STORAGE_KEYS.saveApiKey, DEFAULTS.saveApiKey),
    apiKey
  };
}

async function saveSettings(settings) {
  if (Object.prototype.hasOwnProperty.call(settings, "baseUrl")) {
    localStorage.setItem(STORAGE_KEYS.baseUrl, normalizeUrl(settings.baseUrl || DEFAULTS.baseUrl));
  }
  if (Object.prototype.hasOwnProperty.call(settings, "model")) {
    localStorage.setItem(STORAGE_KEYS.model, settings.model || "");
  }
  if (Object.prototype.hasOwnProperty.call(settings, "prompt")) {
    localStorage.setItem(STORAGE_KEYS.prompt, settings.prompt || "");
  }
  if (Object.prototype.hasOwnProperty.call(settings, "useSelectionRef")) {
    localStorage.setItem(STORAGE_KEYS.useSelectionRef, String(Boolean(settings.useSelectionRef)));
  }
  if (Object.prototype.hasOwnProperty.call(settings, "applySelectionMask")) {
    localStorage.setItem(
      STORAGE_KEYS.applySelectionMask,
      String(Boolean(settings.applySelectionMask))
    );
  }
  if (Object.prototype.hasOwnProperty.call(settings, "featherPx")) {
    localStorage.setItem(STORAGE_KEYS.featherPx, String(Number(settings.featherPx) || 0));
  }
  if (Object.prototype.hasOwnProperty.call(settings, "placementMode")) {
    localStorage.setItem(STORAGE_KEYS.placementMode, settings.placementMode || "cover");
  }
  if (Object.prototype.hasOwnProperty.call(settings, "saveApiKey")) {
    localStorage.setItem(STORAGE_KEYS.saveApiKey, String(Boolean(settings.saveApiKey)));
  }

  if (Object.prototype.hasOwnProperty.call(settings, "apiKey")) {
    if (settings.saveApiKey) {
      await secureStorage.setItem(
        STORAGE_KEYS.apiKey,
        encodeSecureValue(sanitizeSingleLineText(settings.apiKey || ""))
      );
    } else {
      try {
        await secureStorage.removeItem(STORAGE_KEYS.apiKey);
      } catch (error) {
        // Nothing to remove.
      }
    }
  }
}

module.exports = {
  DEFAULTS,
  loadSettings,
  saveSettings
};
