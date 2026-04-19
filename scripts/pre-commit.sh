#!/usr/bin/env bash
# pre-commit hook: 全量 check(lint / type / test)必须绿才能进 commit。
#
# 为什么不只跑改到的文件:
#   - import-linter / mypy / 回归测试 的正确性依赖全图,局部跑会漏
#   - check.sh 当前 <30s,机器上跑一次没问题
#   - 真的急要绕过:git commit --no-verify(但请对自己诚实)

set -euo pipefail

root="$(git rev-parse --show-toplevel)"

printf "\n\033[1;34m[pre-commit] running scripts/check.sh\033[0m\n"
"$root/scripts/check.sh"
printf "\n\033[1;32m[pre-commit] ok\033[0m\n"
