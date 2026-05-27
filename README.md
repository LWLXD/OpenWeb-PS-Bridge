# PS OpenWeb Bridge

一个面向 Photoshop 的 UXP 面板插件，用普通 OpenWeb 用户 API Key 调用 OpenWeb 中可见的聊天型生图模型，并把结果自动贴回当前选区。
只支持最新版的OpenWeb

## 当前能力

- 支持手动填写 OpenWeb 地址，默认值为 `http://10.10.20.235:3000/`
- 支持手动输入普通用户 `API Key`
- 支持从 OpenWeb 的 `/api/models` 读取当前账号可见的模型
- 插件会优先显示名称上看起来像生图模型的候选项
- 支持把当前 Photoshop 选区导出为主参考图
- 支持附加参考图
  - 选择本地图片
  - 在较新的 UXP 运行环境里尝试拖图到面板
- 支持把参考图上传到 OpenWeb 文件接口，再通过聊天接口发起生成
- 支持把结果图自动放回原选区位置
- 支持三种贴回策略
  - 填满选区并按选区裁切
  - 严格拉伸到选区大小
  - 保持比例并居中
- 支持根据原选区创建图层蒙版
- 支持设置羽化像素
- 支持把 `API Key` 保存到 UXP Secure Storage

## 兼容目标

- Windows 10 / 11
- Photoshop 2021 到 Photoshop 2026
- 推荐 Photoshop 至少更新到 `22.5` 或更高版本

## 目录结构

- `manifest.json`: UXP 插件清单
- `index.html`: 面板 UI
- `styles.css`: 面板样式
- `main.js`: 插件入口
- `src/app-controller.js`: UI 与业务协调
- `src/openweb-client.js`: OpenWeb API 调用
- `src/photoshop-workflow.js`: Photoshop 选区导出与结果回贴
- `src/config-store.js`: 本地配置与安全存储
- `icons/`: 面板图标

## OpenWeb 端前提

1. 在 OpenWeb 中启用 API Key 功能。
2. 让插件使用者登录自己的 OpenWeb 账号。
3. 由该用户在个人设置里生成自己的 `API Key`。
4. 确保该用户本身在 OpenWeb 里能看到并使用目标生图模型。
5. 确保运行 Photoshop 的电脑可以访问 `http://10.10.20.235:3000/`。

## 安装方式

### 开发装载

1. 安装 `Adobe UXP Developer Tool`
2. 打开 UXP Developer Tool
3. 选择 `Add Plugin`
4. 指向当前目录
5. 在 Photoshop 中打开面板 `Plugins > PS OpenWeb Bridge > OpenWeb Image`

### 分发安装

当前目录已经是可直接加载的完整插件源码目录，适合：

- UXP Developer Tool 加载
- 后续在有 UXP 打包环境的机器上打成 `.ccx`
- 直接分发源码压缩包给同事加载

项目里也提供了一个源码打包脚本：

- `scripts/build-zip.ps1`

运行后会生成 `dist/PS-OpenWeb-Bridge-1.0.0.zip`

## 使用流程

1. 在 Photoshop 中打开一个文档。
2. 创建一个有效选区。
3. 在面板中填写 OpenWeb 地址和普通用户 API Key。
4. 点击 `测试连接`，确认模型可以正常读取。
5. 选择模型。
6. 填写 Prompt。
7. 如需附加参考图，选择图片或拖图到面板。
8. 点击 `生成并替换到选区`。
9. 插件会自动：
   - 导出当前选区
   - 上传参考图到 OpenWeb
   - 通过聊天接口发起生成
   - 下载结果
   - 回贴到原选区位置
   - 按选项创建蒙版和羽化

## 已知说明

- 面板拖拽在旧版 Photoshop / UXP 上可能不稳定，所以保留了“选择图片”按钮作为兼容后备。
- 图层蒙版创建使用 Action / BatchPlay，依赖 Photoshop 当前选区状态。
- 羽化会作用到当前选区后再创建蒙版，因此执行完成后，当前选区边缘可能与执行前不同。
- 具体是否能成功生图，仍取决于 OpenWeb 当前账号可见模型是否真的支持聊天型生图返回。

## 后续可继续增强

- 选区蒙版状态保存与恢复
- 多结果缩略图选择
- 历史 Prompt 预设
- 更精细的聊天结果解析
- 更明确的模型能力诊断
