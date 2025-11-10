#!/usr/bin/env bash
# Script to build any library WebAssembly module using Emscripten
# Variables (can be overridden by environment variables):
#   NEED_CLONE - whether to clone the library repo (1), copy from local path (2), or skip cloning (0), default 1
#   NEED_BUILD - whether to build the library (1), rebuild (2), or skip building (0), default 2
#   LIB_NAME - name of the library (must be set)
#   LIB_GIT_REPO - git repository URL of the library (must be set if NEED_CLONE=1)
#   LIB_GIT_BRANCH - git branch to checkout (optional, used if NEED_CLONE=1)
#   LIB_CMAKE_PATH - path to the CMakeLists.txt within the library repo (must be set if NEED_BUILD=1 or 2)
#   EXPORTED_RUNTIME_METHODS - list of Emscripten runtime methods to export (default: [])
#   ASYNCIFY_IMPORTS - list of Emscripten asyncify imports (default: [])
#   LOCAL_LIB_PATH - local path to copy the library from if NEED_CLONE=2 (default: ../../../${LIB_NAME})
#   CLONE_LIB_PATH - path to clone the library into (default: ${LIB_NAME})
#   SRC_LIB_PATH - path to the source directory where output files will be placed (default: src/${LIB_NAME})

set -eo pipefail

NEED_CLONE=${NEED_CLONE:-1} # 0 - no clone, 1 - git clone, 2 - copy from $LOCAL_LIB_PATH
NEED_BUILD=${NEED_BUILD:-2} # 0 - no build, 1 - build, 2 - rebuild

LIB_NAME=${LIB_NAME}
LIB_GIT_REPO=${LIB_GIT_REPO}
LIB_GIT_BRANCH=${LIB_GIT_BRANCH}
LIB_CMAKE_PATH=${LIB_CMAKE_PATH}

EXPORTED_RUNTIME_METHODS=${EXPORTED_RUNTIME_METHODS}
ASYNCIFY_IMPORTS=${ASYNCIFY_IMPORTS}

# verify LIB_NAME set
if [ -z "$LIB_NAME" ] ; then
  echo "Error: LIB_NAME must be set."
  exit 1
fi

# paths
LOCAL_LIB_PATH=${LOCAL_LIB_PATH:-"../../../${LIB_NAME}"} # used if NEED_CLONE=2
CLONE_LIB_PATH=${CLONE_LIB_PATH:-"${LIB_NAME}"}
SRC_LIB_PATH=${SRC_LIB_PATH:-"src/${LIB_NAME}"}

# ensure emscripten tools present
emsdk_files=("emcc" "emcmake" "emmake" )
for emsdk_file in "${emsdk_files[@]}"; do
  if ! command -v "$emsdk_file" >/dev/null 2>&1 ; then
    echo "Error: $emsdk_file not found in PATH. Make sure Emscripten SDK is activated."
    exit 2
  fi
done

if [ "$NEED_CLONE" == "1" ] ; then
  # cloning library
  if [ -z "$LIB_GIT_REPO" ] || [ -z "$CLONE_LIB_PATH" ] ; then
    echo "Error: LIB_GIT_REPO and CLONE_LIB_PATH or LIB_NAME must be set when NEED_CLONE=1."
    exit 1
  fi
  rm -rf "${CLONE_LIB_PATH}"
  if [ -n "$LIB_GIT_BRANCH" ] ; then
    git clone --branch "${LIB_GIT_BRANCH}" "${LIB_GIT_REPO}" "${CLONE_LIB_PATH}"
    exit_code=$?
  else
    git clone "${LIB_GIT_REPO}" "${CLONE_LIB_PATH}"
    exit_code=$?
  fi
  if [ $exit_code -ne 0 ] ; then
    echo "Error: git clone failed with exit code $exit_code."
    exit $exit_code
  fi
fi

