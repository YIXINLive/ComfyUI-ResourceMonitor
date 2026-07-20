"""
Server-side resource monitor for ComfyUI.
Collects CPU, GPU, RAM, VRAM, and storage usage data and sends it to the frontend via WebSocket.
"""
import asyncio
import logging
import threading
import time

import psutil
from server import PromptServer
from aiohttp import web

logger = logging.getLogger("ResourceMonitor")
logger.propagate = False
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("[%(name)s] %(message)s"))
    logger.addHandler(handler)
logger.setLevel(logging.INFO)

_lock = threading.Lock()


class GPUInfo:
    """Monitors GPU utilization, VRAM, and temperature via pynvml."""

    def __init__(self):
        self.pynvml = None
        self.pynvml_loaded = False
        self.cuda_available = False
        self.torch_device = "cpu"
        self.gpu_names = []
        self.gpus_utilization = []
        self.gpus_vram = []
        self.gpus_temperature = []
        self._handles = []

        try:
            import torch
            import comfy.model_management
            self.torch_device = comfy.model_management.get_torch_device_name(
                comfy.model_management.get_torch_device()
            )
            self.cuda_available = torch.cuda.is_available()
        except Exception as e:
            logger.debug(f"Could not detect torch device: {e}")

        try:
            import pynvml
            self.pynvml = pynvml
            self.pynvml.nvmlInit()
            self.pynvml_loaded = True
            logger.info("pynvml (NVIDIA) initialized.")
        except ImportError:
            logger.info("pynvml not installed. GPU monitoring disabled.")
        except Exception as e:
            logger.warning(f"Could not init pynvml: {e}")

        if self.pynvml_loaded:
            try:
                count = self.pynvml.nvmlDeviceGetCount()
                for i in range(count):
                    handle = self.pynvml.nvmlDeviceGetHandleByIndex(i)
                    name = self.pynvml.nvmlDeviceGetName(handle)
                    if isinstance(name, bytes):
                        name = name.decode("utf-8", errors="ignore")
                    self.gpu_names.append(name)
                    self.gpus_utilization.append(True)
                    self.gpus_vram.append(True)
                    self.gpus_temperature.append(True)
                    self._handles.append(handle)
                    logger.info(f"GPU {i}: {name}")
            except Exception as e:
                logger.warning(f"Could not enumerate GPUs: {e}")
                self.pynvml_loaded = False

    def get_status(self):
        device_type = "cpu"
        gpus = []

        if self.torch_device != "cpu":
            device_type = self.torch_device

        if self.pynvml_loaded and self.cuda_available:
            for i in range(len(self.gpu_names)):
                handle = self._handles[i]
                gpu_util = -1
                temp = -1
                vram_used = -1
                vram_total = -1
                vram_pct = -1

                if self.gpus_utilization[i]:
                    try:
                        gpu_util = self.pynvml.nvmlDeviceGetUtilizationRates(handle).gpu
                    except Exception:
                        gpu_util = -1

                if self.gpus_vram[i]:
                    try:
                        mem = self.pynvml.nvmlDeviceGetMemoryInfo(handle)
                        vram_used = mem.used
                        vram_total = mem.total
                        if vram_total > 0:
                            vram_pct = vram_used / vram_total * 100
                    except Exception:
                        pass

                if self.gpus_temperature[i]:
                    try:
                        temp = self.pynvml.nvmlDeviceGetTemperature(
                            handle, self.pynvml.NVML_TEMPERATURE_GPU
                        )
                    except Exception:
                        temp = -1

                gpus.append({
                    "gpu_utilization": gpu_util,
                    "gpu_temperature": temp,
                    "vram_total": vram_total,
                    "vram_used": vram_used,
                    "vram_used_percent": round(vram_pct, 1) if vram_pct >= 0 else -1,
                })
        else:
            gpus.append({
                "gpu_utilization": -1,
                "gpu_temperature": -1,
                "vram_total": -1,
                "vram_used": -1,
                "vram_used_percent": -1,
            })

        return {"device_type": device_type, "gpus": gpus}


