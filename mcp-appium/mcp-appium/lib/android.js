"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AndroidDeviceManager = exports.AndroidRobot = void 0;
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const xml = __importStar(require("fast-xml-parser"));
const robot_1 = require("./robot");
const getAdbPath = () => {
    let executable = "adb";
    if (process.env.ANDROID_HOME) {
        executable = path_1.default.join(process.env.ANDROID_HOME, "platform-tools", "adb");
    }
    return executable;
};
const BUTTON_MAP = {
    "BACK": "KEYCODE_BACK",
    "HOME": "KEYCODE_HOME",
    "VOLUME_UP": "KEYCODE_VOLUME_UP",
    "VOLUME_DOWN": "KEYCODE_VOLUME_DOWN",
    "ENTER": "KEYCODE_ENTER",
    "DPAD_CENTER": "KEYCODE_DPAD_CENTER",
    "DPAD_UP": "KEYCODE_DPAD_UP",
    "DPAD_DOWN": "KEYCODE_DPAD_DOWN",
    "DPAD_LEFT": "KEYCODE_DPAD_LEFT",
    "DPAD_RIGHT": "KEYCODE_DPAD_RIGHT",
};
const TIMEOUT = 30000;
const MAX_BUFFER_SIZE = 1024 * 1024 * 4;
class AndroidRobot {
    deviceId;
    constructor(deviceId) {
        this.deviceId = deviceId;
    }
    adb(...args) {
        return (0, child_process_1.execFileSync)(getAdbPath(), ["-s", this.deviceId, ...args], {
            maxBuffer: MAX_BUFFER_SIZE,
            timeout: TIMEOUT,
        });
    }
    getSystemFeatures() {
        return this.adb("shell", "pm", "list", "features")
            .toString()
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.startsWith("feature:"))
            .map(line => line.substring("feature:".length));
    }
    async getScreenSize() {
        const screenSize = this.adb("shell", "wm", "size")
            .toString()
            .split(" ")
            .pop();
        if (!screenSize) {
            throw new Error("Failed to get screen size");
        }
        const scale = 1;
        const [width, height] = screenSize.split("x").map(Number);
        return { width, height, scale };
    }
    async listApps() {
        return this.adb("shell", "cmd", "package", "query-activities", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER")
            .toString()
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.startsWith("packageName="))
            .map(line => line.substring("packageName=".length))
            .filter((value, index, self) => self.indexOf(value) === index)
            .map(packageName => ({
            packageName,
            appName: packageName,
        }));
    }
    async launchApp(packageName) {
        this.adb("shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1");
    }
    async listRunningProcesses() {
        return this.adb("shell", "ps", "-e")
            .toString()
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.startsWith("u")) // non-system processes
            .map(line => line.split(/\s+/)[8]); // get process name
    }
    async swipe(direction) {
        const screenSize = await this.getScreenSize();
        const centerX = screenSize.width >> 1;
        // const centerY = screenSize[1] >> 1;
        let x0, y0, x1, y1;
        switch (direction) {
            case "up":
                x0 = x1 = centerX;
                y0 = Math.floor(screenSize.height * 0.80);
                y1 = Math.floor(screenSize.height * 0.20);
                break;
            case "down":
                x0 = x1 = centerX;
                y0 = Math.floor(screenSize.height * 0.20);
                y1 = Math.floor(screenSize.height * 0.80);
                break;
            default:
                throw new robot_1.ActionableError(`Swipe direction "${direction}" is not supported`);
        }
        this.adb("shell", "input", "swipe", `${x0}`, `${y0}`, `${x1}`, `${y1}`, "1000");
    }
    async getScreenshot() {
        return this.adb("exec-out", "screencap", "-p");
    }
    collectElements(node) {
        const elements = [];
        if (node.node) {
            if (Array.isArray(node.node)) {
                for (const childNode of node.node) {
                    elements.push(...this.collectElements(childNode));
                }
            }
            else {
                elements.push(...this.collectElements(node.node));
            }
        }
        if (node.text || node["content-desc"] || node.hint) {
            const element = {
                type: node.class || "text",
                text: node.text,
                label: node["content-desc"] || node.hint || "",
                rect: this.getScreenElementRect(node),
            };
            if (node.focused === "true") {
                // only provide it if it's true, otherwise don't confuse llm
                element.focused = true;
            }
            if (element.rect.width > 0 && element.rect.height > 0) {
                elements.push(element);
            }
        }
        return elements;
    }
    async getXmlStructure() {
        const parsedXml = await this.getUiAutomatorXml();
        return parsedXml;
    }
    async getElementsOnScreen() {
        const parsedXml = await this.getUiAutomatorXml();
        const hierarchy = parsedXml.hierarchy;
        const elements = this.collectElements(hierarchy.node);
        return elements;
    }
    async terminateApp(packageName) {
        this.adb("shell", "am", "force-stop", packageName);
    }
    async openUrl(url) {
        this.adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url);
    }
    async sendKeys(text) {
        // adb shell requires some escaping
        const _text = text.replace(/ /g, "\\ ");
        this.adb("shell", "input", "text", _text);
    }
    async pressButton(button) {
        if (!BUTTON_MAP[button]) {
            throw new robot_1.ActionableError(`Button "${button}" is not supported`);
        }
        this.adb("shell", "input", "keyevent", BUTTON_MAP[button]);
    }
    async tap(x, y) {
        this.adb("shell", "input", "tap", `${x}`, `${y}`);
    }
    async setOrientation(orientation) {
        const orientationValue = orientation === "portrait" ? 0 : 1;
        this.adb("shell", "content", "insert", "--uri", "content://settings/system", "--bind", "name:s:user_rotation", "--bind", `value:i:${orientationValue}`);
        this.adb("shell", "settings", "put", "system", "accelerometer_rotation", "0");
    }
    async getOrientation() {
        const rotation = this.adb("shell", "settings", "get", "system", "user_rotation").toString().trim();
        return rotation === "0" ? "portrait" : "landscape";
    }
    async getUiAutomatorDump() {
        for (let tries = 0; tries < 10; tries++) {
            const dump = this.adb("exec-out", "uiautomator", "dump", "/dev/tty").toString();
            // note: we're not catching other errors here. maybe we should check for <?xml
            if (dump.includes("null root node returned by UiTestAutomationBridge")) {
                // uncomment for debugging
                // const screenshot = await this.getScreenshot();
                // console.error("Failed to get UIAutomator XML. Here's a screenshot: " + screenshot.toString("base64"));
                continue;
            }
            return dump;
        }
        throw new robot_1.ActionableError("Failed to get UIAutomator XML");
    }
    async getUiAutomatorXml() {
        const dump = await this.getUiAutomatorDump();
        const parser = new xml.XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "",
        });
        return parser.parse(dump);
    }
    getScreenElementRect(node) {
        const bounds = String(node.bounds);
        const [, left, top, right, bottom] = bounds.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/)?.map(Number) || [];
        return {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
        };
    }
}
exports.AndroidRobot = AndroidRobot;
class AndroidDeviceManager {
    getDeviceType(name) {
        const device = new AndroidRobot(name);
        const features = device.getSystemFeatures();
        if (features.includes("android.software.leanback") || features.includes("android.hardware.type.television")) {
            return "tv";
        }
        return "mobile";
    }
    getConnectedDevices() {
        try {
            const names = (0, child_process_1.execFileSync)(getAdbPath(), ["devices"])
                .toString()
                .split("\n")
                .filter(line => !line.startsWith("List of devices attached"))
                .filter(line => line.trim() !== "")
                .map(line => line.split("\t")[0]);
            return names.map(name => ({
                deviceId: name,
                deviceType: this.getDeviceType(name),
            }));
        }
        catch (error) {
            console.error("Could not execute adb command, maybe ANDROID_HOME is not set?");
            return [];
        }
    }
}
exports.AndroidDeviceManager = AndroidDeviceManager;
