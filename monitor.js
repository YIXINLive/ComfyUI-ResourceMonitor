/**
 * Resource Monitor UI for ComfyUI
 * Displays CPU, GPU, RAM, VRAM, and storage usage in the menu bar.
 */
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// Load CSS
(function loadCSS() {
    if (document.getElementById("resource-monitor-css")) return;
    const link = document.createElement("link");
    link.id = "resource-monitor-css";
    link.rel = "stylesheet";
    link.type = "text/css";
    link.href = "extensions/ComfyUI-ResourceMonitor/monitor.css";
    document.head.appendChild(link);
})();

function formatBytes(bytes) {
    if (bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i];
}

function formatSpeedInt(bytesPerSec) {
    if (bytesPerSec <= 0) return "0";
    return Math.floor(bytesPerSec / (1024 * 1024)).toString();
}

const DEFAULT_COLOR = "#0AA015";
const DEFAULT_FONT_COLOR = "#000000";
const DEFAULT_BG_COLOR = "#e9e9e9";
const DEFAULT_WIDTH = 65;
const DEFAULT_HEIGHT = 32;
const DEFAULT_RADIUS = 8;

class ResourceMonitorUI {
    constructor(container) {
        this.container = container;
        this.monitors = {};
        this.maxVramUsed = {};
        this._fillColor = DEFAULT_COLOR;
        this._fontColor = DEFAULT_FONT_COLOR;
        this._bgColor = DEFAULT_BG_COLOR;
        this._boxWidth = DEFAULT_WIDTH;
        this._boxHeight = DEFAULT_HEIGHT;
        this._radius = DEFAULT_RADIUS;
        this._createDOM();
    }

    _createMonitor(cfg) {
        const el = document.createElement("div");
        el.className = "rm-monitor";
        el.style.display = "none";
        el.title = cfg.label;

        const fill = document.createElement("div");
        fill.className = "rm-fill";

        const label = document.createElement("span");
        label.className = "rm-label-text";
        label.textContent = cfg.label;
        el.appendChild(label);

        const value = document.createElement("span");
        value.className = "rm-value-text";
        value.textContent = "0%";
        el.appendChild(value);

        el.appendChild(fill);

        cfg.el = el;
        cfg.fillEl = fill;
        cfg.valueEl = value;
        cfg.defaultLabel = cfg.label;
        fill.style.backgroundColor = this._fillColor;
        el.style.backgroundColor = this._bgColor;
        label.style.color = this._fontColor;
        value.style.color = this._fontColor;
        el.style.width = this._boxWidth + "px";
        el.style.height = this._boxHeight + "px";
        el.style.borderRadius = this._radius + "px";
        return el;
    }

    _createDOM() {
        const cpuCfg = { id: "cpu", label: "CPU", symbol: "%" };
        const ramCfg = { id: "ram", label: "RAM", symbol: "%", showBytes: true };
        const hddCfg = { id: "hdd", label: "Storage", symbol: "", showDiskSpeed: true };

        this.monitors.cpu = cpuCfg;
        this.monitors.ram = ramCfg;
        this.monitors.hdd = hddCfg;

        this.container.appendChild(this._createMonitor(cpuCfg));
        this.container.appendChild(this._createMonitor(ramCfg));
        this.container.appendChild(this._createMonitor(hddCfg));
    }

    _addGpuMonitor(index, name) {
        const shortName = name.replace(/NVIDIA GeForce /, "");
        const gpuCfg = { id: `gpu_${index}`, label: `GPU`, symbol: "%", title: `${index}: ${name}` };
        const vramCfg = { id: `vram_${index}`, label: `VRAM`, symbol: "%", title: `${index}: ${name}`, showBytes: true };
        const tempCfg = { id: `temp_${index}`, label: `${shortName}`, symbol: "\u00b0", title: `${index}: ${name}` };

        this.monitors[gpuCfg.id] = gpuCfg;
        this.monitors[vramCfg.id] = vramCfg;
        this.monitors[tempCfg.id] = tempCfg;

        this.container.appendChild(this._createMonitor(gpuCfg));
        this.container.appendChild(this._createMonitor(vramCfg));
        this.container.appendChild(this._createMonitor(tempCfg));
    }

    setFillColor(color) {
        this._fillColor = color;
        for (const cfg of Object.values(this.monitors)) {
            if (cfg.fillEl) cfg.fillEl.style.backgroundColor = color;
        }
    }

