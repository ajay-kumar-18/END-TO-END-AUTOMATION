#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const server_1 = require("./server");
const logger_1 = require("./logger");
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    const server = (0, server_1.createMcpServer)();
    await server.connect(transport);
    (0, logger_1.error)("mobile-mcp server running on stdio");
}
main().catch(err => {
    console.error("Fatal error in main():", err);
    (0, logger_1.error)("Fatal error in main(): " + JSON.stringify(err.stack));
    process.exit(1);
});
