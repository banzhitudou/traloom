# 发布准备

本目录是独立源码，不需要配套的私人书稿目录。源码上传不等于完成公开发行；仓库可见性与发行状态以 GitHub 页面为准。

## GitHub 仓库资料

建议仓库名：`traloom`

英文简介：`A local desktop workspace for AI-assisted book translation, with PDF reference, terminology checks, revision history, and bilingual exports.`

中文简介：`AI 辅助、译者精修的本地图书翻译工作台，支持 PDF 对照、术语一致性检查、修订记录和双语导出。`

建议 Topics：`translation`、`computer-assisted-translation`、`pdf`、`electron`、`typescript`、`llm`、`terminology`、`local-first`。

仓库主页使用 README.md，英文说明见 README.en.md。不添加不存在的下载链接、演示站点或 CI 状态徽章。

## 首次公开前

- [ ] 逐项审查提交文件，排除书稿、工程、导出、缓存、日志及构建产物。
- [ ] 完成密钥扫描及依赖安全、许可审查；基础扫描不能代替完整审计。
- [ ] 确认 MIT 授权来源及第三方资源声明，保留原有版权声明。
- [ ] 在干净环境运行 `npm ci`、`npm test`、`npm run typecheck` 和 `npm run build`。
- [ ] 使用自制 PDF 制作截图；不使用真实书稿，截图并非公开源码的前置条件。
- [ ] 创建仓库后启用私密漏洞报告，并核对 SECURITY.md 的报告路径。
- [ ] 对外明确早期版本、中文界面、英文 OCR 和当前平台验证范围。
- [ ] 安装包正式发行另行完成平台验证、签名及公证，不与公开源码混为一谈。

首次上传到私有仓库审查，通过后再决定是否公开。不要上传真实工程、书稿或凭据。

## 发行注意事项

- 正式发布前审查最终提交清单、密钥扫描结果及完整依赖许可。
- 使用自制演示项目制作截图；不要使用私人书稿、修订记录或词典数据。
- 当前程序元数据声明 MIT；新增 LICENSE 与此保持一致，发布者应确认贡献代码的授权来源。
- 保留 ECDICT 的许可文件。其他依赖的许可应随发行流程审查并保留。
- macOS/Windows 发行包应分别完成平台测试及签名。现有本地打包命令主要用于 Apple Silicon Mac。
- 新建工程已内嵌 PDF 与资源；旧工程可能引用外部 PDF 的绝对路径，搬移前应确认资源已嵌入，或保留并重新关联外部 PDF。跨平台发行前仍需验证 Windows 路径和文件对话框。

源码打包采用应用文件白名单，私人数据不应放入仓库，即使扩展名已被 `.gitignore` 排除。