if [ "$NEED_CLONE" == "2" ] ; then
  # copying library from local path
  if [ -z "$LOCAL_LIB_PATH" ] || [ -z "$CLONE_LIB_PATH" ] ; then
    echo "Error: LOCAL_LIB_PATH and CLONE_LIB_PATH or LIB_NAME must be set when NEED_CLONE=2."
    exit 1
  fi
  rm -rf "${CLONE_LIB_PATH}"
  cp -R "${LOCAL_LIB_PATH}" "${CLONE_LIB_PATH}"
fi

if [ "$NEED_BUILD" == "1" ] || [ "$NEED_BUILD" == "2" ] ; then
  # building library
  if [ -z "$CLONE_LIB_PATH" ] || [ -z "$LIB_CMAKE_PATH" ] ; then
    echo "Error: CLONE_LIB_PATH and LIB_CMAKE_PATH must be set when NEED_BUILD=1 or 2."
    exit 1
  fi
  old_pwd=$(pwd)
  cd "${CLONE_LIB_PATH}"
  if [ "$NEED_BUILD" == "2" ] ; then
    rm -rf build
  fi
  if [ ! -d build ] ; then
    mkdir build
  fi
  cd build
  emcmake cmake -DCMAKE_BUILD_TYPE=Release ../${LIB_CMAKE_PATH}
  emmake make # VERBOSE=1
  cd "$old_pwd"
fi

# verify necessary files present
lib_files=(
  "${SRC_LIB_PATH}/${LIB_NAME}.d.ts"
  "${SRC_LIB_PATH}/pre.js"
  "${CLONE_LIB_PATH}/build/lib${LIB_NAME}.a"
)
for lib_file in "${lib_files[@]}"; do
  if [ ! -f "$lib_file" ] ; then
    echo "Error: $lib_file not found."
    exit 3
  fi
done

# comma-separated list of exported functions, based on .d.ts file content
exported_functions=$(sed -n 's/^[[:space:]]*\([A-Za-z0-9_]*\)[[:space:]]*(.*/\1/p' ${SRC_LIB_PATH}/${LIB_NAME}.d.ts | paste -sd, -)

# add malloc and free
if [ -n "$exported_functions" ]; then
  exported_functions="${exported_functions},"
fi
exported_functions="${exported_functions}_malloc,_free"

# Ensure no spaces in the final list
exported_functions="${exported_functions// /}"

# args for emcc
args=(
  ${CLONE_LIB_PATH}/build/lib${LIB_NAME}.a
  -o ${SRC_LIB_PATH}/${LIB_NAME}.js
  -sEXPORTED_RUNTIME_METHODS=[${EXPORTED_RUNTIME_METHODS}]
  -sEXPORTED_FUNCTIONS=[$exported_functions]
  -sASSERTIONS=1
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sASYNCIFY=1
  -sLLD_REPORT_UNDEFINED=1
  -sSINGLE_FILE=0
  -sASYNCIFY_IMPORTS=[${ASYNCIFY_IMPORTS}]
  # -sALLOW_MEMORY_GROWTH=1
  # -sDETERMINISTIC=1
)

# include pre.js and post.js if they exist
if [ -f ${SRC_LIB_PATH}/pre.js ]; then
  args+=(--extern-pre-js ${SRC_LIB_PATH}/pre.js)
fi

if [ -f ${SRC_LIB_PATH}/post.js ]; then
  args+=(--extern-post-js ${SRC_LIB_PATH}/post.js)
fi

mode="${1:-optimized}"

case $mode in
  # best build time and unminified
  dev)
    ;;

  # best runtime performance (minified)
  optimized)
    args+=(-O3)
    ;;

  # The following options can be useful for wasm memory debugging.
  # See also https://emscripten.org/docs/debugging/Sanitizers.html

  sanitize-address)
    args+=(-fsanitize=address)
    ;;

  sanitize-undefined)
    args+=(-fsanitize=undefined)
    ;;

  safe-heap)
    args+=(-sSAFE_HEAP=1 -sSAFE_HEAP_LOG=1)
    ;;

  *)
    echo "usage: $0 dev | optimized | sanitize-address | sanitize-undefined | safe-heap"
    exit 1
esac

echo "building in $mode mode"
echo "emcc ${args[@]}"
emcc ${args[@]}
