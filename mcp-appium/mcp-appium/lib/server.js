"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMcpServer = void 0;
const fs = require('fs').promises;
const os = require('os');
const fsSync = require('fs');
const path = require('path');
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const zod_1 = require("zod");
const logger_1 = require("./logger");
const android_1 = require("./android");
const robot_1 = require("./robot");
const iphone_simulator_1 = require("./iphone-simulator");
const ios_1 = require("./ios");
const png_1 = require("./png");
const image_utils_1 = require("./image-utils");
const { google } = require('googleapis');
const axios = require('axios');
const OpenAI = require("openai");
const express = require('express');
// Fixed: support ESM default export of 'open'
const openImport = require('open');
const openBrowser = openImport.default || openImport;
const getAgentVersion = () => {
    const json = require("../package.json");
    return json.version;
};

const createMcpServer = () => {
    const server = new mcp_js_1.McpServer({
        name: "mobile-mcp",
        version: getAgentVersion(),
        capabilities: {
            resources: {},
            tools: {},
        },
    });

    const tool = (name, description, paramsSchema, cb) => {
        const wrappedCb = async (args) => {
            try {
                (0, logger_1.trace)(`Invoking ${name} with args: ${JSON.stringify(args)}`);
                const response = await cb(args);
                (0, logger_1.trace)(`=> ${response}`);
                return {
                    content: [{ type: "text", text: response }],
                };
            }
            catch (error) {
                if (error instanceof robot_1.ActionableError) {
                    return {
                        content: [{ type: "text", text: `${error.message}. Please fix the issue and try again.` }],
                    };
                }
                else {
                    // a real exception
                    (0, logger_1.trace)(`Tool '${description}' failed: ${error.message} stack: ${error.stack}`);
                    return {
                        content: [{ type: "text", text: `Error: ${error.message}` }],
                        isError: true,
                    };
                }
            }
        };
        server.tool(name, description, paramsSchema, args => wrappedCb(args));
    };
    let robot;
    const simulatorManager = new iphone_simulator_1.SimctlManager();
    const requireRobot = () => {
        if (!robot) {
            throw new robot_1.ActionableError("No device selected. Use the mobile_use_device tool to select a device.");
        }
    };

    tool("mobile_list_available_devices", "List all available devices. This includes both physical devices and simulators. If there is more than one device returned, you need to let the user select one of them.", {}, async ({}) => {
        const iosManager = new ios_1.IosManager();
        const androidManager = new android_1.AndroidDeviceManager();
        const devices = simulatorManager.listBootedSimulators();
        const simulatorNames = devices.map(d => d.name);
        const androidDevices = androidManager.getConnectedDevices();
        const iosDevices = await iosManager.listDevices();
        const iosDeviceNames = iosDevices.map(d => d.deviceId);
        const androidTvDevices = androidDevices.filter(d => d.deviceType === "tv").map(d => d.deviceId);
        const androidMobileDevices = androidDevices.filter(d => d.deviceType === "mobile").map(d => d.deviceId);
        const resp = ["Found these devices:"];
        if (simulatorNames.length > 0) {
            resp.push(`iOS simulators: [${simulatorNames.join(".")}]`);
        }
        if (iosDevices.length > 0) {
            resp.push(`iOS devices: [${iosDeviceNames.join(",")}]`);
        }
        if (androidMobileDevices.length > 0) {
            resp.push(`Android devices: [${androidMobileDevices.join(",")}]`);
        }
        if (androidTvDevices.length > 0) {
            resp.push(`Android TV devices: [${androidTvDevices.join(",")}]`);
        }
        return resp.join("\n");
    });

    tool("mobile_use_device", "Select a device to use. This can be a simulator or an Android device. Use the list_available_devices tool to get a list of available devices.", {
        device: zod_1.z.string().describe("The name of the device to select"),
        deviceType: zod_1.z.enum(["simulator", "ios", "android"]).describe("The type of device to select"),
    }, async ({ device, deviceType }) => {
        switch (deviceType) {
            case "simulator":
                robot = simulatorManager.getSimulator(device);
                break;
            case "ios":
                robot = new ios_1.IosRobot(device);
                break;
            case "android":
                robot = new android_1.AndroidRobot(device);
                break;
        }
        return `Selected device: ${device}`;
    });

    tool("mobile_list_apps", "List all the installed apps on the device", {}, async ({}) => {
        requireRobot();
        const result = await robot.listApps();
        return `Found these apps on device: ${result.map(app => `${app.appName} (${app.packageName})`).join(", ")}`;
    });

    tool("mobile_launch_app", "Launch an app on mobile device. Use this to open a specific app. You can find the package name of the app by calling list_apps_on_device.", {
        packageName: zod_1.z.string().describe("The package name of the app to launch"),
    }, async ({ packageName }) => {
        requireRobot();
        await robot.launchApp(packageName);
        return `Launched app ${packageName}`;
    });

    tool("mobile_terminate_app", "Stop and terminate an app on mobile device", {
        packageName: zod_1.z.string().describe("The package name of the app to terminate"),
    }, async ({ packageName }) => {
        requireRobot();
        await robot.terminateApp(packageName);
        return `Terminated app ${packageName}`;
    });

    tool("mobile_get_screen_size", "Get the screen size of the mobile device in pixels", {}, async ({}) => {
        requireRobot();
        const screenSize = await robot.getScreenSize();
        return `Screen size is ${screenSize.width}x${screenSize.height} pixels`;
    });

    const fs = require('fs').promises;
    const path = require('path');

// tool(
//   "mobile_learn_current_app_context",
//   "Follow these instructions strictly to navigate through the app. This should be the first step after launching the app and before performing any tests. Google Sheet name to fetch locatorName and androidLocator from the specified sheet. NOTE: Only use the locator data from the Google Sheet at the end while generating test cases, don't use to navigate through screens",
//   {
//     sheetName: zod_1.z.string().describe("The name of the Google Sheet to fetch locator data from").default("PDP"),
//   },
//   async ({ sheetName }) => {
//     try {
//       // Read app context notes from file
//       const notesFilePath = path.join(__dirname, 'app_context.txt');
//       const fileContent = await fs.readFile(notesFilePath, 'utf-8');
//
//       const notes = fileContent
//         .split('\n')
//         .map(line => line.trim())
//         .filter(line => line.length > 0);
//
//       // Initialize response object
//       const context = { notes, locatorData: null };
//
//       if (sheetName && sheetName.trim() !== '') {
//         // Load Google Sheets credentials with keyFile option (no manual parse)
//        const keyFile = path.join(os.homedir(), 'Desktop', 'secret.json');
//
//
//         const auth = new google.auth.GoogleAuth({
//           keyFile,
//           scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
//         });
//
//         const authClient = await auth.getClient();
//         const sheets = google.sheets({ version: 'v4', auth: authClient });
//         const spreadsheetId = '1UapR81AxaztDUlPGDV-_EwHo2hWXkKCZXl8ALsvIyxA';
//
//         const range = `${sheetName}!A1:Z1000`;
//         const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
//         const rows = res.data.values;
//
//         if (!rows || rows.length === 0) {
//           return `Sheet "${sheetName}" is empty or does not exist. Notes loaded: ${JSON.stringify(notes)}`;
//         }
//
//         // Map headers exactly (trimmed, case-sensitive)
//         const header = rows[0].map(h => h.toString().trim());
//
//         const locatorNameIdx = header.indexOf('locatorName');
//         const androidLocatorIdx = header.indexOf('androidLocator');
//
//         if (locatorNameIdx === -1 || androidLocatorIdx === -1) {
//           return `Required columns "locatorName" and/or "androidLocator" not found in sheet "${sheetName}". Notes loaded: ${JSON.stringify(notes)}`;
//         }
//
//         const locatorData = rows.slice(1)
//           .filter(row => row[locatorNameIdx] && row[androidLocatorIdx])
//           .map(row => ({
//             locatorName: row[locatorNameIdx],
//             androidLocator: row[androidLocatorIdx],
//           }));
//
//         context.locatorData = locatorData;
//        }
//       return `App context learned: ${JSON.stringify(context)}`;
//     } catch (error) {
//       return `Error reading app context notes or fetching locator data: ${error.message}`;
//     }
//   }
// );

// Tool 1: Fetch incomplete test case
// Tool 1: Fetch incomplete test case
tool(
  "mobile_fetch_incomplete_testcase",
  "Fetches the first test case from a Google Sheet that has blank test steps but has a value in 'UT v/s Automation' column. Returns the test scenario and row number for later update.",
  {
    sheetName: zod_1.z.string().describe("The name of the Google Sheet tab to fetch test case data from").default("TestCases"),
  },
  async ({ sheetName }) => {
    try {
      // Load Google Sheets credentials
      const keyFile = path.join(os.homedir(), 'Desktop', 'secret.json');

      const auth = new google.auth.GoogleAuth({
        keyFile,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      });

      const authClient = await auth.getClient();
      const sheets = google.sheets({ version: 'v4', auth: authClient });
      const spreadsheetId = '1jAilVUeQW99JUYj1KL4jovoxeWGUnsIcY_nMJR5H6dc';

      const range = `${sheetName}!A1:Z1000`;
      const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
      const rows = res.data.values;

      if (!rows || rows.length === 0) {
        return `Sheet "${sheetName}" is empty or does not exist.`;
      }

      // Map headers (trimmed, case-sensitive)
      const header = rows[0].map(h => h.toString().trim());

      // Find required column indices
      const testCasesIdx = header.indexOf('Testcases');
      const testStepsIdx = header.indexOf('Test Steps');
      const utVsAutomationIdx = header.indexOf('UT v/s Automation');

      if (testCasesIdx === -1 || testStepsIdx === -1 || utVsAutomationIdx === -1) {
        return `Required columns "Testcases", "Test Steps", and/or "UT v/s Automation" not found in sheet "${sheetName}". Available columns: ${header.join(', ')}`;
      }

      // Find first row with empty test steps and non-empty UT v/s Automation
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const testSteps = row[testStepsIdx] ? row[testStepsIdx].toString().trim() : '';
        const utVsAutomation = row[utVsAutomationIdx] ? row[utVsAutomationIdx].toString().trim() : '';
        const testScenario = row[testCasesIdx] ? row[testCasesIdx].toString().trim() : '';

        // Check if test steps are empty, UT v/s Automation is not empty, and test scenario exists
        if (!testSteps && utVsAutomation && testScenario) {
          // Convert column index to letter (A, B, C, etc.)
          const columnLetter = String.fromCharCode(65 + testStepsIdx);
          const rowNumber = i + 1; // +1 because spreadsheet rows are 1-indexed

          return JSON.stringify({
            testScenario: testScenario,
            sheetName: sheetName,
            rowNumber: rowNumber,
            columnLetter: columnLetter,
            cellReference: `${columnLetter}${rowNumber}`
          });
        }
      }

      return `No test cases found with blank test steps and non-empty "UT v/s Automation" in sheet "${sheetName}".`;

    } catch (error) {
      return `Error fetching incomplete test case: ${error.message}`;
    }
  }
);

