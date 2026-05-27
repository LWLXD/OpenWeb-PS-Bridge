# PS OpenWeb Bridge

<div align="center">

[![中文](https://img.shields.io/badge/README-%E4%B8%AD%E6%96%87-2ea44f?style=for-the-badge)](#中文)
[![English](https://img.shields.io/badge/README-English-0969da?style=for-the-badge)](#english)

</div>

## 中文

PS OpenWeb Bridge 是一个面向 Adobe Photoshop 的 UXP 面板插件，用于把 Photoshop 选区和参考图发送到 OpenWeb / Open WebUI，并把生成结果自动回贴到当前选区。

> 兼容声明：本插件仅支持最新版 OpenWeb / Open WebUI。使用前请先将 OpenWeb 更新到最新版本。  
> OpenWeb / Open WebUI 项目地址：[open-webui/open-webui](https://github.com/open-webui/open-webui)

### 当前能力

- 手动填写 OpenWeb 地址和普通用户 API Key。
- 从 OpenWeb 读取当前账号可见模型，并优先显示看起来适合生图的模型。
- 优先使用新版 OpenWeb 图片接口：
  - `/api/v1/images/generations`
  - `/api/v1/images/edit`
- 保留 `/api/chat/completions` 聊天接口兜底兼容。
- 将当前 Photoshop 选区导出为参考图。
- 支持添加本地参考图。
- 下载 OpenWeb 返回的生成图，并自动放回原选区位置。
- 支持三种回贴策略：填满、严格拉伸、保持比例。
- 可基于原选区创建图层蒙版。
- 支持羽化像素设置。
- 支持将 API Key 保存到 UXP Secure Storage。
- 调试文件会写入插件数据目录，便于排查选区图和结果图。

### 兼容目标

- Windows 10 / 11。
- Photoshop 2021 到 Photoshop 2026。
- Photoshop UXP API 版本不低于 `22.5`。
- 仅支持最新版 OpenWeb / Open WebUI。

### OpenWeb 前置要求

1. 部署并更新到最新版 OpenWeb / Open WebUI。
2. 启用 API Key 功能。
3. 让插件使用者登录自己的 OpenWeb 账号。
4. 在个人设置中生成普通用户 API Key。
5. 确保该用户在 OpenWeb 中有图片生成功能权限。
6. 确保 OpenWeb 后台已经正确配置图片生成或图片编辑引擎。
7. 确保运行 Photoshop 的电脑可以访问 OpenWeb 地址。

### 安装方式

开发加载：

1. 安装 Adobe UXP Developer Tool。
2. 打开 UXP Developer Tool。
3. 选择 `Add Plugin`。
4. 指向当前项目目录。
5. 在 Photoshop 中打开 `Plugins > PS OpenWeb Bridge > OpenWeb Image`。

分发安装：

- 使用 `dist/PS-OpenWeb-Bridge-1.0.2.ccx` 安装。
- 或使用 `dist/PS-OpenWeb-Bridge-1.0.2.zip` 分发源码包。

### 打包

```powershell
.\scripts\build-zip.ps1
.\scripts\build-ccx.ps1
```

打包结果会输出到 `dist/`。

### 使用流程

1. 在 Photoshop 中打开一个文档。
2. 创建有效选区。
3. 在插件面板中填写 OpenWeb 地址和 API Key。
4. 点击测试连接或刷新模型。
5. 选择模型。
6. 输入 Prompt。
7. 按需启用当前选区参考图，或添加额外参考图。
8. 点击生成按钮。
9. 插件会自动导出选区、请求 OpenWeb、下载生成图，并回贴到选区位置。

### 已知说明

- 带参考图时，插件会优先使用 OpenWeb 的图片编辑接口；具体编辑模型取决于 OpenWeb 后台配置。
- 纯文本生图会优先使用 OpenWeb 的图片生成接口。
- 如果新版图片接口不可用，插件会尝试聊天接口兜底。
- 结果是否能生成，仍取决于 OpenWeb 当前账号权限、模型能力和后端图片引擎配置。

## English

PS OpenWeb Bridge is an Adobe Photoshop UXP panel plugin that sends the current Photoshop selection and optional reference images to OpenWeb / Open WebUI, then places the generated image back into the original selection.

> Compatibility notice: this plugin supports only the latest OpenWeb / Open WebUI release. Please update OpenWeb before using it.  
> OpenWeb / Open WebUI project: [open-webui/open-webui](https://github.com/open-webui/open-webui)

### Features

- Manually configure the OpenWeb URL and a normal user API key.
- Load models visible to the current OpenWeb account, prioritizing likely image-capable models.
- Prefer the latest OpenWeb image endpoints:
  - `/api/v1/images/generations`
  - `/api/v1/images/edit`
- Keep `/api/chat/completions` as a compatibility fallback.
- Export the active Photoshop selection as a reference image.
- Add local reference images.
- Download the generated image from OpenWeb and place it back into the original selection.
- Support three placement modes: cover, stretch, and contain.
- Optionally create a layer mask from the original selection.
- Support feathering settings.
- Store the API key in UXP Secure Storage.
- Save debug files in the plugin data directory for easier troubleshooting.

### Compatibility

- Windows 10 / 11.
- Photoshop 2021 through Photoshop 2026.
- Photoshop UXP API version `22.5` or newer.
- Latest OpenWeb / Open WebUI only.

### OpenWeb Requirements

1. Deploy and update to the latest OpenWeb / Open WebUI release.
2. Enable API key support.
3. Ask each plugin user to log in with their own OpenWeb account.
4. Generate a normal user API key from personal settings.
5. Make sure the user has permission to use image generation.
6. Make sure the OpenWeb image generation or image editing backend is configured correctly.
7. Make sure the Photoshop machine can reach the OpenWeb URL.

### Installation

Development loading:

1. Install Adobe UXP Developer Tool.
2. Open UXP Developer Tool.
3. Select `Add Plugin`.
4. Point it to this project directory.
5. In Photoshop, open `Plugins > PS OpenWeb Bridge > OpenWeb Image`.

Distribution:

- Install with `dist/PS-OpenWeb-Bridge-1.0.2.ccx`.
- Or distribute `dist/PS-OpenWeb-Bridge-1.0.2.zip` as the source package.

### Build

```powershell
.\scripts\build-zip.ps1
.\scripts\build-ccx.ps1
```

Build artifacts are written to `dist/`.

### Usage

1. Open a document in Photoshop.
2. Create a valid selection.
3. Enter the OpenWeb URL and API key in the plugin panel.
4. Test the connection or refresh the model list.
5. Select a model.
6. Enter a prompt.
7. Enable the current selection as a reference image, or add extra reference images if needed.
8. Click the generate button.
9. The plugin exports the selection, calls OpenWeb, downloads the result, and places it back into the selected area.

### Notes

- With reference images, the plugin prefers OpenWeb's image edit endpoint; the actual edit model depends on the OpenWeb backend configuration.
- Prompt-only generation prefers OpenWeb's image generation endpoint.
- If the latest image API is unavailable, the plugin attempts the chat-completions fallback.
- Successful generation still depends on OpenWeb user permissions, model capability, and image backend configuration.
