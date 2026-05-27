"use strict";

const { storage } = require("uxp");
const { loadSettings, saveSettings } = require("./config-store");
const {
  downloadImage,
  generateImage,
  isCanceledError,
  runNetworkDiagnostics,
  testConnection
} = require("./openweb-client");
const {
  copyFileToDebug,
  createSelectionSnapshot,
  exportSelectionToPng,
  getDebugFolderPath,
  getSelectionInfo,
  placeGeneratedImage,
  readFileAsDataUrl,
  writeBinaryToDebugFile
} = require("./photoshop-workflow");
const {
  arrayBufferToDataUrl,
  clampNumber,
  extractErrorMessage,
  normalizeUrl,
  sanitizeSingleLineText,
  sanitizeFileName
} = require("./utils");

const fs = storage.localFileSystem;

class AppController {
  constructor(rootNode) {
    this.root = rootNode;
    this.state = {
      extraReferences: [],
      isBusy: false,
      promptDraft: "",
      busyContext: null,
      activeGenerateCancelToken: null
    };
    this.boundHandlers = [];
  }

  async initialize() {
    this.cacheElements();
    this.bindEvents();
    await this.restoreSettings();
    this.renderReferenceList();
    this.updateCancelGenerateButton();
  }

  async onShow() {
    if (!this.modelSelect.value) {
      await this.refreshModels({ silent: true });
    }
  }

  destroy() {
    this.boundHandlers.forEach(({ element, eventName, handler }) => {
      element.removeEventListener(eventName, handler);
    });
    this.boundHandlers = [];
  }

  cacheElements() {
    this.serverUrlInput = this.root.querySelector("#server-url");
    this.apiKeyInput = this.root.querySelector("#api-key");
    this.modelSelect = this.root.querySelector("#model-select");
    this.promptInput = this.root.querySelector("#prompt");
    this.useSelectionRefInput = this.root.querySelector("#use-selection-ref");
    this.applySelectionMaskInput = this.root.querySelector("#apply-selection-mask");
    this.saveApiKeyInput = this.root.querySelector("#save-api-key");
    this.placementModeInput = this.root.querySelector("#placement-mode");
    this.featherInput = this.root.querySelector("#feather-px");
    this.generateButton = this.root.querySelector("#generate");
    this.testConnectionButton = this.root.querySelector("#test-connection");
    this.networkDiagnosticsButton = this.root.querySelector("#run-diagnostics");
    this.refreshModelsButton = this.root.querySelector("#refresh-models");
    this.pickRefsButton = this.root.querySelector("#pick-refs");
    this.clearRefsButton = this.root.querySelector("#clear-refs");
    this.dropZone = this.root.querySelector("#drop-zone");
    this.referenceList = this.root.querySelector("#ref-list");
    this.statusNode = this.root.querySelector("#status");
    this.cancelGenerateButton = this.root.querySelector("#cancel-generate");
    this.connectionStatusNode = this.root.querySelector("#connection-status");
    this.connectionDiagnosticsNode = this.root.querySelector("#connection-diagnostics");
    this.sectionToggles = Array.from(this.root.querySelectorAll(".section-toggle"));
  }

  bind(element, eventName, handler) {
    if (!element) {
      return;
    }

    element.addEventListener(eventName, handler);
    this.boundHandlers.push({ element, eventName, handler });
  }

