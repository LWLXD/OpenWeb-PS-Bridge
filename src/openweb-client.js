"use strict";

const {
  ensureHttpUrl,
  extractErrorMessage,
  parseJsonSafe,
  sanitizeSingleLineText,
  toAbsoluteUrl
} = require("./utils");

function sanitizeHeaderValue(value) {
  return sanitizeSingleLineText(value).replace(/[^\t\x20-\x7e]/g, "");
}

function buildHeaders(apiKey, extraHeaders = {}) {
  const headers = {};

  Object.entries({
    Accept: "application/json",
    ...extraHeaders
  }).forEach(([name, value]) => {
    const sanitizedValue = sanitizeHeaderValue(value);
    if (sanitizedValue) {
      headers[name] = sanitizedValue;
    }
  });

  const sanitizedApiKey = sanitizeHeaderValue(apiKey).replace(/\s+/g, "");
  if (sanitizedApiKey) {
    headers.Authorization = `Bearer ${sanitizedApiKey}`;
  }

  return headers;
}

function parseResponseHeaders(rawHeaders) {
  const headers = {};

  String(rawHeaders || "")
    .trim()
    .split(/[\r\n]+/)
    .filter(Boolean)
    .forEach((line) => {
      const parts = line.split(": ");
      const key = String(parts.shift() || "").toLowerCase();
      headers[key] = parts.join(": ");
    });

  return headers;
}

function readXhrResponseText(xhr, responseType) {
  const normalizedType = String(responseType || "").toLowerCase();

  if (normalizedType && normalizedType !== "text" && normalizedType !== "") {
    return "";
  }

  try {
    return xhr.responseText || "";
  } catch (error) {
    return "";
  }
}

function getOrigin(url) {
  try {
    return new URL(url).origin;
  } catch (error) {
    return "";
  }
}

function createCanceledError(message = "已取消生图。") {
  const error = new Error(String(message || "已取消生图。"));
  error.code = "ABORT_ERR";
  error.isCanceled = true;
  return error;
}

function isCanceledError(error) {
  return Boolean(error && (error.isCanceled || error.code === "ABORT_ERR"));
}

function requestWithXhr(url, options = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const responseType = options.responseType || "text";
    const cancelToken = options.cancelToken;
    const rawResolve = resolve;
    const rawReject = reject;
    let finished = false;
    let cancelMessage = "";
    let unsubscribeCancel = () => {};

    const cleanup = () => {
      unsubscribeCancel();
    };

    const finishResolve = (value) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      rawResolve(value);
    };

    const finishReject = (error) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      rawReject(error);
    };

    resolve = finishResolve;
    reject = finishReject;

    if (cancelToken && cancelToken.cancelled) {
      finishReject(createCanceledError(cancelToken.reason));
      return;
    }

    xhr.open(options.method || "GET", url, true);
    xhr.responseType = responseType;
    xhr.timeout = options.timeout || 15000;

    const headers = options.headers || {};
    Object.keys(headers).forEach((key) => {
      if (headers[key] !== undefined && headers[key] !== null) {
        try {
          xhr.setRequestHeader(key, headers[key]);
        } catch (error) {
          throw new Error(
            `请求头无效：${key}。这通常是 API Key 中包含了换行或隐藏字符，请重新粘贴 API Key 后再试。`
          );
        }
      }
    });

    xhr.onload = () => {
      finishResolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        statusText: xhr.statusText,
        response: xhr.response,
        responseText: readXhrResponseText(xhr, responseType),
        headers: parseResponseHeaders(xhr.getAllResponseHeaders())
      });
    };

    xhr.onerror = () => {
      reject(new Error("网络请求失败，请检查当前电脑是否能访问 OpenWeb。"));
    };

    xhr.ontimeout = () => {
      reject(new Error("网络请求超时，请检查 OpenWeb 地址、端口或服务状态。"));
    };

    xhr.onabort = () => {
      finishReject(createCanceledError(cancelMessage || "已取消生图。"));
    };

    if (cancelToken && typeof cancelToken.subscribe === "function") {
      unsubscribeCancel = cancelToken.subscribe((reason) => {
        cancelMessage = String(reason || "已取消生图。");
        try {
          xhr.abort();
        } catch (error) {
          finishReject(createCanceledError(cancelMessage));
        }
      });
    }

    xhr.send(options.body);
  });
}

