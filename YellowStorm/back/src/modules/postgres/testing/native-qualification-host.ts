import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

/** Opt-in, real native transport; credentials exist only in the child environment. */
export async function startNativeQualificationHost(apiUrl: string, internalToken: string) {
  if (process.env.POSTGRES_TEST_DB !== 'agentstore_test'
    || process.env.POSTGRES_TEST_DB === process.env.POSTGRES_DB) throw new Error('Isolated test database required');
  const database = new URL('postgresql://localhost/agentstore_test');
  database.hostname = process.env.POSTGRES_HOST!;
  database.port = process.env.POSTGRES_PORT || '5432';
  database.username = process.env.POSTGRES_USER!;
  database.password = process.env.POSTGRES_PASSWORD!;
  const key = randomBytes(32).toString('hex');
  const runtime = resolve(process.cwd(), '../../yellowstorm-adk');
  const child = spawn('conda', ['run', '--no-capture-output', '-n', 'meta', 'python',
    'tests/wp10/native_qualification_host.py'], { cwd: runtime, windowsHide: true,
    env: { ...process.env, PYTHONPATH: runtime, PYTHONUTF8: '1',
      ROOT_WORK_DATABASE_URL: database.toString(), ROOT_WORK_BACKGROUND_ENABLED: 'true',
      ROOT_WORK_LLM_CAPACITY_ENABLED: 'true', INTERNAL_SERVICE_SECRET: internalToken,
      GRPC_API_KEY: key, PLATFORM_API_URL: apiUrl } });
  // Do not expose native log output: settings/provider diagnostics may contain credentials.
  child.stderr.on('data', () => {});
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
    child.once('error', () => { clearTimeout(timeout); reject(new Error('Native qualification process could not start')); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Native qualification process exited before readiness')); });
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