// Tool 2: Update Test Steps
tool(
  "mobile_update_test_steps",
  "Updates the Test Steps cell in Google Sheet for a specific test case. Use the sheetName, rowNumber, and columnLetter obtained from mobile_fetch_incomplete_testcase tool.",
  {
    sheetName: zod_1.z.string().describe("The name of the Google Sheet tab"),
    rowNumber: zod_1.z.number().describe("The row number to update (from fetch tool)"),
    columnLetter: zod_1.z.string().describe("The column letter for Test Steps (from fetch tool)"),
    testSteps: zod_1.z.string().describe("The test steps content to write into the cell"),
  },
  async ({ sheetName, rowNumber, columnLetter, testSteps }) => {
    try {
      // Load Google Sheets credentials with write permissions
      const keyFile = path.join(os.homedir(), 'Desktop', 'secret.json');

      const auth = new google.auth.GoogleAuth({
        keyFile,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'], // Full read/write access
      });

      const authClient = await auth.getClient();
      const sheets = google.sheets({ version: 'v4', auth: authClient });
      const spreadsheetId = '1jAilVUeQW99JUYj1KL4jovoxeWGUnsIcY_nMJR5H6dc';

      // Construct the cell reference (e.g., "TestCases!C5")
      const cellReference = `${sheetName}!${columnLetter}${rowNumber}`;

      // Update the cell
      const updateRes = await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: cellReference,
        valueInputOption: 'RAW',
        resource: {
          values: [[testSteps]]
        }
      });

      if (updateRes.status === 200) {
        return `Successfully updated Test Steps at ${cellReference} with content: "${testSteps.substring(0, 100)}${testSteps.length > 100 ? '...' : ''}"`;
      } else {
        return `Failed to update Test Steps. Status: ${updateRes.status}`;
      }

    } catch (error) {
      return `Error updating test steps: ${error.message}`;
    }
  }
);

tool(
  "mobile_learn_teststeps_generation_guidelines",
  "Reads previously saved test steps generation guidelines and returns them so they can be used to validate or update test steps. This should be executed before generating manual test steps.",
  {},
  async () => {
    try {
      // Read test steps generation guidelines from Desktop
      const guidelinesFilePath = path.join(os.homedir(), 'Desktop', 'teststeps_generation_guidelines.txt');
      const fileContent = await fs.readFile(guidelinesFilePath, "utf-8");

      const guidelines = fileContent
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0);

      if (guidelines.length === 0) {
        return "No test steps generation guidelines found.";
      }

      return `Test steps generation guidelines loaded: ${JSON.stringify({ guidelines })}`;
    } catch (error) {
      return `Error reading test steps generation guidelines: ${error.message}`;
    }
  }
);

tool(
  "mobile_learn_app_context_and_navigation_guidelines",
  "Reads previously saved app context and navigation guidelines and returns them so they can be used to navigate through the app before generating test steps.",
  {},
  async () => {
    try {
      const guidelinesFilePath = path.join(os.homedir(), 'Desktop', 'app_context_and_navigation_guidelines.txt');
      const fileContent = await fs.readFile(guidelinesFilePath, "utf-8");

      const guidelines = fileContent
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0);

      if (guidelines.length === 0) {
        return "No app context and navigation guidelines found.";
      }

      return `App context and navigation guidelines loaded: ${JSON.stringify({ guidelines })}`;
    } catch (error) {
      return `Error reading app context and navigation guidelines: ${error.message}`;
    }
  }
);