    setFontColor(color) {
        this._fontColor = color;
        for (const cfg of Object.values(this.monitors)) {
            if (cfg.el) {
                const labels = cfg.el.querySelectorAll(".rm-label-text, .rm-value-text");
                labels.forEach(l => l.style.color = color);
            }
        }
    }

    setBgColor(color) {
        this._bgColor = color;
        for (const cfg of Object.values(this.monitors)) {
            if (cfg.el) cfg.el.style.backgroundColor = color;
        }
    }

    setBoxSize(width, height) {
        this._boxWidth = width;
        this._boxHeight = height;
        for (const cfg of Object.values(this.monitors)) {
            if (cfg.el) {
                cfg.el.style.width = width + "px";
                cfg.el.style.height = height + "px";
            }
        }
    }

    setRadius(r) {
        this._radius = r;
        for (const cfg of Object.values(this.monitors)) {
            if (cfg.el) cfg.el.style.borderRadius = r + "px";
        }
    }

    updateDisplay(data) {
        this._updateMonitor(this.monitors.cpu, data.cpu_utilization);
        this._updateMonitor(this.monitors.ram, data.ram_used_percent, data.ram_used, data.ram_total);
        this._updateMonitor(this.monitors.hdd, data.storage_read_speed);

        if (data.gpus && data.gpus.length > 0) {
            data.gpus.forEach((gpu, i) => {
                const gpuCfg = this.monitors[`gpu_${i}`];
                const vramCfg = this.monitors[`vram_${i}`];
                const tempCfg = this.monitors[`temp_${i}`];
                if (gpuCfg) this._updateMonitor(gpuCfg, gpu.gpu_utilization);
                if (vramCfg) this._updateMonitor(vramCfg, gpu.vram_used_percent, gpu.vram_used, gpu.vram_total);
                if (tempCfg) {
                    this._updateMonitor(tempCfg, gpu.gpu_temperature);
                }
            });
        }
    }

    _updateMonitor(cfg, percent, used, total) {
        if (!cfg || !cfg.fillEl || !cfg.valueEl) return;
        if (percent == null || percent < 0) return;

        let displayText;
        let pct;

        if (cfg.showDiskSpeed) {
            displayText = formatSpeedInt(Math.max(0, percent)) + " MB/s";
            pct = Math.min(100, ((percent / (1024 * 1024)) / 1000) * 100);
            cfg.fillEl.style.width = `${Math.floor(pct)}%`;
            cfg.valueEl.textContent = displayText;
            if (cfg.el) cfg.el.title = `${cfg.label}: ${displayText}`;
        } else if (cfg.showBytes && used !== undefined && used >= 0) {
            displayText = formatBytes(used);
            cfg.valueEl.textContent = displayText;
            pct = Math.min(100, Math.floor(percent));
            cfg.fillEl.style.width = `${pct}%`;
        } else {
            displayText = `${Math.floor(percent)}${cfg.symbol}`;
            cfg.valueEl.textContent = displayText;
            pct = Math.min(100, Math.floor(percent));
            cfg.fillEl.style.width = `${pct}%`;
        }

        cfg.fillEl.style.borderRadius = pct >= 100 ? `${this._radius}px` : `${this._radius}px 0 0 ${this._radius}px`;

        let tooltip = cfg.title || cfg.label;
        tooltip += `: ${displayText}`;
        if (used !== undefined && total !== undefined && total > 0) {
            const idx = parseInt(cfg.id.split("_")[1]) || 0;
            if (this.maxVramUsed[idx] === undefined || this.maxVramUsed[idx] > total) this.maxVramUsed[idx] = 0;
            if (used > this.maxVramUsed[idx]) this.maxVramUsed[idx] = used;
            tooltip += `  ${formatBytes(used)}/${formatBytes(total)} Max: ${formatBytes(this.maxVramUsed[idx])}`;
        }
        if (cfg.el) cfg.el.title = tooltip;
    }

    showMonitor(cfg, visible) {
        if (cfg && cfg.el) cfg.el.style.display = visible ? "" : "none";
    }

    setMonitorLabel(idPrefix, newLabel) {
        for (const cfg of Object.values(this.monitors)) {
            if (cfg.id && cfg.id.startsWith(idPrefix)) {
                const label = newLabel || cfg.defaultLabel || "";
                cfg.label = label;
                if (cfg.el) {
                    const labelEl = cfg.el.querySelector(".rm-label-text");
                    if (labelEl) labelEl.textContent = label;
                }
            }
        }
    }
}


class ResourceMonitorExtension {
    constructor() {
        this.ui = null;
        this.container = null;
        this._dragging = false;
        this._dragX = 0;
        this._dragY = 0;
    }

