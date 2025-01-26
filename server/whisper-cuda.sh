#/bin/bash

source .env

if [ ! -d "whisper" ]; then
    git clone https://github.com/ggerganov/whisper.cpp whisper
fi

sh whisper/models/download-ggml-model.sh $MODEL

cmake -B whisper/build -S whisper -DGGML_CUDA=1
cmake --build whisper/build --config Release