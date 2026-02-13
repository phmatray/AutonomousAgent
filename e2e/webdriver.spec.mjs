import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = 'http://127.0.0.1:1420';

const mockWorkflow = {
  id: 'wf-123',
  name: 'Sample Workflow',
  description: 'End-to-end test workflow',
  nodes: [],
  edges: [],
  version: 1,
  createdAt: new Date('2026-02-13T10:00:00Z').toISOString(),
  updatedAt: new Date('2026-02-13T10:00:00Z').toISOString(),
};

let devServerProcess;
let driver;

async function waitForDevServer(timeoutMs = 20000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // Ignore while booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error('Vite dev server did not become ready for WebDriver tests.');
}

function routeUrl(route, options = {}) {
  const params = new URLSearchParams();
  params.set('e2e', String(Date.now()));

  if (options.state) params.set('e2e_state', JSON.stringify(options.state));
  if (options.failures) params.set('e2e_fail', JSON.stringify(options.failures));
  if (options.delays) params.set('e2e_delay', JSON.stringify(options.delays));

  return `${baseUrl}/?${params.toString()}#/${route}`;
}

async function openRoute(route, options = {}) {
  await driver.get(routeUrl(route, options));
}

async function findText(text, timeoutMs = 10000) {
  const locator = By.xpath(`//*[contains(normalize-space(), "${text}")]`);
  const el = await driver.wait(until.elementLocated(locator), timeoutMs);
  await driver.wait(until.elementIsVisible(el), timeoutMs);
  return el;
}

async function setState(patch) {
  await driver.executeScript((nextPatch) => {
    Object.assign(window.__E2E_STATE__, nextPatch);
  }, patch);
}

async function clearCommandFailure(command) {
  await driver.executeScript((commandName) => {
    delete window.__E2E_STATE__.commandFailures[commandName];
  }, command);
}

async function getInvokeCalls(command) {
  return driver.executeScript((commandName) => {
    return window.__E2E_STATE__.invokeLog.filter((entry) => entry.cmd === commandName);
  }, command);
}

