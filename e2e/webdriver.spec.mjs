import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = 'http://127.0.0.1:1420';

let devServerProcess;
let driver;

async function waitForDevServer(timeoutMs = 20000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // Ignore while server boots.
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error('Vite dev server did not become ready for WebDriver tests.');
}

function routeUrl(route) {
  return `${baseUrl}/#/${route}`;
}

async function findHeading(text) {
  const locator = By.xpath(
    `//*[self::h1 or self::h2 or self::h3 or @role='heading'][contains(normalize-space(), '${text}')]`,
  );
  await driver.wait(until.elementLocated(locator), 10000);
  const heading = await driver.findElement(locator);
  await driver.wait(until.elementIsVisible(heading), 10000);
}

describe('WebDriver e2e', () => {
  before(async () => {
    devServerProcess = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '1420'], {
      cwd: rootDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        VITE_E2E_WEBDRIVER: '1',
      },
    });

    await waitForDevServer();

    const options = new chrome.Options()
      .addArguments('--headless=new')
      .addArguments('--disable-gpu')
      .addArguments('--window-size=1440,900');

    driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
  });

  after(async () => {
    if (driver) {
      await driver.quit();
    }

    if (devServerProcess && !devServerProcess.killed) {
      devServerProcess.kill('SIGTERM');
    }
  });

  beforeEach(async () => {
    await driver.get(routeUrl('dashboard'));
    await driver.executeScript(() => {
      if (!window.__E2E_STATE__) return;
      window.__E2E_STATE__.workflows = [];
      window.__E2E_STATE__.executions = [];
      window.__E2E_STATE__.logsByExecutionId = {};
      window.__E2E_STATE__.invokeLog = [];
      window.__E2E_STATE__.auth = { authenticated: false };
    });
  });

  it('loads dashboard', async () => {
    await driver.get(routeUrl('dashboard'));
    await findHeading('Workflows');
  });

  it('navigates to monitoring route', async () => {
    await driver.get(routeUrl('monitoring'));
    await findHeading('Executions');
  });

  it('navigates to settings route', async () => {
    await driver.get(routeUrl('settings'));
    await findHeading('Settings');
  });

  it('creates a workflow and records create_workflow invoke', async () => {
    await driver.get(routeUrl('editor'));

    const nameInput = await driver.wait(
      until.elementLocated(By.xpath("//label[normalize-space()='Workflow name']/following::input[1]")),
      10000,
    );
    await nameInput.clear();
    await nameInput.sendKeys('WebDriver Created Workflow');

    const saveButton = await driver.findElement(
      By.css('button[aria-label="Save workflow (Cmd+S)"]'),
    );
    await saveButton.click();

    const createCalls = await driver.wait(async () => {
      return driver.executeScript(() => {
        const state = window.__E2E_STATE__;
        if (!state) return [];
        return state.invokeLog.filter((entry) => entry.cmd === 'create_workflow');
      });
    }, 10000);

    assert.ok(createCalls.length >= 1);
    const latestCreateCall = createCalls.at(-1);
    assert.equal(latestCreateCall?.args?.workflow?.name, 'WebDriver Created Workflow');
  });
});
