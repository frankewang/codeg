# codeg 定制（已归档停用）

> **状态：2026-11-24 起停用。** 已回归官方 0.48.1 原版前端，线上没有任何
> 定制补丁。原因：上游 PR #1142 已合入（Markdown 中文路径图片），且
> v0.48.0 起 `useTouchSelectionMenuGuard` 覆盖消息面板单指选词复制、
> 会话详情弹窗自带手机常显复制按钮 —— 用户的本质需求（正确复制文字）
> 已由官方满足。侧栏/弹窗长按仍会弹菜单，但收益不足以支撑常驻定制维护。
> **不要再运行 `apply-patch.sh`**；`~/.local/share/codeg/codeg-patch.json`
> 标记 `mode: stock`。若将来确实需要恢复，定制版静态前端备份在
> `~/.local/share/codeg/web.custom-retired-20261124-183801`，本分支提交
> `b9d0506fd` 之前的状态即完整定制层。

# codeg 定制（声明式）

**一个固定分支 `frankewang-custom`** = 上游 tag 原版源码 + 本目录。
分支上 `src/` 保持上游原样，不做任何改动 —— 定制代码全部以**标准 TSX
完整副本**放在 `files/` 下，可读、可 diff、可单独 review。

- 上游：<https://github.com/spacering-net/codeg>
- 本 fork：<https://github.com/frankewang/codeg>
- 本地：`/data/workspace/codeg-fork`

## 三个文件

| 文件 | 作用 |
| --- | --- |
| `patches.conf` | **变更台账**：哪个文件、改了什么、适用版本、什么场景替换、上游合入后如何退役 |
| `files/<同路径>` | 定制后的完整源码副本（标准 TSX；已在 `tsconfig.build.json` 排除，不参与 Next 类型检查） |
| `apply-patch.sh` | 只做：读台账 → 复制副本 → 构建 → 替换 `web/` → 自检 |

## 台账格式

```
目标文件 | 变更说明 | 适用版本 | 场景 | 上游合入探测
```

- **适用版本** `>=vX.Y.Z`：当前 codeg 版本不低于它才替换
- **场景** `web`（server/web 静态部署）或 `all`
- **上游合入探测**：脚本读 `git HEAD` 的上游原版 blob，若已含该特征串
  说明修复已合入上游 → 自动跳过替换（退役）；`-` 表示永不自动退役

## 当前状态（v0.48.0）

- 上游 PR #1142 已合入 v0.48.0：markdown 中文路径图片修复由官方提供，
  我们对应的 3 个补丁（组件 + 两组测试）已**退役**。
- 上游 v0.48.0 在消息面板新增 `useTouchSelectionMenuGuard`，单指长按选词
  复制已由官方解决；我们不再修改 `conversation-detail-panel.tsx`。
- 双指长按菜单仅保留在**侧栏会话列表**（上游没有守卫的那块）。
- 台账当前 8 行，基线哈希对齐 v0.48.0。

## 升级到新版本

官方更新会替换整个 `web/` 目录（见 `src-tauri/src/update/install.rs`），
定制前端随之丢失。让官方更新跑完，然后：

```bash
git -C /data/workspace/codeg-fork merge <new-tag>     # 普通上游合并，src/ 自动跟进
scripts/codeg-custom/apply-patch.sh                   # 按台账重新打包替换并部署
scripts/codeg-custom/apply-patch.sh --check           # 只读自检
```

合并若与 `files/` 里某个副本对应的上游文件冲突，说明上游动过这段逻辑：
对照新上游文件重新生成该副本，并在台账更新「变更说明 / 适用版本」。

## 隐性依赖

`tsconfig.build.json` 的 `exclude` 包含 `scripts/codeg-custom/files`（副本不参与
Next 类型检查，否则相对导入报 TS2307）。这是工具层的一部分，随分支提交。

## 新增一个定制

1. 把改好的完整文件放到 `files/<原路径>`；
2. 在 `patches.conf` 加一行（文件、变更、起始版本、场景、探测串）；
3. `git commit` + `git push fork frankewang-custom`；
4. 跑一次 `apply-patch.sh` 部署。

## 对外提 PR

`fix/markdown-local-images` 是上游 PR #1142 的只读 head 分支，保留到合入。
本分支的 `files/` 副本与它内容一致，需要更新 PR 时从副本同步过去。
