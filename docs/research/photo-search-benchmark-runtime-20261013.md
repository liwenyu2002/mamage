# Photo Search Benchmark: Official Runtime Check

Checked 2026-10-13 for the user's **Apple M5 MacBook Pro, 24 GB unified memory**, not a Mac Mini. Research only: public official documentation, source code, package metadata and small model configuration files. No installation, model-weight download, inference, private-data access, harness implementation or production change. Every runtime example below is **unexecuted**; MPS compatibility, correctness, speed and peak memory remain unmeasured.

## 1. Checkpoints and Dependency Pins

Use these exact first-party checkpoints, not the base Qwen Instruct model or a community quantization. Revisions are the public Hub heads observed during this check; keep weights, tokenizer, processor and chat templates from the same revision.

| Purpose | Checkpoint | Immutable revision |
|---|---|---|
| Chinese-CLIP ViT-B/16 baseline | `OFA-Sys/chinese-clip-vit-base-patch16` | `36e679e65c2a2fead755ae21162091293ad37834` |
| Qwen embedding | `Qwen/Qwen3-VL-Embedding-2B` | `9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda` |
| Optional Qwen reranker | `Qwen/Qwen3-VL-Reranker-2B` | `4bd860ac4f15ad1897a214615cccc700f8f71818` |

Sources: [Chinese-CLIP snapshot][CC], [embedding snapshot][QE], [reranker snapshot][QR]. Hub revision selection takes a full commit hash; a local snapshot directory prevents the helper from mixing model and processor revisions. [Hub download/revision API][HUB]

**Pin the helper source separately:** official `QwenLM/Qwen3-VL-Embedding` commit `393e2978d27852b0d0230d6994f37f9c15bed73c`. Its current imports are `src.models.qwen3_vl_embedding.Qwen3VLEmbedder` and `src.models.qwen3_vl_reranker.Qwen3VLReranker`. The model-card imports under `scripts/` refer to helpers bundled in the HF snapshots, not the current GitHub layout. Those files are not identical; do not interchange them silently. [Current embedding helper][GE], [current reranker helper][GR], [HF embedding helper][HE], [HF reranker helper][HR]

The HF cards specify `transformers>=4.57.0`, `qwen-vl-utils>=0.0.14`, `torch==2.8.0`. The pinned repository requires Python `>=3.11`, Transformers `>=4.57.3`, Torch `2.8.*`, torchvision `>=0.23.0`. **Suggested reproducible starting point: native arm64 Python 3.11 and the following exact versions taken from its official lockfile**, not a claim that these are today's newest releases or an M5-validated stack. [Embedding requirements][QE], [reranker requirements][QR], [project requirements][PROJECT], [official lockfile][LOCK]

```text
torch==2.8.0
torchvision==0.23.0
transformers==4.57.3
qwen-vl-utils==0.0.14
numpy==2.2.6
pillow==12.0.0
scipy==1.16.3
accelerate==1.12.0
huggingface-hub==0.36.0
tokenizers==0.22.1
safetensors==0.7.0
av==16.0.1
requests==2.32.5
packaging==25.0
```

This is a runtime pin subset, not a complete transitive lock. Torch 2.8.0 publishes a CPython 3.11 macOS arm64 wheel; torchvision 0.23.0 explicitly requires Torch 2.8.0. Do not upgrade only one of that pair. [Torch package metadata][TORCH-PKG], [torchvision metadata][TV-PKG]

For still-image inference, do not run the repository's broad environment setup: it includes evaluation/notebook/video dependencies. No Sentence Transformers, vLLM, SGLang or FlashAttention package is needed for the API path below. Plain `qwen-vl-utils==0.0.14` already depends on PyAV, Pillow, Requests and Packaging; `decord` is its optional extra, although the broader repository lists it directly. SciPy is imported by the reranker helper even though its scoring uses Torch. [Project requirements][PROJECT], [utility package metadata][UTIL-PKG], [reranker imports][GR]

Chinese-CLIP's pinned HF snapshot has `pytorch_model.bin` and a separate original `clip_cn_vit-b-16.pt`, **no `model.safetensors`**. For native HF `ChineseCLIPModel`, use the `.bin`, not the original `.pt`, and set `use_safetensors=False` to avoid conversion/discovery behavior. Transformers 4.57.3 requires Torch >=2.6 for its `torch.load` path, satisfied by 2.8.0. [Snapshot files][CC], [Transformers safety check][LOAD-SAFETY]