function requestWithXhrStream(url, options = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let lastIndex = 0;
    const cancelToken = options.cancelToken;
    const rawResolve = resolve;
    const rawReject = reject;
    let finished = false;
    let cancelMessage = "";
    let unsubscribeCancel = () => {};

    const cleanup = () => {
      unsubscribeCancel();
    };

    const finishResolve = (value) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      rawResolve(value);
    };

    const finishReject = (error) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      rawReject(error);
    };

    resolve = finishResolve;
    reject = finishReject;

    if (cancelToken && cancelToken.cancelled) {
      finishReject(createCanceledError(cancelToken.reason));
      return;
    }

    xhr.open(options.method || "GET", url, true);
    xhr.responseType = "text";
    xhr.timeout = options.timeout || 300000;

    const headers = options.headers || {};
    Object.keys(headers).forEach((key) => {
      if (headers[key] !== undefined && headers[key] !== null) {
        try {
          xhr.setRequestHeader(key, headers[key]);
        } catch (error) {
          throw new Error(
            `请求头无效：${key}。这通常是 API Key 中包含了换行或隐藏字符，请重新粘贴 API Key 后再试。`
          );
        }
      }
    });

    const emitDelta = () => {
      const text = xhr.responseText || "";
      if (text.length <= lastIndex) {
        return;
      }

      const chunk = text.slice(lastIndex);
      lastIndex = text.length;

      if (typeof options.onChunk === "function") {
        options.onChunk(chunk);
      }
    };

    xhr.onprogress = emitDelta;

    xhr.onload = () => {
      emitDelta();

      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        statusText: xhr.statusText,
        response: xhr.response,
        responseText: xhr.responseText,
        headers: parseResponseHeaders(xhr.getAllResponseHeaders())
      });
    };

    xhr.onerror = () => {
      reject(new Error("网络流请求失败，请检查当前电脑是否能访问 OpenWeb。"));
    };

    xhr.ontimeout = () => {
      reject(new Error("网络流请求超时，请检查 OpenWeb 地址、端口或服务状态。"));
    };

    xhr.onabort = () => {
      finishReject(createCanceledError(cancelMessage || "已取消生图。"));
    };

    if (cancelToken && typeof cancelToken.subscribe === "function") {
      unsubscribeCancel = cancelToken.subscribe((reason) => {
        cancelMessage = String(reason || "已取消生图。");
        try {
          xhr.abort();
        } catch (error) {
          finishReject(createCanceledError(cancelMessage));
        }
      });
    }

    xhr.send(options.body);
  });
}

function requestWithFetch(url, options = {}) {
  if (typeof fetch !== "function") {
    return Promise.reject(new Error("当前 UXP 环境不支持 fetch。"));
  }

  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeout || 15000;
    let finished = false;

    const finishResolve = (value) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      resolve(value);
    };

    const finishReject = (error) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      reject(error);
    };

    const timer = setTimeout(() => {
      finishReject(new Error("fetch 请求超时，请检查 OpenWeb 地址、端口或服务状态。"));
    }, timeoutMs);

    Promise.resolve()
      .then(() =>
        fetch(url, {
          method: options.method || "GET",
          headers: options.headers || {},
          body: options.body
        })
      )
      .then(async (response) => {
        const responseText = await response.text();
        const headers = {};

        if (response && response.headers && typeof response.headers.forEach === "function") {
          response.headers.forEach((value, key) => {
            headers[String(key || "").toLowerCase()] = value;
          });
        }

        finishResolve({
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          response: responseText,
          responseText,
          headers
        });
      })
      .catch((error) => {
        finishReject(
          new Error(
            `fetch 网络请求失败：${extractErrorMessage(error, "请检查当前电脑是否能访问 OpenWeb。")}`
          )
        );
      });
  });
}

function getErrorDetail(parsed, rawText, fallback) {
  if (parsed) {
    if (Array.isArray(parsed.detail)) {
      return parsed.detail.map((item) => item.msg || JSON.stringify(item)).join(", ");
    }

    if (parsed.detail) {
      return typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail);
    }

    if (parsed.error) {
      return typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed.error);
    }

    if (parsed.message) {
      return typeof parsed.message === "string" ? parsed.message : JSON.stringify(parsed.message);
    }
  }

  return rawText || fallback;
}

async function requestJson(baseUrl, path, apiKey, options = {}) {
  const url = /^https?:\/\//i.test(path) ? path : `${ensureHttpUrl(baseUrl)}${path}`;
  const response = await requestWithXhr(url, {
    method: options.method || "GET",
    headers: buildHeaders(apiKey, options.headers),
    body: options.body,
    timeout: options.timeout,
    responseType: options.responseType || "text",
    cancelToken: options.cancelToken
  });

  const rawText = response.responseText || "";
  const parsed = parseJsonSafe(rawText);

  if (!response.ok) {
    const error = new Error(getErrorDetail(parsed, rawText, response.statusText));
    error.status = response.status;
    throw error;
  }

  return parsed;
}

