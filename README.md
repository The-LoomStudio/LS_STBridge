# LS STBridge

Loom Studio 的 SillyTavern 数据兼容扩展。

当前职责：

- 导入 SillyTavern 角色卡、世界书和预设；
- 将兼容数据转换为 Loom Studio 原生资源；
- 通过“整体迁移”扫描 Data 文件夹，并在本次迁移内按语义内容去重 Lore；
- 角色卡内嵌世界书会抽取为可共享资源，再以外部引用挂回角色，避免卡片与外部 worlds 文件重复创建；
- 为后续会话导入、Text Pipeline 正则兼容和远程更新提供独立发布单元。

## EJS / MVU 数据兼容

新导入的 MVU 卡显式采用 `sillytavern.importer.mvu` State Contribution。完整数据存放在
`/entities/stCompatibility/mvu/components/data`，保留 `stat_data`、动态 `schema`、
`initialized_lorebooks` 与更新后的显示/增量字段；不再把正文消息作为变量的权威存储。

- 初始化读取所选开场和关联世界书，包括 Prompt 已禁用的 `[initvar]` 条目。开场 `<initvar>` 替代主角色世界书初值；其他世界书继续合并。已有 Timeline 不因资源编辑或重载扩展重新初始化。
- EJS 使用 `ejs` 3.1.10，在 QuickJS 0.32.0 内编译、渲染；提供 `_`、`print`、异步模板、最新 `getvar` / `getVariable`、`getVariables` / `Mvu.getMvuData`。最新楼层可省略或使用 `latest` / `-1`，这些兼容函数仅存在于 Prompt guest。
- `{{get_message_variable::路径}}` 在 EJS 求值后读取当前 MVU 数据，不把变量内容再次编译成模板。
- `[Preprocessing]` / `@@preprocessing` 在激活前执行一次，`@@if` 先过滤候选；`activewi` / `activateWorldInfo` 支持显式 `force: true` 的本轮激活，目标须是本轮可用资源中的唯一条目。`@@activate` / `@@dont_activate` 支持本轮控制，不改资源的永久启用状态。
- 模型继续使用 MVU 的 `_.set/add/insert/assign/remove/unset/delete` 与 JSONPatch 格式。解析和内建 Schema/VWD/模板规则来自用户提供的 MVU 源码，不执行任意模型 JavaScript。
- 完整的无工具助手回复才进入自动 State 更新；流式片段、推理、工具参数和工具结果不执行 MVU。长度续写及暂停续写先合并，再处理一次。更新不要求追加 Narrative 正文，也不会为了更新变量多调用一次模型。
- State 操作先记入 Run 检查点，再以 Revision CAS 和幂等键提交。热恢复和冷恢复复用已接受的 Prompt / 操作，不重跑模板或增减命令；原生工具结果不确定时仍拒绝自动重放。

当前不支持：历史消息/swipe API、作者后台脚本及回调、UI/状态栏桥、EJS 持久写变量、文件 include、
非强制 `activewi` 的 ST 递归扫描、关键词模板、其他 ST 专有装饰器和依赖最终消息位置的注入。
这些调用不会获得隐式宿主权限。工具调用同一 Step 的旁白不是当前自动 MVU 更新入口。
导入已有聊天不恢复旧消息上的 MVU 快照，也不扫描历史命令补算状态。

Preview 不写 State；独立 `ctx.prompt.build` 没有 Timeline 时，读取 MVU 会明确失败。工具后续轮次不重建模板。
Guest 内临时修改只活到本次构建结束，不写回 State。资源限制为每份模板 256 KB、输出 1 MB、
QuickJS 堆 64 MB、单次执行约 2 秒；MVU 单次输入/输出 2 MB、独立 Worker 约 5 秒。
QuickJS 当前在服务器线程运行，时间上限不等于零阻塞；大规模模板的调度优化尚未做性能验收。

原来已经导入的资源不会被后台批量改写。新导入资源带显式加工标记；旧资源需重新导入或显式采用相同处理器/Contribution。

去重边界：

- Lore 只按同一批迁移中的规范化语义内容去重，内容不同的世界书不会因名称相同而覆盖；
- 角色卡和 Preset 的正则保留各自 owner 生命周期，不跨卡片、预设或扩展全局合并；
- 当前批量迁移不把不同导入批次当作全局幂等操作，重复选择同一 Data 文件夹仍可能产生新的资源。
- MVU 主世界书保留初始化角色标记，与未带该标记的普通共享世界书不视为相同语义，因此不强行去重。一个角色关联多个“主世界书”时初始化明确报错，避免错误地跳过初值。

本扩展的源码仓库已从 Loom Studio 主仓库拆分，主仓库只保留安装或开发集成所需的外部扩展引用。

## 开发

该扩展当前使用 Loom Studio monorepo 中的 `@loom-studio/application-runtime`、`@loom-studio/extension-sdk` 和 `@loom-studio/shared`。独立仓库的可复现构建依赖策略将在发布流程确定后补充。

运行 `pnpm --filter @loom-studio/sillytavern-importer build` 会先检查类型，再打包服务端、客户端、MVU Worker
及 EJS/QuickJS 资源；Host 隔离目录不需要扩展自己的 `node_modules`。发布时需保留完整 `dist`，
包括 `assets`、`runtime` 和 `THIRD_PARTY_NOTICES.md`，不能只复制入口文件。

Git 安装不会执行构建。修改源码后，将重新构建的完整 `dist/` 与源码一起提交到独立扩展仓库。

`scripts/vendor-mvu.mjs` 从指定 MVU 源码提取内建数据规则，生成来源 SHA-256 和 MIT 许可；
不复制 ST 存储、界面通知和作者事件宿主。`scripts/probe-upstream.mjs` 对本地上游示例卡运行内存数据库探针，
使用固定模型回复而不请求真实模型。当前数据链与恢复测试位于主仓库 `tests/unit/st-data-compat/`、
`tests/integration/application-runtime/st-data-compat.test.ts`。