## 2. Exact APIs and Image Budgets

**Embedding:** `process(list[dict], normalize=True)` returns a Torch tensor `[N, 2048]`, despite its `tuple` annotation. Each dict accepts `text`, `image`, optional `instruction`; images can be PIL objects or paths. Use absolute ordinary paths, not pre-prefixed `file://` strings, because the helper prefixes local strings itself. It right-pads and pools the last non-padding hidden state, then L2-normalizes. The default instruction is `Represent the user's input.`; preserve it for the initial baseline. There is no `dimensions=` argument in this helper. For an optional MRL variant, slice to the desired supported dimension and normalize again; this does not reduce model-weight memory. [Current helper][GE], [embedding dimensions/card][QE]

**Reranker:** `process({"instruction": str, "query": {"text": str}, "documents": [{"image": absolute_path}, ...]})` returns a Python list of scores in document order. It formats query-document pairs, left-pads, takes the last hidden state and applies `sigmoid((w_yes - w_no) @ h)`. Higher is more relevant; these are not embeddings or calibrated relevance probabilities. The current helper loops over documents individually, not as a single inference batch. Its scoring head is a separate `score_linear` module. [Current helper][GR]

The upstream copies have different defaults:

| Helper origin | Embedding `max_length` / image cap | Reranker `max_length` / image cap |
|---|---|---|
| Pinned GitHub `src/models/` | 8192 / `1800 * 32**2` pixels | 10240 / `1800 * 32**2` pixels |
| Pinned HF `scripts/` | 8192 / `1800 * 32**2` pixels | 8192 / `1280 * 32**2` pixels |

All four helpers use `min_pixels=4 * 32**2`, explicitly call `process_vision_info(..., image_patch_size=16, ...)`, then call the processor with `do_resize=False`. The helper's image-message limits control the resize, not an assumed processor default. [GitHub embedding][GE], [GitHub reranker][GR], [HF embedding][HE], [HF reranker][HR]

- Qwen3-VL uses 16-pixel patches and spatial merge size 2: **32, not the older Qwen2-VL factor 28**. For a still image, merged visual tokens are `image_grid_thw.prod(-1) // 4`; equivalently, resized area / `32**2`. Include prompt/text tokens separately. [Checkpoint vision config][QE-CONFIG], [pinned processor implementation][PROCESSOR]
- Proposed low-budget start, **not an official accuracy/performance recommendation**: `min_pixels=4096`, `max_pixels=256 * 32**2 = 262144`, `max_length=2048`, one image per call. Optional caps 128 / 512 correspond to 131072 / 524288 pixels. The cap is an area budget with aspect-ratio/grid rounding, not a forced square resize. Validate actual `image_grid_thw` rather than assuming every photo consumes the full budget. [Image resize implementation][VISION]
- `max_length` limits tokenized content, not image resolution. Embedding uses ordinary truncation; reranking preserves special tokens and appends its final five tokens, so its setting is not an absolute memory bound. Reject unexpected truncation or image-placeholder/feature-count mismatch; reduce image pixels first. [HF embedding preprocessing][HE], [HF reranker tokenization][HR], [native model placeholder checks][NATIVE]
- Both official Qwen helpers catch vision-processing exceptions and substitute a text `NULL` input. A returned embedding/score is therefore not proof that the photo was processed. Treat their error logs, missing expected image tensors or batch-size mismatch as failed samples, not successful visual inference. [HF embedding error handling][HE], [HF reranker error handling][HR]

**Chinese-CLIP preprocessing:** the selected HF config outputs 512-dimensional features; vision input is 224 x 224, patch size 16. Its checkpoint processor explicitly uses a 224 x 224 resize with `do_center_crop=false`, not a generic CLIP center-crop assumption. Its text position limit is 512, not CLIP's usual 77. Preserve that checkpoint processor and normalize `get_text_features` / `get_image_features` yourself. [Model config][CC-CONFIG], [processor config][CC-PRE], [official feature API example][CC-CARD]

## 3. Loading Fragments for the Local Harness

These are loading/API examples only, not a harness. Use **one model per process**. The user supplies already-staged local snapshots and a checkout of the pinned Qwen source; nothing here provisions/downloads them. Set environment variables before imports:

```text
HF_HUB_OFFLINE=1
TRANSFORMERS_OFFLINE=1
HF_HUB_DISABLE_TELEMETRY=1
PYTORCH_ENABLE_MPS_FALLBACK=0
BENCH_DEVICE=cpu
BENCH_DTYPE=float32
BENCH_ATTN=eager
```