function normalizeModelList(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload && payload.data)
      ? payload.data
      : Array.isArray(payload && payload.models)
        ? payload.models
        : [];

  return list
    .map((item) => {
      if (typeof item === "string") {
        return { id: item, name: item, raw: { id: item, name: item } };
      }

      return {
        id: item && (item.id || item.model || item.name),
        name: item && (item.name || item.id || item.model),
        raw: item || {}
      };
    })
    .filter((item) => item.id);
}

function buildDiagnosticResponseDetail(response, options = {}) {
  const status = Number(response && response.status ? response.status : 0);
  const statusText = String((response && response.statusText) || "").trim();
  const summary = [`HTTP ${status || "0"}`];

  if (statusText) {
    summary.push(statusText);
  }

  let modelCount = 0;
  if (options.expectModels) {
    const parsed = parseJsonSafe((response && response.responseText) || "");
    const models = normalizeModelList(parsed);
    modelCount = models.length;

    if (modelCount > 0) {
      summary.push(`返回 ${modelCount} 个模型`);
    } else if (status === 401) {
      summary.push("已到达服务器，但 API Key 无效");
    } else if (status === 403) {
      summary.push("已到达服务器，但当前账号无权限");
    } else if (status >= 200 && status < 300) {
      summary.push("已到达服务器，但没有解析到模型列表");
    }
  }

  return {
    status,
    modelCount,
    detail: summary.join("，")
  };
}

async function runDiagnosticStep(key, label, runner, options = {}) {
  const startedAt = Date.now();

  try {
    const response = await runner();
    const detail = buildDiagnosticResponseDetail(response, options);

    return {
      key,
      label,
      ok: true,
      reachable: true,
      status: detail.status,
      detail: detail.detail,
      modelCount: detail.modelCount,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      key,
      label,
      ok: false,
      reachable: false,
      status: Number(error && error.status ? error.status : 0),
      detail: extractErrorMessage(error, "网络请求失败"),
      modelCount: 0,
      durationMs: Date.now() - startedAt
    };
  }
}

function summarizeDiagnostics(steps) {
  const findStep = (key) => steps.find((item) => item.key === key);
  const fetchRoot = findStep("fetch-root");
  const xhrRoot = findStep("xhr-root");
  const fetchModels = findStep("fetch-models");
  const xhrModels = findStep("xhr-models");
  const modelSteps = [fetchModels, xhrModels].filter(Boolean);

  if (!modelSteps.length) {
    return "已完成网络自检。";
  }

  if (fetchRoot && !fetchRoot.reachable && xhrRoot && !xhrRoot.reachable) {
    return "插件运行环境无法连到 OpenWeb，优先检查 Photoshop 出站访问、防火墙或安全软件。";
  }

  if (fetchRoot && fetchRoot.reachable && xhrRoot && !xhrRoot.reachable) {
    return "fetch 可访问，但 XHR 失败，更像是 Photoshop/UXP 的 XHR 环境被拦截。";
  }

  if (fetchRoot && !fetchRoot.reachable && xhrRoot && xhrRoot.reachable) {
    return "XHR 可访问，但 fetch 失败，更像是当前 UXP 的 fetch 兼容或缓存异常。";
  }

  if (modelSteps.every((item) => item.reachable && item.status === 401)) {
    return "网络已通，但 API Key 无效。";
  }

  if (modelSteps.every((item) => item.reachable && item.status === 403)) {
    return "网络已通，但当前账号没有读取模型的权限。";
  }

  if (modelSteps.some((item) => item.reachable && item.status >= 200 && item.status < 300)) {
    return "插件运行环境可以访问 OpenWeb，/api/models 也已返回结果。";
  }

  if (modelSteps.some((item) => item.reachable && item.status === 401)) {
    return "网络已通，但 API Key 可能无效，或被错误复制进去了。";
  }

  if (modelSteps.some((item) => item.reachable && item.status === 403)) {
    return "网络已通，但当前账号可能没有模型访问权限。";
  }

  return "已完成网络自检，请根据各步骤结果定位失败环节。";
}