    async setup() {
        this.container = document.createElement("div");
        this.container.id = "rm-container";

        this._injectContainer();
        this._enableDrag();

        this.ui = new ResourceMonitorUI(this.container);

        // Apply saved settings
        const savedColor = app.ui.settings.getSettingValue("ResourceMonitor.FillColor", DEFAULT_COLOR);
        const savedFontColor = app.ui.settings.getSettingValue("ResourceMonitor.FontColor", DEFAULT_FONT_COLOR);
        const savedBgColor = app.ui.settings.getSettingValue("ResourceMonitor.BgColor", DEFAULT_BG_COLOR);
        const savedWidth = app.ui.settings.getSettingValue("ResourceMonitor.BoxWidth", DEFAULT_WIDTH);
        const savedHeight = app.ui.settings.getSettingValue("ResourceMonitor.BoxHeight", DEFAULT_HEIGHT);
        const savedRadius = app.ui.settings.getSettingValue("ResourceMonitor.BoxRadius", DEFAULT_RADIUS);
        this.ui.setFillColor(savedColor);
        this.ui.setFontColor(savedFontColor);
        this.ui.setBgColor(savedBgColor);
        this.ui.setBoxSize(savedWidth, savedHeight);
        this.ui.setRadius(savedRadius);

        this._addSettings();
        this._fetchGpus();

        api.addEventListener("resource_monitor.stats", (event) => {
            if (event?.detail) this.ui.updateDisplay(event.detail);
        });
    }

    _enableDrag() {
        const el = this.container;
        el.style.cursor = "grab";
        el.style.userSelect = "none";
        el.title = "拖动移动 | 双击回归原位";

        const onDown = (e) => {
            if (e.target !== el && !el.contains(e.target)) return;
            e.preventDefault();
            this._dragging = true;
            const rect = el.getBoundingClientRect();
            this._dragX = e.clientX - rect.left;
            this._dragY = e.clientY - rect.top;
            el.style.cursor = "grabbing";
            el.style.position = "fixed";
            el.style.left = rect.left + "px";
            el.style.top = rect.top + "px";
            el.style.zIndex = "9999";
            el.style.margin = "0";
        };

        const onMove = (e) => {
            if (!this._dragging) return;
            el.style.left = (e.clientX - this._dragX) + "px";
            el.style.top = (e.clientY - this._dragY) + "px";
        };

        const onUp = () => {
            if (!this._dragging) return;
            this._dragging = false;
            el.style.cursor = "grab";
        };

        const onDblClick = () => {
            this._resetPosition();
        };

        el.addEventListener("mousedown", onDown);
        el.addEventListener("dblclick", onDblClick);
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    }

    _resetPosition() {
        const el = this.container;
        el.style.position = "";
        el.style.left = "";
        el.style.top = "";
        el.style.zIndex = "";
        el.style.margin = "";
        el.style.cursor = "grab";
        this._injectContainer();
    }

    _injectContainer() {
        if (app.menu?.settingsGroup?.element) {
            app.menu.settingsGroup.element.before(this.container);
            console.log("[ResourceMonitor] injected into menu bar");
            return;
        }

        const queueBtn = document.getElementById("queue-button");
        if (queueBtn && queueBtn.parentElement) {
            queueBtn.parentElement.insertBefore(this.container, queueBtn.nextSibling);
            console.log("[ResourceMonitor] injected next to queue-button");
            return;
        }

        document.body.appendChild(this.container);
        console.log("[ResourceMonitor] injected at body (fallback)");
    }

