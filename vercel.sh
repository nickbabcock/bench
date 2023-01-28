#!/usr/bin/env bash

# Forgive me vercel, but we need clang to compile some wasm packages

set -euxo pipefail

CLANG_VERSION=clang+llvm-15.0.6-x86_64-linux-gnu-ubuntu-18.04

curl -O -L "https://github.com/llvm/llvm-project/releases/download/llvmorg-15.0.6/$CLANG_VERSION.tar.xz"
tar -axf $CLANG_VERSION.tar.xz

export PATH="$PWD/$CLANG_VERSION/bin:$PATH"

curl https://sh.rustup.rs -sSf | sh -s -- -y 
npm install -g wasm-pack
source $HOME/.cargo/env
npm run build