async function runNetworkDiagnostics(config) {
  const baseUrl = ensureHttpUrl(config.baseUrl);
  const rootUrl = `${baseUrl}/`;
  const modelsUrl = `${baseUrl}/api/models`;
  const baseHeaders = {
    Accept: "text/html,application/json;q=0.9,*/*;q=0.8"
  };

  const steps = [];

  steps.push(
    await runDiagnosticStep("fetch-root", "fetch /", () =>
      requestWithFetch(rootUrl, {
        method: "GET",
        headers: baseHeaders,
        timeout: 15000
      })
    )
  );

  steps.push(
    await runDiagnosticStep("xhr-root", "XHR /", () =>
      requestWithXhr(rootUrl, {
        method: "GET",
        headers: baseHeaders,
        timeout: 15000
      })
    )
  );

  steps.push(
    await runDiagnosticStep(
      "fetch-models",
      "fetch /api/models",
      () => {
        if (!sanitizeSingleLineText(config.apiKey)) {
          throw new Error("请先填写 API Key，才能验证 /api/models。");
        }

        return requestWithFetch(modelsUrl, {
          method: "GET",
          headers: buildHeaders(config.apiKey),
          timeout: 15000
        });
      },
      { expectModels: true }
    )
  );

  steps.push(
    await runDiagnosticStep(
      "xhr-models",
      "XHR /api/models",
      () => {
        if (!sanitizeSingleLineText(config.apiKey)) {
          throw new Error("请先填写 API Key，才能验证 /api/models。");
        }

        return requestWithXhr(modelsUrl, {
          method: "GET",
          headers: buildHeaders(config.apiKey),
          timeout: 15000
        });
      },
      { expectModels: true }
    )
  );

  return {
    baseUrl,
    steps,
    summary: summarizeDiagnostics(steps)
  };
}

function dedupeModels(models) {
  const seen = new Set();
  return models.filter((item) => {
    const id = String(item && item.id ? item.id : "").trim();
    if (!id || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function isLikelyImageModel(model) {
  const haystack = `${model.id || ""} ${model.name || ""}`.toLowerCase();
  const keywords = [
    "gpt-image",
    "dall-e",
    "dalle",
    "seedream",
    "imagen",
    "image-preview",
    "banana",
    "flux",
    "sdxl",
    "stable-diffusion",
    "stable diffusion",
    "recraft",
    "midjourney",
    "image",
    "gemini"
  ];

  return keywords.some((keyword) => haystack.includes(keyword));
}

async function loadUserModels(config) {
  const payload = await requestJson(config.baseUrl, "/api/models", config.apiKey);
  return normalizeModelList(payload);
}

async function loadImageModels(config) {
  const payload = await requestJson(config.baseUrl, "/api/v1/images/models", config.apiKey);
  return normalizeModelList(payload);
}

async function testConnection(config) {
  const allModels = await loadUserModels(config);
  const likelyChatImageModels = allModels.filter(isLikelyImageModel);
  let imageApiModels = [];
  let imageApiError = null;

  try {
    imageApiModels = await loadImageModels(config);
  } catch (error) {
    imageApiError = error;
  }

  const models = dedupeModels([
    ...(likelyChatImageModels.length ? likelyChatImageModels : []),
    ...imageApiModels,
    ...(likelyChatImageModels.length ? [] : allModels)
  ]);
  const warnings = imageApiError
    ? [
        `OpenWeb images model endpoint was not available; fell back to /api/models. ${extractErrorMessage(
          imageApiError
        )}`
      ]
    : [];

  return {
    ok: true,
    mode: imageApiModels.length ? "images-api" : "chat-stream",
    models,
    allModels,
    imageApiModels,
    warnings
  };
}

function dataUrlToArrayBuffer(dataUrl) {
  const parts = String(dataUrl || "").split(",", 2);
  const header = parts[0] || "";
  const encoded = parts[1] || "";
  const mimeMatch = header.match(/^data:([^;]+);base64$/i);
  const mimeType = mimeMatch ? mimeMatch[1] : "image/png";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return {
    buffer: bytes.buffer,
    mimeType
  };
}

function isUsableDataUrl(value) {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i.test(String(value || ""));
}

async function prepareReferenceAttachments(references) {
  const contentParts = [];
  const warnings = [];

  for (const reference of references) {
    if (!isUsableDataUrl(reference.dataUrl)) {
      warnings.push(`${reference.name || "参考图"} 不是可用的 data URL，已跳过。`);
      continue;
    }

    contentParts.push({
      type: "image_url",
      image_url: {
        url: reference.dataUrl
      }
    });
  }

  if (!contentParts.length && references.length) {
    warnings.push("当前参考图没有成功写入聊天消息，模型将按纯文本方式处理。");
  }

  return {
    uploadedFiles: [],
    contentParts,
    warnings
  };
}

async function prepareReferenceImages(references) {
  const dataUrls = [];
  const warnings = [];

  for (const reference of references) {
    if (!isUsableDataUrl(reference.dataUrl)) {
      warnings.push(`${reference.name || "reference image"} is not a usable data URL and was skipped.`);
      continue;
    }

    dataUrls.push(reference.dataUrl);
  }

  return {
    dataUrls,
    warnings
  };
}

function normalizeImagesApiResponse(payload) {
  const candidates = dedupeImageCandidates(extractImageCandidatesDeep(payload, []));

  return candidates.map((url) => ({ url }));
}

function buildImageGenerationPayload(payload) {
  return {
    prompt: payload.prompt,
    n: 1,
    ...(payload.model ? { model: payload.model } : {})
  };
}

function buildImageEditPayload(payload, preparedReferences) {
  if (!preparedReferences.dataUrls.length) {
    throw new Error("OpenWeb image edit requires at least one usable reference image.");
  }

  return {
    form_data: {
      image:
        preparedReferences.dataUrls.length === 1
          ? preparedReferences.dataUrls[0]
          : preparedReferences.dataUrls,
      prompt: payload.prompt,
      n: 1
    }
  };
}

async function generateImageViaImagesApi(config, payload, options = {}) {
  const referenceImages = Array.isArray(payload.referenceImages) ? payload.referenceImages : [];
  const preparedReferences = await prepareReferenceImages(referenceImages);
  const useEditRoute = preparedReferences.dataUrls.length > 0;
  const path = useEditRoute ? "/api/v1/images/edit" : "/api/v1/images/generations";
  const requestPayload = useEditRoute
    ? buildImageEditPayload(payload, preparedReferences)
    : buildImageGenerationPayload(payload);

  const response = await requestJson(config.baseUrl, path, config.apiKey, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestPayload),
    timeout: 300000,
    cancelToken: options.cancelToken
  });

  const images = normalizeImagesApiResponse(response);

  if (!images.length) {
    throw new Error(
      `OpenWeb ${useEditRoute ? "/api/v1/images/edit" : "/api/v1/images/generations"} returned no image URL.`
    );
  }

  return {
    images,
    warnings: preparedReferences.warnings.concat(
      useEditRoute && payload.model
        ? [
            "Reference-image mode uses OpenWeb's configured image edit model; the selected model is only used for prompt-only generation and chat fallback."
          ]
        : []
    ),
    transport: useEditRoute ? "images-edit" : "images-generation"
  };
}

function extractImagesFromText(text) {
  const found = [];
  const value = String(text || "");

  const dataUrlMatches = value.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g) || [];
  found.push(...dataUrlMatches);

  const markdownMatches = [
    ...value.matchAll(/\((\/api\/v1\/files\/[^)\s]+|https?:\/\/[^)\s]+)\)/g)
  ];
  markdownMatches.forEach((match) => {
    if (match[1]) {
      found.push(match[1]);
    }
  });

  const rawUrlMatches = value.match(/(?:\/api\/v1\/files\/[^\s]+|https?:\/\/[^\s]+)/g) || [];
  rawUrlMatches.forEach((item) => {
    if (/^data:image\//i.test(item)) {
      found.push(item);
    } else if (/\.(png|jpg|jpeg|webp|gif|bmp)(\?|$)/i.test(item)) {
      found.push(item);
    } else if (/\/api\/v1\/files\/.+\/content/i.test(item)) {
      found.push(item);
    }
  });

  return found;
}