// Tool 3: Update Test Scenario (Always appends with green color)
tool(
  "mobile_update_test_scenario",
  "Updates the Test Scenario (Testcases column) in Google Sheet for outdated scenarios. Always keeps the existing scenario and adds the updated scenario in green color on a new line.",
  {
    sheetName: zod_1.z.string().describe("The name of the Google Sheet tab"),
    rowNumber: zod_1.z.number().describe("The row number to update"),
    columnLetter: zod_1.z.string().describe("The column letter for Testcases column"),
    updatedScenario: zod_1.z.string().describe("The updated test scenario content"),
  },
  async ({ sheetName, rowNumber, columnLetter, updatedScenario }) => {
    try {
      // Load Google Sheets credentials with write permissions
      const keyFile = path.join(os.homedir(), 'Desktop', 'secret.json');

      const auth = new google.auth.GoogleAuth({
        keyFile,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const authClient = await auth.getClient();
      const sheets = google.sheets({ version: 'v4', auth: authClient });
      const spreadsheetId = '1jAilVUeQW99JUYj1KL4jovoxeWGUnsIcY_nMJR5H6dc';

      const cellReference = `${sheetName}!${columnLetter}${rowNumber}`;

      // First, read the existing scenario
      const getRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: cellReference
      });

      const existingScenario = getRes.data.values && getRes.data.values[0] && getRes.data.values[0][0]
        ? getRes.data.values[0][0]
        : '';

      if (!existingScenario) {
        return `No existing scenario found at ${cellReference}. Cannot append to empty cell.`;
      }

      // Combine: existing scenario + newline + updated scenario
      const combinedContent = `${existingScenario}\n${updatedScenario}`;

      // Get sheet ID dynamically
      const sheetsMetadata = await sheets.spreadsheets.get({ spreadsheetId });
      const sheetId = sheetsMetadata.data.sheets.find(s => s.properties.title === sheetName)?.properties.sheetId || 0;

      // Calculate text positions
      const existingLength = existingScenario.length;
      const newTextStartIndex = existingLength + 1; // +1 for newline

      // Apply green color formatting to the new text
      const batchUpdateRes = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: sheetId,
                  startRowIndex: rowNumber - 1,
                  endRowIndex: rowNumber,
                  startColumnIndex: columnLetter.charCodeAt(0) - 65,
                  endColumnIndex: columnLetter.charCodeAt(0) - 64
                },
                cell: {
                  userEnteredValue: {
                    stringValue: combinedContent
                  },
                  textFormatRuns: [
                    // Keep existing text in default color
                    {
                      startIndex: 0,
                      format: {}
                    },
                    // New text in green
                    {
                      startIndex: newTextStartIndex,
                      format: {
                        foregroundColor: {
                          red: 0.0,
                          green: 0.5,
                          blue: 0.0
                        }
                      }
                    }
                  ]
                },
                fields: 'userEnteredValue,textFormatRuns'
              }
            }
          ]
        }
      });

      if (batchUpdateRes.status === 200) {
        return `Successfully appended updated scenario at ${cellReference}. New scenario added in green color: "${updatedScenario.substring(0, 100)}${updatedScenario.length > 100 ? '...' : ''}"`;
      } else {
        return `Failed to append scenario. Status: ${batchUpdateRes.status}`;
      }

    } catch (error) {
      return `Error updating test scenario: ${error.message}`;
    }
  }
);

 tool("mobile_list_elements_on_screennn", "List elements on screen and their coordinates, with display text or accessibility label. Returns the complete XML structure to maintain hierarchy for XPath creation. Do not cache this result.", {}, async ({}) => {
     requireRobot();
     const xmlStructure = await robot.getXmlStructure();
     return `Complete XML structure of current screen: ${JSON.stringify(xmlStructure)}`;
 });

    tool("mobile_press_button", "Press a button on device", {
        button: zod_1.z.string().describe("The button to press. Supported buttons: BACK (android only), HOME, VOLUME_UP, VOLUME_DOWN, ENTER, DPAD_CENTER (android tv only), DPAD_UP (android tv only), DPAD_DOWN (android tv only), DPAD_LEFT (android tv only), DPAD_RIGHT (android tv only)"),
    }, async ({ button }) => {
        requireRobot();
        await robot.pressButton(button);
        return `Pressed the button: ${button}`;
    });

    tool("mobile_open_url", "Open a URL in browser on device", {
        url: zod_1.z.string().describe("The URL to open"),
    }, async ({ url }) => {
        requireRobot();
        await robot.openUrl(url);
        await new Promise(resolve => setTimeout(resolve, 5000));
        return `Opened URL: ${url}`;
    });

    tool("swipe_on_screen", "Swipe on the screen"Swipe on the screen", {
        direction: zod_1.z.enum(["up", "down"]).describe("The direction to swipe, up direction means it will from bottom part of the screen to top part of screen, essentially moving the screen content up and opposite happens for down"),
    }, async ({ direction }) => {
        requireRobot();
        await robot.swipe(direction);
        return `Swiped ${direction} on screen`;
    });

    tool("mobile_type_keys", "Type text into the focused element", {
        text: zod_1.z.string().describe("The text to type"),
        submit: zod_1.z.boolean().describe("Whether to submit the text. If true, the text will be submitted as if the user pressed the enter key."),
    }, async ({ text, submit }) => {
        requireRobot();
        await robot.sendKeys(text);
        if (submit) {
            await robot.pressButton("ENTER");
        }
        return `Typed text: ${text}`;
    });

    tool("mobile_set_orientation", "Change the screen orientation of the device", {
        orientation: zod_1.z.enum(["portrait", "landscape"]).describe("The desired orientation"),
    }, async ({ orientation }) => {
        requireRobot();
        await robot.setOrientation(orientation);
        return `Changed device orientation to ${orientation}`;
    });

    tool("mobile_get_orientation", "Get the current screen orientation of the device", {}, async () => {
        requireRobot();
        const orientation = await robot.getOrientation();
        return `Current device orientation is ${orientation}`;
    });

    tool(
      "mobile_tap_by_text",
      "Tap an element on screen by its displayed text or accessibility label using ADB tap",
      {
        text: zod_1.z.string().describe("The exact text or label of the element to tap"),
      },
      async ({ text }) => {
        if (!text) throw new Error("Input text is required");

        requireRobot(); // ensure robot instance available
        const elements = await robot.getElementsOnScreen();

        // Find element by exact match on text or label
        const element = elements.find(
          el => el.text === text || el.label === text
        );

        if (!element) throw new Error(`Element with text or label "${text}" not found`);

        // Calculate center coordinates
        const rect = element.rect;
        const x = Math.floor(rect.x + rect.width / 2);
        const y = Math.floor(rect.y + rect.height / 2);

        // Execute adb tap
        const { execSync } = require("child_process");
        execSync(`adb shell input tap ${x} ${y}`);

        return `Tapped element with text/label "${text}" at (${x},${y})`;
      }
    );

