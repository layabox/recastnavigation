# LayaAir Recast JS / WASM

在官方 Recast/Detour 源码上添加 LayaAir Embind 胶水，独立编译纯 JS 和 JS/WASM。所有新增内容集中于 `laya/`，不修改官方算法、CMake、Demo 或根目录文档。

当前审查的官方基线：`9f4ce64458dfae86e1239c525ddc219c4e9e06f1`。默认使用官方原生 layers 语义，保留官方 areaType 修复，不提供恢复旧 layers bug 的模式。最大坡度过滤由胶水显式执行。

## 构建

要求：Node.js >= 20，Emscripten **3.1.64**，Git checkout（保留提交历史）。安装并激活 emsdk 后：

```sh
git clone https://github.com/layabox/recastnavigation.git
cd recastnavigation/laya
npm ci
npm run build
npm test
```

无需另找 Recast 源码，也不需要 LayaAir 引擎仓库或引擎的 node_modules。构建直接使用本 fork 的 `Recast/`、`Detour/`、`DetourCrowd/`。

如果 em++ 不在 PATH：

```sh
EMXX=/path/to/emsdk/upstream/emscripten/em++ npm run build
```

| 配置 | 默认值/说明 |
| --- | --- |
| `EMXX` | `em++`，要求已激活 Emscripten 3.1.64 |
| `RECAST_OUTPUT` | `laya/dist`，可设置绝对输出路径 |
| `RECAST_BACKENDS` | `wasm js`，可指定 `wasm` 或 `js` 单独构建 |
| layers | 始终使用官方原生算法；`RECAST_LAYER_MODE=legacy` 会报错 |

`dist/` 输出：

- `recast-navigation.js`：纯 JS，`window.Recast()` 返回就绪 Promise。
- `recast-navigation-wasm.js`、`recast-navigation-wasm.wasm`：必须配套更新，文件名保持原约定。
- `source.json`、`manifest.json`：官方基线、当前 fork 提交、native 源码验证结果、工具链和配方/产物 SHA-256。

构建不自动复制、安装或修改任何引擎文件。生成文件和 node_modules 不提交到 Git。

## V8 大函数限制

纯 JS 和 WASM 均保留 `-O3`。纯 JS 另设置 LLVM `-mllvm -inline-threshold=50`，并在 wasm-opt **和后续 wasm2js** 阶段设置 `--one-caller-inline-max-function-size=500`，避免默认无限制的单调用者内联把整个建图/Crowd 流程合并成大函数。构建临时创建 Binaryen 工具视图，并包装 wasm2js 传入参数；退出后删除临时目录，不修改 emsdk 或官方 C++ 源码。WASM 不使用该限制。

构建和 `npm test` 都会编译检查**所有函数**的 V8 bytecode，任意函数超过 **51,200 字节（50 KiB）**就失败；不依赖压缩函数名，也不执行库初始化。这比引擎 `scripts/checkJsBytecode.mjs` 的 61,440 字节门槛再保留至少 10 KiB 余量，不是 JS 源码字符数限制。检查器只保存函数名与字节码大小，不保留完整反汇编。

```sh
npm run check:bytecode
# 可指定 IDE Electron 或其他目标 V8 可执行文件：
JS_BYTECODE_NODE=/path/to/Electron npm run check:bytecode
```

不同 V8 版本的字节码大小和优化策略可能变化；更新 Node/Electron 或工具链后应重新检查。51,200 字节是当前构建预算，满足预算不代表所有函数一定会被运行时优化。外部引擎检查脚本固定监控旧产物函数名，不能直接复用其旧 watchlist 判断新产物。

## 加载与小游戏约定

WASM 脚本保留以下模块外层包装：

```js
window.Recast = Laya.WasmAdapter.create(Recast, "recast-navigation-wasm.wasm");
```

浏览器默认从 JS 同目录加载 WASM，保留 `locateFile` 路径覆盖、流式加载和 ArrayBuffer 回退；小游戏由 `WasmAdapter.instantiateWasm` 接管实例化并应用资源映射。引擎包装后的入口是 `window.Recast()`，裸模块工厂才接受 Emscripten options。

构建继续使用 `MODULARIZE=1`、`EXPORT_NAME=Recast`、`ENVIRONMENT=web`、`DYNAMIC_EXECUTION=0`、`WASM_BIGINT=0`、内存增长和 `_malloc/_free` 导出；esbuild 降低到 ES2017 语法。不会加入 Node 文件系统加载分支、动态生成 JS 或 BigInt heap views。

公开方法和历史拼写保持一致，例如 `transfromData`、`addCovexVoume`；状态码和原生 area bits、借用 TypedArray、Crowd 输出布局也有回归检查。对旧二进制的两个有意变化是：最大坡度限制生效，以及 layers 保留官方区域类型边界。

## 测试

`npm test` 无需引擎，覆盖 90 组检查：

- 全部生成 JS 函数的 V8 字节码大小；超限、语法错误及压缩函数改名的检测。
- JS/WASM 各 17 项几何更新检查：坡度/区域标志变化、重新初始化、旋转和保留的可写几何视图。
- 原模块类、方法参数、属性和枚举；关键返回类型、状态码、原生 mask 和几何缓存行为。
- 六个场景，每场景 480 帧 Crowd 输出、状态和路径的严格哈希；覆盖三分区、断路、off-mesh link、tile 重建与 agent 增删。
- 45° 坡面在 0°/30°/60° 最大坡度下的完整路径结果，组合三种分区和正反绕序，JS/WASM 各 18 项。
- 浏览器相对目录、query/hash、流式回退和 URL 映射；无 document / 标准 WebAssembly / TextDecoder / BigInt typed arrays，禁止动态生成 JS 的宿主。