`HF_HUB_OFFLINE` stops Hub HTTP access, but is **not a general network sandbox**: Qwen image utilities accept remote URLs. Supply only local paths or locally opened PIL objects. `local_files_only=True` below is an additional loader guard. [Hub offline behavior][OFFLINE], [image URL handling][VISION]

Shared setup; `QWEN_SOURCE_DIR` is the pinned checkout root. `QUERY_TEXT` and `PHOTO_PATH` are user-provided local inputs. Each model directory variable must point to the corresponding immutable snapshot above.

```python
import os
import sys
from pathlib import Path
import torch

device = torch.device(os.environ.get("BENCH_DEVICE", "cpu"))
dtype = getattr(torch, os.environ.get("BENCH_DTYPE", "float32"))
if device.type == "mps" and not torch.backends.mps.is_available():
    raise RuntimeError("MPS unavailable; select CPU explicitly")
query = os.environ["QUERY_TEXT"]
photo = str(Path(os.environ["PHOTO_PATH"]).resolve(strict=True))
attn = os.environ.get("BENCH_ATTN", "eager")
```

Qwen embedding process; `process` has no `batch_size` keyword, so passing singleton lists gives one item per inference call. Imports and calls follow the pinned GitHub helper; explicit placement is the untested local adaptation. [Embedding source][GE]

```python
sys.path.insert(0, str(Path(os.environ["QWEN_SOURCE_DIR"]).resolve(strict=True)))
from src.models.qwen3_vl_embedding import Qwen3VLEmbedder

embedder = Qwen3VLEmbedder(
    model_name_or_path=str(Path(os.environ["QWEN_EMBED_DIR"]).resolve(strict=True)),
    torch_dtype=dtype,
    attn_implementation=attn,
    local_files_only=True,
    use_safetensors=True,
    min_pixels=4 * 32**2,
    max_pixels=256 * 32**2,
    max_length=2048,
)
embedder.model.to(device).eval()
embedder.model.config.text_config.use_cache = False
with torch.inference_mode():
    q = embedder.process([{"text": query}])
    image = embedder.process([{"image": photo}])
    cosine = (q.float() @ image.float().T).cpu()
```

Optional reranker process, using the shared setup but not retaining the embedder. Move **both** backbone and scoring head. Keep the instruction explicit. [Reranker source][GR]

```python
sys.path.insert(0, str(Path(os.environ["QWEN_SOURCE_DIR"]).resolve(strict=True)))
from src.models.qwen3_vl_reranker import Qwen3VLReranker

reranker = Qwen3VLReranker(
    model_name_or_path=str(Path(os.environ["QWEN_RERANK_DIR"]).resolve(strict=True)),
    torch_dtype=dtype,
    attn_implementation=attn,
    local_files_only=True,
    use_safetensors=True,
    min_pixels=4 * 32**2,
    max_pixels=256 * 32**2,
    max_length=2048,
)
reranker.device = device
reranker.model.to(device).eval()
reranker.model.config.text_config.use_cache = False
reranker.score_linear.to(device=device, dtype=dtype).eval()
with torch.inference_mode():
    scores = reranker.process({
        "instruction": "Retrieve images relevant to the user's query.",
        "query": {"text": query},
        "documents": [{"image": photo}],
    })
```

Chinese-CLIP process, using the shared setup; no Qwen helper checkout needed. Keep this baseline FP32 initially even when `BENCH_DEVICE=mps`; an FP16 variant is a separate untested setting. `use_fast=False` fixes the image-preprocessor implementation. [Official API][CC-CARD], [pinned native processor][CC-PROCESSOR]

```python
from PIL import Image
import torch.nn.functional as F
from transformers import ChineseCLIPModel, ChineseCLIPProcessor

clip_dir = str(Path(os.environ["CHINESE_CLIP_DIR"]).resolve(strict=True))
clip = ChineseCLIPModel.from_pretrained(
    clip_dir, local_files_only=True, use_safetensors=False,
    torch_dtype=torch.float32,
).to(device).eval()
processor = ChineseCLIPProcessor.from_pretrained(
    clip_dir, local_files_only=True, use_fast=False,
)
text_inputs = processor(
    text=[query], padding=True, truncation=True, max_length=512,
    return_tensors="pt",
).to(device)
with Image.open(photo) as source:
    image_inputs = processor(images=source.convert("RGB"), return_tensors="pt").to(device)
with torch.inference_mode():
    q = F.normalize(clip.get_text_features(**text_inputs).float(), dim=-1)
    image = F.normalize(clip.get_image_features(**image_inputs).float(), dim=-1)
    cosine = (q @ image.T).cpu()
```