function scoreImageCandidate(candidate) {
  const value = String(candidate || "").toLowerCase();

  if (!value) {
    return -1;
  }

  if (value.startsWith("data:image/")) {
    return 100;
  }

  if (/\/api\/v1\/files\/.+\/content/.test(value)) {
    return 95;
  }

  if (/\.(png|jpg|jpeg|webp|gif|bmp)(\?|$)/.test(value)) {
    return 90;
  }

  if (value.includes("/files/") || value.includes("image")) {
    return 70;
  }

  if (/^https?:\/\//.test(value) || value.startsWith("/")) {
    return 50;
  }

  return 10;
}

function dedupeImageCandidates(candidates) {
  const seen = new Set();
  return candidates
    .filter((item) => {
      const key = String(item || "").trim();
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => scoreImageCandidate(right) - scoreImageCandidate(left));
}

function collectImageCandidate(candidate, output) {
  if (!candidate) {
    return;
  }

  const value = String(candidate).trim();
  if (!value) {
    return;
  }

  if (value.startsWith("data:image/")) {
    output.push(value);
    return;
  }

  if (/\/api\/v1\/files\/.+\/content/i.test(value)) {
    output.push(value);
    return;
  }

  if (/\.(png|jpg|jpeg|webp|gif|bmp)(\?|$)/i.test(value)) {
    output.push(value);
    return;
  }

  if (/^https?:\/\//i.test(value) && /(image|img|file|cdn|media)/i.test(value)) {
    output.push(value);
  }
}

function extractImageCandidatesDeep(value, output = [], seen = new Set()) {
  if (!value) {
    return output;
  }

  if (typeof value === "string") {
    extractImagesFromText(value).forEach((item) => collectImageCandidate(item, output));
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => extractImageCandidatesDeep(item, output, seen));
    return output;
  }

  if (typeof value !== "object") {
    return output;
  }

  if (seen.has(value)) {
    return output;
  }
  seen.add(value);

  if (value.b64_json) {
    collectImageCandidate(`data:image/png;base64,${value.b64_json}`, output);
  }

  if (value.image_url) {
    if (typeof value.image_url === "string") {
      collectImageCandidate(value.image_url, output);
    } else if (value.image_url.url) {
      collectImageCandidate(value.image_url.url, output);
    }
  }

  if (typeof value.url === "string") {
    const typeHint = String(value.type || "");
    if (
      /image/i.test(typeHint) ||
      /\/api\/v1\/files\/.+\/content/i.test(value.url) ||
      /\.(png|jpg|jpeg|webp|gif|bmp)(\?|$)/i.test(value.url)
    ) {
      collectImageCandidate(value.url, output);
    }
  }

  Object.keys(value).forEach((key) => {
    extractImageCandidatesDeep(value[key], output, seen);
  });

  return output;
}

