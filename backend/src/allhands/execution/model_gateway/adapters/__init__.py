"""Concrete model adapters · one file per (provider, modality) pair.

Add a new file here for each provider you onboard:
  openai_image.py     · OpenAI gpt-image-* / dall-e-3 (image gen)
  dashscope_image.py  · DashScope wanx (image gen · async polling)
  imagen.py           · Vertex Imagen 4 (image gen · later)
  flux.py             · Black Forest Labs FLUX (image gen · later)
  veo_video.py        · Vertex Veo (video gen · later)
  wanx_video.py       · DashScope wanx-video (video gen · later)
  openai_audio.py     · OpenAI TTS / Whisper (audio · later)
  ...

Adding a provider/modality pair is purely additive: write the file,
register it once in api/deps.py · the gateway / tools / UI all light up.
"""

from __future__ import annotations

from .dashscope_image import DashScopeImageAdapter
from .openai_image import ImageProviderError, OpenAIImageAdapter

__all__ = [
    "DashScopeImageAdapter",
    "ImageProviderError",
    "OpenAIImageAdapter",
]
