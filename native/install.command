#!/bin/zsh
set -eu
XVC_PACKAGE_DIR="${0:A:h}"
XVC_HOST="$XVC_PACKAGE_DIR/xvc-host"
if [[ ! -x "$XVC_HOST" ]]; then XVC_HOST="$XVC_PACKAGE_DIR/build/xvc-host"; fi
"$XVC_HOST" --install
printf '\n安装完成，可以关闭此窗口。\n'