    _addSettings() {
        const settings = [
            {
                id: "ResourceMonitor.RefreshRate",
                name: "监控刷新率 (秒, 0=关闭)",
                category: ["ResourceMonitor", "通用", "监控刷新率"],
                type: "slider",
                attrs: { min: 0, max: 2, step: 0.25 },
                defaultValue: 0.5,
                onChange: async (v) => {
                    const rate = parseFloat(v);
                    if (isNaN(rate)) return;
                    await this._updateServer({ rate });
                    if (rate === 0) {
                        this.ui.updateDisplay({
                            cpu_utilization: 0, ram_used_percent: 0, ram_used: 0, ram_total: 0,
                            storage_read_speed: 0,
                            gpus: [{ gpu_utilization: 0, gpu_temperature: 0, vram_used_percent: 0, vram_used: 0, vram_total: 0 }],
                        });
                    }
                },
            },
            {
                id: "ResourceMonitor.BoxRadius",
                name: "框圆角 (px)",
                category: ["ResourceMonitor", "外观样式", "框圆角"],
                type: "slider",
                attrs: { min: 0, max: 20, step: 1 },
                defaultValue: DEFAULT_RADIUS,
                onChange: (v) => { this.ui.setRadius(parseInt(v)); },
            },
            {
                id: "ResourceMonitor.BoxHeight",
                name: "框高度 (px)",
                category: ["ResourceMonitor", "外观样式", "框高度"],
                type: "slider",
                attrs: { min: 20, max: 60, step: 2 },
                defaultValue: DEFAULT_HEIGHT,
                onChange: (v) => { this.ui.setBoxSize(parseInt(app.ui.settings.getSettingValue("ResourceMonitor.BoxWidth", DEFAULT_WIDTH)), parseInt(v)); },
            },
            {
                id: "ResourceMonitor.BoxWidth",
                name: "框宽度 (px)",
                category: ["ResourceMonitor", "外观样式", "框宽度"],
                type: "slider",
                attrs: { min: 50, max: 200, step: 5 },
                defaultValue: DEFAULT_WIDTH,
                onChange: (v) => { this.ui.setBoxSize(parseInt(v), parseInt(app.ui.settings.getSettingValue("ResourceMonitor.BoxHeight", DEFAULT_HEIGHT))); },
            },
            {
                id: "ResourceMonitor.BgColor",
                name: "框背景颜色",
                category: ["ResourceMonitor", "外观样式", "框背景颜色"],
                type: "text",
                defaultValue: DEFAULT_BG_COLOR,
                onChange: (v) => { this.ui.setBgColor(v); },
            },
            {
                id: "ResourceMonitor.FillColor",
                name: "占用填充颜色",
                category: ["ResourceMonitor", "外观样式", "占用填充颜色"],
                type: "text",
                defaultValue: DEFAULT_COLOR,
                onChange: (v) => { this.ui.setFillColor(v); },
            },
            {
                id: "ResourceMonitor.FontColor",
                name: "字体颜色",
                category: ["ResourceMonitor", "外观样式", "字体颜色"],
                type: "text",
                defaultValue: DEFAULT_FONT_COLOR,
                onChange: (v) => { this.ui.setFontColor(v); },
            },
            {
                id: "ResourceMonitor.LabelTemp",
                name: "自定义 GPU 温度 显示名称（留空则用默认）",
                category: ["ResourceMonitor", "显示开关", "GPU 温度 显示名称"],
                type: "text",
                defaultValue: "",
                onChange: (v) => { this.ui.setMonitorLabel("temp_", v); },
            },
            {
                id: "ResourceMonitor.ShowTemp",
                name: "显示 GPU 温度",
                category: ["ResourceMonitor", "显示开关", "显示 GPU 温度"],
                type: "boolean",
                defaultValue: true,
                onChange: (v) => {
                    for (const m of Object.values(this.ui.monitors)) {
                        if (m.id && m.id.startsWith("temp_")) this.ui.showMonitor(m, v);
                    }
                },
            },
            {
                id: "ResourceMonitor.LabelVRAM",
                name: "自定义 VRAM 显示名称（留空则用默认）",
                category: ["ResourceMonitor", "显示开关", "VRAM 显示名称"],
                type: "text",
                defaultValue: "",
                onChange: (v) => { this.ui.setMonitorLabel("vram_", v); },
            },
            {
                id: "ResourceMonitor.ShowVRAM",
                name: "显示 VRAM 使用量",
                category: ["ResourceMonitor", "显示开关", "显示 VRAM 使用量"],
                type: "boolean",
                defaultValue: true,
                onChange: (v) => {
                    for (const m of Object.values(this.ui.monitors)) {
                        if (m.id && m.id.startsWith("vram_")) this.ui.showMonitor(m, v);
                    }
                },
            },
            {
                id: "ResourceMonitor.LabelGPU",
                name: "自定义 GPU 使用率 显示名称（留空则用默认）",
                category: ["ResourceMonitor", "显示开关", "GPU 使用率 显示名称"],
                type: "text",
                defaultValue: "",
                onChange: (v) => { this.ui.setMonitorLabel("gpu_", v); },
            },
            {
                id: "ResourceMonitor.ShowGPU",
                name: "显示 GPU 使用率",
                category: ["ResourceMonitor", "显示开关", "显示 GPU 使用率"],
                type: "boolean",
                defaultValue: true,
                onChange: (v) => {
                    for (const m of Object.values(this.ui.monitors)) {
                        if (m.id && m.id.startsWith("gpu_")) this.ui.showMonitor(m, v);
                    }
                },
            },
            {
                id: "ResourceMonitor.LabelStorage",
                name: "自定义 Storage 显示名称（留空则用默认）",
                category: ["ResourceMonitor", "显示开关", "Storage 磁盘读取速度 显示名称"],
                type: "text",
                defaultValue: "",
                onChange: (v) => { this.ui.setMonitorLabel("hdd", v); },
            },
            {
                id: "ResourceMonitor.ShowStorage",
                name: "显示 Storage 磁盘读取速度",
                category: ["ResourceMonitor", "显示开关", "显示 Storage 磁盘读取速度"],
                type: "boolean",
                defaultValue: true,
                onChange: async (v) => { await this._updateServer({ switchHDD: v }); this.ui.showMonitor(this.ui.monitors.hdd, v); },
            },
            {
                id: "ResourceMonitor.LabelRAM",
                name: "自定义 RAM 显示名称（留空则用默认）",
                category: ["ResourceMonitor", "显示开关", "RAM 显示名称"],
                type: "text",
                defaultValue: "",
                onChange: (v) => { this.ui.setMonitorLabel("ram", v); },
            },
            {
                id: "ResourceMonitor.ShowRAM",
                name: "显示 RAM 使用率",
                category: ["ResourceMonitor", "显示开关", "显示 RAM 使用率"],
                type: "boolean",
                defaultValue: true,
                onChange: async (v) => { await this._updateServer({ switchRAM: v }); this.ui.showMonitor(this.ui.monitors.ram, v); },
            },
            {
                id: "ResourceMonitor.LabelCPU",
                name: "自定义 CPU 显示名称（留空则用默认）",
                category: ["ResourceMonitor", "显示开关", "CPU 显示名称"],
                type: "text",
                defaultValue: "",
                onChange: (v) => { this.ui.setMonitorLabel("cpu", v); },
            },
            {
                id: "ResourceMonitor.ShowCPU",
                name: "显示 CPU 使用率",
                category: ["ResourceMonitor", "显示开关", "显示 CPU 使用率"],
                type: "boolean",
                defaultValue: true,
                onChange: async (v) => { await this._updateServer({ switchCPU: v }); this.ui.showMonitor(this.ui.monitors.cpu, v); },
            },
        ];

        for (const s of settings) {
            app.ui.settings.addSetting(s);
        }

        this.ui.showMonitor(this.ui.monitors.cpu, true);
        this.ui.showMonitor(this.ui.monitors.ram, true);
        this.ui.showMonitor(this.ui.monitors.hdd, true);

        // Apply saved label settings for CPU/RAM/Storage
        this.ui.setMonitorLabel("cpu", app.ui.settings.getSettingValue("ResourceMonitor.LabelCPU", ""));
        this.ui.setMonitorLabel("ram", app.ui.settings.getSettingValue("ResourceMonitor.LabelRAM", ""));
        this.ui.setMonitorLabel("hdd", app.ui.settings.getSettingValue("ResourceMonitor.LabelStorage", ""));
    }

