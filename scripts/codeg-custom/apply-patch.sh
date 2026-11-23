#!/usr/bin/env bash
# 按 patches.conf 把 files/ 下的定制源码打包替换进工作区，构建并部署。
#
#   apply-patch.sh           读台账 → 替换文件 → pnpm build → 替换 web/ → 自检
#   apply-patch.sh --check   只读自检（线上状态）
#   apply-patch.sh --dry-run 只读演练：打印本次将替换/跳过哪些文件，不改动任何东西
#
# 定制代码就是 files/ 下的标准 TSX 副本；本脚本不操作 git 历史、不重放提交。
# 上游升级：git merge 上游 tag 到本分支，再跑一次本脚本。
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CONF=${CODEG_PATCH_CONF:-$HERE/patches.conf}
FILES="$HERE/files"
FORK=${CODEG_PATCH_FORK:-/data/workspace/codeg-fork}
DATA="$HOME/.local/share/codeg"
WEB="$DATA/web"
DB="$DATA/codeg.db"
PATCH_INFO="$DATA/codeg-patch.json"
SCENE=${CODEG_PATCH_SCENE:-web}
NODE_BIN=$(ls -d "$HOME"/.local/lib/nodejs/node-v*/bin 2>/dev/null | sort -V | tail -1 || true)
[ -n "$NODE_BIN" ] || { echo "ERROR: 未找到 node 工具链" >&2; exit 1; }
export PATH="$NODE_BIN:$PATH"
PNPM=(npx --yes pnpm@11.9.0)
DOMAIN=$(awk '/^[[:space:]]*server_name/{gsub(/;/,"",$2);print $2;exit}' /etc/nginx/conf.d/anydev.conf 2>/dev/null || true)

die()  { echo "ERROR: $*" >&2; exit 1; }
info() { echo "==> $*"; }

# 当前 codeg 版本（数字部分）
CUR_VER=$("$HOME/.local/bin/codeg-server" --version | sed 's/^v//' | head -1)
ver_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]; }

# 上游原版（HEAD blob）是否已含该修复 → 自动退役。读 blob 而非工作区，
# 这样工作区即便已被上次替换过也不影响判断。
upstream_has_fix() {
  local target=$1 probe=$2 tmp rc
  tmp=$(mktemp)
  git -C "$FORK" show "HEAD:$target" > "$tmp" 2>/dev/null || { rm -f "$tmp"; return 1; }
  grep -qF -- "$probe" "$tmp"; rc=$?
  rm -f "$tmp"
  return $rc
}

# 分支的上游基线 tag（merge 上游 tag 后 HEAD 可达该 tag）
base_tag() { git -C "$FORK" describe --tags --abbrev=0 HEAD 2>/dev/null || true; }

# ── 只读自检 ─────────────────────────────────────────────────────────────
selfcheck() {
  local ok=1 code chunk rel n recorded html f
  echo; info "自检"
  [ "$(systemctl is-active codeg 2>/dev/null || true)" = active ] && echo "  OK   codeg.service active" || { echo "  FAIL codeg.service inactive"; ok=0; }
  code=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:3080/ || true)
  [ "$code" = 200 ] && echo "  OK   3080 HTTP $code" || { echo "  FAIL 3080 HTTP $code"; ok=0; }
  if [ -n "$DOMAIN" ]; then
    code=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 8 -H "Host: $DOMAIN" http://127.0.0.1/workspace || true)
    [ "$code" = 200 ] && echo "  OK   domain /workspace HTTP $code" || { echo "  FAIL domain /workspace HTTP $code"; ok=0; }
  fi
  recorded=""
  [ -f "$PATCH_INFO" ] && recorded=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("chunk",""))' "$PATCH_INFO" 2>/dev/null || true)
  chunk=""
  if [ -n "$recorded" ]; then
    if [ -f "$WEB$recorded" ]; then
      chunk="$WEB$recorded"; rel="$recorded"; echo "  OK   定制基线 chunk 仍在 ($rel)"
    else
      echo "  FAIL 定制基线 chunk 已消失 —— 官方 web/ 覆盖了定制前端"; ok=0
    fi
  else
    echo "  WARN 无部署记录，运行 apply-patch.sh 建立基线"
  fi
  if [ -n "$chunk" ]; then
    n=$(grep -c 'decodeURIComponent' "$chunk" || true)
    [ "${n:-0}" -gt 0 ] && echo "  OK   产物含解码逻辑 ($n 处)" || { echo "  FAIL 产物缺少解码逻辑"; ok=0; }
    code=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:3080$rel" || true)
    [ "$code" = 200 ] && echo "  OK   定制 chunk 可访问" || { echo "  FAIL 定制 chunk HTTP $code"; ok=0; }
    html=$(curl -s --noproxy '*' --max-time 8 http://127.0.0.1:3080/workspace || true)
    [[ "$html" == *"$(basename "$chunk")"* ]] && echo "  OK   /workspace HTML 引用定制 chunk" || { echo "  FAIL HTML 未引用定制 chunk"; ok=0; }
  fi
  [ -f "$PATCH_INFO" ] && echo "  --   部署记录: $(cat "$PATCH_INFO")"
  echo
  return $((1-ok))
}