function extractImageCandidatesFromChatResponse(response) {
  return dedupeImageCandidates(extractImageCandidatesDeep(response, []));
}

function extractTextPreviewFromNode(node, fragments = [], seen = new Set()) {
  if (!node) {
    return fragments;
  }

  if (typeof node === "string") {
    const text = node.trim();
    if (text) {
      fragments.push(text);
    }
    return fragments;
  }

  if (Array.isArray(node)) {
    node.forEach((item) => extractTextPreviewFromNode(item, fragments, seen));
    return fragments;
  }

  if (typeof node !== "object") {
    return fragments;
  }

  if (seen.has(node)) {
    return fragments;
  }
  seen.add(node);

  if (typeof node.delta === "string" && node.delta.trim()) {
    fragments.push(node.delta.trim());
  }

  if (typeof node.text === "string" && node.text.trim()) {
    fragments.push(node.text.trim());
  }

  if (typeof node.content === "string" && node.content.trim()) {
    fragments.push(node.content.trim());
  }

  if (node.message) {
    extractTextPreviewFromNode(node.message, fragments, seen);
  }

  if (node.choices) {
    extractTextPreviewFromNode(node.choices, fragments, seen);
  }

  if (node.output) {
    extractTextPreviewFromNode(node.output, fragments, seen);
  }

  if (node.response) {
    extractTextPreviewFromNode(node.response, fragments, seen);
  }

  if (node.item) {
    extractTextPreviewFromNode(node.item, fragments, seen);
  }

  if (node.part) {
    extractTextPreviewFromNode(node.part, fragments, seen);
  }

  return fragments;
}

function createStreamState() {
  return {
    buffer: "",
    eventCount: 0,
    done: false,
    rawPreview: [],
    textPreview: [],
    accumulatedText: "",
    imageCandidates: [],
    finalResponse: null
  };
}

function appendPreview(list, value, limit = 8) {
  const text = String(value || "").trim();
  if (!text) {
    return;
  }

  if (list.length >= limit) {
    return;
  }

  list.push(text.slice(0, 1200));
}

function extractStreamTextFragments(parsed) {
  const fragments = [];

  const append = (value) => {
    if (typeof value === "string" && value) {
      fragments.push(value);
    }
  };

  const appendContent = (content) => {
    if (typeof content === "string") {
      append(content);
      return;
    }

    if (Array.isArray(content)) {
      content.forEach((part) => {
        if (!part) {
          return;
        }

        if (typeof part === "string") {
          append(part);
          return;
        }

        if (typeof part.text === "string") {
          append(part.text);
        }

        if (typeof part.content === "string") {
          append(part.content);
        }
      });
    }
  };

  const choices = Array.isArray(parsed && parsed.choices) ? parsed.choices : [];
  choices.forEach((choice) => {
    if (!choice) {
      return;
    }

    appendContent(choice.delta && choice.delta.content);
    appendContent(choice.message && choice.message.content);
    appendContent(choice.text);
  });

  appendContent(parsed && parsed.delta && parsed.delta.content);
  appendContent(parsed && parsed.message && parsed.message.content);
  appendContent(parsed && parsed.content);

  return fragments;
}

function processStreamEventData(dataText, state) {
  const trimmed = String(dataText || "").trim();
  if (!trimmed) {
    return;
  }

  if (trimmed === "[DONE]") {
    state.done = true;
    return;
  }

  appendPreview(state.rawPreview, trimmed);

  const parsed = parseJsonSafe(trimmed);
  if (!parsed) {
    extractImagesFromText(trimmed).forEach((item) => state.imageCandidates.push(item));
    appendPreview(state.textPreview, trimmed);
    return;
  }

  state.eventCount += 1;

  extractImageCandidatesFromChatResponse(parsed).forEach((item) => {
    state.imageCandidates.push(item);
  });

  extractStreamTextFragments(parsed).forEach((item) => {
    state.accumulatedText += item;
  });

  extractTextPreviewFromNode(parsed).forEach((item) => {
    appendPreview(state.textPreview, item);
  });

  if (parsed.response && typeof parsed.response === "object") {
    state.finalResponse = parsed.response;
  } else if (parsed.choices || parsed.output || parsed.data) {
    state.finalResponse = parsed;
  }
}

