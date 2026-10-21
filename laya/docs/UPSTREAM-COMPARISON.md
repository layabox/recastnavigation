# 官方源码与旧 Laya 产物的对比记录

核对日期：2026-10-21。

## 源码来源

旧 Layabox 导入提交 `9352c4f7f424a1a2d541d89782be019fd4dc3957` 的整个 Git 文件树，等同于官方 `455a019e7aef99354ac3020f04c1fe3541aa4d19`（2024-04-28）：根 tree 都是 `f99ef2cc0f2ad5c02e0ce305179907e6e89e09e6`。不是带有 Laya 定制算法的 fork；只是导入时未保留官方历史。重建胶水原本不在该仓库中。

本 fork 直接来自官方仓库，已核对当前 main 为 `9f4ce64458dfae86e1239c525ddc219c4e9e06f1`（2026-02-27），当前 native 基线采用该提交。

## 自 2024 快照以来的差异

四个核心目录共 18 个文件变化，包含四个 CMakeLists：

- Recast：rcIntArray 改为 rcTempVector、显式类型转换、异或 helper 清理、断言处理；大型网格空三角形数组的保护（#796）；零高度/反向 span 输入保护。
- Detour：raycast 缓冲区不足时停止并标记 partial；poly ref 位数断言；closestPointOnDetailEdges 去模板；fast-math 下 isfinite 行为处理。
- dtMeshTile 删除禁止复制的私有声明；胶水仍保持旧公开构造接口，不因 C++ 结构变化而增加 JS 构造器。
- DetourCrowd 的源码和头文件相同，只有 CMake 改动。
- DetourTileCache 的 builder 清理；本胶水的同名 dtNavTileCache 是几何缓存，不链接官方 DetourTileCache 模块。
- 其他仓库改动主要为 Demo、SDL2/Dear ImGui/ImPlot、CI、文档及单元测试，不参与 JS/WASM 构建。

[官方整体差异](https://github.com/recastnavigation/recastnavigation/compare/455a019e7aef99354ac3020f04c1fe3541aa4d19...9f4ce64458dfae86e1239c525ddc219c4e9e06f1)。

## 两个有意修复的旧行为

### 最大坡度

原 JS/WASM 在同一 45° 坡面上，0°、30°、60° 最大坡度全部可通行。重建胶水在栅格化前显式调用 rcClearUnwalkableTriangles，0°/30° 不通、60° 通行。使用同一官方源码和编译参数，仅移除这一调用就可复现旧问题；不能简单归因为官方版本不同。原胶水已丢失，不能断言旧代码是漏调用还是后续覆盖了过滤结果。

### layers 的 areaType

官方 [ddaa361b / #470](https://github.com/recastnavigation/recastnavigation/commit/ddaa361b0893ddc7602a3bd5c20ad2cfd0a8df7c) 修复 layer 未记录 areaType、跨类型合并区域的问题。2024 快照与当前 main 均包含修复，但 Laya 原二进制表现为修复前的行为。

对比阶段曾临时移除区域类型检查以复现旧轨迹，六场景中只有 obstacle-layers 的路径/Crowd 哈希改变。最终决定保留官方修复；当前构建没有该补丁或 legacy 回退开关。`native-behavior.json` 是独立地用 2024 源码原生 layers 语义捕获的参考，不是将当前失败结果直接录制为黄金基准。

## b3d69475 的加载兼容约定

LayaAir 提交 `b3d69475e7c44e1085279601c063711190f2d369` 更新了 JS/WASM 外壳：固定 Web 环境、删除 Node/fs 分支，安全获取脚本地址并更新异步初始化流程；WasmAdapter 包装和 WASM 文件名不变。其具体 SDK 版本没有保存，不能断言原作者使用了哪个 SDK。

后续 `5482621db78e695811ebf9218a16a9531d64e703` 还降低语法要求并删除 BigInt heap views。此配方保留这些兼容约定，通过 esbuild ES2017、禁用动态执行、禁用 WASM_BIGINT 和 Web 环境编译完成；没有将淘宝文件系统/图片适配代码复制进 Recast。

## 验证结果与边界

官方当前源码无需修改即可与 `laya-recast.cpp` 编译。API/加载/内存视图检查、六场景路径与 480 帧 Crowd 基准、JS/WASM 各 18 项坡度测试通过；外部 LayaAir 构建的 2D/3D 集成回归各 65 项通过。测试是有限场景与宿主模拟，不声称所有几何输入或小游戏真机都已覆盖。

后续同步保留官方正常 merge 历史，以 source-lock 和这些测试识别 native 算法/接口变化；不要为了重现旧 bug 撤回上游修复。