//    tool(
//      "mobile_fetch_jira_ticket",
//      "Fetch JIRA ticket information including summary, description, and extract Figma links from description",
//      {
//        ticketId: zod_1.z.string().describe("The JIRA ticket ID (e.g., HDA-434)"),
//      },
//      async ({ ticketId }) => {
//        try {
//          // Read JIRA credentials from desktop/jira.json file
//          const jiraConfigPath = path.join(os.homedir(), 'Desktop', 'jira.json');
//
//          let jiraConfig;
//          try {
//            const configContent = await fs.readFile(jiraConfigPath, 'utf-8');
//            jiraConfig = JSON.parse(configContent);
//          } catch (error) {
//            throw new Error(`Failed to read JIRA config from ${jiraConfigPath}: ${error.message}`);
//          }
//
//          // Extract all required values from JSON file
//          const { api: jiraApiToken, baseUrl: jiraBaseUrl, email: jiraEmail } = jiraConfig;
//
//          if (!jiraApiToken) {
//            throw new Error('JIRA API token not found in jira.json file. Please ensure the file contains "api" field.');
//          }
//
//          if (!jiraBaseUrl) {
//            throw new Error('JIRA base URL not found in jira.json file. Please ensure the file contains "baseUrl" field.');
//          }
//
//          if (!jiraEmail) {
//            throw new Error('JIRA email not found in jira.json file. Please ensure the file contains "email" field.');
//          }
//
//          // Create Basic Auth token
//          const auth = Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString('base64');
//
//          // Fetch ticket from JIRA API
//          const response = await axios.get(
//            `${jiraBaseUrl}/rest/api/3/issue/${ticketId}`,
//            {
//              headers: {
//                'Authorization': `Basic ${auth}`,
//                'Accept': 'application/json',
//                'Content-Type': 'application/json'
//              }
//            }
//          );
//
//          const issue = response.data;
//
//          // Extract summary and description
//          const summary = issue.fields.summary || 'No summary available';
//          const description = issue.fields.description ?
//            extractTextFromADF(issue.fields.description) :
//            'No description available';
//
//          // Extract Figma links directly from ADF structure
//          const figmaLinks = extractFigmaLinksFromADF(issue.fields.description);
//
//          // Format response
//          const result = {
//            ticketId: ticketId,
//            summary: summary,
//            description: description,
//            figmaLinks: figmaLinks.length > 0 ? figmaLinks : ['No Figma links found']
//          };
//
//          return `JIRA Ticket Information:
//    Ticket ID: ${result.ticketId}
//    Summary: ${result.summary}
//    Description: ${result.description}
//    Figma Links: ${result.figmaLinks.join(', ')}`;
//
//        } catch (error) {
//          if (error.response && error.response.status === 404) {
//            return `Error: JIRA ticket ${ticketId} not found. Please check the ticket ID.`;
//          } else if (error.response && error.response.status === 401) {
//            return `Error: Authentication failed. Please check your JIRA credentials.`;
//          } else {
//            return `Error fetching JIRA ticket: ${error.message}`;
//          }
//        }
//      }
//    );
//
//    // Helper function to extract text from Atlassian Document Format (ADF)
//    function extractTextFromADF(adfContent) {
//      if (!adfContent || typeof adfContent !== 'object') {
//        return String(adfContent || '');
//      }
//
//      let text = '';
//
//      function traverse(node) {
//        if (node.type === 'text') {
//          text += node.text || '';
//        } else if (node.content && Array.isArray(node.content)) {
//          node.content.forEach(traverse);
//        }
//
//        // Add line breaks for paragraphs
//        if (node.type === 'paragraph') {
//          text += '\n';
//        }
//      }
//
//      if (adfContent.content) {
//        adfContent.content.forEach(traverse);
//      }
//
//      return text.trim();
//    }
//
//    // Helper function to extract Figma links directly from ADF structure
//    function extractFigmaLinksFromADF(adfContent) {
//      if (!adfContent || typeof adfContent !== 'object') {
//        return [];
//      }
//
//      const figmaLinks = [];
//
//      function traverse(node) {
//        // Check for inlineCard nodes with Figma URLs
//        if (node.type === 'inlineCard' && node.attrs && node.attrs.url) {
//          const url = node.attrs.url;
//          if (url.includes('figma.com')) {
//            figmaLinks.push(url);
//          }
//        }
//
//        // Check for link marks with Figma URLs
//        if (node.marks && Array.isArray(node.marks)) {
//          node.marks.forEach(mark => {
//            if (mark.type === 'link' && mark.attrs && mark.attrs.href) {
//              const href = mark.attrs.href;
//              if (href.includes('figma.com')) {
//                figmaLinks.push(href);
//              }
//            }
//          });
//        }
//
//        // Traverse child content
//        if (node.content && Array.isArray(node.content)) {
//          node.content.forEach(traverse);
//        }
//      }
//
//      if (adfContent.content) {
//        adfContent.content.forEach(traverse);
//      }
//
//      // Remove duplicates and return
//      return [...new Set(figmaLinks)];
//    }
//
//// ----------------------
//// Helper: Extract File ID & Node ID
//// ----------------------
//function extractFileAndNodeId(url) {
//  const patterns = [
//    /figma\.com\/file\/([a-zA-Z0-9]+)/,
//    /figma\.com\/design\/([a-zA-Z0-9]+)/,
//    /figma\.com\/proto\/([a-zA-Z0-9]+)/
//  ];
//
//  let fileId = null;
//  for (const pattern of patterns) {
//    const match = url.match(pattern);
//    if (match) {
//      fileId = match[1];
//      break;
//    }
//  }
//
//  // Extract node-id if present
//  const nodeMatch = url.match(/[?&]node-id=([^&]+)/);
//  let nodeId = null;
//  if (nodeMatch) {
//    // Replace dash with colon (Figma expects 13:5951 instead of 13-5951)
//    nodeId = decodeURIComponent(nodeMatch[1]).replace(/-/g, ":");
//  }
//
//  return { fileId, nodeId };
//}
//
//// ----------------------
//// TOOL 1: Export Figma to PNG
//// ----------------------
//tool(
//  "mobile_export_figma_png",
//  "Export Figma file as PNG",
//  {
//    figmaUrl: zod_1.z.string().describe("The Figma file URL to export as PNG")
//  },
//  async ({ figmaUrl }) => {
//    try {
//      // Load Figma token from Desktop/figma.json
//      const figmaConfigPath = path.join(os.homedir(), "Desktop", "figma.json");
//      const configContent = await fs.readFile(figmaConfigPath, "utf-8");
//      const { token: figmaToken } = JSON.parse(configContent);
//
//      if (!figmaToken) throw new Error("Figma API token missing in figma.json");
//
//      // Extract fileId and nodeId from URL
//      const { fileId, nodeId } = extractFileAndNodeId(figmaUrl);
//      if (!fileId) throw new Error("Invalid Figma URL - cannot extract fileId");
//
//      let idsToExport = [];
//
//      if (nodeId) {
//        // Use node-id directly from URL
//        idsToExport = [nodeId];
//      } else {
//        // Fallback: scan file to collect all top-level frames
//        const fileResponse = await axios.get(
//          `https://api.figma.com/v1/files/${fileId}`,
//          { headers: { "X-Figma-Token": figmaToken } }
//        );
//
//        fileResponse.data.document.children?.forEach(page => {
//          page.children?.forEach(child => {
//            if (child.type === "FRAME") idsToExport.push(child.id);
//          });
//        });
//
//        if (idsToExport.length === 0)
//          throw new Error("No frames found in Figma file");
//      }
//
//      // Request PNG export with higher scale for better quality
//      const exportResponse = await axios.get(
//        `https://api.figma.com/v1/images/${fileId}`,
//        {
//          headers: { "X-Figma-Token": figmaToken },
//          params: {
//            ids: idsToExport.join(","),
//            format: "png",
//            scale: "2" // 2x scale for better quality
//          }
//        }
//      );
//
//      const exportPath = path.join(os.homedir(), "Desktop", "figma");
//
//      // Clear the folder before creating new PNGs
//      try {
//        // Check if folder exists
//        await fs.access(exportPath);
//        // If folder exists, remove all contents
//        const files = await fs.readdir(exportPath);
//        await Promise.all(
//          files.map(file => fs.unlink(path.join(exportPath, file)))
//        );
//      } catch (err) {
//        // Folder doesn't exist or is empty, no need to clear
//        if (err.code !== 'ENOENT') {
//        }
//      }
//
//      // Ensure directory exists
//      await fs.mkdir(exportPath, { recursive: true });
//
//      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
//
//      // Download all PNG images
//      const downloadPromises = Object.entries(exportResponse.data.images).map(
//        async ([nodeId, pngUrl], index) => {
//          if (!pngUrl) throw new Error(`No PNG export URL returned for node ${nodeId}`);
//
//          const pngResponse = await axios.get(pngUrl, { responseType: "arraybuffer" });
//          const filename = idsToExport.length > 1
//            ? `figma-export-${timestamp}-${index + 1}.png`
//            : `figma-export-${timestamp}.png`;
//          const pngPath = path.join(exportPath, filename);
//
//          await fs.writeFile(pngPath, pngResponse.data);
//          return pngPath;
//        }
//      );
//
//      const savedPaths = await Promise.all(downloadPromises);
//
//      return `✅ PNG Export Complete: ${savedPaths.length} file(s) saved to ${exportPath}`;
//    } catch (err) {
//      return `❌ Error exporting Figma PNG: ${err.message}`;
//    }
//  }
//);

