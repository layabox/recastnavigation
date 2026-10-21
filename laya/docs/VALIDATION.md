# 验证记录

日期：2026-10-21。

- 官方 main：`9f4ce64458dfae86e1239c525ddc219c4e9e06f1`（再次联网核对后没有更新的提交）。
- Emscripten 3.1.64、Node.js 22.12.0、esbuild 0.25.10，macOS ARM64。
- 官方算法源文件保持原样；没有 layers 兼容补丁。
- `npm ci` 干净安装通过；依赖锁文件使用公共 npm registry，包含跨平台 optional packages 和 integrity，无本机绝对路径。
- `npm run build` 同时生成纯 JS 和分离 WASM 产物。
- `npm test`：53 组检查通过，包括六场景 × 480 帧路径/Crowd 行为、JS/WASM 各 18 项坡度检查、API 与宿主加载兼容。
- `LAYAAIR_ROOT=... npm run test:engine`：JS 和 WASM 各 65 项 2D/3D 引擎导航检查通过；引擎文件只读，不安装产物。

与原引擎二进制相比，有意接受最大坡度限制生效和官方 layers areaType 修复。与独立捕获的官方原生 layers 基准相比，所测场景没有新增行为差异。有限测试不能保证所有输入完全等价；小游戏加载测试是宿主模拟，尚未真机运行。