[ "${1:-}" = "--check" ] && { selfcheck && echo "结论: 定制前端完好 ✅" || { echo "结论: 异常 ❌"; exit 1; }; exit 0; }

[ -f "$CONF" ] || die "缺少台账: $CONF"
[ -d "$FILES" ] || die "缺少副本目录: $FILES"
[ -d "$FORK/.git" ] || die "fork 不存在: $FORK"
command -v sqlite3 >/dev/null || die "缺少 sqlite3"

TS=$(date +%Y%m%d-%H%M%S)
info "codeg $CUR_VER / 场景 $SCENE / 台账 $CONF"

# 基线守卫：分支的上游基线必须与已部署 codeg 版本一致，否则会把旧前端
# 覆盖到新服务（或反之）。不一致时提示先完成官方更新 + git merge。
BASE_TAG=$(base_tag | sed 's/^v//')
if [ -n "$BASE_TAG" ] && [ "$BASE_TAG" != "$CUR_VER" ]; then
  die "分支上游基线 v$BASE_TAG 与已部署 codeg $CUR_VER 不一致 —— 先让官方更新完成，再 git -C $FORK merge v$CUR_VER 后重跑"
fi

# 1) 按台账收集本次要替换的文件（标准 TSX 完整副本）
APPLIED=(); SKIPPED=()
while IFS='|' read -r target desc version scene probe base_blob; do
  [[ -z "$target" || "$target" == \#* ]] && continue
  trim() { printf '%s' "$1" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'; }
  target=$(trim "$target"); version=$(trim "$version"); scene=$(trim "$scene"); probe=$(trim "$probe")
  base_blob=$(trim "${base_blob:--}")
  [ -f "$FILES/$target" ] || die "副本缺失: files/$target"
  # 目标可以是上游没有的新增文件（如新手势 hook），只要求父目录存在
  [ -d "$FORK/$(dirname "$target")" ] || die "目标父目录不存在: $target"
  base=${version#>=}; base=${base#v}
  if ! ver_ge "$CUR_VER" "$base"; then echo "  SKIP 版本不符 ($version): $target"; SKIPPED+=("$target"); continue; fi
  if [ "$scene" != all ] && [ "$scene" != "$SCENE" ]; then echo "  SKIP 场景不符 ($scene): $target"; SKIPPED+=("$target"); continue; fi
  if [ "$probe" != "-" ] && upstream_has_fix "$target" "$probe"; then
    echo "  SKIP 上游已合入，退役: $target"; SKIPPED+=("$target"); continue
  fi
  # 维护兼容性：merge 上游后若该文件的 blob 变了，说明上游动过这段代码，
  # 旧副本可能覆盖上游新修复 —— 拒绝替换，先基于新上游文件重建副本。
  if [ "$base_blob" != "-" ]; then
    cur_blob=$(git -C "$FORK" rev-parse "HEAD:$target" 2>/dev/null || true)
    if [ "$cur_blob" != "$base_blob" ]; then
      die "上游文件已变更: $target（台账基线 ${base_blob:0:8} → 当前 ${cur_blob:0:8}）。请基于新上游文件重建 files/ 副本并更新台账哈希后再运行"
    fi
  fi
  echo "  USE  $target  [$(trim "$desc")]"
  APPLIED+=("$target")
done < "$CONF"

info "替换 ${#APPLIED[@]} 个文件，跳过 ${#SKIPPED[@]} 个"
[ "${#APPLIED[@]}" -gt 0 ] || die "没有需要替换的文件"

# 只读演练出口：到这里为止未产生任何副作用（无备份/复制/构建/部署）
if [ "${1:-}" = "--dry-run" ]; then
  info "演练结束：以上即本次将执行的替换计划，未改动任何文件"
  exit 0
fi

# 1.5) 目标文件必须与 HEAD 一致（工作区干净），否则还原语义不成立
if ! git -C "$FORK" diff --quiet HEAD -- "${APPLIED[@]}"; then
  die "台账目标文件存在未提交改动（相对 HEAD）——先提交或还原后再运行"
fi

# 2) WAL 安全备份 db（硬约束，先做）
info "备份 codeg.db"
sqlite3 "$DB" ".backup '$DATA/codeg.db.backup-$TS'" || die "db 备份失败"

# 3) 打包替换：把副本覆盖到工作区，构建后立即还原（见 trap）。
# src/ 的工作区状态必须始终等于上游原版 —— 定制代码的唯一真相源是 files/，
# 否则一次 git commit -a 就会把定制提交进 src/，破坏"上游镜像 + files/"模型。
for target in "${APPLIED[@]}"; do cp "$FILES/$target" "$FORK/$target"; done
restore_worktree() {
  if [ -z "${CODEG_PATCH_KEEP:-}" ]; then
    local target
    for target in "${APPLIED[@]}"; do
      if git -C "$FORK" cat-file -e "HEAD:$target" 2>/dev/null; then
        git -C "$FORK" checkout HEAD -- "$target" 2>/dev/null || true
      else
        # 上游没有的新增文件：删除，保持工作区为上游镜像
        rm -f "$FORK/$target"
      fi
    done
  fi
}
trap restore_worktree EXIT

# 4) 构建静态导出
info "pnpm install + pnpm build"
( cd "$FORK" && "${PNPM[@]}" install --frozen-lockfile ) >/tmp/codeg-patch-install.log 2>&1 \
  || { tail -20 /tmp/codeg-patch-install.log; die "pnpm install 失败"; }
( cd "$FORK" && "${PNPM[@]}" build ) >/tmp/codeg-patch-build.log 2>&1 \
  || { tail -30 /tmp/codeg-patch-build.log; die "pnpm build 失败"; }
[ -f "$FORK/out/index.html" ] || die "构建产物缺少 index.html"
CHUNK=$(grep -rlF '[PreviewImage] readFileBase64 failed' "$FORK/out/_next/static/chunks" | head -1 || true)
[ -n "$CHUNK" ] || die "构建产物找不到预览组件 chunk"
CHUNK_REL="/_next/static/chunks/$(basename "$CHUNK")"

# 5) 原子替换 web/（旧目录保留可回滚）
info "替换静态前端（旧目录保留为 web.old.$TS）"
STAGING="$DATA/web.new.$$"; cp -a "$FORK/out" "$STAGING" || die "staging 复制失败"
OLD="$DATA/web.old.$TS"; mv "$WEB" "$OLD" || die "备份旧 web/ 失败"
if ! mv "$STAGING" "$WEB"; then mv "$OLD" "$WEB"; die "替换失败，已回滚"; fi

python3 - "$PATCH_INFO" "$CUR_VER" "$CHUNK_REL" "$TS" "${APPLIED[@]}" <<'PY'
import json, sys
out, ver, chunk, ts, *files = sys.argv[1:]
json.dump({"version": ver, "chunk": chunk, "files": files, "appliedAt": ts},
          open(out, "w"), ensure_ascii=False)
PY

# 6) 重启 + 自检
info "重启 codeg"
sudo systemctl restart codeg || die "重启失败（静态目录已替换）"
systemctl is-active codeg >/dev/null 2>&1 || die "重启后服务未 active"
if selfcheck; then
  echo "完成 ✅  codeg $CUR_VER，替换 ${#APPLIED[@]} 个定制文件。"
  echo "  旧前端: $OLD"
  echo "  db 备份: $DATA/codeg.db.backup-$TS"
else
  echo "部署完成但自检未全通过 ❌ —— 可用 $OLD 回滚" >&2; exit 1
fi
