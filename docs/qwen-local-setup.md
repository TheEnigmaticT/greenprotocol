# Qwen Local Endpoint Configuration

This guide covers setting up Qwen3-32B or Qwen3-72B on an M5 Mac Studio (256GB RAM) via Ollama or vLLM to serve as a local LLM endpoint for greenchemistry.ai.

## Prerequisites

- M5 Mac Studio with 256GB RAM
- macOS with Homebrew installed
- At least 40GB free disk space for Qwen3-32B (80GB for Qwen3-72B)

## Option 1: Ollama (Recommended for Simplicity)

### Installation

```bash
# Install Ollama
brew install ollama

# Start Ollama service (runs in background)
brew services start ollama
```

### Pull Qwen Model

```bash
# For Qwen3-32B (recommended starting point)
ollama pull qwen2.5:32b

# Or for Qwen3-72B (requires more RAM/compute)
ollama pull qwen2.5:72b
```

### Test the Endpoint

```bash
# Verify Ollama is serving
curl http://localhost:11434/v1/models

# Test a chat completion
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen2.5:32b",
    "messages": [{"role": "user", "content": "What is green chemistry?"}],
    "temperature": 0.0
  }'
```

### Configure greenchemistry.ai

Add to `.env.local`:

```bash
# Qwen via Ollama (OpenAI-compatible)
LOCAL_LLM_URL=http://localhost:11434
LLM_MODEL=qwen2.5:32b

# Optional: Comment out ANTHROPIC_API_KEY to force local inference
# ANTHROPIC_API_KEY=
```

**Model selection priority:** The chemistry service (`services/chemistry/llm_client.py`) checks `ANTHROPIC_API_KEY` first, then falls back to `LOCAL_LLM_URL`. To use Qwen exclusively, comment out the Anthropic key.

## Option 2: vLLM (For Production Throughput)

vLLM offers better batching and throughput for high-concurrency scenarios.

### Installation

```bash
# Install vLLM (requires Python 3.10+)
pip3 install vllm

# Or via conda
conda install -c conda-forge vllm
```

### Start vLLM Server

```bash
# Qwen3-32B with OpenAI-compatible API
python3 -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen2.5-32B-Instruct \
  --host 127.0.0.1 \
  --port 8080 \
  --dtype float16

# Or for Qwen3-72B
python3 -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen2.5-72B-Instruct \
  --host 127.0.0.1 \
  --port 8080 \
  --dtype float16 \
  --tensor-parallel-size 2
```

**Note:** vLLM will automatically download the model from HuggingFace on first run. This may take 30-60 minutes depending on your connection.

### Test the Endpoint

```bash
# Verify vLLM is serving
curl http://localhost:8080/v1/models

# Test a chat completion
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen2.5-32B-Instruct",
    "messages": [{"role": "user", "content": "What is green chemistry?"}],
    "temperature": 0.0
  }'
```

### Configure greenchemistry.ai

Add to `.env.local`:

```bash
# Qwen via vLLM (OpenAI-compatible)
LOCAL_LLM_URL=http://localhost:8080
LLM_MODEL=Qwen/Qwen2.5-32B-Instruct

# Optional: Comment out ANTHROPIC_API_KEY to force local inference
# ANTHROPIC_API_KEY=
```

## Model Selection

| Model | Parameters | RAM Required | Speed | Use Case |
|-------|------------|--------------|-------|----------|
| Qwen2.5-32B | 32B | ~70GB | Fast | Development, testing, most production workloads |
| Qwen2.5-72B | 72B | ~150GB | Moderate | High-accuracy scenarios, complex chemistry reasoning |

**Recommendation:** Start with Qwen2.5-32B. The 72B model requires significantly more RAM and compute, and the quality improvement is incremental for most green chemistry tasks.

## Startup Instructions

### Quick Start (Ollama)

Single command to start Qwen3-32B:

```bash
ollama serve &
sleep 5  # Wait for Ollama to start
ollama pull qwen2.5:32b  # Only needed first time
```

Add to your shell rc file (`.zshrc`, `.bashrc`) for automatic startup:

```bash
# Auto-start Ollama on shell init (optional)
if ! pgrep -x "ollama" > /dev/null; then
  ollama serve > /dev/null 2>&1 &
fi
```

### Quick Start (vLLM)

Create a startup script `start-qwen.sh`:

```bash
#!/bin/bash
# Start Qwen3-32B via vLLM
python3 -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen2.5-32B-Instruct \
  --host 127.0.0.1 \
  --port 8080 \
  --dtype float16 \
  > ~/logs/vllm-qwen.log 2>&1 &

echo "vLLM server starting on http://localhost:8080"
echo "Logs: ~/logs/vllm-qwen.log"
```

Make it executable:

```bash
chmod +x start-qwen.sh
mkdir -p ~/logs
./start-qwen.sh
```

## Verification

Once configured, test the greenchemistry.ai pipeline:

```bash
# From greenchemistry-ai root directory
cd services/chemistry

# Run the test suite (includes LLM calls)
pytest tests/ -v

# Or manually test the LLM client
python3 -c "
import asyncio
from llm_client import call_llm

async def test():
    response = await call_llm('What is atom economy in green chemistry?')
    print(f'Response: {response}')

asyncio.run(test())
"
```

Expected output: A coherent explanation of atom economy without errors.

## Troubleshooting

### "Connection refused" errors

**Cause:** Ollama/vLLM server not running.

**Fix:**
```bash
# For Ollama
brew services restart ollama
ollama list  # Should show downloaded models

# For vLLM
pkill -f vllm  # Kill any stale processes
./start-qwen.sh  # Restart
```

### Slow response times

**Cause:** Model too large for available RAM, swapping to disk.

**Fix:** Switch to a smaller model:
```bash
# Downgrade from 72B to 32B
ollama pull qwen2.5:32b
# Update .env.local: LLM_MODEL=qwen2.5:32b
```

### "Model not found" errors

**Cause:** Model name mismatch between config and server.

**Fix:** Verify model name matches exactly:
```bash
# Ollama
ollama list

# vLLM
curl http://localhost:8080/v1/models | jq '.data[].id'
```

Update `.env.local` `LLM_MODEL` to match the exact name from the server.

## Performance Notes

- **First call latency:** 2-5 seconds (model load + inference)
- **Subsequent calls:** 200-500ms for short completions
- **Token throughput:** ~30-50 tokens/second on M5 Mac Studio (32B model)

For production workloads with many concurrent users, consider running vLLM on a dedicated GPU server.

## Next Steps

- Benchmark Qwen vs Claude Sonnet (see BACKLOG task `t_d28f8da8`)
- Validate structured output schemas with Qwen (see BACKLOG task `t_7ebb66cf`)
- Monitor token costs and latency via pipeline traces (see BACKLOG task `t_7028b7fa`)

## References

- [Ollama Documentation](https://ollama.ai/docs)
- [vLLM Documentation](https://docs.vllm.ai/)
- [Qwen2.5 Model Card](https://huggingface.co/Qwen/Qwen2.5-32B-Instruct)
- [OpenAI API Compatibility](https://platform.openai.com/docs/api-reference/chat)
