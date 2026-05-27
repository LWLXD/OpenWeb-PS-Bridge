const { entrypoints } = require("uxp");
const { AppController } = require("./src/app-controller");

let controller = null;

function reportBootstrapError(error) {
  const message = error && error.message ? error.message : String(error || "未知错误");
  const statusNode = document.querySelector("#status");
  const connectionStatusNode = document.querySelector("#connection-status");

  if (statusNode) {
    statusNode.textContent = `插件初始化失败：${message}`;
    statusNode.className = "status status-error";
  }

  if (connectionStatusNode) {
    connectionStatusNode.textContent = `初始化失败：${message}`;
    connectionStatusNode.className = "mini-status error";
  }

  try {
    console.error(error);
  } catch (logError) {
    // Ignore console issues in older runtimes.
  }
}

entrypoints.setup({
  plugin: {
    create() {},
    destroy() {
      if (controller) {
        controller.destroy();
        controller = null;
      }
    }
  },
  panels: {
    "ps-openweb-panel": {
      async create() {
        try {
          controller = new AppController(document);
          await controller.initialize();
        } catch (error) {
          reportBootstrapError(error);
        }
      },
      async show() {
        try {
          if (!controller) {
            controller = new AppController(document);
            await controller.initialize();
          }
          await controller.onShow();
        } catch (error) {
          reportBootstrapError(error);
        }
      },
      hide() {},
      destroy() {
        if (controller) {
          controller.destroy();
          controller = null;
        }
      }
    }
  }
});

window.addEventListener("error", (event) => {
  reportBootstrapError(event.error || event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  reportBootstrapError(event.reason || "未处理的 Promise 错误");
});
