# LS STBridge

Loom Studio 的 SillyTavern 数据兼容扩展。

当前职责：

- 导入 SillyTavern 角色卡、世界书和预设；
- 将兼容数据转换为 Loom Studio 原生资源；
- 为后续会话导入、Text Pipeline 正则兼容和远程更新提供独立发布单元。

本扩展的源码仓库已从 Loom Studio 主仓库拆分，主仓库只保留安装或开发集成所需的外部扩展引用。

## 开发

该扩展当前使用 Loom Studio monorepo 中的 `@loom-studio/application-runtime`、`@loom-studio/extension-sdk` 和 `@loom-studio/shared`。独立仓库的可复现构建依赖策略将在发布流程确定后补充。