## 4. MPS: Documented Facts vs Untested Choices

| Item | What the official source establishes / local consequence |
|---|---|
| Automatic device selection | Both Qwen helper constructors select CUDA if available, otherwise CPU. On this Mac, default loading is CPU, not MPS. Their `**kwargs` feed `from_pretrained`; `device="mps"` is not a wrapper placement option. Explicit `.to(device)` above is necessary for an MPS attempt. Do not combine this with `device_map="auto"` or assume Accelerate fixes wrapper placement. [Embedding][GE], [reranker][GR] |
| Native Transformers support | Version 4.57.3 contains native `Qwen3VLModel`, `Qwen3VLForConditionalGeneration`, the processor and Chinese-CLIP APIs. Use the retrieval helper rather than treating a generic generation pipeline's output as an embedding/score. Native class availability is not model-level MPS validation. [Qwen implementation][NATIVE], [Chinese-CLIP implementation][CC-NATIVE] |
| Attention | Pinned native Qwen declares SDPA support and implements eager attention. `BENCH_ATTN=eager` is a proposed diagnostic start; `sdpa` is a separate trial, neither measured here. The model-card `flash_attention_2` suggestion does not apply to this Mac: upstream FlashAttention documents CUDA/ROCm requirements, not an MPS backend. [Native attention source][NATIVE], [FlashAttention requirements][FLASH] |
| Precision | Both Qwen checkpoints declare BF16. Torch 2.8 MPS source supports FP32/FP16 and gates BF16 on macOS >=14; it does not support FP64. Do not claim BF16 is universally unsupported on Apple silicon. Proposed Qwen MPS trial: `BENCH_DEVICE=mps`, `BENCH_DTYPE=float16`; BF16 and FP32 are separate trials, with model/operator correctness still unverified. [Embedding config][QE-CONFIG], [reranker config][QR-CONFIG], [Torch 2.8 dtype source][MPS-DTYPE] |
| Availability and OS | `is_built()` checks binary support; `is_available()` checks runtime availability, not all model operators. Torch 2.8's older guide mentions macOS 12.3+; Apple's current page lists macOS 14+, Apple silicon, Python 3.10+ and Xcode tools for its stated Torch 2.11 release. Those generic requirements are not an official Qwen-on-M5 certification. [Pinned Torch guide][MPS], [Apple requirements][APPLE] |
| Unsupported-op fallback | Keep `PYTORCH_ENABLE_MPS_FALLBACK=0` for a strict MPS attempt. A separate run with `=1` permits supported CPU fallbacks and must be labelled mixed MPS/CPU, not pure MPS. It does not guarantee every failure can fall back. [Torch environment variables][MPS-ENV] |
| Memory | 24 GB unified memory is not 24 GB guaranteed model allocation. Use one model/process and small image budgets as proposed precautions; no fit/throughput claim is established. Leave allocator limits at defaults; never use `PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0` as an OOM workaround, because official docs warn of possible system failure. [Allocator documentation][MPS-ENV] |

The snippets retain the official helpers' internally hard-coded `trust_remote_code=True`; do not also pass that keyword, which would duplicate it. Review/pin helper code and use matching local snapshots. The selected configs use native `qwen3_vl` architecture, but the wrapper's trust flag is not a compatibility or security guarantee. [Helper loading][GE], [reranker loading][GR], [checkpoint config][QE-CONFIG]

**Boundary:** all benchmark execution, data inspection and measurements remain with the user. No architecture changes or production rollout are proposed here. If Torch 2.8 on the actual M5/macOS combination fails, preserve that result; a newer matched Torch/torchvision stack is a separately pinned experiment, not a silently substituted validation of this baseline.

## Primary Sources

`VISION` links to the exact official `qwen-vl-utils==0.0.14` source archive; the inspected member is `src/qwen_vl_utils/vision_process.py`. Package metadata reports archive SHA256 `9c7cad5ae803b3a10f8bb7194deb12aeacdd032f92f4224e880c73587a7346ad`. Only source text was streamed for inspection, not installed or extracted into the workspace. [Release metadata][UTIL-PKG]