  bindEvents() {
    this.bind(this.testConnectionButton, "click", () => this.handleTestConnection());
    this.bind(this.networkDiagnosticsButton, "click", () => this.handleNetworkDiagnostics());
    this.bind(this.refreshModelsButton, "click", () => this.refreshModels());
    this.bind(this.pickRefsButton, "click", () => this.pickReferenceFiles());
    this.bind(this.cancelGenerateButton, "click", () => this.handleCancelGenerate());
    this.bind(this.clearRefsButton, "click", () => {
      this.state.extraReferences = [];
      this.renderReferenceList();
      this.setStatus("已清空附加参考图。", "info");
    });
    this.bind(this.generateButton, "click", () => this.handleGenerate());

    this.sectionToggles.forEach((button) => {
      this.bind(button, "click", () => this.toggleSection(button.dataset.target));
    });

    ["input", "change", "blur"].forEach((eventName) => {
      [
        this.serverUrlInput,
        this.apiKeyInput,
        this.modelSelect,
        this.useSelectionRefInput,
        this.applySelectionMaskInput,
        this.saveApiKeyInput,
        this.placementModeInput,
        this.featherInput
      ].forEach((element) => {
        this.bind(element, eventName, () => this.persistSettings());
      });
    });

    ["input", "keyup", "change", "blur"].forEach((eventName) => {
      this.bind(this.promptInput, eventName, (event) => this.handlePromptChange(event));
    });

    [this.serverUrlInput, this.apiKeyInput, this.promptInput, this.featherInput].forEach((element) => {
      this.bind(element, "keydown", (event) => this.handleGenerateShortcut(event));
    });

    this.bind(this.dropZone, "dragover", (event) => {
      event.preventDefault();
      this.dropZone.classList.add("drag-over");
    });

    this.bind(this.dropZone, "dragleave", () => {
      this.dropZone.classList.remove("drag-over");
    });

    this.bind(this.dropZone, "drop", async (event) => {
      event.preventDefault();
      this.dropZone.classList.remove("drag-over");

      try {
        const files = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
        if (!files.length) {
          this.setStatus("当前 Photoshop 版本没有把拖拽文件交给插件，请改用“选择图片”。", "error");
          return;
        }

        await this.addHtmlFilesAsReferences(files);
      } catch (error) {
        this.setStatus(extractErrorMessage(error), "error");
      }
    });
  }

  handlePromptChange(event) {
    const nextValue = String(
      this.readEventValue(event) || this.readElementValue(this.promptInput) || ""
    );

    this.state.promptDraft = nextValue;

    if (this.promptInput && typeof this.promptInput.setAttribute === "function") {
      this.promptInput.setAttribute("data-draft", nextValue);
    }

    this.persistSettings();
  }