function processSseText(chunk, state) {
  state.buffer += String(chunk || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  let boundaryIndex = state.buffer.indexOf("\n\n");
  while (boundaryIndex >= 0) {
    const rawEvent = state.buffer.slice(0, boundaryIndex);
    state.buffer = state.buffer.slice(boundaryIndex + 2);

    const dataLines = [];
    rawEvent.split("\n").forEach((line) => {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    });

    if (dataLines.length) {
      processStreamEventData(dataLines.join("\n"), state);
    }

    boundaryIndex = state.buffer.indexOf("\n\n");
  }
}

function finalizeSseState(state) {
  const trailing = state.buffer.trim();
  if (!trailing) {
    return;
  }

  const dataLines = [];
  trailing.split("\n").forEach((line) => {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  });

  if (dataLines.length) {
    processStreamEventData(dataLines.join("\n"), state);
  } else {
    processStreamEventData(trailing, state);
  }

  state.buffer = "";
}

function buildNoImageError(state, fallbackResponseText) {
  const textPreview = state.textPreview.join("\n").slice(0, 800);
  const rawPreview = state.rawPreview.join("\n---\n").slice(0, 1600);
  const rawText = String(fallbackResponseText || "").trim().slice(0, 800);
  const mergedPreview = String(state.accumulatedText || "").trim().slice(0, 1200);

  const lines = ["OpenWeb 聊天流已返回，但没有解析到图片结果。"];

  if (mergedPreview) {
    lines.push(`合并文本：${mergedPreview}`);
  }

  if (textPreview) {
    lines.push(`文本片段：${textPreview}`);
  }

  if (rawPreview) {
    lines.push(`流片段：${rawPreview}`);
  } else if (rawText) {
    lines.push(`响应片段：${rawText}`);
  }

  return new Error(lines.join("\n"));
}

function createLocalChatId() {
  return `local:ps-openweb-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function generateImageStream(config, payload, options = {}) {
  const referenceImages = Array.isArray(payload.referenceImages) ? payload.referenceImages : [];
  const preparedReferences = await prepareReferenceAttachments(referenceImages);
  const state = createStreamState();

  const userContent =
    preparedReferences.contentParts.length > 0
      ? [{ type: "text", text: payload.prompt }, ...preparedReferences.contentParts]
      : payload.prompt;

  const requestPayload = {
    chat_id: createLocalChatId(),
    model: payload.model,
    stream: true,
    messages: [
      {
        role: "user",
        content: userContent
      }
    ]
  };

  const response = await requestWithXhrStream(`${ensureHttpUrl(config.baseUrl)}/api/chat/completions`, {
    method: "POST",
    headers: buildHeaders(config.apiKey, {
      "Content-Type": "application/json"
    }),
    body: JSON.stringify(requestPayload),
    timeout: 300000,
    onChunk: (chunk) => processSseText(chunk, state),
    cancelToken: options.cancelToken
  });

  finalizeSseState(state);

  if (!response.ok) {
    const parsed = parseJsonSafe(response.responseText || "");
    throw new Error(getErrorDetail(parsed, response.responseText, response.statusText));
  }

  const contentType = String(response.headers["content-type"] || "").toLowerCase();
  let candidates = dedupeImageCandidates([
    ...state.imageCandidates,
    ...extractImagesFromText(state.accumulatedText)
  ]);

  if (!candidates.length && contentType.includes("application/json")) {
    const parsed = parseJsonSafe(response.responseText || "");
    if (parsed) {
      candidates = extractImageCandidatesFromChatResponse(parsed);
      if (!state.finalResponse) {
        state.finalResponse = parsed;
      }
      extractTextPreviewFromNode(parsed).forEach((item) => appendPreview(state.textPreview, item));
    }
  }

  if (!candidates.length && state.finalResponse) {
    candidates = extractImageCandidatesFromChatResponse(state.finalResponse);
  }

  if (!candidates.length) {
    throw buildNoImageError(state, response.responseText);
  }

  return {
    images: candidates.map((url) => ({ url })),
    warnings: preparedReferences.warnings,
    transport: contentType.includes("text/event-stream") || state.eventCount ? "stream" : "json",
    rawPreview: state.rawPreview,
    textPreview: state.textPreview
  };
}

async function generateImage(config, payload, options = {}) {
  let imagesApiError = null;

  try {
    return await generateImageViaImagesApi(config, payload, options);
  } catch (error) {
    if (isCanceledError(error)) {
      throw error;
    }
    imagesApiError = error;
  }

  try {
    const result = await generateImageStream(config, payload, options);
    return {
      ...result,
      transport: result.transport ? `chat-fallback:${result.transport}` : "chat-fallback",
      warnings: [
        `OpenWeb images API failed (${extractErrorMessage(
          imagesApiError
        )}); used chat-completions fallback.`,
        ...((result && result.warnings) || [])
      ]
    };
  } catch (chatError) {
    if (isCanceledError(chatError)) {
      throw chatError;
    }

    throw new Error(
      [
        `OpenWeb images API failed: ${extractErrorMessage(imagesApiError)}`,
        `OpenWeb chat fallback failed: ${extractErrorMessage(chatError)}`
      ].join("\n")
    );
  }
}

function decodeArrayBufferText(buffer) {
  if (!buffer) {
    return "";
  }

  try {
    if (typeof TextDecoder !== "undefined") {
      return new TextDecoder("utf-8").decode(
        buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
      );
    }
  } catch (error) {
    // Fall through.
  }

  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let text = "";
  const maxLength = Math.min(bytes.length, 4096);
  for (let index = 0; index < maxLength; index += 1) {
    text += String.fromCharCode(bytes[index]);
  }
  return text;
}

function summarizeNonImageResponse(buffer, contentType) {
  const text = decodeArrayBufferText(buffer).trim();
  const parsed = parseJsonSafe(text);

  if (parsed) {
    return JSON.stringify(parsed).slice(0, 500);
  }

  if (text) {
    return text.slice(0, 500);
  }

  return `content-type=${contentType || "unknown"}`;
}

function isImageContentType(contentType) {
  return /^image\//i.test(String(contentType || "").trim());
}

function shouldSendAuthHeader(baseUrl, imageUrl) {
  const value = String(imageUrl || "");

  if (!/^https?:\/\//i.test(value)) {
    return true;
  }

  return getOrigin(value) === getOrigin(ensureHttpUrl(baseUrl));
}

function normalizeImageUrlValue(imageUrl) {
  return String(imageUrl || "")
    .trim()
    .replace(/[\r\n\t]+/g, "")
    .replace(/^["'`<(\[]+/, "")
    .replace(/[>"'`)\],]+$/, "")
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u002f/gi, "/")
    .replace(/&amp;/gi, "&");
}

function sniffImageMimeType(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || new ArrayBuffer(0));

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return "image/gif";
  }

  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return "image/bmp";
  }

  return "";
}