[CC]: https://huggingface.co/OFA-Sys/chinese-clip-vit-base-patch16/tree/36e679e65c2a2fead755ae21162091293ad37834
[CC-CARD]: https://huggingface.co/OFA-Sys/chinese-clip-vit-base-patch16/blob/36e679e65c2a2fead755ae21162091293ad37834/README.md
[QE]: https://huggingface.co/Qwen/Qwen3-VL-Embedding-2B/blob/9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda/README.md
[QR]: https://huggingface.co/Qwen/Qwen3-VL-Reranker-2B/blob/4bd860ac4f15ad1897a214615cccc700f8f71818/README.md
[GE]: https://github.com/QwenLM/Qwen3-VL-Embedding/blob/393e2978d27852b0d0230d6994f37f9c15bed73c/src/models/qwen3_vl_embedding.py
[GR]: https://github.com/QwenLM/Qwen3-VL-Embedding/blob/393e2978d27852b0d0230d6994f37f9c15bed73c/src/models/qwen3_vl_reranker.py
[HE]: https://huggingface.co/Qwen/Qwen3-VL-Embedding-2B/blob/9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda/scripts/qwen3_vl_embedding.py
[HR]: https://huggingface.co/Qwen/Qwen3-VL-Reranker-2B/blob/4bd860ac4f15ad1897a214615cccc700f8f71818/scripts/qwen3_vl_reranker.py
[PROJECT]: https://github.com/QwenLM/Qwen3-VL-Embedding/blob/393e2978d27852b0d0230d6994f37f9c15bed73c/pyproject.toml
[LOCK]: https://github.com/QwenLM/Qwen3-VL-Embedding/blob/393e2978d27852b0d0230d6994f37f9c15bed73c/uv.lock
[QE-CONFIG]: https://huggingface.co/Qwen/Qwen3-VL-Embedding-2B/blob/9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda/config.json
[QR-CONFIG]: https://huggingface.co/Qwen/Qwen3-VL-Reranker-2B/blob/4bd860ac4f15ad1897a214615cccc700f8f71818/config.json
[CC-CONFIG]: https://huggingface.co/OFA-Sys/chinese-clip-vit-base-patch16/blob/36e679e65c2a2fead755ae21162091293ad37834/config.json
[CC-PRE]: https://huggingface.co/OFA-Sys/chinese-clip-vit-base-patch16/blob/36e679e65c2a2fead755ae21162091293ad37834/preprocessor_config.json
[CC-PROCESSOR]: https://github.com/huggingface/transformers/blob/v4.57.3/src/transformers/models/chinese_clip/processing_chinese_clip.py
[CC-NATIVE]: https://github.com/huggingface/transformers/blob/v4.57.3/src/transformers/models/chinese_clip/modeling_chinese_clip.py
[NATIVE]: https://github.com/huggingface/transformers/blob/v4.57.3/src/transformers/models/qwen3_vl/modeling_qwen3_vl.py
[PROCESSOR]: https://github.com/huggingface/transformers/blob/v4.57.3/src/transformers/models/qwen3_vl/processing_qwen3_vl.py
[VISION]: https://files.pythonhosted.org/packages/b6/b1/ad4fc2260a3badd278b38d642f3b987412f1f6682f0ef2b31b0572d5caa8/qwen_vl_utils-0.0.14.tar.gz
[LOAD-SAFETY]: https://github.com/huggingface/transformers/blob/v4.57.3/src/transformers/utils/import_utils.py#L1645-L1652
[TORCH-PKG]: https://pypi.org/pypi/torch/2.8.0/json
[TV-PKG]: https://pypi.org/pypi/torchvision/0.23.0/json
[UTIL-PKG]: https://pypi.org/pypi/qwen-vl-utils/0.0.14/json
[HUB]: https://huggingface.co/docs/huggingface_hub/guides/download
[OFFLINE]: https://huggingface.co/docs/huggingface_hub/package_reference/environment_variables#hfhuboffline
[FLASH]: https://github.com/Dao-AILab/flash-attention#installation-and-features
[MPS]: https://docs.pytorch.org/docs/2.8/notes/mps.html
[MPS-ENV]: https://docs.pytorch.org/docs/2.8/mps_environment_variables.html
[MPS-DTYPE]: https://github.com/pytorch/pytorch/blob/v2.8.0/aten/src/ATen/native/mps/OperationUtils.h#L627-L649
[APPLE]: https://developer.apple.com/metal/pytorch/