class HardwareInfo:
    """Collects CPU, RAM, storage I/O speed, and GPU status."""

    def __init__(self, switch_cpu=True, switch_storage=True, switch_ram=True):
        self.switch_cpu = switch_cpu
        self.switch_storage = switch_storage
        self.switch_ram = switch_ram
        self.gpu_info = GPUInfo()
        self._prev_storage_io = None
        self._prev_storage_time = None

    def _get_storage_speed(self):
        """Returns (read_speed, write_speed) in bytes/sec."""
        try:
            counters = psutil.disk_io_counters()
            now = time.time()
            if counters is None:
                return (-1, -1)
            if self._prev_storage_io is not None and self._prev_storage_time is not None:
                dt = now - self._prev_storage_time
                if dt > 0:
                    read_delta = counters.read_bytes - self._prev_storage_io.read_bytes
                    self._prev_storage_io = counters
                    self._prev_storage_time = now
                    return (read_delta / dt, 0)
            self._prev_storage_io = counters
            self._prev_storage_time = now
            return (0, 0)
        except Exception:
            return (-1, -1)

    def get_status(self):
        cpu = -1
        ram_total = -1
        ram_used = -1
        ram_pct = -1
        storage_read_speed = -1

        if self.switch_cpu:
            cpu = psutil.cpu_percent()

        if self.switch_ram:
            ram = psutil.virtual_memory()
            ram_total = ram.total
            ram_used = ram.used
            ram_pct = ram.percent

        if self.switch_storage:
            storage_read_speed, _ = self._get_storage_speed()

        gpu_status = self.gpu_info.get_status()

        return {
            "cpu_utilization": cpu,
            "ram_total": ram_total,
            "ram_used": ram_used,
            "ram_used_percent": ram_pct,
            "storage_read_speed": storage_read_speed,
            "device_type": gpu_status["device_type"],
            "gpus": gpu_status["gpus"],
        }


class Monitor:
    """Background thread that periodically sends hardware stats via WebSocket."""

    def __init__(self, rate=1):
        self.rate = rate
        self.hardware_info = HardwareInfo()
        self._thread = None
        self._stop_event = threading.Event()

    async def _send(self, data):
        PromptServer.instance.send_sync("resource_monitor.stats", data)

    async def _loop(self):
        while self.rate > 0 and not self._stop_event.is_set():
            try:
                data = self.hardware_info.get_status()
                await self._send(data)
            except Exception as e:
                logger.error(f"Monitor error: {e}")
            await asyncio.sleep(self.rate)

    def _run(self):
        asyncio.run(self._loop())

    def start(self):
        if self._thread and self._thread.is_alive():
            self.stop()
        self._stop_event.clear()
        with _lock:
            self._thread = threading.Thread(target=self._run, daemon=True)
            self._thread.start()
        logger.info(f"Resource monitor started (refresh every {self.rate}s)")

    def stop(self):
        self._stop_event.set()
        logger.info("Resource monitor stopped")


_monitor = Monitor(rate=0.5)


def setup():
    """Register HTTP API routes for the resource monitor."""

    @PromptServer.instance.routes.patch("/resource_monitor/settings")
    async def _update_settings(request):
        try:
            settings = await request.json()

            if "rate" in settings:
                rate = settings["rate"]
                if not isinstance(rate, (int, float)):
                    return web.Response(status=400, text="rate must be a number")
                old_rate = _monitor.rate
                _monitor.rate = rate
                if rate > 0 and old_rate == 0:
                    _monitor.start()
                elif rate == 0:
                    _monitor.stop()

            hi = _monitor.hardware_info
            if "switchCPU" in settings:
                hi.switch_cpu = bool(settings["switchCPU"])
            if "switchHDD" in settings:
                hi.switch_storage = bool(settings["switchHDD"])
            if "switchRAM" in settings:
                hi.switch_ram = bool(settings["switchRAM"])

            gi = hi.gpu_info
            if "gpuUtilization" in settings:
                idx = settings.get("gpuIndex", 0)
                if 0 <= idx < len(gi.gpus_utilization):
                    gi.gpus_utilization[idx] = bool(settings["gpuUtilization"])
            if "gpuVram" in settings:
                idx = settings.get("gpuIndex", 0)
                if 0 <= idx < len(gi.gpus_vram):
                    gi.gpus_vram[idx] = bool(settings["gpuVram"])
            if "gpuTemperature" in settings:
                idx = settings.get("gpuIndex", 0)
                if 0 <= idx < len(gi.gpus_temperature):
                    gi.gpus_temperature[idx] = bool(settings["gpuTemperature"])

            return web.Response(status=200)
        except Exception as e:
            logger.error(f"Settings error: {e}")
            return web.Response(status=400, text=str(e))

    @PromptServer.instance.routes.get("/resource_monitor/gpus")
    def _get_gpus(request):
        try:
            gpus = []
            gi = _monitor.hardware_info.gpu_info
            for i, name in enumerate(gi.gpu_names):
                gpus.append({"name": name, "index": i})
            return web.json_response(gpus)
        except Exception as e:
            return web.Response(status=400, text=str(e))

    _monitor.start()