    async _fetchGpus() {
        try {
            const resp = await api.fetchApi("/resource_monitor/gpus", { method: "GET" });
            if (resp.status !== 200) return;
            const gpus = await resp.json();

            gpus.forEach(({ name, index }) => {
                this.ui._addGpuMonitor(index, name);
                this.ui.showMonitor(this.ui.monitors[`gpu_${index}`], true);
                this.ui.showMonitor(this.ui.monitors[`vram_${index}`], true);
                this.ui.showMonitor(this.ui.monitors[`temp_${index}`], true);
            });

            // Apply saved label settings for GPU/VRAM/Temp
            this.ui.setMonitorLabel("gpu_", app.ui.settings.getSettingValue("ResourceMonitor.LabelGPU", ""));
            this.ui.setMonitorLabel("vram_", app.ui.settings.getSettingValue("ResourceMonitor.LabelVRAM", ""));
            this.ui.setMonitorLabel("temp_", app.ui.settings.getSettingValue("ResourceMonitor.LabelTemp", ""));
        } catch (e) {
            console.warn("ResourceMonitor: Could not fetch GPU info:", e);
        }
    }

    async _updateServer(data) {
        try {
            const resp = await api.fetchApi("/resource_monitor/settings", {
                method: "PATCH",
                body: JSON.stringify(data),
                cache: "no-store",
            });
        } catch (e) {
            // ignore
        }
    }
}

const monitorExt = new ResourceMonitorExtension();
app.registerExtension({
    name: "ResourceMonitor",
    setup: () => monitorExt.setup(),
});