async function downloadImage(config, imageUrl, options = {}) {
  if (options.cancelToken && options.cancelToken.cancelled) {
    throw createCanceledError(options.cancelToken.reason);
  }

  if (/^data:image\//i.test(imageUrl)) {
    const decoded = dataUrlToArrayBuffer(imageUrl);
    return {
      buffer: decoded.buffer,
      mimeType: decoded.mimeType,
      url: imageUrl
    };
  }

  const absoluteUrl = toAbsoluteUrl(config.baseUrl, normalizeImageUrlValue(imageUrl));
  const headers = shouldSendAuthHeader(config.baseUrl, absoluteUrl)
    ? buildHeaders(config.apiKey, { Accept: "image/*,*/*" })
    : { Accept: "image/*,*/*" };

  const response = await requestWithXhr(absoluteUrl, {
    method: "GET",
    headers,
    responseType: "arraybuffer",
    timeout: 60000,
    cancelToken: options.cancelToken
  });

  if (!response.ok) {
    throw new Error(
      response.responseText ||
        `下载结果图片失败：${response.status}\n地址：${absoluteUrl}\n鉴权：${
          shouldSendAuthHeader(config.baseUrl, absoluteUrl) ? "OpenWeb Bearer" : "无"
        }`
    );
  }

  const contentType = response.headers["content-type"] || "application/octet-stream";
  const sniffedMimeType = sniffImageMimeType(response.response);
  if (!isImageContentType(contentType) && !sniffedMimeType) {
    const preview = summarizeNonImageResponse(response.response, contentType);
    throw new Error(
      `生成结果地址已返回，但下载到的不是图片。\n地址：${absoluteUrl}\n类型：${contentType}\n内容片段：${preview}`
    );
  }

  return {
    buffer: response.response,
    mimeType: isImageContentType(contentType) ? contentType : sniffedMimeType,
    url: absoluteUrl
  };
}

module.exports = {
  createCanceledError,
  downloadImage,
  generateImage,
  isCanceledError,
  loadUserModels,
  runNetworkDiagnostics,
  testConnection
};
