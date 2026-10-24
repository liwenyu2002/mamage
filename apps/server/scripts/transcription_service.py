"""Private streaming whisper.cpp adapter; exposed only over the inference tunnel."""
import asyncio
import hmac
import json
import os
from pathlib import Path
import re
import tempfile
import time

from fastapi import APIRouter, HTTPException, Request

router = APIRouter()
_slot = asyncio.Semaphore(1)
MAX_AUDIO_BYTES = 512 * 1024 * 1024


def _authorize(request):
    token = os.environ.get("VIDEO_TRANSCRIPT_SERVICE_TOKEN", "")
    if len(token) < 32:
        raise HTTPException(status_code=503, detail="transcription not configured")
    if not hmac.compare_digest(request.headers.get("authorization", ""), "Bearer " + token):
        raise HTTPException(status_code=401, detail="unauthorized")


def _assets():
    root = Path.home() / "whisper.cpp"
    cli = Path(os.environ.get("VIDEO_TRANSCRIPT_WHISPER_CLI", str(root / "build/bin/whisper-cli")))
    model = Path(os.environ.get("VIDEO_TRANSCRIPT_MODEL_PATH", str(root / "models/ggml-large-v3-q5_0.bin")))
    if not cli.is_file() or not os.access(cli, os.X_OK) or not model.is_file():
        raise HTTPException(status_code=503, detail="transcription assets unavailable")
    return cli, model


@router.get("/transcribe/health")
async def health(request: Request):
    _authorize(request)
    _assets()
    return {"ok": True, "provider": "whisper.cpp"}


async def _run_whisper(request, audio, output, language):
    cli, model = _assets()
    threads = max(1, min(12, int(os.environ.get("VIDEO_TRANSCRIPT_THREADS", "4"))))
    prompt = os.environ.get("VIDEO_TRANSCRIPT_PROMPT", "中关村学院，北京大学，团代会，校园融媒体，学生工作")[:2000]
    command = [str(cli), "-m", str(model), "-f", str(audio), "-l", language,
               "-t", str(threads), "-oj", "-of", str(output), "-np"]
    if prompt:
        command += ["--prompt", prompt]
    process = await asyncio.create_subprocess_exec(*command, stdout=asyncio.subprocess.DEVNULL,
                                                   stderr=asyncio.subprocess.PIPE)

    async def drain_errors():
        tail = b""
        while True:
            chunk = await process.stderr.read(4096)
            if not chunk:
                return tail
            tail = (tail + chunk)[-4096:]

    errors = asyncio.create_task(drain_errors())
    waiting = asyncio.create_task(process.wait())
    deadline = time.monotonic() + min(14400, max(120, int(os.environ.get("VIDEO_TRANSCRIPT_TIMEOUT_MS", "14400000")) // 1000))
    try:
        while not waiting.done():
            await asyncio.wait([waiting], timeout=1)
            if time.monotonic() >= deadline:
                raise HTTPException(status_code=504, detail="transcription timed out")
            if await request.is_disconnected():
                raise HTTPException(status_code=499, detail="client disconnected")
        if await waiting != 0:
            # Internal paths and model stderr must not be returned to the caller.
            raise HTTPException(status_code=502, detail="transcription failed")
        result = Path(str(output) + ".json")
        if not result.is_file() or result.stat().st_size > 16 * 1024 * 1024:
            raise HTTPException(status_code=502, detail="invalid transcription output")
        payload = json.loads(result.read_text(encoding="utf-8"))
        return {"transcription": payload.get("transcription", [])}
    finally:
        if process.returncode is None:
            process.kill()
        await waiting
        await errors


@router.post("/transcribe")
async def transcribe(request: Request):
    _authorize(request)
    _assets()
    if request.headers.get("content-type", "").split(";", 1)[0] != "audio/wav":
        raise HTTPException(status_code=415, detail="WAV required")
    language = request.headers.get("x-mamage-language", "zh")
    if not re.fullmatch(r"(?:[a-z]{2,3}|auto)", language):
        raise HTTPException(status_code=400, detail="invalid language")
    length = request.headers.get("content-length")
    if length and (not length.isdigit() or int(length) > MAX_AUDIO_BYTES):
        raise HTTPException(status_code=413, detail="audio too large")
    if _slot.locked():
        raise HTTPException(status_code=429, detail="transcription busy", headers={"Retry-After": "15"})
    async with _slot:
        with tempfile.TemporaryDirectory(prefix="mamage-remote-transcript-") as directory:
            audio = Path(directory) / "audio.wav"
            size = 0
            prefix = b""
            with audio.open("wb") as output:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > MAX_AUDIO_BYTES:
                        raise HTTPException(status_code=413, detail="audio too large")
                    if len(prefix) < 12:
                        prefix = (prefix + chunk)[:12]
                    output.write(chunk)
            if size < 44 or prefix[:4] != b"RIFF" or prefix[8:12] != b"WAVE":
                raise HTTPException(status_code=422, detail="invalid WAV")
            return await _run_whisper(request, audio, Path(directory) / "transcript", language)
