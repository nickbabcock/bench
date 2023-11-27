ARG NODE_VERSION=20
FROM mcr.microsoft.com/devcontainers/javascript-node:1.0-${NODE_VERSION}-bookworm
ARG WASM_OPT_VERSION=version_116

RUN apt-get update && apt-get install -y \
      clang \
      curl  \
    && \
    rm -rf /var/lib/apt/lists/* && \
    MY_TMP="$(mktemp -d)" && \
    curl -o "$MY_TMP/binaryen.tar.gz" -L "https://github.com/WebAssembly/binaryen/releases/download/${WASM_OPT_VERSION}/binaryen-${WASM_OPT_VERSION}-x86_64-linux.tar.gz" && \
    (cd "$MY_TMP" && tar -xzf "binaryen.tar.gz") && \
    mv "$MY_TMP/binaryen-$WASM_OPT_VERSION/bin/wasm-opt" "/usr/local/bin/." && \
    rm -rf "$MY_TMP"

USER node
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- --profile minimal --component rustfmt --component clippy -y && \
    . $HOME/.cargo/env && \
    npm install -g wasm-pack@0.10.1 vercel && \
    rustup target add wasm32-unknown-unknown
