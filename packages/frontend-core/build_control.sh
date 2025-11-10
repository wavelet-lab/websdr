#!/usr/bin/env bash
# Script to build control library WebAssembly module using Emscripten

BUILD_SCRIPT="../../scripts/build_wasm_library.sh"

NEED_CLONE=1 # 0 - no clone, 1 - git clone, 2 - copy from $LOCAL_LIB_PATH
NEED_BUILD=2 # 0 - no build, 1 - build, 2 - rebuild

LIB_NAME="control"
LIB_GIT_REPO="https://github.com/wavelet-lab/usdr-lib.git"
LIB_GIT_BRANCH="main"
LIB_CMAKE_PATH="src/lib/webusb/emlib"

EXPORTED_RUNTIME_METHODS="HEAPF32,HEAPU32,HEAP32,HEAPU16,HEAP16,HEAPU8,HEAP8,ccall,cwrap,stringToAscii,AsciiToString"
ASYNCIFY_IMPORTS="write_ep1,write_ep2,read_ep1,read_ep2,write_log_js"

set -eo pipefail

# call the generic build script with the parameters
NEED_CLONE=${NEED_CLONE} \
NEED_BUILD=${NEED_BUILD} \
LIB_NAME=${LIB_NAME} \
LIB_GIT_REPO=${LIB_GIT_REPO} \
LIB_GIT_BRANCH=${LIB_GIT_BRANCH} \
LIB_CMAKE_PATH=${LIB_CMAKE_PATH} \
EXPORTED_RUNTIME_METHODS=${EXPORTED_RUNTIME_METHODS} \
ASYNCIFY_IMPORTS=${ASYNCIFY_IMPORTS} \
${BUILD_SCRIPT}