  handleGenerateShortcut(event) {
    if (!event || event.defaultPrevented || event.isComposing) {
      return;
    }

    if (event.key !== "Enter" || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const target = event.target;
    const tagName = String((target && target.tagName) || "").toLowerCase();
    const inputType = String((target && target.type) || "").toLowerCase();
    const isPrompt = target === this.promptInput || tagName === "textarea";

    if (isPrompt && event.shiftKey) {
      return;
    }

    if (!["input", "textarea", "sp-textfield"].includes(tagName)) {
      return;
    }

    if (inputType === "checkbox" || inputType === "button") {
      return;
    }

    event.preventDefault();
    this.handleGenerate();
  }

  createGenerateCancelToken() {
    let cancelled = false;
    let reason = "已取消生图。";
    const listeners = new Set();

    return {
      get cancelled() {
        return cancelled;
      },
      get reason() {
        return reason;
      },
      subscribe(listener) {
        if (typeof listener !== "function") {
          return () => {};
        }

        if (cancelled) {
          listener(reason);
          return () => {};
        }

        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      cancel(nextReason) {
        if (cancelled) {
          return;
        }

        cancelled = true;
        reason = String(nextReason || reason);
        listeners.forEach((listener) => {
          try {
            listener(reason);
          } catch (error) {
            // Ignore cancel listener issues.
          }
        });
        listeners.clear();
      }
    };
  }

  throwIfGenerateCancelled(cancelToken) {
    if (!cancelToken || !cancelToken.cancelled) {
      return;
    }

    const error = new Error(cancelToken.reason || "已取消生图。");
    error.code = "ABORT_ERR";
    error.isCanceled = true;
    throw error;
  }

  handleCancelGenerate() {
    const cancelToken = this.state.activeGenerateCancelToken;
    if (!cancelToken || cancelToken.cancelled) {
      return;
    }

    cancelToken.cancel("已取消生图。");
    this.setStatus("正在取消生图...", "working");
    this.updateCancelGenerateButton();
  }

  readEventValue(event) {
    const target = event && event.target;
    if (!target) {
      return "";
    }

    if (typeof target.value === "string" && target.value.length > 0) {
      return target.value;
    }

    if (typeof target.getAttribute === "function") {
      const attrValue = target.getAttribute("value");
      if (typeof attrValue === "string" && attrValue.length > 0) {
        return attrValue;
      }

      const draftValue = target.getAttribute("data-draft");
      if (typeof draftValue === "string" && draftValue.length > 0) {
        return draftValue;
      }
    }

    if (typeof target.innerText === "string" && target.innerText.length > 0) {
      return target.innerText;
    }

    if (typeof target.textContent === "string" && target.textContent.length > 0) {
      return target.textContent;
    }

    return "";
  }

  readElementValue(element) {
    if (!element) {
      return "";
    }

    if (typeof element.value === "string" && element.value.length > 0) {
      return element.value;
    }

    if (typeof element.getAttribute === "function") {
      const attrValue = element.getAttribute("value");
      if (typeof attrValue === "string" && attrValue.length > 0) {
        return attrValue;
      }

      const draftValue = element.getAttribute("data-draft");
      if (typeof draftValue === "string" && draftValue.length > 0) {
        return draftValue;
      }
    }

    if (typeof element.innerText === "string" && element.innerText.length > 0) {
      return element.innerText;
    }

    if (typeof element.textContent === "string" && element.textContent.length > 0) {
      return element.textContent;
    }

    if (typeof element.value === "string") {
      return element.value;
    }

    return "";
  }

  setElementValue(element, value) {
    if (!element) {
      return;
    }

    if ("value" in element) {
      element.value = value;
    }

    if (typeof element.setAttribute === "function") {
      element.setAttribute("value", value);
      element.setAttribute("data-draft", value);
    }

    if (element.tagName && String(element.tagName).toLowerCase() === "textarea") {
      element.textContent = value;
    }
  }

  readPromptValue() {
    const currentValue = String(this.readElementValue(this.promptInput) || "").trim();
    const draftValue = String(this.state.promptDraft || "").trim();
    return currentValue || draftValue;
  }

  readApiKeyValue() {
    const element = this.apiKeyInput;
    if (!element) {
      return "";
    }

    if (typeof element.value === "string" && element.value.length > 0) {
      return sanitizeSingleLineText(element.value).replace(/\s+/g, "");
    }

    if (typeof element.getAttribute === "function") {
      const attrValue = element.getAttribute("value");
      if (typeof attrValue === "string" && attrValue.length > 0) {
        return sanitizeSingleLineText(attrValue).replace(/\s+/g, "");
      }

      const draftValue = element.getAttribute("data-draft");
      if (typeof draftValue === "string" && draftValue.length > 0) {
        return sanitizeSingleLineText(draftValue).replace(/\s+/g, "");
      }
    }

    return "";
  }

  async restoreSettings() {
    const settings = await loadSettings();

    this.setElementValue(this.serverUrlInput, settings.baseUrl || "http://10.10.20.235:3000/");
    this.setElementValue(this.apiKeyInput, settings.apiKey || "");
    this.setElementValue(this.promptInput, settings.prompt || "");
    this.state.promptDraft = settings.prompt || "";

    this.useSelectionRefInput.checked = settings.useSelectionRef;
    this.applySelectionMaskInput.checked = settings.applySelectionMask;
    if (this.saveApiKeyInput) {
      this.saveApiKeyInput.checked = true;
    }
    this.setElementValue(this.placementModeInput, settings.placementMode || "cover");
    this.setElementValue(this.featherInput, String(settings.featherPx || 0));

    this.restoreCollapsedState();
    await this.refreshModels({ selectedModel: settings.model, silent: true });
  }

  async persistSettings() {
    await saveSettings(this.collectSettings());
  }

  collectSettings() {
    const saveApiKey = this.saveApiKeyInput ? this.saveApiKeyInput.checked : true;

    return {
      baseUrl: normalizeUrl(this.readElementValue(this.serverUrlInput)),
      apiKey: this.readApiKeyValue(),
      model: this.modelSelect.value,
      prompt: this.readPromptValue(),
      useSelectionRef: this.useSelectionRefInput.checked,
      applySelectionMask: this.applySelectionMaskInput.checked,
      saveApiKey,
      placementMode: this.placementModeInput.value,
      featherPx: clampNumber(this.readElementValue(this.featherInput), 0, 1000, 0)
    };
  }

  updateCancelGenerateButton() {
    if (!this.cancelGenerateButton) {
      return;
    }

    const cancelToken = this.state.activeGenerateCancelToken;
    this.cancelGenerateButton.disabled = !(
      this.state.isBusy &&
      this.state.busyContext === "generate" &&
      cancelToken &&
      !cancelToken.cancelled
    );
  }

  setBusy(isBusy, context = null) {
    this.state.isBusy = isBusy;
    this.state.busyContext = isBusy ? context : null;

    [
      this.generateButton,
      this.testConnectionButton,
      this.networkDiagnosticsButton,
      this.refreshModelsButton,
      this.pickRefsButton,
      this.clearRefsButton,
      this.modelSelect
    ].forEach((element) => {
      if (element) {
        element.disabled = Boolean(isBusy);
      }
    });

    this.updateCancelGenerateButton();
  }

  setStatus(message, type = "info") {
    if (!this.statusNode) {
      return;
    }

    this.statusNode.textContent = message;
    this.statusNode.className = `status status-${type}`;
  }

  setConnectionStatus(message, type = "info") {
    if (!this.connectionStatusNode) {
      return;
    }

    this.connectionStatusNode.textContent = message;
    this.connectionStatusNode.className = type === "info" ? "mini-status" : `mini-status ${type}`;
  }

  setDiagnosticsStatus(message, type = "info") {
    if (!this.connectionDiagnosticsNode) {
      return;
    }

    this.connectionDiagnosticsNode.hidden = false;
    this.connectionDiagnosticsNode.textContent = message;
    this.connectionDiagnosticsNode.className =
      type === "info"
        ? "mini-status diagnostic-status"
        : `mini-status diagnostic-status ${type}`;
  }

  getDiagnosticsType(report) {
    if (!report || !Array.isArray(report.steps) || !report.steps.length) {
      return "info";
    }

    const hasTransportFailure = report.steps.some((step) => !step.reachable);
    const hasAuthFailure = report.steps.some((step) => step.status === 401 || step.status === 403);
    const hasServerFailure = report.steps.some((step) => step.status >= 500);

    if (hasTransportFailure || hasAuthFailure || hasServerFailure) {
      return "error";
    }

    return "success";
  }

  buildDiagnosticsMessage(report) {
    const lines = [`网络自检：${report.baseUrl}`];

    report.steps.forEach((step, index) => {
      const icon = step.reachable ? "✓" : "×";
      const duration = step.durationMs ? ` (${step.durationMs}ms)` : "";
      lines.push(`${index + 1}. ${icon} ${step.label} -> ${step.detail}${duration}`);
    });

    if (report.summary) {
      lines.push("");
      lines.push(`结论：${report.summary}`);
    }

    return lines.join("\n");
  }

  buildConnectionMessages(result) {
    const totalModels = Array.isArray(result.allModels)
      ? result.allModels.length
      : result.models.length;
    const lines = [
      `连接成功，当前账号可见 ${totalModels} 个模型。`,
      `已在插件中加载 ${result.models.length} 个候选模型。`
    ];

    if (result.models.length !== totalModels) {
      lines.push("插件当前优先显示名称上看起来像生图模型的候选项。");
    }

    if (Array.isArray(result.warnings) && result.warnings.length) {
      lines.push(...result.warnings);
    }

    return lines;
  }

  populateModels(models, preferredValue) {
    this.modelSelect.innerHTML = "";

    if (!models.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "没有可用模型";
      this.modelSelect.appendChild(option);
      return;
    }

    models.forEach((model) => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.name || model.id;
      this.modelSelect.appendChild(option);
    });

    const preferred = models.find((item) => item.id === preferredValue);
    this.modelSelect.value = preferred ? preferred.id : models[0].id;
  }

  async refreshModels(options = {}) {
    const config = this.collectSettings();

    if (!config.baseUrl || !config.apiKey) {
      this.populateModels([], "");
      if (!options.silent) {
        const hint = "请先填写 OpenWeb 地址和普通用户 API Key。";
        this.setConnectionStatus(hint, "error");
        this.setStatus(hint, "error");
      }
      return;
    }

    this.setConnectionStatus("正在读取 OpenWeb 模型列表...", "working");
    if (!options.silent) {
      this.setStatus("正在读取 OpenWeb 模型列表...", "working");
    }

    try {
      const result = await testConnection(config);
      this.populateModels(result.models, options.selectedModel || this.modelSelect.value);

      const message = this.buildConnectionMessages(result).join("\n");
      this.setConnectionStatus(message, "success");
      if (!options.silent) {
        this.setStatus(message, "success");
      }
    } catch (error) {
      const message = extractErrorMessage(error);
      this.populateModels([], "");
      this.setConnectionStatus(`连接失败：${message}`, "error");
      if (!options.silent) {
        this.setStatus(`连接失败：${message}`, "error");
      }
    }
  }

  async handleTestConnection() {
    this.setBusy(true, "test");
    this.testConnectionButton.textContent = "测试中...";
    this.setConnectionStatus("正在测试 OpenWeb 连接...", "working");
    this.setStatus("正在测试 OpenWeb 连接...", "working");

    try {
      const result = await testConnection(this.collectSettings());
      this.populateModels(result.models, this.modelSelect.value);
      await this.persistSettings();

      const message = this.buildConnectionMessages(result).join("\n");
      this.setConnectionStatus(message, "success");
      this.setStatus(message, "success");
    } catch (error) {
      const message = extractErrorMessage(error);
      this.setConnectionStatus(`连接失败：${message}`, "error");
      this.setStatus(`连接失败：${message}`, "error");
    } finally {
      this.testConnectionButton.textContent = "测试连接";
      this.setBusy(false);
    }
  }

  async handleNetworkDiagnostics() {
    this.setBusy(true, "diagnostic");

    if (this.networkDiagnosticsButton) {
      this.networkDiagnosticsButton.textContent = "自检中...";
    }

    this.setDiagnosticsStatus("正在执行网络自检...", "working");
    this.setStatus("正在执行网络自检...", "working");

    try {
      const report = await runNetworkDiagnostics(this.collectSettings());
      const message = this.buildDiagnosticsMessage(report);
      const type = this.getDiagnosticsType(report);

      this.setDiagnosticsStatus(message, type);
      this.setStatus(message, type);
    } catch (error) {
      const message = `网络自检失败：${extractErrorMessage(error)}`;
      this.setDiagnosticsStatus(message, "error");
      this.setStatus(message, "error");
    } finally {
      if (this.networkDiagnosticsButton) {
        this.networkDiagnosticsButton.textContent = "网络自检";
      }

      this.setBusy(false);
    }
  }

  async pickReferenceFiles() {
    try {
      const entries = await fs.getFileForOpening({
        allowMultiple: true,
        types: ["png", "jpg", "jpeg", "webp", "bmp"]
      });

      if (!entries) {
        return;
      }

      const files = Array.isArray(entries) ? entries : [entries];
      const prepared = await Promise.all(
        files.map(async (entry) => ({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          name: entry.name,
          mimeType: guessMimeType(entry.name),
          dataUrl: await readFileAsDataUrl(entry, guessMimeType(entry.name))
        }))
      );

      this.state.extraReferences = [...this.state.extraReferences, ...prepared];
      this.renderReferenceList();
      this.setStatus(`已添加 ${prepared.length} 张附加参考图。`, "success");
    } catch (error) {
      this.setStatus(`选择参考图失败：${extractErrorMessage(error)}`, "error");
    }
  }

  async addHtmlFilesAsReferences(files) {
    const prepared = await Promise.all(
      files.map(async (file) => ({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: file.name,
        mimeType: file.type || guessMimeType(file.name),
        dataUrl: arrayBufferToDataUrl(
          await file.arrayBuffer(),
          file.type || guessMimeType(file.name)
        )
      }))
    );

    this.state.extraReferences = [...this.state.extraReferences, ...prepared];
    this.renderReferenceList();
    this.setStatus(`已添加 ${prepared.length} 张附加参考图。`, "success");
  }

  renderReferenceList() {
    this.referenceList.innerHTML = "";

    if (!this.state.extraReferences.length) {
      this.referenceList.classList.add("empty");
      const emptyState = document.createElement("p");
      emptyState.className = "empty-state";
      emptyState.textContent = "当前没有附加参考图";
      this.referenceList.appendChild(emptyState);
      return;
    }

    this.referenceList.classList.remove("empty");
    this.state.extraReferences.forEach((reference) => {
      const chip = document.createElement("div");
      chip.className = "ref-chip";

      const label = document.createElement("span");
      label.textContent = reference.name;

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.textContent = "×";
      removeButton.addEventListener("click", () => {
        this.state.extraReferences = this.state.extraReferences.filter(
          (item) => item.id !== reference.id
        );
        this.renderReferenceList();
      });

      chip.appendChild(label);
      chip.appendChild(removeButton);
      this.referenceList.appendChild(chip);
    });
  }

  describeEntry(entry) {
    return (entry && (entry.nativePath || entry.name)) || "未保存";
  }

  mimeTypeToExtension(mimeType) {
    const value = String(mimeType || "").toLowerCase();
    if (value.includes("jpeg") || value.includes("jpg")) {
      return "jpg";
    }
    if (value.includes("webp")) {
      return "webp";
    }
    if (value.includes("gif")) {
      return "gif";
    }
    if (value.includes("bmp")) {
      return "bmp";
    }
    return "png";
  }

  async handleGenerate() {
    if (this.state.isBusy) {
      return;
    }

    const cancelToken = this.createGenerateCancelToken();
    this.state.activeGenerateCancelToken = cancelToken;
    this.setBusy(true, "generate");
    this.setStatus("正在检查 Photoshop 选区...", "working");
    const debugNotes = [];

    try {
      const settings = this.collectSettings();
      settings.prompt = this.readPromptValue();
      this.throwIfGenerateCancelled(cancelToken);
      debugNotes.push(`调试目录：${await getDebugFolderPath()}`);

      if (!settings.prompt) {
        throw new Error("请输入 Prompt。");
      }

      if (!settings.model) {
        throw new Error("请选择一个可用的模型。");
      }

      await this.persistSettings();
      this.throwIfGenerateCancelled(cancelToken);

      const selectionInfo = await getSelectionInfo();
      const selectionSnapshot = await createSelectionSnapshot(selectionInfo);
      const references = [];
      this.throwIfGenerateCancelled(cancelToken);

      if (settings.useSelectionRef) {
        this.setStatus("正在导出当前选区...", "working");
        const selectionExport = await exportSelectionToPng({ selectionSnapshot });
        this.throwIfGenerateCancelled(cancelToken);
        const debugSelectionFile = await copyFileToDebug(
          selectionExport.file,
          `selection-${Date.now()}.png`
        );
        debugNotes.push(`参考图：${this.describeEntry(debugSelectionFile)}`);

        references.push({
          name: selectionExport.file.name || "selection-reference.png",
          mimeType: "image/png",
          dataUrl: await readFileAsDataUrl(selectionExport.file, "image/png")
        });
      }

      references.push(...this.state.extraReferences);

      this.setStatus(
        references.length > 0
          ? "正在通过 OpenWeb 图片接口生成参考图结果..."
          : "正在通过 OpenWeb 图片接口生成图片...",
        "working"
      );

      const result = await generateImage(settings, {
        prompt: settings.prompt,
        model: settings.model,
        referenceImages: references
      }, {
        cancelToken
      });
      this.throwIfGenerateCancelled(cancelToken);

      if (result.transport) {
        debugNotes.push(`结果链路：${result.transport}`);
      }
      if (result.images && result.images[0] && result.images[0].url) {
        debugNotes.push(`结果来源：${String(result.images[0].url).slice(0, 240)}`);
      }

      this.setStatus(
        `正在下载生成结果...\n${String(result.images[0].url || "").slice(0, 240)}`,
        "working"
      );
      const downloaded = await downloadImage(settings, result.images[0].url, { cancelToken });
      this.throwIfGenerateCancelled(cancelToken);
      const debugResultFile = await writeBinaryToDebugFile(
        downloaded.buffer,
        `result-${Date.now()}.${this.mimeTypeToExtension(downloaded.mimeType)}`
      );
      debugNotes.push(`结果图：${this.describeEntry(debugResultFile)}`);

      this.setStatus("正在回贴结果到 Photoshop...", "working");
      this.throwIfGenerateCancelled(cancelToken);
      const placed = await placeGeneratedImage({
        buffer: downloaded.buffer,
        fileName: sanitizeFileName(result.images[0].url.split("/").pop() || "openweb-result.png"),
        selectionSnapshot,
        placementMode: settings.placementMode,
        applySelectionMask: settings.applySelectionMask,
        featherPx: settings.featherPx
      });

      const warningText =
        Array.isArray(result.warnings) && result.warnings.length
          ? `\n提示：${result.warnings.join("；")}`
          : "";
      const debugText = debugNotes.length ? `\n调试文件：\n${debugNotes.join("\n")}` : "";

      this.setStatus(
        `生成完成。\n图层：${placed.layerName}\n尺寸：${selectionInfo.bounds.width} x ${selectionInfo.bounds.height}px${warningText}${debugText}`,
        "success"
      );
    } catch (error) {
      if (isCanceledError(error)) {
        this.setStatus(extractErrorMessage(error) || "已取消生图。", "info");
        return;
      }

      const debugText = debugNotes.length ? `\n${debugNotes.join("\n")}` : "";
      this.setStatus(`执行失败：${extractErrorMessage(error)}${debugText}`, "error");
    } finally {
      this.state.activeGenerateCancelToken = null;
      this.setBusy(false);
    }
  }

  toggleSection(targetId) {
    const body = this.root.querySelector(`#${targetId}`);
    const button = this.root.querySelector(`.section-toggle[data-target="${targetId}"]`);

    if (!body || !button) {
      return;
    }

    const collapsed = body.classList.toggle("collapsed");
    button.classList.toggle("is-collapsed", collapsed);
    localStorage.setItem(`ow.section.${targetId}`, collapsed ? "collapsed" : "expanded");
  }

  restoreCollapsedState() {
    this.sectionToggles.forEach((button) => {
      const targetId = button.dataset.target;
      const body = this.root.querySelector(`#${targetId}`);
      if (!body) {
        return;
      }

      const collapsed = localStorage.getItem(`ow.section.${targetId}`) === "collapsed";
      body.classList.toggle("collapsed", collapsed);
      button.classList.toggle("is-collapsed", collapsed);
    });
  }
}

function guessMimeType(fileName) {
  const lowered = String(fileName || "").toLowerCase();
  if (lowered.endsWith(".jpg") || lowered.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lowered.endsWith(".webp")) {
    return "image/webp";
  }
  if (lowered.endsWith(".bmp")) {
    return "image/bmp";
  }
  return "image/png";
}

module.exports = {
  AppController
};
