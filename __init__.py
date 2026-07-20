"""
ComfyUI Resource Monitor
A lightweight resource monitor for ComfyUI showing CPU, GPU, RAM, VRAM, and disk usage.
Based on the resource monitor from ComfyUI-Crystools by crystian.
"""
import logging

logger = logging.getLogger("ResourceMonitor")

try:
    from .monitor import setup as monitor_setup
    monitor_setup()
    logger.info("Resource Monitor loaded successfully.")
except Exception as e:
    logger.error(f"Failed to load Resource Monitor: {e}")

WEB_DIRECTORY = "./web"

# ComfyUI requires these exports to recognize the extension
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
