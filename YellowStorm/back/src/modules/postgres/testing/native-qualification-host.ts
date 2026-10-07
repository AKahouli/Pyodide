import { execFile, execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const HOST_SCRIPT = 'tests/wp10/native_qualification_host.py';
const DIAGNOSTIC_TAIL = 8192;

/** Masks what a startup tail could echo back: URL passwords, API keys and bearer tokens. */
function redact(text: string): string {
  return text
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+):[^\s@/]+@/gi, '$1:***@')
    .replace(/\b(sk-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g, '$1***')
    .replace(/((?:api[-_]?key|access[-_]?token|secret|password|authorization)["'\s:=]+)[^\s"',}]+/gi, '$1***');
}

let condaMeta: boolean | undefined;

/** Whether the shared conda env the qualification was authored against is installed here. */
function condaMetaAvailable(): boolean {
  if (condaMeta !== undefined) return condaMeta;
  try {
    const listed = execFileSync('conda', ['env', 'list', '--json'], { encoding: 'utf8', timeout: 20_000 });
    condaMeta = (JSON.parse(listed) as { envs?: string[] }).envs?.some((path) => /[\\/]meta$/.test(path)) ?? false;
  } catch {
    condaMeta = false;
  }
  return condaMeta;
}

function onPath(command: string): boolean {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore', timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * The interpreter that can run the host: the conda `meta` env where it exists, else the repository
 * venv, else the interpreter CI provisions on PATH (GitHub runners ship conda without `meta`).
 */
function hostCommand(runtime: string): { command: string; args: string[] } {
  if (condaMetaAvailable()) {
    return { command: 'conda', args: ['run', '--no-capture-output', '-n', 'meta', 'python', HOST_SCRIPT] };
  }
  const venv = process.platform === 'win32'
    ? resolve(runtime, '.venv', 'Scripts', 'python.exe')
    : resolve(runtime, '.venv', 'bin', 'python');
  if (existsSync(venv)) return { command: venv, args: [HOST_SCRIPT] };
  for (const command of ['python3', 'python']) if (onPath(command)) return { command, args: [HOST_SCRIPT] };
  throw new Error('No Python runtime for the native qualification host (expected conda env "meta", yellowstorm-adk/.venv, or python3 on PATH)');
}

/** Opt-in, real native transport; credentials exist only in the child environment. */
export async function startNativeQualificationHost(apiUrl: string, internalToken: string, enabled = true, waitFixture = false) {
  if (process.env.POSTGRES_TEST_DB !== 'agentstore_test'
    || process.env.POSTGRES_TEST_DB === process.env.POSTGRES_DB) throw new Error('Isolated test database required');
  const database = new URL('postgresql://localhost/agentstore_test');
  database.hostname = process.env.POSTGRES_HOST!;
  database.port = process.env.POSTGRES_PORT || '5432';
  database.username = process.env.POSTGRES_USER!;
  database.password = process.env.POSTGRES_PASSWORD!;
  const key = randomBytes(32).toString('hex');
  const runtime = resolve(process.cwd(), '../../yellowstorm-adk');
  const { command, args } = hostCommand(runtime);
  const child = spawn(command, args, { cwd: runtime, windowsHide: true,
    env: { ...process.env, PYTHONPATH: runtime, PYTHONUTF8: '1',
      ROOT_WORK_DATABASE_URL: database.toString(), ROOT_WORK_BACKGROUND_ENABLED: String(enabled),
      ROOT_WORK_LLM_CAPACITY_ENABLED: String(enabled), INTERNAL_SERVICE_SECRET: internalToken,
      GRPC_API_KEY: key, PLATFORM_API_URL: apiUrl, VECTOR_NATIVE_WAIT_FIXTURE: String(waitFixture),
      // The host imports the ADK app, which builds Settings (middleware → get_settings) at import
      // time. CI ships no yellowstorm-adk/.env, so supply non-secret placeholders for the required
      // fields; the qualification fixture never reaches Azure, Redis or LiteLLM.
      AZURE_DATALAKE_CONNECTION_STRING: 'DefaultEndpointsProtocol=https;AccountName=qualification;AccountKey=placeholder;EndpointSuffix=core.windows.net',
      AZURE_DATALAKE_FILE_SYSTEM_NAME: 'qualification',
      DATABASE_URL: database.toString().replace('postgresql://', 'postgresql+asyncpg://'),
      LINKUP_API_KEY: 'qualification-placeholder',
      WEB_SEARCH_PROMPT: 'qualification-placeholder',
      API_URL: apiUrl,
      LITELLM_API_BASE_URL: 'http://127.0.0.1:4000',
      LITELLM_API_SECRET_KEY: 'qualification-placeholder',
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: '6379',
      ADK_API_KEY: 'qualification-placeholder',
      VECTORSTORE_API_KEY: 'qualification-placeholder',
      EMBEDDING_MODEL: 'text-embedding-3-small' } });
  // Native logs are not echoed while it runs: settings/provider diagnostics may contain credentials.
  // The tail is kept, redacted, for the startup-failure rejection below so the real reason is visible.
  let stderrTail = '';
  child.stderr.on('data', (chunk: Buffer) => { stderrTail = (stderrTail + chunk.toString()).slice(-DIAGNOSTIC_TAIL); });
  const diagnostics: unknown[] = [];
  let diagnosticOutput = '';
  child.stdout.on('data', (chunk: Buffer) => {
    diagnosticOutput += chunk.toString();
    const lines = diagnosticOutput.split('\n'); diagnosticOutput = lines.pop()!.slice(-8192);
    for (const line of lines) if (line.startsWith('VECTOR_NATIVE_DIAGNOSTIC ')) {
      diagnostics.push(JSON.parse(line.slice('VECTOR_NATIVE_DIAGNOSTIC '.length)));
    }
  });
  const exited = new Promise<void>((done) => { child.once('exit', () => done()); child.once('error', () => done()); });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.stdin.end('\n');
    const finished = await Promise.race([exited.then(() => true),
      new Promise<boolean>((done) => { const timeout = setTimeout(() => done(false), 20000); timeout.unref(); })]);
    if (finished) return;
    if (process.platform === 'win32' && child.pid) {
      await new Promise<void>((done, reject) => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true }, (error) => error && child.exitCode === null ? reject(new Error('Qualification child cleanup failed')) : done()));
    } else child.kill('SIGKILL');
    await exited;
  };
  try {
  const port = await new Promise<number>((resolvePort, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Native qualification startup timed out')), 60000);
    child.once('error', (error: Error) => { clearTimeout(timeout); reject(new Error(`Native qualification process could not start (${command}: ${error.message})`)); });
    child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timeout);
      const tail = redact(stderrTail).trim();
      reject(new Error(`Native qualification process exited before readiness (exit code ${code ?? 'null'}${signal ? `, signal ${signal}` : ''})`
        + (tail ? `\n--- native stderr (tail) ---\n${tail}` : '')));
    });
    child.stdout.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8192);
      const match = output.match(/VECTOR_NATIVE_READY (\{"port":\s*\d+\})/);
      if (match) { clearTimeout(timeout); resolvePort((JSON.parse(match[1]) as { port: number }).port); }
    });
  });
  const definition = protoLoader.loadSync(resolve(process.cwd(), 'src/modules/conversation/proto/chatbot.proto'),
    { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
  const descriptor = grpc.loadPackageDefinition(definition).chatbot as grpc.GrpcObject;
  const Constructor = descriptor.ChatbotService as grpc.ServiceClientConstructor;
  const client = new Constructor(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  const metadata = new grpc.Metadata(); metadata.set('x-api-key', key);
  return { client, key, metadata, diagnostics, async close() {
    client.close();
    await stop();
  } };
  } catch (error) { await stop(); throw error; }
}
