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

## 首次修复：生成 JS 的 V8 字节码限制（b30dc59）

引擎提交 `75af56ac01e1791c4eaf874b20e71a14338c208b` 曾拆分原 JS 的 `nd` / `Jg` 和提取出的阶段函数，并用固定 watchlist 检查 60 KiB 预算。引擎当前原产物运行其 `scripts/checkJsBytecode.mjs` 为 0 warnings。直接重新编译不会保留那些生成代码级拆分；旧 watchlist 在新产物上报告 27 个目标缺失/形状变化，不能据此测量新函数。

初始 fork 构建 `29069c8` 的纯 JS 在 Node 22.12.0 / V8 `12.4.254.21-node.21` 下：

| 配方 | 最大两个函数的 V8 bytecode |
| --- | --- |
| 原 `-O3` | 278,791 / 74,856 字节 |
| 仅改为 `-O2`（未采用） | 265,850 / 70,540 字节 |
| `-O3` + wasm-opt/wasm2js 两阶段限制单调用者内联 | 60,342 / 48,203 字节 |

限制参数为 `--one-caller-inline-max-function-size=500`。仅给 wasm-opt 传参也无法解决：后续 wasm2js 会重新运行优化，因此构建通过临时工具视图向 wasm2js 传入同样的参数。没有降低 LLVM 优化等级、全局禁用内联、修改官方 native 文件或拆写压缩 JS。纯 JS 大小由 474,736 变为 477,559 字节（约 +0.6%）。

新检查扫描全部 684 个函数，包含未执行分支，不依赖函数名。构建和测试都强制拒绝超出 61,440 字节的产物。验证了对最初超限产物的失败检测，并在回归中覆盖任意新函数名的超限检测、语法错误拒绝和只编译不执行初始化。

修复后 `npm test`：56 组检查通过，JS/WASM 六场景 × 480 帧的严格行为哈希、各 18 项坡度及所有加载场景均通过。字节码检测仅适用于 JS 函数，不用于推断 WASM 原生函数的优化状况。

同机串行运行原 fork 产物和限制内联产物：六场景各预热 20 次、测量 100 次 tile 重建，合计耗时约 10.24 s → 3.78 s，查询哈希一致；六场景各 480 帧 Crowd 更新合计约 15.49 s → 15.26 s，但单场景存在明显波动，不能据此声称 Crowd 普遍提速。这是本机一次样本，不作为时间阈值测试，也不代表小游戏真机表现。JS/WASM 各 65 项引擎集成测试均通过；引擎仓库没有改动或安装产物。


## 增加余量并验证实际优化

不能把“字节码低于门槛”等同于“运行时已经完成优化”。对上版 60,342 字节的 `a6` 函数，Node 22.12.0 建图基准的 `--trace-opt --trace-deopt` 日志记录了六次 `completed optimizing ... JSFunction a6 ... (target TURBOFAN)`。因此已确认该版本能在所测 V8 12.4 中完成优化，但它距离 61,440 字节仅剩 1,098 字节（约 1.8%），余量不足。

纯 JS 新增 LLVM `-mllvm -inline-threshold=50`，同时保留两阶段 Binaryen 的单调用者内联限制 500，仍为 `-O3`；WASM 配方和官方 C++ 不变。仅把 Binaryen 参数降到 100 的未采用试验反而得到 60,564 字节，说明参数与 V8 字节码大小并非单调关系。

| 实测运行时 | 上版最大函数 | 新版最大函数 |
| --- | ---: | ---: |
| Node 22.12.0 / V8 12.4.254.21-node.21 | 60,342 | 49,242 |
| 本机 LayaAir IDE / Electron 44.0.0 / V8 15.2.124.13-electron.0 | 48,133 | 38,808 |

新版扫描全部 722 个函数，构建预算收紧到 **50 KiB（51,200 字节）**，比所测两版 V8 默认的 `--max-optimized-bytecode-size=61440` 至少留出 10 KiB 余量。当前 Node 最大函数实际余量为 12,198 字节（约 19.9%）。不同 V8 生成字节码的大小不同；不能用一版的测量推断所有运行时。

新版最大函数 `$f` 运行六场景建图基准时，在 Node 日志中出现 `completed optimizing ... (target TURBOFAN)`，IDE 日志中出现 `completed optimizing ... (target TURBOFAN_JS)`，也观察到 OSR 完成。两份日志中没有该函数的 deopt 记录。这是实际优化证据，不只是大小推断；并不保证其他输入下永不 deopt。

复现（从 `laya/` 运行；函数名应取当前字节码检查报告，不能固定旧名称）：

```sh
npm run check:bytecode
JS_BYTECODE_NODE=/path/to/LayaAirIDE npm run check:bytecode
node --trace-opt --trace-deopt tests/behavior-regression.cjs dist/recast-navigation.js --build-benchmark
ELECTRON_RUN_AS_NODE=1 /path/to/LayaAirIDE --trace-opt --trace-deopt tests/behavior-regression.cjs dist/recast-navigation.js --build-benchmark
```

新版 `npm test` 56 组和 JS/WASM 各 65 项引擎回归均通过。与上版 60,342 字节产物串行对比，六场景各预热 20 次、测量 100 次 tile 重建合计约 1.420 s → 1.436 s（约 +1.1%，单次样本），所有查询哈希一致。此计时不能作为稳定性能提升或下降的结论；日志输出的 JIT 验证与正常计时分开运行。小游戏仍需各目标宿主真机验证。

同一轮串行六场景 × 480 帧 Crowd 更新合计约 5.718 s → 5.812 s（约 +1.7%，单次样本），位置与状态哈希全部一致。该结果未显示明显性能损失，也不能据此保证所有场景性能不变。