API 基准来自原 LayaAir WASM；native layers 行为基准独立捕获于官方 2024/Layabox 源码的原生分层算法。只忽略耗时和失败 nearest-poly 查询中原库未初始化的坐标，不用浮点容差掩盖正常行为差异。适配器快照来源见 `tests/fixtures/provenance.json`。

需要单独验证某个输出目录时：

```sh
node tests/verify.cjs /absolute/path/to/output
node tests/slope-regression.cjs /absolute/path/to/recast-navigation-wasm.js
```

可选的引擎集成回归需要已有 LayaAir 构建：

```sh
# 在引擎 checkout 中先运行 npm run build
LAYAAIR_ROOT=/absolute/path/to/LayaAir npm run test:engine
```

该命令以只读方式载入引擎的 build/libs，在隔离 VM 中注入本 fork 的模块，JS/WASM 各执行 65 项 2D/3D 导航检查，不复制文件进引擎。宿主模拟测试不能替代淘宝、微信、抖音真机验收。

## 性能基准

`tests/performance.cjs` 在同一进程的独立 VM 中串行交错 A/B、B/A，分别计时 `addTile` 和 `updateCrowd`；查询、轨迹哈希和等待事件循环的时间不计入调用耗时。保留每批原始数据、冷调用和堆容量，支持 Node wall time，以及新 Node/Electron 的线程 CPU 时间。没有基于绝对耗时的 CI 断言。

```sh
npm run bench -- --baseline=/path/to/previous/recast-navigation.js --mode=build
npm run bench -- --baseline=/path/to/previous/recast-navigation.js --mode=build --scene=plane --density=8 --terrain=wave --warmup=200 --iterations=100
npm run bench -- --baseline=/path/to/previous/recast-navigation.js --mode=crowd --scene=plane --agents=128 --trials=12
# 用 IDE 实际 V8 运行（路径按本机安装调整）：
ELECTRON_RUN_AS_NODE=1 /path/to/LayaAirIDE tests/performance.cjs --baseline=/previous/recast-navigation.js --mode=crowd --scene=plane
# WASM 配套文件必须在 JS 同目录，基准和候选均显式指定：
npm run bench -- --baseline=/previous/recast-navigation-wasm.js --candidate=dist/recast-navigation-wasm.js --mode=crowd
```

默认包含六个场景，每批 Crowd 480 帧、24 个 agent，缓存 agent 的借用句柄并逐帧让出事件循环；128-agent 模式使用 plane 场景。`--density=8 --scene=plane` 为 8,192 个三角形，`--terrain=flat/ramp/wave` 分别测水平面、缓坡和起伏地形。默认建图预热 1000 次，6 批各 200 次；Crowd 先重放完整轨迹三次再测量。参数以 `--name=value` 传入。

**VM 使用自己的 Math 内建函数，只在 VM 内设置固定随机数种子。** 注入宿主 `Math` 或 `Object.create(Math)` 会引入跨 realm 调用，破坏性能基准的代表性；基准显式检查 `Math.fround` / `Math.sqrt` 不来自宿主。旧记录中基于此做法得出的 JS 回退比例和阶段性慢帧结论已撤回，见验证记录。此问题不改变已验证的行为哈希或产物字节码大小。

layers 使用官方修复后的行为，与旧引擎的查询/轨迹不同，应单独报告。基准不自动修改任何行为期望值，也不把性能变化等同于正确性通过。

## 同步官方上游

`laya/` 独立于官方目录，正常 merge 会保留本地绑定；不要用强制覆盖分支来代替合并。

```sh
# 在仓库根目录；如果尚未配置 upstream：
git remote add upstream https://github.com/recastnavigation/recastnavigation.git
git fetch upstream
# 检查变更后，在测试分支合并：
git switch -c codex/update-recast
git merge upstream/main
```

`source-lock.json` 固定的是已审查的官方提交和 **42 个 native .h/.cpp 的内容哈希**，不是要求 fork 的 HEAD 永远不变。新增 `laya/` 提交、上游仅修改文档/CMake 时不会使构建失效；native 源码新增、删除或改变时，构建会明确拒绝未审查变更。

确认要采用新的官方算法后：

```sh
cd laya
npm run lock-source -- <reviewed-full-official-commit-sha>
npm run build
npm test
LAYAAIR_ROOT=/absolute/path/to/LayaAir npm run test:engine
```

锁文件更新不会重录行为基准。若算法行为有变化，先查明原因，再决定是否接受并显式记录，不能仅为通过测试而覆盖基准。Emscripten 升级另行验证，以便区分算法变化和小游戏加载代码变化。

## 来源

`src/laya-recast.cpp` 是根据现有 LayaAir 接口重建的胶水，不是找回的旧胶水原件；原编译命令不可唯一还原，此配方通过回归验证。上游差异及层合并问题见 [对比记录](docs/UPSTREAM-COMPARISON.md)。Recast/Detour 与参考的 Demo helper 遵循仓库根目录 `License.txt`。

共面不可走网格使用绑定层的高度匹配掩码处理，官方 span 合并和 layers 算法不变。`npm test` 含每后端 96 项障碍回归（形状/分区/顺序/孔洞/上层地面），引擎集成含真实 2D 三种障碍的阻挡、绕行和移除验证。详见 [验证记录](docs/VALIDATION.md#共面-unwalk-网格障碍回归)。