async function waitForHashContains(fragment, timeoutMs = 10000) {
  await driver.wait(async () => {
    const url = await driver.getCurrentUrl();
    return url.includes(fragment);
  }, timeoutMs);
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
    if (driver) await driver.quit();
    if (devServerProcess && !devServerProcess.killed) {
      devServerProcess.kill('SIGTERM');
    }
  });

  it('dashboard: shows empty state and can open editor', async () => {
    await openRoute('dashboard');

    await findText('Workflows');
    await findText('No workflows yet');

    await driver.findElement(By.xpath("//button[normalize-space()='Create Workflow']")).click();
    await waitForHashContains('#/editor');

    const nameInput = await driver.findElement(By.css('input[aria-label="Workflow name"]'));
    assert.equal(await nameInput.getAttribute('value'), 'Untitled Workflow');
  });

  it('dashboard: renders workflows and opens selected workflow', async () => {
    await openRoute('dashboard', {
      state: { workflows: [mockWorkflow] },
    });

    await findText('Sample Workflow');
    await driver.findElement(By.css('article[aria-label="Workflow: Sample Workflow"]')).click();
    await waitForHashContains('#/editor?id=wf-123');

    const nameInput = await driver.findElement(By.css('input[aria-label="Workflow name"]'));
    assert.equal(await nameInput.getAttribute('value'), 'Sample Workflow');
  });

  it('dashboard: deletes workflow and issues delete_workflow invoke', async () => {
    await openRoute('dashboard', {
      state: { workflows: [mockWorkflow] },
    });

    await driver.findElement(By.css('button[aria-label="Delete workflow"]')).click();
    await driver.findElement(By.css('button[aria-label="Delete"]')).click();

    await driver.wait(async () => (await getInvokeCalls('delete_workflow')).length > 0, 10000);
    const deleteCalls = await getInvokeCalls('delete_workflow');
    assert.equal(deleteCalls[0]?.args?.id, 'wf-123');
  });

  it('dashboard: shows error state when list_workflows fails', async () => {
    await openRoute('dashboard', {
      failures: { list_workflows: 'Backend unavailable' },
    });

    await findText('Could not load workflows');
    await driver.findElement(By.xpath("//button[normalize-space()='Open Editor']")).click();
    await waitForHashContains('#/editor');
  });

  it('editor: saves workflow and updates URL with new id', async () => {
    await openRoute('editor');

    const nameInput = await driver.findElement(By.css('input[aria-label="Workflow name"]'));
    await nameInput.clear();
    await nameInput.sendKeys('E2E Saved Workflow');

    await driver.findElement(By.css('button[aria-label="Save workflow (Cmd+S)"]')).click();
    await waitForHashContains('#/editor?id=wf-created');

    const createCalls = await getInvokeCalls('create_workflow');
    assert.ok(createCalls.length >= 1);
    assert.equal(createCalls.at(-1)?.args?.workflow?.name, 'E2E Saved Workflow');
  });

  it('editor: executes saved workflow and navigates to monitoring', async () => {
    await openRoute('editor?id=wf-123', {
      state: { workflows: [mockWorkflow] },
    });

    await driver.findElement(By.css('button[aria-label="Execute workflow (Cmd+Enter)"]')).click();
    await waitForHashContains('#/monitoring?id=exec-');

    const executeCalls = await getInvokeCalls('execute_workflow');
    assert.equal(executeCalls.length, 1);
    assert.equal(executeCalls[0]?.args?.workflowId, 'wf-123');
    assert.equal(executeCalls[0]?.args?.triggerType, 'manual');
  });

  it('editor: creates then executes when executing a new workflow', async () => {
    await openRoute('editor');

    const nameInput = await driver.findElement(By.css('input[aria-label="Workflow name"]'));
    await nameInput.clear();
    await nameInput.sendKeys('Execute New Workflow');

    await driver.findElement(By.css('button[aria-label="Execute workflow (Cmd+Enter)"]')).click();
    await waitForHashContains('#/monitoring?id=exec-');

    const invokeLog = await driver.executeScript(() => window.__E2E_STATE__.invokeLog);
    const createIndex = invokeLog.findIndex((entry) => entry.cmd === 'create_workflow');
    const executeIndex = invokeLog.findIndex((entry) => entry.cmd === 'execute_workflow');

    assert.ok(createIndex >= 0);
    assert.ok(executeIndex > createIndex);
    assert.equal(invokeLog[createIndex]?.args?.workflow?.name, 'Execute New Workflow');
    assert.equal(invokeLog[executeIndex]?.args?.workflowId, 'wf-created');
  });

  it('editor: prevents duplicate execute requests while pending', async () => {
    await openRoute('editor?id=wf-123', {
      state: { workflows: [mockWorkflow] },
      delays: { execute_workflow: 500 },
    });

    const executeButton = await driver.findElement(By.css('button[aria-label="Execute workflow (Cmd+Enter)"]'));
    await driver.actions().doubleClick(executeButton).perform();

    await driver.wait(async () => (await getInvokeCalls('execute_workflow')).length > 0, 10000);
    await new Promise((resolve) => setTimeout(resolve, 700));

    const executeCalls = await getInvokeCalls('execute_workflow');
    assert.equal(executeCalls.length, 1);
  });

  it('editor: clears stale workflow when workflow id does not exist', async () => {
    await openRoute('editor?id=wf-123', {
      state: { workflows: [mockWorkflow] },
    });

    const nameInput = await driver.findElement(By.css('input[aria-label="Workflow name"]'));
    assert.equal(await nameInput.getAttribute('value'), 'Sample Workflow');

    await driver.executeScript(() => {
      window.location.hash = '#/editor?id=wf-missing';
    });

    await driver.wait(async () => {
      const input = await driver.findElement(By.css('input[aria-label="Workflow name"]'));
      return (await input.getAttribute('value')) === 'Untitled Workflow';
    }, 10000);
  });

  it('monitoring: shows empty state when there are no executions', async () => {
    await openRoute('monitoring');
    await findText('Executions');
    await findText('No executions yet');
  });

  it('monitoring: selects running execution and cancels it', async () => {
    await openRoute('monitoring', {
      state: {
        executions: [{
          id: 'exec-12345678',
          workflowId: 'wf-123',
          status: 'RUNNING',
          startedAt: new Date('2026-02-13T12:00:00Z').toISOString(),
        }],
      },
    });

    await driver.findElement(By.css('button[aria-label="Execution exec-123, status: RUNNING"]')).click();
    await findText('Execution: exec-1234567');

    await driver.findElement(By.css('button[aria-label="Cancel execution"]')).click();
    await driver.wait(async () => (await getInvokeCalls('cancel_execution')).length > 0, 10000);

    const cancelCalls = await getInvokeCalls('cancel_execution');
    assert.equal(cancelCalls[0]?.args?.executionId, 'exec-12345678');
  });

  it('monitoring: handles list execution errors and allows retry', async () => {
    await openRoute('monitoring', {
      failures: { list_executions: 'Backend unavailable' },
    });

    await findText('Could not load executions');

    await clearCommandFailure('list_executions');
    await driver.findElement(By.xpath("//button[normalize-space()='Retry']")).click();
    await findText('Select an execution to view logs');
  });

  it('monitoring: clears selected execution when it disappears', async () => {
    await openRoute('monitoring', {
      state: {
        executions: [{
          id: 'exec-12345678',
          workflowId: 'wf-123',
          status: 'RUNNING',
          startedAt: new Date('2026-02-13T12:00:00Z').toISOString(),
        }],
      },
    });

    await driver.findElement(By.css('button[aria-label="Execution exec-123, status: RUNNING"]')).click();
    await findText('Execution: exec-1234567');

    await setState({ executions: [] });
    await findText('Select an execution to view logs', 12000);
  });

  it('settings: toggles token visibility and saves token', async () => {
    await openRoute('settings');

    const tokenInput = await driver.findElement(By.css('input#github-token'));
    assert.equal(await tokenInput.getAttribute('type'), 'password');

    await driver.findElement(By.css('button[aria-label="Show token"]')).click();
    assert.equal(await tokenInput.getAttribute('type'), 'text');

    await tokenInput.sendKeys('ghp_example_token');
    await driver.findElement(By.xpath("//button[normalize-space()='Save Token']")).click();

    await findText('Token saved successfully');
    await findText('Connected as e2e-user');
    assert.equal(await tokenInput.getAttribute('type'), 'password');
  });

  it('settings: shows save error and auto-clears after timeout', async () => {
    await openRoute('settings', {
      failures: { authenticate_github: 'Invalid token' },
    });

    const tokenInput = await driver.findElement(By.css('input#github-token'));
    await tokenInput.sendKeys('ghp_bad_token');
    await driver.findElement(By.xpath("//button[normalize-space()='Save Token']")).click();

    await findText('Failed to save token');

    await driver.wait(async () => {
      const bodyText = await driver.findElement(By.css('body')).getText();
      return !bodyText.includes('Failed to save token');
    }, 5000);
  });

  it('settings: handles auth status check failure and retry', async () => {
    await openRoute('settings', {
      failures: { get_auth_status: 'Keyring unavailable' },
    });

    await findText('Could not verify authentication status');

    await clearCommandFailure('get_auth_status');
    await driver.findElement(By.xpath("//button[normalize-space()='Retry status check']")).click();
    await findText('Not authenticated');
  });
});