//tool(
//  "fetch_testcases_from_tcms",
//  "Before calling these tool, folder name can be analysed by data fetched from jira ticket info. Before generating test cases for a jira ticket, always fetch existing test cases from TCMS tool for a specific folder",
//  {
//    projectKey: zod_1.z.string().describe("The project key Default: SCRUM"),
//    folderName: zod_1.z.string().describe("The folder name to filter test cases (e.g., PDP), folder name can to be fetched from jira ticket info")
//  },
//  async ({ projectKey, folderName }) => {
//    try {
//      // Load AIO token from Desktop/aio.json
//      const aioConfigPath = path.join(os.homedir(), "Desktop", "aio.json");
//      const configContent = await fs.readFile(aioConfigPath, "utf-8");
//      const { token } = JSON.parse(configContent);
//
//      if (!token) throw new Error("AIO token missing in aio.json");
//
//      // Make API request to TCMS
//      const response = await axios.get(
//        `https://tcms.aiojiraapps.com/aio-tcms/api/v1/project/${projectKey}/testcase`,
//        {
//          headers: {
//            "accept": "application/json;charset=utf-8",
//            "Authorization": `AioAuth ${token}`
//          }
//        }
//      );
//
//      const testCases = response.data.items || [];
//
//      // Filter test cases by folder name
//      const filteredTestCases = testCases.filter(testCase =>
//        testCase.folder && testCase.folder.name === folderName
//      );
//
//      if (filteredTestCases.length === 0) {
//        return `No test cases found in folder: ${folderName}`;
//      }
//
//      // Extract key, title, and folder name
//      const extractedTestCases = filteredTestCases.map(testCase => ({
//        key: testCase.key,
//        title: testCase.title,
//        folderName: testCase.folder.name
//      }));
//
//      // Format as string response
//      const result = `✅ Found ${extractedTestCases.length} test cases in folder: ${folderName}\n\n` +
//        extractedTestCases.map(tc =>
//          `Key: ${tc.key}\nTitle: ${tc.title}\nFolder: ${tc.folderName}\n---`
//        ).join('\n');
//
//      return result;
//
//    } catch (err) {
//      if (err.response) {
//        return `❌ TCMS API Error: ${err.response.status} - ${err.response.data?.message || err.response.statusText}`;
//      }
//      return `❌ Error fetching test cases: ${err.message}`;
//    }
//  }
//);

