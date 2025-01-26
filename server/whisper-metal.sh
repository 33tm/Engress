#/bin/bash

virtualenv .venv --python=python3.10

if [ ! -d "whisper" ]; then
    git clone https://github.com/ggerganov/whisper.cpp whisper
fi

pip3 install -r whisper/models/requirements-coreml.txt

# The requirements-coreml.txt is clearly very useful
pip3 install "numpy<2"
pip3 install "torch==2.5.0"

curl -O https://mac.r-project.org/openmp/openmp-14.0.6-darwin20-Release.tar.gz
sudo tar fvxz openmp-14.0.6-darwin20-Release.tar.gz -C /
rm openmp-14.0.6-darwin20-Release.tar.gz

sh whisper/models/download-ggml-model.sh large-v3-turbo
sh whisper/models/generate-coreml-model.sh large-v3-turbo

cmake -B whisper/build -S whisper -DWHISPER_COREML=1
cmake --build whisper/build --config Release