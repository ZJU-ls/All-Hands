"""Concrete model adapters · one file per (provider, modality) pair.

Add a new file here for each provider you onboard:
  openai_image.py     · OpenAI gpt-image-* / dall-e-3 (image gen)
  dashscope_image.py  · DashScope wanx (image gen · async polling)
  dashscope_video.py  · DashScope wanx-video / wan2.x-t2v (video gen · async polling)
  dashscope_audio.py  · DashScope cosyvoice / sambert (TTS · async polling)
  imagen.py           · Vertex Imagen 4 (image gen · later)
  flux.py             · Black Forest Labs FLUX (image gen · later)
  veo_video.py        · Vertex Veo (video gen · later)
  openai_audio.py     · OpenAI TTS / Whisper (audio · later)
  ...

Adding a provider/modality pair is purely additive: write the file,
register it once in api/deps.py · the gateway / tools / UI all light up.
"""

from __future__ import annotations

from .dashscope_audio import AudioProviderError, DashScopeAudioAdapter
from .dashscope_image import DashScopeImageAdapter
from .dashscope_video import DashScopeVideoAdapter, VideoProviderError
from .openai_image import ImageProviderError, OpenAIImageAdapter

__all__ = [
    "AudioProviderError",
    "DashScopeAudioAdapter",
    "DashScopeImageAdapter",
    "DashScopeVideoAdapter",
    "ImageProviderError",
    "OpenAIImageAdapter",
    "VideoProviderError",
]
