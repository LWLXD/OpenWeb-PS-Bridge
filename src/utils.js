"use strict";

function normalizeUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function ensureHttpUrl(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) {
    throw new Error("请先填写 OpenWeb 地址。");
  }
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error("OpenWeb 地址必须以 http:// 或 https:// 开头。");
  }
  return normalized;
}

function toAbsoluteUrl(baseUrl, maybeRelativePath) {
  if (!maybeRelativePath) {
    throw new Error("OpenWeb 没有返回可下载的图片地址。");
  }
  if (/^https?:\/\//i.test(maybeRelativePath)) {
    return maybeRelativePath;
  }
  return new URL(maybeRelativePath, `${ensureHttpUrl(baseUrl)}/`).toString();
}

function sanitizeFileName(name, fallback = "openweb-result.png") {
  const cleaned = String(name || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return cleaned || fallback;
}

function sanitizeSingleLineText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u2060\ufeff]+/g, "")
    .trim();
}

function extractErrorMessage(error, fallback = "发生未知错误。") {
  if (!error) {
    return fallback;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error.message) {
    return error.message;
  }

  if (error.detail) {
    return typeof error.detail === "string" ? error.detail : JSON.stringify(error.detail);
  }

  return fallback;
}

function decodeSecureValue(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder().decode(value);
  }

  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let result = "";
  for (let index = 0; index < bytes.length; index += 1) {
    result += String.fromCharCode(bytes[index]);
  }
  return decodeURIComponent(escape(result));
}

function encodeSecureValue(value) {
  const text = String(value || "");

  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text);
  }

  const utf8 = unescape(encodeURIComponent(text));
  const bytes = new Uint8Array(utf8.length);
  for (let index = 0; index < utf8.length; index += 1) {
    bytes[index] = utf8.charCodeAt(index);
  }
  return bytes;
}

function numberFromUnit(value) {
  if (typeof value === "number") {
    return value;
  }
  if (value && typeof value._value === "number") {
    return value._value;
  }
  return Number(value);
}

function normalizeBounds(bounds) {
  if (!bounds) {
    throw new Error("无法读取当前选区。");
  }

  const left = numberFromUnit(bounds.left);
  const top = numberFromUnit(bounds.top);
  const right = numberFromUnit(bounds.right);
  const bottom = numberFromUnit(bounds.bottom);

  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(1, Math.round(right - left)),
    height: Math.max(1, Math.round(bottom - top))
  };
}

function uint8ArrayToBase64(uint8Array) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < uint8Array.length; index += chunkSize) {
    const chunk = uint8Array.subarray(index, index + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

function arrayBufferToDataUrl(arrayBuffer, mimeType) {
  const bytes = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
  const base64 = uint8ArrayToBase64(bytes);
  return `data:${mimeType || "image/png"};base64,${base64}`;
}

function parseJsonSafe(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

module.exports = {
  arrayBufferToDataUrl,
  clampNumber,
  decodeSecureValue,
  encodeSecureValue,
  ensureHttpUrl,
  extractErrorMessage,
  normalizeBounds,
  normalizeUrl,
  parseJsonSafe,
  sanitizeSingleLineText,
  sanitizeFileName,
  toAbsoluteUrl
};
