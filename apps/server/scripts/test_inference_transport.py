import base64
import os
from pathlib import Path
import unittest
from unittest.mock import patch

import cv2
import numpy as np
from fastapi import HTTPException
from scripts.face_embed_service import DetectRequest, FaceRuntime
from scripts import transcription_service as asr

TOKEN = "test-only-inference-transport-token-123456789"


class FaceBytesTests(unittest.TestCase):
    def test_inline_image_has_no_file_or_private_payload_in_source(self):
        _, encoded = cv2.imencode(".jpg", np.zeros((16, 24, 3), dtype=np.uint8))
        request = DetectRequest(imageBase64=base64.b64encode(encoded).decode("ascii"))
        image, source, kind = FaceRuntime()._read_image(request)
        self.assertEqual(image.shape, (16, 24, 3))
        self.assertEqual((source, kind), ("inline-selfie", "bytes"))
        for bad in (DetectRequest(imageBase64="invalid!"), DetectRequest(imageBase64=request.imageBase64, imagePath="/tmp/not-shared")):
            with self.assertRaises(HTTPException) as error:
                FaceRuntime()._read_image(bad)
            self.assertEqual(error.exception.status_code, 400)


class Request:
    def __init__(self, data, token=TOKEN):
        self.headers = {"authorization": "Bearer " + token, "content-type": "audio/wav"}
        self.data = data

    async def stream(self):
        for offset in range(0, len(self.data), 5):
            yield self.data[offset:offset + 5]


class AudioTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_streaming_auth_validation_and_temporary_cleanup(self):
        wav = b"RIFF" + b"\x00" * 4 + b"WAVE" + b"\x00" * 64
        paths = []

        async def fake_whisper(_request, audio, _output, language):
            self.assertEqual(audio.read_bytes(), wav)
            self.assertEqual(language, "zh")
            paths.append(audio)
            return {"transcription": [{"text": "fixture"}]}

        with patch.dict(os.environ, {"VIDEO_TRANSCRIPT_SERVICE_TOKEN": TOKEN}), \
             patch.object(asr, "_assets", return_value=(Path("/bin/true"), Path("/tmp/test-only-model"))), \
             patch.object(asr, "_run_whisper", side_effect=fake_whisper):
            self.assertEqual((await asr.transcribe(Request(wav)))["transcription"][0]["text"], "fixture")
            self.assertFalse(paths[0].exists())
            for request, expected in ((Request(wav, "wrong"), 401), (Request(b"bad-wav"), 422)):
                with self.assertRaises(HTTPException) as error:
                    await asr.transcribe(request)
                self.assertEqual(error.exception.status_code, expected)
            with patch.object(asr, "MAX_AUDIO_BYTES", 44):
                with self.assertRaises(HTTPException) as error:
                    await asr.transcribe(Request(wav))
                self.assertEqual(error.exception.status_code, 413)
            await asr._slot.acquire()
            try:
                with self.assertRaises(HTTPException) as error:
                    await asr.transcribe(Request(wav))
                self.assertEqual(error.exception.status_code, 429)
            finally:
                asr._slot.release()
            self.assertFalse(asr._slot.locked())


if __name__ == "__main__":
    unittest.main()