//tool(
//  "generate_testcases_from_ticket_data",
//  "Generate manual test cases by analyzing PNG design with JIRA requirements",
//  {
//    jiraSummary: zod_1.z.string().describe("Jira issue summary"),
//    jiraDescription: zod_1.z.string().describe("Jira issue description"),
//    existingTestCases: zod_1.z.string().optional().describe("Existing test cases from TCMS")
//  },
//  async ({ jiraSummary, jiraDescription, existingTestCases }) => {
//    try {
//      // Clear the generated test cases file before starting
//      const testCasesFilePath = path.join(__dirname, 'generated-testcases.txt');
//      await fs.writeFile(testCasesFilePath, ''); // Clear the file
//
//      // Load OpenAI API key from Desktop/openai.json
//      const openaiConfigPath = path.join(os.homedir(), "Desktop", "openai.json");
//      const configContent = await fs.readFile(openaiConfigPath, "utf-8");
//      const { apiKey } = JSON.parse(configContent.trim());
//
//      // Load test case generation guidelines
//      const guidelinesPath = path.join(__dirname, 'testcases-generation-context.txt');
//      const guidelines = await fs.readFile(guidelinesPath, "utf-8");
//
//      const figmaDir = path.join(os.homedir(), "Desktop", "figma");
//      const files = await fs.readdir(figmaDir);
//      const pngFiles = files.filter(file => file.toLowerCase().endsWith('.png'));
//
//      if (pngFiles.length === 0) throw new Error("No PNG files found in figma folder");
//
//      // Get the latest PNG file
//      const latestPng = pngFiles.sort((a, b) => b.localeCompare(a))[0];
//      const pngPath = path.join(figmaDir, latestPng);
//
//      const client = new OpenAI({ apiKey });
//
//      // Convert PNG to base64 for vision API
//      const pngBuffer = await fs.readFile(pngPath);
//      const base64Image = pngBuffer.toString('base64');
//
//      // Start OpenAI generation (this will run in background due to timeout)
//      client.chat.completions.create({
//        model: "gpt-5", // Use GPT-5 model for image analysis
//        messages: [{
//          role: "user",
//          content: [
//            {
//              type: "text",
//              text: `Generate manual test cases based on the following:
//
//JIRA Summary: ${jiraSummary}
//
//JIRA Description: ${jiraDescription}
//
//${existingTestCases ? `Existing Test Cases from TCMS:
//${existingTestCases}
//
//Please consider these existing test cases and generate additional comprehensive test cases that complement them.` : ''}
//
//Test Case Generation Guidelines:
//${guidelines}`
//            },
//            {
//              type: "image_url",
//              image_url: {
//                url: `data:image/png;base64,${base64Image}`,
//                detail: "high"
//              }
//            }
//          ]
//        }],
//        max_completion_tokens: 10000
//      }).then(async (completion) => {
//        // Save test cases to file when generation completes
//        const testCases = completion.choices[0].message.content;
//        await fs.writeFile(testCasesFilePath, testCases);
//      }).catch(async (error) => {
//        // Save error to file if generation fails
//        await fs.writeFile(testCasesFilePath, `Error generating test cases: ${error.message}`);
//      });
//
//      return "✅ Test case generation started. Use 'check_testcases_status' tool to check if generation is complete. Try max 10 times";
//    } catch (err) {
//      return `❌ Error starting test case generation: ${err.message}`;
//    }
//  }
//);
//
//tool(
//  "check_testcases_status",
//  "Check if test cases have been generated and saved to file",
//  {},
//  async () => {
//    try {
//      // Wait for 20 seconds before checking
//      await new Promise(resolve => setTimeout(resolve, 25000));
//
//      const testCasesFilePath = path.join(__dirname, 'generated-testcases.txt');
//
//      // Check if file exists and has content
//      try {
//        const fileContent = await fs.readFile(testCasesFilePath, 'utf-8');
//
//        if (fileContent.trim().length === 0) {
//          return "❌ Test cases are still being generated. Please wait and try again.";
//        }
//
//        if (fileContent.startsWith('Error generating test cases:')) {
//          return `❌ ${fileContent}`;
//        }
//
//        return `✅ Test cases generated successfully!\n\n${fileContent}`;
//      } catch (fileError) {
//        return "❌ Test cases file not found or still being created. Please wait and try again.";
//      }
//    } catch (err) {
//      return `❌ Error checking test cases status: ${err.message}`;
//    }
//  }
//);
//
//// Fix 2: Updated review_testcases tool with proper JSON handling and open module usage
//tool(
//  "review_testcases",
//  "Open test cases in browser for manual approval.",
//  {
//    testCases: zod_1.z.array(zod_1.z.array(zod_1.z.string())).describe("test cases array generated by tool generate_testcases_from_ticket_data")
//  },
//  async ({ testCases }) => {
//    try {
//      const app = express();
//      let port = 3001;
//
//      // Find an available port
//      const findAvailablePort = async (startPort) => {
//        const net = require('net');
//        return new Promise((resolve) => {
//          const server = net.createServer();
//          server.listen(startPort, () => {
//            const port = server.address().port;
//            server.close(() => resolve(port));
//          });
//          server.on('error', () => {
//            resolve(findAvailablePort(startPort + 1));
//          });
//        });
//      };
//
//      port = await findAvailablePort(port);
//
//      // Generate unique session ID
//      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
//
//      // Store approval status
//      let approvalStatus = 'pending';
//      let finalTestCases = [];
//
//      app.use(express.json({ limit: '10mb' }));
//      app.use(express.urlencoded({ extended: true, limit: '10mb' }));
//
//      // Process test cases - handle the specific format properly
//      const processedTestCases = testCases.map((testCase, index) => {
//        if (Array.isArray(testCase)) {
//          const arrayLength = testCase.length;
//
//          if (arrayLength === 4) {
//            // Modify case: ["original title", "new description", "Modify", "SCRUM-TC-1"]
//            return {
//              originalTitle: testCase[0] || `Test Case ${index + 1}`,
//              newDescription: testCase[1] || '',
//              status: testCase[2] || 'Modify',
//              testId: testCase[3] || '',
//              index: index
//            };
//          } else if (arrayLength === 3) {
//            // Remove case: ["title", "Remove", "SCRUM-TC-2"]
//            return {
//              title: testCase[0] || `Test Case ${index + 1}`,
//              status: testCase[1] || 'Remove',
//              testId: testCase[2] || '',
//              index: index
//            };
//          } else if (arrayLength === 2) {
//            // New case: ["title", "New"]
//            return {
//              title: testCase[0] || `Test Case ${index + 1}`,
//              status: testCase[1] || 'New',
//              index: index
//            };
//          } else {
//            // Fallback for unexpected format
//            return {
//              title: testCase[0] || `Test Case ${index + 1}`,
//              status: 'New',
//              index: index
//            };
//          }
//        } else {
//          // Fallback for non-array format
//          return {
//            title: String(testCase) || `Test Case ${index + 1}`,
//            status: 'New',
//            index: index
//          };
//        }
//      });
//
//      // Helper function to get display text for test cases
//      const getTestCaseDisplayText = (testCase) => {
//        const status = testCase.status.toLowerCase();
//
//        if (status === 'modify') {
//          // For modify cases, show original → changed format
//          return `Original: ${testCase.originalTitle}\nChanged to: ${testCase.newDescription}`;
//        } else if (status === 'remove') {
//          // For remove cases, show the title
//          return testCase.title;
//        } else {
//          // For new cases, show the title
//          return testCase.title;
//        }
//      };
//
//      // Main review page with proper handling
//      app.get('/', (req, res) => {
//        try {
//          const htmlContent = `
//<!DOCTYPE html>
//<html lang="en">
//<head>
//    <meta charset="UTF-8">
//    <meta name="viewport" content="width=device-width, initial-scale=1.0">
//    <title>Test Cases Review & Approval</title>
//    <style>
//        * {
//            margin: 0;
//            padding: 0;
//            box-sizing: border-box;
//        }
//
//        body {
//            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
//            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
//            min-height: 100vh;
//            padding: 20px;
//        }
//
//        .container {
//            max-width: 1200px;
//            margin: 0 auto;
//            background: white;
//            border-radius: 15px;
//            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.1);
//            overflow: hidden;
//        }
//
//        .header {
//            background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
//            color: white;
//            padding: 30px;
//            text-align: center;
//        }
//
//        .header h1 {
//            font-size: 2.5rem;
//            margin-bottom: 10px;
//            font-weight: 700;
//        }
//
//        .header p {
//            font-size: 1.1rem;
//            opacity: 0.9;
//        }
//
//        .stats {
//            display: flex;
//            justify-content: space-around;
//            background: #f8f9fa;
//            padding: 20px;
//            border-bottom: 1px solid #e9ecef;
//        }
//
//        .stat-item {
//            text-align: center;
//        }
//
//        .stat-number {
//            font-size: 2rem;
//            font-weight: bold;
//            color: #495057;
//        }
//
//        .stat-label {
//            color: #6c757d;
//            font-size: 0.9rem;
//            margin-top: 5px;
//        }
//
//        .controls {
//            padding: 20px;
//            background: #f8f9fa;
//            display: flex;
//            justify-content: space-between;
//            align-items: center;
//            flex-wrap: wrap;
//            gap: 10px;
//        }
//
//        .btn {
//            padding: 12px 24px;
//            border: none;
//            border-radius: 8px;
//            font-weight: 600;
//            cursor: pointer;
//            transition: all 0.3s ease;
//            text-decoration: none;
//            display: inline-block;
//            font-size: 14px;
//        }
//
//        .btn-primary {
//            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
//            color: white;
//        }
//
//        .btn-primary:hover {
//            transform: translateY(-2px);
//            box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
//        }
//
//        .btn-secondary {
//            background: #6c757d;
//            color: white;
//        }
//
//        .btn-secondary:hover {
//            background: #5a6268;
//        }
//
//        .btn-delete {
//            background: #dc3545;
//            color: white;
//            padding: 8px 16px;
//            font-size: 12px;
//        }
//
//        .btn-delete:hover {
//            background: #c82333;
//        }
//
//        .btn-restore {
//            background: #28a745;
//            color: white;
//            padding: 8px 16px;
//            font-size: 12px;
//        }
//
//        .btn-restore:hover {
//            background: #218838;
//        }
//
//        .test-cases {
//            max-height: 70vh;
//            overflow-y: auto;
//        }
//
//        .test-case {
//            border-bottom: 1px solid #e9ecef;
//            padding: 20px;
//            transition: all 0.3s ease;
//        }
//
//        .test-case:hover {
//            background: #f8f9fa;
//        }
//
//        .test-case.deleted {
//            opacity: 0.5;
//            background: #f8d7da;
//        }
//
//        .test-case-header {
//            display: flex;
//            justify-content: space-between;
//            align-items: center;
//            margin-bottom: 15px;
//        }
//
//        .test-case-meta {
//            display: flex;
//            gap: 15px;
//            align-items: center;
//        }
//
//        .test-case-index {
//            background: #007bff;
//            color: white;
//            padding: 4px 8px;
//            border-radius: 4px;
//            font-size: 12px;
//            font-weight: bold;
//        }
//
//        .test-case-status {
//            padding: 4px 12px;
//            border-radius: 12px;
//            font-size: 12px;
//            font-weight: 600;
//        }
//
//        .status-new {
//            background: #d4edda;
//            color: #155724;
//        }
//
//        .status-modify {
//            background: #fff3cd;
//            color: #856404;
//        }
//
//        .status-remove {
//            background: #f8d7da;
//            color: #721c24;
//        }
//
//        .test-case textarea {
//            width: 100%;
//            min-height: 100px;
//            padding: 15px;
//            border: 2px solid #e9ecef;
//            border-radius: 8px;
//            font-family: inherit;
//            font-size: 14px;
//            line-height: 1.5;
//            resize: vertical;
//            transition: border-color 0.3s ease;
//        }
//
//        .test-case textarea:focus {
//            outline: none;
//            border-color: #007bff;
//            box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
//        }
//
//        .notification {
//            position: fixed;
//            top: 20px;
//            right: 20px;
//            padding: 15px 25px;
//            border-radius: 8px;
//            color: white;
//            font-weight: 600;
//            display: none;
//            z-index: 1000;
//            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
//        }
//
//        @media (max-width: 768px) {
//            .container {
//                margin: 10px;
//                border-radius: 10px;
//            }
//
//            .header h1 {
//                font-size: 2rem;
//            }
//
//            .stats {
//                flex-direction: column;
//                gap: 15px;
//            }
//
//            .controls {
//                flex-direction: column;
//                gap: 15px;
//            }
//
//            .test-case-header {
//                flex-direction: column;
//                align-items: flex-start;
//                gap: 10px;
//            }
//        }
//    </style>
//</head>
//<body>
//    <div class="notification" id="notification"></div>
//
//    <div class="container">
//        <div class="header">
//            <h1>🔍 Test Cases Review & Approval</h1>
//            <p>Review, edit, and approve your test cases. Make any necessary changes before final approval.</p>
//        </div>
//
//        <div class="stats">
//            <div class="stat-item">
//                <div class="stat-number" id="totalCount">${processedTestCases.length}</div>
//                <div class="stat-label">Total Cases</div>
//            </div>
//            <div class="stat-item">
//                <div class="stat-number" id="activeCount">${processedTestCases.length}</div>
//                <div class="stat-label">Active Cases</div>
//            </div>
//            <div class="stat-item">
//                <div class="stat-number" id="deletedCount">0</div>
//                <div class="stat-label">Deleted Cases</div>
//            </div>
//        </div>
//
//        <div class="controls">
//            <div>
//                <button class="btn btn-secondary" onclick="resetAll()">🔄 Reset All</button>
//            </div>
//            <div>
//                <button class="btn btn-primary" onclick="approveTestCases()">✅ Approve Test Cases</button>
//            </div>
//        </div>
//
//        <div class="test-cases">
//            ${processedTestCases.map((testCase, index) => {
//              const displayText = getTestCaseDisplayText(testCase);
//              const statusLabel = testCase.status === 'Remove' ? 'Remove' : testCase.status;
//
//              // Create proper label and test ID display for modify/remove cases
//              let labelAndIdDisplay = '';
//              if (testCase.status.toLowerCase() === 'modify' && testCase.testId) {
//                labelAndIdDisplay = `<div style="margin-bottom: 8px; font-weight: 600; color: #856404; font-size: 13px;">Modify - ${testCase.testId}</div>`;
//              } else if (testCase.status.toLowerCase() === 'remove' && testCase.testId) {
//                labelAndIdDisplay = `<div style="margin-bottom: 8px; font-weight: 600; color: #721c24; font-size: 13px;">Remove - ${testCase.testId}</div>`;
//              }
//
//              return `
//                <div class="test-case" data-index="${index}">
//                    <div class="test-case-header">
//                        <div class="test-case-meta">
//                            <span class="test-case-index">#${index + 1}</span>
//                            <span class="test-case-status status-${testCase.status.toLowerCase()}">${statusLabel}</span>
//                        </div>
//                        <button class="btn btn-delete" onclick="toggleDelete(${index})">Delete</button>
//                    </div>
//                    ${labelAndIdDisplay}
//                    <textarea data-index="${index}" placeholder="Enter test case details...">${displayText}</textarea>
//                </div>
//              `;
//            }).join('')}
//        </div>
//    </div>
//
//    <script>
//        let testCases = ${JSON.stringify(processedTestCases).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')};
//        let deletedIndices = new Set();
//
//        function updateStats() {
//            document.getElementById('activeCount').textContent = testCases.length - deletedIndices.size;
//            document.getElementById('deletedCount').textContent = deletedIndices.size;
//        }
//
//        function toggleDelete(index) {
//            const testCaseEl = document.querySelector(\`[data-index="\${index}"]\`);
//            const btn = testCaseEl.querySelector('.btn-delete, .btn-restore');
//
//            if (deletedIndices.has(index)) {
//                // Restore
//                deletedIndices.delete(index);
//                testCaseEl.classList.remove('deleted');
//                btn.textContent = 'Delete';
//                btn.className = 'btn btn-delete';
//            } else {
//                // Delete
//                deletedIndices.add(index);
//                testCaseEl.classList.add('deleted');
//                btn.textContent = 'Restore';
//                btn.className = 'btn btn-restore';
//            }
//            updateStats();
//        }
//
//        function resetAll() {
//            deletedIndices.clear();
//            document.querySelectorAll('.test-case').forEach((el, index) => {
//                el.classList.remove('deleted');
//                const btn = el.querySelector('.btn-delete, .btn-restore');
//                btn.textContent = 'Delete';
//                btn.className = 'btn btn-delete';
//
//                // Reset textarea value
//                const textarea = el.querySelector('textarea');
//                const originalTestCase = testCases[index];
//
//                // Use proper display format based on status
//                let resetValue = '';
//                const status = originalTestCase.status.toLowerCase();
//
//                if (status === 'modify') {
//                    resetValue = 'Original: ' + originalTestCase.originalTitle + '\\nChanged to: ' + originalTestCase.newDescription;
//                } else if (status === 'remove') {
//                    resetValue = originalTestCase.title;
//                } else {
//                    resetValue = originalTestCase.title;
//                }
//
//                textarea.value = resetValue;
//            });
//            updateStats();
//        }
//
//        function showNotification(message, type = 'success') {
//            const notification = document.getElementById('notification');
//            notification.textContent = message;
//            notification.style.background = type === 'success' ? '#28a745' : '#dc3545';
//            notification.style.display = 'block';
//
//            setTimeout(() => {
//                notification.style.display = 'none';
//            }, 3000);
//        }
//
//        function approveTestCases() {
//            try {
//                // Collect updated test cases
//                const updatedTestCases = [];
//                document.querySelectorAll('.test-case').forEach((el, index) => {
//                    if (!deletedIndices.has(index)) {
//                        const textarea = el.querySelector('textarea');
//                        const originalTestCase = testCases[index];
//
//                        // Create the updated test case array based on the original format
//                        let updatedCase;
//                        const status = originalTestCase.status.toLowerCase();
//
//                        if (status === 'modify') {
//                            // For modify: [updatedContent, newDescription, "Modify", testId]
//                            updatedCase = [
//                                textarea.value.trim(),
//                                originalTestCase.newDescription,
//                                originalTestCase.status,
//                                originalTestCase.testId
//                            ];
//                        } else if (status === 'remove') {
//                            // For remove: [updatedContent, "Remove", testId]
//                            updatedCase = [
//                                textarea.value.trim(),
//                                originalTestCase.status,
//                                originalTestCase.testId
//                            ];
//                        } else {
//                            // For new: [updatedContent, "New"]
//                            updatedCase = [
//                                textarea.value.trim(),
//                                originalTestCase.status
//                            ];
//                        }
//
//                        updatedTestCases.push(updatedCase);
//                    }
//                });
//
//                // Send approval to server
//                fetch('/approve', {
//                    method: 'POST',
//                    headers: {
//                        'Content-Type': 'application/json',
//                    },
//                    body: JSON.stringify({
//                        sessionId: '${sessionId}',
//                        testCases: updatedTestCases
//                      })
//                })
//                .then(response => response.json())
//                .then(data => {
//                    if (data.success) {
//                        showNotification('Test cases approved successfully!');
//                        setTimeout(() => {
//                          window.close();
//                        }, 2000);
//                    } else {
//                        showNotification('Error approving test cases', 'error');
//                    }
//                })
//                .catch(error => {
//                    showNotification('Error approving test cases', 'error');
//                    console.error('Error:', error);
//                });
//            } catch (error) {
//                showNotification('Error processing test cases', 'error');
//                console.error('Error:', error);
//            }
//        }
//
//        // Update test cases when textarea changes
//        document.addEventListener('input', function(e) {
//            if (e.target.tagName === 'TEXTAREA') {
//                const index = parseInt(e.target.getAttribute('data-index'));
//                if (!isNaN(index) && testCases[index]) {
//                    // Update the title with the textarea content
//                    testCases[index].title = e.target.value.trim();
//                }
//            }
//        });
//    </script>
//</body>
//</html>
//          `;
//          res.send(htmlContent);
//        } catch (error) {
//          console.error('Error rendering page:', error);
//          res.status(500).send('Error rendering page');
//        }
//      });
//
//      // Approval endpoint with better error handling
//      app.post('/approve', (req, res) => {
//        try {
//          const { testCases: approvedTestCases, sessionId: receivedSessionId } = req.body;
//
//          if (receivedSessionId !== sessionId) {
//            return res.status(400).json({ success: false, message: 'Invalid session ID' });
//          }
//
//          finalTestCases = approvedTestCases;
//          approvalStatus = 'approved';
//
//          // Save to global state for the check tool
//          global.approvalSessions = global.approvalSessions || {};
//          global.approvalSessions[sessionId] = {
//            status: 'approved',
//            testCases: finalTestCases,
//            timestamp: Date.now()
//          };
//
//          res.json({ success: true, message: 'Test cases approved successfully' });
//
//          // Close server after approval
//          setTimeout(() => {
//            if (server && server.listening) {
//              server.close();
//            }
//          }, 3000);
//        } catch (error) {
//          console.error('Approval error:', error);
//          res.status(500).json({ success: false, message: error.message });
//        }
//      });
//
//      // Error handling middleware
//      app.use((err, req, res, next) => {
//        console.error('Express error:', err);
//        res.status(500).json({ error: 'Internal server error' });
//      });
//
//      // 404 handler
//      app.use((req, res) => {
//        res.status(404).json({ error: 'Not found' });
//      });
//
//      // Start server with promise-based approach
//      const server = await new Promise((resolve, reject) => {
//        const srv = app.listen(port, (err) => {
//          if (err) {
//            reject(err);
//            return;
//          }
//          console.log(`✅ Test case review session started. Session ID: ${sessionId}.`);
//          console.log(`Server running at http://localhost:${port}`);
//          console.log(`Browser should open automatically.`);
//          resolve(srv);
//        });
//
//        srv.on('error', (error) => {
//          reject(error);
//        });
//      });
//
//      // Open browser with proper error handling
//      let openAttemptFailed = false;
//      try {
//        await openBrowser(`http://localhost:${port}`);
//      } catch (err) {
//        openAttemptFailed = true;
//        console.error('Failed to open browser automatically:', err.message);
//        // Continue without opening browser - user can manually navigate to the URL
//      }
//
//      // Store session globally for status checking
//      global.approvalSessions = global.approvalSessions || {};
//      global.approvalSessions[sessionId] = {
//        status: 'pending',
//        testCases: processedTestCases,
//        timestamp: Date.now(),
//        server: server
//      };
//
//      return `✅ Test case review session started. Session ID: ${sessionId}.\nServer running at http://localhost:${port}\n${openAttemptFailed ? 'Please manually open the URL in your browser.' : 'Browser should open automatically.'}`;
//
//    } catch (err) {
//      console.error('Review tool error:', err);
//      return `❌ Error starting test case review: ${err.message}`;
//    }
//  }
//);
//
//// Fix 3: Updated check_approval_status tool with better error handling
//tool(
//  "check_approval_status",
//  "Check the approval status of test cases review session (waits 25 seconds before checking)",
//  {
//    sessionId: zod_1.z.string().describe("Session ID from review_testcases")
//  },
//  async ({ sessionId }) => {
//    try {
//      // Wait for 25 seconds
//      await new Promise(resolve => setTimeout(resolve, 25000));
//
//      // Check global approval sessions
//      if (!global.approvalSessions || !global.approvalSessions[sessionId]) {
//        return "❌ Session not found. Please ensure the review session is still active.";
//      }
//
//      const session = global.approvalSessions[sessionId];
//
//      if (session.status === 'approved') {
//        const result = {
//          status: 'approved',
//          testCases: session.testCases,
//          approvedCount: session.testCases.length,
//          sessionId: sessionId
//        };
//
//        // Format the approved test cases properly
//        const formattedTestCases = result.testCases.map((tc, index) => {
//          if (!Array.isArray(tc)) {
//            return `${index + 1}. ${String(tc)} (New)`;
//          }
//
//          // Handle different array structures based on length and content
//          let title, description, status, originalCase;
//
//          if (tc.length === 4) {
//            // Standard format: [title, description, status, originalCase]
//            title = tc[0] || `Test Case ${index + 1}`;
//            description = tc[1] || '';
//            status = tc[2] || 'New';
//            originalCase = tc[3] || '';
//          } else if (tc.length === 3) {
//            // Could be [title, status, originalCase] for remove cases
//            title = tc[0] || `Test Case ${index + 1}`;
//            if (tc[1] && tc[1].toLowerCase() === 'remove') {
//              status = tc[1];
//              originalCase = tc[2] || '';
//              description = '';
//            } else {
//              // [title, description, status]
//              description = tc[1] || '';
//              status = tc[2] || 'New';
//              originalCase = '';
//            }
//          } else {
//            // Fallback
//            title = tc[0] || `Test Case ${index + 1}`;
//            description = tc[1] || '';
//            status = tc[2] || 'New';
//            originalCase = tc[3] || '';
//          }
//
//          const statusLower = status.toLowerCase();
//
//          if (statusLower === 'modify') {
//            // For modify cases: show "Original: ... Changed to: ..." format with proper test ID
//            return `${index + 1}. Original: ${title}\n   Changed to: ${description} (Modify) (${originalCase})`;
//          } else if (statusLower === 'remove') {
//            // For remove cases: show title with Remove label and reference
//            return `${index + 1}. ${title} (Remove) (${originalCase})`;
//          } else {
//            // For new cases: just show title with New label
//            return `${index + 1}. ${title} (New)`;
//          }
//        }).join('\n');
//
//        // Clean up session after returning result
//        delete global.approvalSessions[sessionId];
//
//        return `✅ Test cases approved successfully!\n\nApproved ${result.approvedCount} test cases:\n\n${formattedTestCases}\n\nSession completed: ${sessionId}`;
//      } else {
//        return "⏳ Still waiting for approval. The review session is active but not yet approved. Please complete the review in the browser.";
//      }
//
//    } catch (err) {
//      console.error('Check approval status error:', err);
//      return `❌ Error checking approval status: ${err.message}`;
//    }
//  }
//);
//
//tool(
//  "update_testcases_to_tcms",
//  "Create new test cases in TCMS from approved test cases. Only processes test cases with 'New' status, ignores Modify and Remove cases since APIs are not available.",
//  {
//    testCases: zod_1.z.array(zod_1.z.array(zod_1.z.string())).describe("Array of test case arrays from approved test cases")
//  },
//  async ({ testCases }) => {
//    try {
//      // Load AIO token from Desktop/aio.json
//      const aioConfigPath = path.join(os.homedir(), "Desktop", "aio.json");
//      const configContent = await fs.readFile(aioConfigPath, "utf-8");
//      const { token } = JSON.parse(configContent);
//
//      if (!token) throw new Error("AIO token missing in aio.json");
//
//      // Filter test cases to extract only "New" test cases
//      const newTestCases = [];
//
//      for (const testCase of testCases) {
//        if (Array.isArray(testCase) && testCase.length >= 2) {
//          // Check if the last element or second-to-last element is "New"
//          const status = testCase.length === 2 ? testCase[1] : testCase[testCase.length - 2];
//
//          if (status && status.toLowerCase() === 'new') {
//            const title = testCase[0]; // First element is always the title
//            if (title && title.trim().length > 0) {
//              newTestCases.push(title.trim());
//            }
//          }
//        }
//      }
//
//      if (newTestCases.length === 0) {
//        return "No new test cases found to create in TCMS. Only test cases marked as '(New)' are processed.";
//      }
//
//      // Hard-coded values as requested
//      const projectKey = "SCRUM";
//      const folderId = 1;
//      const ownerId = "712020:37085ff2-5a05-47eb-8977-50a485355755";
//
//      // Create test cases in TCMS one by one
//      for (let i = 0; i < newTestCases.length; i++) {
//        const title = newTestCases[i];
//
//        try {
//          const requestBody = {
//            title: title,
//            ownedByID: ownerId,
//            folder: {
//              ID: folderId
//            },
//            status: {
//              name: "Published",
//              description: "The test is ready for execution",
//              ID: 1
//            }
//          };
//
//          (0, logger_1.trace)(`Creating test case ${i + 1}/${newTestCases.length}: ${title}`);
//
//          const response = await axios.post(
//            `https://tcms.aiojiraapps.com/aio-tcms/api/v1/project/${projectKey}/testcase`,
//            requestBody,
//            {
//              headers: {
//                "accept": "application/json;charset=utf-8",
//                "Authorization": `AioAuth ${token}`,
//                "Content-Type": "application/json"
//              }
//            }
//          );
//
//          if (response.status === 200 || response.status === 201) {
//            const testCaseKey = response.data.key || `${projectKey}-TC-${response.data.ID}`;
//            (0, logger_1.trace)(`Successfully created test case: ${testCaseKey} - ${title}`);
//          }
//
//          // Add a small delay between requests to avoid rate limiting
//          await new Promise(resolve => setTimeout(resolve, 500));
//
//        } catch (error) {
//          (0, logger_1.trace)(`Failed to create test case: ${title} - ${error.message}`);
//          throw new Error(`Failed to create test case "${title}": ${error.message}`);
//        }
//      }
//
//      return "All test cases have been updated to TCMS";
//
//    } catch (error) {
//      console.error('TCMS update error:', error);
//      if (error.response) {
//        return `❌ TCMS API Error: ${error.response.status} - ${error.response.data?.message || error.response.statusText}`;
//      }
//      return `❌ Error updating test cases to TCMS: ${error.message}`;
//    }
//  }
//);

    return server;
};

exports.createMcpServer = createMcpServer;
