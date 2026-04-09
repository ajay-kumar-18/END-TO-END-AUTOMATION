"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimctlManager = exports.Simctl = void 0;
const child_process_1 = require("child_process");
const webdriver_agent_1 = require("./webdriver-agent");
const robot_1 = require("./robot");
const TIMEOUT = 30000;
const WDA_PORT = 8100;
const MAX_BUFFER_SIZE = 1024 * 1024 * 4;
class Simctl {
    simulatorUuid;
    constructor(simulatorUuid) {
        this.simulatorUuid = simulatorUuid;
    }
    async wda() {
        const wda = new webdriver_agent_1.WebDriverAgent("localhost", WDA_PORT);
        if (!(await wda.isRunning())) {
            throw new robot_1.ActionableError("WebDriverAgent is not running on simulator, please see https://github.com/mobile-next/mobile-mcp/wiki/");
        }
        return wda;
    }
    simctl(...args) {
        return (0, child_process_1.execFileSync)("xcrun", ["simctl", ...args], {
            timeout: TIMEOUT,
            maxBuffer: MAX_BUFFER_SIZE,
        });
    }
    async getScreenshot() {
        return this.simctl("io", this.simulatorUuid, "screenshot", "-");
    }
    async openUrl(url) {
        const wda = await this.wda();
        await wda.openUrl(url);
        // alternative: this.simctl("openurl", this.simulatorUuid, url);
    }
    async launchApp(packageName) {
        this.simctl("launch", this.simulatorUuid, packageName);
    }
    async terminateApp(packageName) {
        this.simctl("terminate", this.simulatorUuid, packageName);
    }
    static parseIOSAppData(inputText) {
        const result = [];
        let ParseState;
        (function (ParseState) {
            ParseState[ParseState["LOOKING_FOR_APP"] = 0] = "LOOKING_FOR_APP";
            ParseState[ParseState["IN_APP"] = 1] = "IN_APP";
            ParseState[ParseState["IN_PROPERTY"] = 2] = "IN_PROPERTY";
        })(ParseState || (ParseState = {}));
        let state = ParseState.LOOKING_FOR_APP;
        let currentApp = {};
        let appIdentifier = "";
        const lines = inputText.split("\n");
        for (let line of lines) {
            line = line.trim();
            if (line === "") {
                continue;
            }
            switch (state) {
                case ParseState.LOOKING_FOR_APP:
                    // look for app identifier pattern: "com.example.app" = {
                    const appMatch = line.match(/^"?([^"=]+)"?\s*=\s*\{/);
                    if (appMatch) {
                        appIdentifier = appMatch[1].trim();
                        currentApp = {
                            CFBundleIdentifier: appIdentifier,
                        };
                        state = ParseState.IN_APP;
                    }
                    break;
                case ParseState.IN_APP:
                    if (line === "};") {
                        result.push(currentApp);
                        currentApp = {};
                        state = ParseState.LOOKING_FOR_APP;
                    }
                    else {
                        // look for property: PropertyName = Value;
                        const propertyMatch = line.match(/^([^=]+)\s*=\s*(.+?);\s*$/);
                        if (propertyMatch) {
                            const propName = propertyMatch[1].trim();
                            let propValue = propertyMatch[2].trim();
                            // remove quotes if present (they're optional)
                            if (propValue.startsWith('"') && propValue.endsWith('"')) {
                                propValue = propValue.substring(1, propValue.length - 1);
                            }
                            // add property to current app
                            currentApp[propName] = propValue;
                        }
                        else if (line.endsWith("{")) {
                            // nested property like GroupContainers = {
                            state = ParseState.IN_PROPERTY;
                        }
                    }
                    break;
                case ParseState.IN_PROPERTY:
                    if (line === "};") {
                        // end of nested property
                        state = ParseState.IN_APP;
                    }
                    // skip content of nested properties, we don't care of those right now
                    break;
            }
        }
        return result;
    }
    async listApps() {
        const text = this.simctl("listapps", this.simulatorUuid).toString();
        const apps = Simctl.parseIOSAppData(text);
        return apps.map(app => ({
            packageName: app.CFBundleIdentifier,
            appName: app.CFBundleDisplayName,
        }));
    }
    async getScreenSize() {
        const wda = await this.wda();
        return wda.getScreenSize();
    }
    async sendKeys(keys) {
        const wda = await this.wda();
        return wda.sendKeys(keys);
    }
    async swipe(direction) {
        const wda = await this.wda();
        return wda.swipe(direction);
    }
    async tap(x, y) {
        const wda = await this.wda();
        return wda.tap(x, y);
    }
    async pressButton(button) {
        const wda = await this.wda();
        return wda.pressButton(button);
    }
    async getElementsOnScreen() {
        const wda = await this.wda();
        return wda.getElementsOnScreen();
    }
    async setOrientation(orientation) {
        const wda = await this.wda();
        return wda.setOrientation(orientation);
    }
    async getOrientation() {
        const wda = await this.wda();
        return wda.getOrientation();
    }
}
exports.Simctl = Simctl;
class SimctlManager {
    listSimulators() {
        // detect if this is a mac
        if (process.platform !== "darwin") {
            // don't even try to run xcrun
            return [];
        }
        try {
            const text = (0, child_process_1.execFileSync)("xcrun", ["simctl", "list", "devices", "-j"]).toString();
            const json = JSON.parse(text);
            return Object.values(json.devices).flatMap(device => {
                return device.map(d => {
                    return {
                        name: d.name,
                        uuid: d.udid,
                        state: d.state,
                    };
                });
            });
        }
        catch (error) {
            console.error("Error listing simulators", error);
            return [];
        }
    }
    listBootedSimulators() {
        return this.listSimulators()
            .filter(simulator => simulator.state === "Booted");
    }
    getSimulator(uuid) {
        return new Simctl(uuid);
    }
}
exports.SimctlManager = SimctlManager;
