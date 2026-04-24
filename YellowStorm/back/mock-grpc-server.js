/**
 * Mock gRPC server for testing the conversation streaming flow.
 * Simulates an AI response by streaming component chunks with realistic
 * word-by-word delays mimicking actual LLM token generation.
 *
 * Proto format: Uses oneof for component types (text, code, reasoning, plan, queue, checkpoint, chart, task)
 *
 * Usage: node mock-grpc-server.js
 * Listens on: localhost:50051
 */

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { randomUUID } = require('crypto');
const path = require('path');

const PROTO_PATH = path.resolve(__dirname, 'src/modules/conversation/proto/chatbot.proto');
const PORT = '0.0.0.0:50051';

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
const chatbotPackage = protoDescriptor.chatbot;

/**
 * Splits text into word-level tokens, preserving whitespace and punctuation.
 */
function tokenize(text) {
  const tokens = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    current += char;
    if (char === ' ' || char === '\n' || i === text.length - 1) {
      tokens.push(current);
      current = '';
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/**
 * Splits code into token-level chunks (smaller than words for realistic code streaming).
 */
function tokenizeCode(code) {
  const tokens = [];
  let current = '';
  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    current += char;
    if (
      char === ' ' ||
      char === '\n' ||
      char === ';' ||
      char === '{' ||
      char === '}' ||
      char === '(' ||
      char === ')' ||
      char === ',' ||
      i === code.length - 1
    ) {
      tokens.push(current);
      current = '';
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/**
 * Builds chunks for a text component (streamed token by token).
 */
function buildTextChunks(componentId, tokens, options = {}) {
  const { delay = 4, metadata } = options;
  const chunks = [];

  tokens.forEach((token, i) => {
    chunks.push({
      delay: i === 0 ? delay * 3 : delay + Math.floor(Math.random() * 20),
      chunk: {
        action: i === 0 ? 'add' : 'update',
        component: {
          id: componentId,
          text: { content: token },
        },
        metadata,
      },
    });
  });

  return chunks;
}

/**
 * Builds chunks for a code component (streamed token by token).
 */
function buildCodeChunks(componentId, tokens, options = {}) {
  const { delay = 20, language = '', filename = '', metadata } = options;
  const chunks = [];

  tokens.forEach((token, i) => {
    chunks.push({
      delay: i === 0 ? delay * 3 : delay + Math.floor(Math.random() * 20),
      chunk: {
        action: i === 0 ? 'add' : 'update',
        component: {
          id: componentId,
          code: {
            content: token,
            language: i === 0 ? language : '',
            filename: i === 0 ? filename : '',
          },
        },
        metadata,
      },
    });
  });

  return chunks;
}

/**
 * Builds chunks for a reasoning component (streamed token by token).
 */
function buildReasoningChunks(componentId, tokens, options = {}) {
  const { delay = 3, metadata } = options;
  const chunks = [];

  tokens.forEach((token, i) => {
    chunks.push({
      delay: i === 0 ? delay * 3 : delay + Math.floor(Math.random() * 20),
      chunk: {
        action: i === 0 ? 'add' : 'update',
        component: {
          id: componentId,
          reasoning: { content: token },
        },
        metadata,
      },
    });
  });

  return chunks;
}

/**
 * Builds a single chunk for a queue component.
 * Queue arrives fully formed in one chunk.
 */
function buildQueueChunk(componentId, title, items, options = {}) {
  const { delay = 1, metadata } = options;
  return {
    delay,
    chunk: {
      action: 'add',
      component: {
        id: componentId,
        queue: {
          title,
          items: items.map((item) => ({
            id: item.id,
            title: item.title,
            status: item.status,
          })),
        },
      },
      metadata,
    },
  };
}

/**
 * TaskStatus enum values (must match proto enum)
 * PENDING = 0, IN_PROGRESS = 1, COMPLETED = 2, ERROR = 3
 */
const TaskStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  ERROR: 'ERROR',
};

/**
 * Builds a single chunk for a plan component.
 * Plan arrives fully formed in one chunk.
 * Status should be a TaskStatus enum value.
 */
function buildPlanChunk(componentId, title, description, steps, options = {}) {
  const { delay = 100, action = 'add', status = TaskStatus.IN_PROGRESS, metadata } = options;
  return {
    delay,
    chunk: {
      action,
      component: {
        id: componentId,
        plan: {
          title,
          description,
          steps,
          status,
        },
      },
      metadata,
    },
  };
}

/**
 * Builds a single chunk for a checkpoint component.
 */
function buildCheckpointChunk(componentId, label, options = {}) {
  const { delay = 100, metadata } = options;
  return {
    delay,
    chunk: {
      action: 'add',
      component: {
        id: componentId,
        checkpoint: { label },
      },
      metadata,
    },
  };
}

/**
 * Builds a single chunk for a task component.
 * Task arrives fully formed in one chunk.
 */
function buildTaskChunk(componentId, title, items, options = {}) {
  const { delay = 100, status = 'completed', metadata } = options;
  return {
    delay,
    chunk: {
      action: 'add',
      component: {
        id: componentId,
        task: {
          title,
          items: items.map((text) => ({ text })),
          status,
        },
      },
      metadata,
    },
  };
}

/**
 * Builds a single chunk for a chart component.
 * Charts are sent fully formed in one chunk.
 */
function buildChartChunk(componentId, chart, options = {}) {
  const { delay = 100, metadata } = options;

  // Map chart kind strings to enum values (matching proto enum)
  const kindMap = {
    bar: 'CHART_KIND_BAR',    // = 1
    line: 'CHART_KIND_LINE',    // = 2
    area: 'CHART_KIND_AREA',    // = 3
    pie: 'CHART_KIND_PIE',    // = 4
    scatter: 'CHART_KIND_SCATTER', // = 5
    composed: 'CHART_KIND_COMPOSED', // = 6
  };

  // Map layout strings to enum values (matching proto enum)
  const layoutMap = {
    horizontal: 'CHART_LAYOUT_HORIZONTAL', // = 1
    vertical: 'CHART_LAYOUT_VERTICAL',    // = 2
  };

  // Use enum string names for proto compatibility with enums: String setting
  const kindString = String(chart.kind || 'bar').toLowerCase();
  const kindValue = kindMap[kindString] ?? 'CHART_KIND_BAR';
  const layoutString = String(chart.layout || 'horizontal').toLowerCase();
  const layoutValue = layoutMap[layoutString] ?? 'CHART_LAYOUT_HORIZONTAL';

  return {
    delay,
    chunk: {
      action: 'add',
      component: {
        id: componentId,
        chart: {
          title: chart.title,
          data: JSON.stringify(chart.data ?? []),
          config: JSON.stringify(chart.config ?? {}),
          xAxisKey: chart.xAxisKey,
          series: JSON.stringify(chart.series ?? []),
          kind: kindValue,
          yAxisKey: chart.yAxisKey,
          stacked: !!chart.stacked,
          layout: layoutValue,
          innerRadius: chart.innerRadius ?? 0,
          showLegend: chart.showLegend ?? true,
          showGrid: chart.showGrid ?? true,
          nameKey: chart.nameKey || '',
          zAxisKey: chart.zAxisKey || '',
        },
      },
      metadata,
    },
  };
}

/**
 * Builds a single chunk for a sources component.
 * Sources arrive fully formed in one chunk.
 */
function buildSourcesChunk(componentId, sources, options = {}) {
  const { delay = 100, metadata } = options;
  return {
    delay,
    chunk: {
      action: 'add',
      component: {
        id: componentId,
        sources: {
          sources: sources.map((s) => ({
            title: s.title,
            url: s.url,
          })),
        },
      },
      metadata,
    },
  };
}

/**
 * Builds chunks for a sandbox component (Python code execution).
 * First chunk: code with output_available=false (executing state)
 * Second chunk: output/error with output_available=true (completed state)
 */
function buildSandboxChunks(componentId, code, output, options = {}) {
  const { delay = 100, error = '', executionDelay = 1500, metadata } = options;

  // First chunk: code being executed
  const addChunk = {
    delay,
    chunk: {
      action: 'add',
      component: {
        id: componentId,
        sandbox: {
          code,
          output: '',
          error: '',
          output_available: false,
        },
      },
      metadata,
    },
  };

  // Second chunk: execution result
  const updateChunk = {
    delay: executionDelay,
    chunk: {
      action: 'update',
      component: {
        id: componentId,
        sandbox: {
          code: '',
          output: error ? '' : output,
          error: error,
          output_available: true,
        },
      },
      metadata,
    },
  };

  return [addChunk, updateChunk];
}

/**
 * Builds a single chunk for a web preview component.
 * WebPreview arrives fully formed in one chunk with HTML content.
 */
function buildWebPreviewChunk(componentId, content, options = {}) {
  const { delay = 100, metadata } = options;
  return {
    delay,
    chunk: {
      action: 'add',
      component: {
        id: componentId,
        web_preview: {
          content,
        },
      },
      metadata,
    },
  };
}

/**
 * Builds a single chunk for an artifact component.
 * Artifact arrives fully formed in one chunk with file path and filename.
 */
function buildArtifactChunk(componentId, filePath, filename, options = {}) {
  const { delay = 100, metadata } = options;
  return {
    delay,
    chunk: {
      action: 'add',
      component: {
        id: componentId,
        artifact: {
          file_path: filePath,
          filename: filename,
        },
      },
      metadata,
    },
  };
}

/**
 * Builds a single chunk for a citation component.
 * Citation arrives fully formed in one chunk, referencing a parent text component.
 * Supports text_source and image_source via the oneof source_data field.
 */
function buildCitationChunk(componentId, parentId, sourceData, options = {}) {
  const { delay = 100, metadata } = options;

  const citation = { parent_id: parentId };

  if (sourceData.type === 'image') {
    citation.image_source = {
      type: 'image',
      path: sourceData.path || '',
      page: sourceData.page || '',
      file_name: sourceData.fileName || '',
      external_id: sourceData.externalId || '',
      workspace_id: sourceData.workspaceId || '',
      height: sourceData.height || '',
      width: sourceData.width || '',
    };
  } else {
    citation.text_source = {
      type: 'text',
      source: sourceData.source || '',
      external_id: sourceData.externalId || '',
      page: sourceData.page || '',
      page_content: sourceData.pageContent || '',
      workspace_id: sourceData.workspaceId || '',
    };
  }

  return {
    delay,
    chunk: {
      action: 'add',
      component: {
        id: componentId,
        citation,
      },
      metadata,
    },
  };
}

/**
 * Generates a random conversation name based on the user's query.
 * Returns a short, descriptive title for the conversation.
 */
function generateConversationName(call, callback) {
  const request = call.request;
  console.log(`[Mock gRPC] GenerateConversationName request:`, {
    query: request.query,
    model: request.model,
  });

  // Simulate some processing delay (500-1500ms)
  const delay = 500 + Math.random() * 1000;

  setTimeout(() => {
    // Generate a name based on the query
    const name = generateNameFromQuery(request.query);
    console.log(`[Mock gRPC] Generated name: "${name}"`);
    callback(null, { conversation_name: name });
  }, delay);
}

/**
 * Generates a conversation name from the user's query.
 * Extracts key topics or creates a summarized title.
 */
function generateNameFromQuery(query) {
  // List of prefixes for variety
  const prefixes = [
    'Discussion about',
    'Help with',
    'Question on',
    'Exploring',
    'Understanding',
    'Working on',
    'Learning about',
    'Debugging',
    'Building',
    'Implementing',
  ];

  // List of topic patterns to detect
  const topicPatterns = [
    { pattern: /fibonacci/i, topic: 'Fibonacci Implementation' },
    { pattern: /sort(ing)?/i, topic: 'Sorting Algorithms' },
    { pattern: /react/i, topic: 'React Development' },
    { pattern: /typescript|ts/i, topic: 'TypeScript Code' },
    { pattern: /javascript|js/i, topic: 'JavaScript Code' },
    { pattern: /python/i, topic: 'Python Programming' },
    { pattern: /api/i, topic: 'API Development' },
    { pattern: /database|sql|mongo/i, topic: 'Database Design' },
    { pattern: /test(ing)?/i, topic: 'Testing Strategy' },
    { pattern: /bug|fix|error/i, topic: 'Bug Fix' },
    { pattern: /auth(entication)?/i, topic: 'Authentication' },
    { pattern: /deploy/i, topic: 'Deployment' },
    { pattern: /css|style/i, topic: 'Styling' },
    { pattern: /performance|optimi/i, topic: 'Performance Optimization' },
  ];

  // Try to match a topic
  for (const { pattern, topic } of topicPatterns) {
    if (pattern.test(query)) {
      const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
      return `${prefix} ${topic}`;
    }
  }

  // Fallback: extract first few meaningful words
  const words = query
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 4);

  if (words.length > 0) {
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const topic = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    return `${prefix} ${topic}`;
  }

  // Ultimate fallback
  const randomTopics = [
    'New Chat Session',
    'Coding Assistance',
    'Technical Discussion',
    'Problem Solving',
    'Code Review',
  ];
  return randomTopics[Math.floor(Math.random() * randomTopics.length)];
}

/**
 * Simulates an AI response stream.
 * Streams reasoning, text, and code components word-by-word with realistic timing.
 * Queue and Plan arrive in single chunks.
 */
function runAgentTeam(call) {
  const request = call.request;
  console.log(`[Mock gRPC] Received request:`, {
    user_id: request.user_context?.user_id,
    conversation_id: request.conversation_id,
    query: request.query,
    agent_mode: request.agent_mode,
  });

  const reasoningId = randomUUID();
  const queueId = randomUUID();
  const planId = randomUUID();
  const taskId = randomUUID();
  const sandboxId = randomUUID();
  const sourcesId = randomUUID();
  const webPreviewId = randomUUID();
  const artifactId = randomUUID();
  const checkpoint1Id = randomUUID();
  const textId = randomUUID();
  const codeId = randomUUID();
  const checkpoint2Id = randomUUID();
  const text2Id = randomUUID();
  const citation1Id = randomUUID();
  const citation2Id = randomUUID();
  const citation3Id = randomUUID();
  const citation4Id = randomUUID();
  const chartLineId = randomUUID();
  const chartBarId = randomUUID();
  const chartAreaId = randomUUID();
  const chartPieId = randomUUID();
  const chartScatterId = randomUUID();
  const chartComposedId = randomUUID();

  const metadata = { message_id: randomUUID(), agent_id: 'agent-main' };

  // Log component IDs for debugging citation parent matching
  console.log(`[Mock gRPC] Component IDs:`);
  console.log(`  textId (main text):    ${textId}`);
  console.log(`  text2Id (follow-up):   ${text2Id}`);
  console.log(`  citation1Id → parent:  ${textId}  (main text)`);
  console.log(`  citation2Id → parent:  ${textId}  (main text)`);
  console.log(`  citation3Id → parent:  ${textId}  (main text)`);
  console.log(`  citation4Id → parent:  ${text2Id}  (follow-up)`);

  // --- Reasoning component (internal thought process) ---
  const reasoningText =
    `The user is asking about "${request.query}". ` +
    `Let me break this down step by step. ` +
    `First, I need to understand the core concept they're asking about. ` +
    `This seems to be related to implementing a function in JavaScript. ` +
    `I should provide a clear explanation with a practical code example. ` +
    `Let me think about the best approach - I'll use a recursive solution ` +
    `since it demonstrates the concept clearly and is easy to understand. `;

  const reasoningTokens = tokenize(reasoningText);
  const reasoningChunks = buildReasoningChunks(reasoningId, reasoningTokens, { metadata });

  // --- Queue component (arrives in one chunk) ---
  const queueItems = [
    { id: 'q1', title: 'Analyze the query', status: 'completed' },
    { id: 'q2', title: 'Research Fibonacci algorithms', status: 'completed' },
    { id: 'q3', title: 'Write implementation', status: 'active' },
    { id: 'q4', title: 'Add documentation', status: 'pending' },
    { id: 'q5', title: 'Provide performance tips', status: 'pending' },
  ];
  const queueChunk = buildQueueChunk(queueId, 'Task Progress', queueItems, { metadata });

  // --- Plan component (arrives in one chunk) ---
  const planStepTexts = [
    'Understand the mathematical definition of Fibonacci sequence',
    'Implement a recursive solution with memoization',
    'Implement an iterative solution for better performance',
    'Add TypeScript types and documentation',
    'Provide usage examples and performance comparison',
  ];

  const makePlanSteps = (completedCount, inProgressIndex = -1) =>
    planStepTexts.map((task, i) => ({
      task,
      agent: 'agent-main',
      status:
        i < completedCount
          ? TaskStatus.COMPLETED
          : i === inProgressIndex
            ? TaskStatus.IN_PROGRESS
            : TaskStatus.PENDING,
    }));

  // Initial plan: first 2 completed, 3rd in_progress
  const planChunk = buildPlanChunk(
    planId,
    'Implementation Plan',
    'Step-by-step approach to implement Fibonacci functions',
    makePlanSteps(2, 2),
    { status: TaskStatus.IN_PROGRESS, metadata },
  );

  // Plan updates: progress steps over time
  const planUpdate1 = buildPlanChunk(
    planId,
    'Implementation Plan',
    'Step-by-step approach to implement Fibonacci functions',
    makePlanSteps(3, 3),
    { action: 'update', delay: 1, status: TaskStatus.IN_PROGRESS, metadata },
  );
  const planUpdate2 = buildPlanChunk(
    planId,
    'Implementation Plan',
    'Step-by-step approach to implement Fibonacci functions',
    makePlanSteps(4, 4),
    { action: 'update', delay: 1, status: TaskStatus.IN_PROGRESS, metadata },
  );
  const planUpdate3 = buildPlanChunk(
    planId,
    'Implementation Plan',
    'Step-by-step approach to implement Fibonacci functions',
    makePlanSteps(5),
    { action: 'update', delay: 1, status: TaskStatus.COMPLETED, metadata },
  );

  // --- Task component (research results) ---
  const taskItems = [
    'Found 3 common Fibonacci implementations',
    'Recursive approach has O(2^n) without memoization',
    'Iterative approach is most memory efficient',
    'Matrix exponentiation achieves O(log n) for large n',
  ];
  const taskChunk = buildTaskChunk(taskId, 'Research Results', taskItems, {
    status: 'completed',
    metadata,
  });

  // --- Sources component (web sources used) ---
  const sourcesData = [
    {
      title: 'Wikipedia - Fibonacci number',
      url: 'https://en.wikipedia.org/wiki/Fibonacci_number',
    },
    {
      title: 'MDN Web Docs - Recursion',
      url: 'https://developer.mozilla.org/en-US/docs/Glossary/Recursion',
    },
    {
      title: 'GeeksforGeeks - Fibonacci Series',
      url: 'https://www.geeksforgeeks.org/program-for-nth-fibonacci-number/',
    },
  ];
  const sourcesChunk = buildSourcesChunk(sourcesId, sourcesData, { metadata });

  // --- Sandbox component (Python code execution) ---
  const sandboxCode = `# Calculate Fibonacci using Python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

# Calculate first 10 Fibonacci numbers
result = [fibonacci(i) for i in range(10)]
print(f"First 10 Fibonacci numbers: {result}")`;

  const sandboxOutput = `First 10 Fibonacci numbers: [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]`;
  const sandboxChunks = buildSandboxChunks(sandboxId, sandboxCode, sandboxOutput, {
    executionDelay: 2000,
    metadata,
  });

  // --- Checkpoint 1 ---
  const checkpoint1 = buildCheckpointChunk(checkpoint1Id, 'Starting Implementation', { metadata });

  // --- Text component (main explanation) ---
  const mainText =
    `Great question! Let me explain this with a clear example.\n\n` +
    `## Fibonacci Sequence\n\n` +
    `The Fibonacci sequence is a series of numbers where each number is the sum ` +
    `of the two preceding ones. It starts with 0 and 1, and the sequence goes: ` +
    `0, 1, 1, 2, 3, 5, 8, 13, 21, 34, and so on.\n\n` +
    `### Key Properties\n\n` +
    `- Each number is the sum of the previous two\n` +
    `- The ratio between consecutive numbers approaches the golden ratio (≈1.618)\n` +
    `- It appears frequently in nature, art, and computer science\n\n` +
    `Here's an implementation in TypeScript:\n\n`;

  const textTokens = tokenize(mainText);
  const textChunks = buildTextChunks(textId, textTokens, { metadata });

  // --- Code component ---
  const codeContent = `/**
 * Calculates the nth Fibonacci number using iteration.
 * Time complexity: O(n), Space complexity: O(1)
 */
function fibonacci(n: number): number {
  if (n <= 0) return 0;
  if (n === 1) return 1;

  let prev = 0;
  let curr = 1;

  for (let i = 2; i <= n; i++) {
    const next = prev + curr;
    prev = curr;
    curr = next;
  }

  return curr;
}

// Usage
console.log(fibonacci(10)); // 55`;

  const codeTokens = tokenizeCode(codeContent);
  const codeChunks = buildCodeChunks(codeId, codeTokens, {
    language: 'typescript',
    filename: 'fibonacci.ts',
    metadata,
  });

  // --- Checkpoint 2 ---
  const checkpoint2 = buildCheckpointChunk(checkpoint2Id, 'Implementation Complete', { metadata });

  // --- Second text component (follow-up) ---
  const followUpText =
    `\n\n### Summary\n\n` +
    `The iterative approach is efficient with O(n) time and O(1) space complexity. ` +
    `This makes it suitable for production use without risk of stack overflow.`;

  const followUpTokens = tokenize(followUpText);

  // --- Web Preview component (HTML/CSS/JS demo) ---
  const webPreviewContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Fibonacci Visualizer</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    h1 { color: white; margin-bottom: 20px; text-shadow: 0 2px 4px rgba(0,0,0,0.2); }
    .container {
      background: white;
      padding: 30px;
      border-radius: 16px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.2);
      max-width: 500px;
      width: 100%;
    }
    .input-group {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
    }
    input {
      flex: 1;
      padding: 12px 16px;
      border: 2px solid #e2e8f0;
      border-radius: 8px;
      font-size: 16px;
      transition: border-color 0.2s;
    }
    input:focus { outline: none; border-color: #667eea; }
    button {
      padding: 12px 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    button:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4); }
    .result {
      padding: 20px;
      background: #f7fafc;
      border-radius: 8px;
      font-size: 24px;
      font-weight: bold;
      text-align: center;
      color: #4a5568;
    }
    .sequence {
      margin-top: 15px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: center;
    }
    .sequence span {
      padding: 8px 12px;
      background: #edf2f7;
      border-radius: 6px;
      font-size: 14px;
      color: #667eea;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <h1>Fibonacci Calculator</h1>
  <div class="container">
    <div class="input-group">
      <input type="number" id="num" placeholder="Enter a number (1-40)" min="1" max="40" value="10">
      <button onclick="calculate()">Calculate</button>
    </div>
    <div class="result" id="result">F(10) = 55</div>
    <div class="sequence" id="sequence"></div>
  </div>
  <script>
    function fibonacci(n) {
      if (n <= 0) return 0;
      if (n === 1) return 1;
      let prev = 0, curr = 1;
      for (let i = 2; i <= n; i++) {
        [prev, curr] = [curr, prev + curr];
      }
      return curr;
    }
    function calculate() {
      const n = parseInt(document.getElementById('num').value) || 10;
      const result = fibonacci(n);
      document.getElementById('result').textContent = 'F(' + n + ') = ' + result;
      const seq = [];
      for (let i = 0; i <= Math.min(n, 15); i++) seq.push(fibonacci(i));
      document.getElementById('sequence').innerHTML = seq.map(x => '<span>' + x + '</span>').join('');
    }
    calculate();
  </script>
</body>
</html>`;

  const webPreviewChunk = buildWebPreviewChunk(webPreviewId, webPreviewContent, { metadata });

  // --- Artifact component (fake file path to test error handling) ---
  const artifactChunk = buildArtifactChunk(
    artifactId,
    'generated/fake-file-path-' + randomUUID() + '/fibonacci-report.pdf',
    'fibonacci-report.pdf',
    { metadata },
  );

  const chartLineChunk = buildChartChunk(
    chartLineId,
      {
        title: 'Revenue trend',
        data: [
          { month: 'Jan', revenue: 32 },
          { month: 'Feb', revenue: 48 },
          { month: 'Mar', revenue: 39 },
        ],
        config: { revenue: { label: 'Revenue', color: '#2563eb' } },
      xAxisKey: 'month',
      yAxisKey: 'revenue',
      series: [{ dataKey: 'revenue', label: 'Revenue' }],
      kind: 'line',
      showLegend: true,
      showGrid: true,
    },
    { metadata },
  );

  const chartBarChunk = buildChartChunk(
    chartBarId,
      {
        title: 'Task volume',
        data: [
          { label: 'Plan', value: 12 },
          { label: 'Review', value: 18 },
          { label: 'Ship', value: 8 },
        ],
        config: { value: { label: 'Value', color: '#16a34a' } },
      xAxisKey: 'label',
      yAxisKey: 'value',
      series: [{ dataKey: 'value', label: 'Value' }],
      kind: 'bar',
      layout: 'vertical',
      showLegend: true,
      showGrid: true,
    },
    { metadata },
  );

  const chartAreaChunk = buildChartChunk(
    chartAreaId,
      {
        title: 'Usage over time',
        data: [
          { month: 'Jan', usage: 14 },
          { month: 'Feb', usage: 27 },
          { month: 'Mar', usage: 21 },
        ],
        config: { usage: { label: 'Usage', color: '#a855f7' } },
      xAxisKey: 'month',
      yAxisKey: 'usage',
      series: [{ dataKey: 'usage', label: 'Usage' }],
      kind: 'area',
      showLegend: true,
      showGrid: true,
    },
    { metadata },
  );

  const chartPieChunk = buildChartChunk(
    chartPieId,
      {
        title: 'Traffic split',
        data: [
          { name: 'Desktop', value: 42, fill: '#f97316' },
          { name: 'Mobile', value: 58, fill: '#06b6d4' },
        ],
        config: { value: { label: 'Share', color: '#f97316' } },
      xAxisKey: 'name',
      nameKey: 'name',
      series: [{ dataKey: 'value', label: 'Share' }],
      kind: 'pie',
      innerRadius: 48,
      showLegend: true,
    },
    { metadata },
  );

  const chartScatterChunk = buildChartChunk(
    chartScatterId,
      {
        title: 'Correlation sample',
        data: [
          { x: 5, y: 12, z: 10 },
          { x: 12, y: 18, z: 22 },
          { x: 18, y: 9, z: 14 },
        ],
        config: { y: { label: 'Y', color: '#ef4444' } },
      xAxisKey: 'x',
      yAxisKey: 'y',
      zAxisKey: 'z',
      series: [{ dataKey: 'y', label: 'Series' }],
      kind: 'scatter',
      showLegend: true,
      showGrid: true,
    },
    { metadata },
  );

  const chartComposedChunk = buildChartChunk(
    chartComposedId,
      {
        title: 'Revenue vs Cost',
        data: [
          { month: 'Jan', revenue: 22, cost: 14, target: 24 },
          { month: 'Feb', revenue: 31, cost: 16, target: 28 },
          { month: 'Mar', revenue: 28, cost: 18, target: 30 },
        ],
        config: {
        revenue: { label: 'Revenue', color: '#0f766e' },
        cost: { label: 'Cost', color: '#dc2626' },
        target: { label: 'Target', color: '#f59e0b' },
      },
      xAxisKey: 'month',
      yAxisKey: 'value',
      series: [
        { dataKey: 'revenue', label: 'Revenue', kind: 'bar' },
        { dataKey: 'cost', label: 'Cost', kind: 'line' },
        { dataKey: 'target', label: 'Target', kind: 'area' },
      ],
      kind: 'composed',
      showLegend: true,
      showGrid: true,
    },
    { metadata },
  );

  const followUpChunks = buildTextChunks(text2Id, followUpTokens, { metadata });

  // --- Citation components (referencing the main text component) ---
  // Citation 1: text source referencing the main text paragraph (textId)
  const citationChunk1 = buildCitationChunk(
    citation1Id,
    textId,
    {
      type: 'text',
      source: 'fibonacci-algorithms.pdf',
      externalId: '698da6fde908e75891fd4637',
      page: 4,
      pageContent: 'For the Quarter Ended December 31, 2024 (In thousands of USD)',
      workspaceId: '698c8fcd9ce2bad9d9d44430',
    },
    { metadata },
  );

  // Citation 2: another text source on the same parent
  const citationChunk2 = buildCitationChunk(
    citation2Id,
    textId,
    {
      type: 'text',
      source: 'golden-ratio-nature.pdf',
      externalId: '6984d2a5646ac970f9daf229',
      page: 12,
      pageContent:
        'The ratio of consecutive Fibonacci numbers converges to the golden ratio phi = (1 + sqrt(5)) / 2 ≈ 1.6180339887.',
      workspaceId: '69808cec3e857958d636a31e',
    },
    { metadata },
  );

  // Citation 3: image source referencing the main text (textId)
  const citationChunk3 = buildCitationChunk(
    citation3Id,
    textId,
    {
      type: 'image',
      path: '/images/fibonacci-spiral.png',
      page: 1,
      fileName: 'fibonacci-spiral.png',
      externalId: '6984d2af646ac970f9daf247',
      workspaceId: '69808cec3e857958d636a31e',
      height: '400',
      width: '600',
    },
    { metadata },
  );

  // Citation 4: text source referencing the follow-up text (text2Id)
  const citationChunk4 = buildCitationChunk(
    citation4Id,
    text2Id,
    {
      type: 'text',
      source: 'algorithm-complexity.pdf',
      externalId: 'doc-ext-003',
      page: 12,
      pageContent:
        'The iterative Fibonacci implementation runs in O(n) time with O(1) auxiliary space, making it optimal for most practical applications.',
      workspaceId: '69808cec3e857958d636a31e',
    },
    { metadata },
  );

  // Combine all chunks in order
  const allChunks = [
    ...reasoningChunks,
    { delay: 2, chunk: null },
    queueChunk,
    { delay: 1, chunk: null },
    planChunk,
    { delay: 1, chunk: null },
    taskChunk,
    { delay: 2, chunk: null },
    planUpdate1,
    checkpoint1,
    { delay: 1, chunk: null },
    ...textChunks,
    citationChunk1,
    citationChunk2,
    citationChunk3,
    planUpdate2,
    ...codeChunks,
    { delay: 1, chunk: null },
    ...sandboxChunks,
    { delay: 1, chunk: null },
    webPreviewChunk,
    { delay: 1, chunk: null },
    artifactChunk,
    { delay: 1, chunk: null },
    chartLineChunk,
    chartBarChunk,
    chartAreaChunk,
    chartPieChunk,
    chartScatterChunk,
    chartComposedChunk,
    { delay: 1, chunk: null },
    planUpdate3,
    checkpoint2,
    { delay: 1, chunk: null },
    ...followUpChunks,
    { delay: 1, chunk: null },
    // Citations for the main text (textId) — 3 citations on one parent
    // Citation for follow-up text (text2Id) — 1 citation
    citationChunk4,
    { delay: 5, chunk: null },
    sourcesChunk,
  ];

  let index = 0;
  const totalChunks = allChunks.filter((c) => c.chunk).length;

  // Simulate token counts based on content length
  const totalInputTokens = Math.ceil(request.query.length / 4) + 50; // rough estimate
  const totalOutputTokens = Math.ceil(
    (reasoningText.length +
      mainText.length +
      codeContent.length +
      followUpText.length +
      sandboxCode.length +
      sandboxOutput.length +
      webPreviewContent.length) /
      4,
  );

  function sendNext() {
    if (index >= allChunks.length) {
      // Send a final usage-only chunk before ending
      call.write({
        action: '',
        usage: {
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
          total_tokens: totalInputTokens + totalOutputTokens,
          model: 'gpt-4.1',
        },
      });
      call.end();
      console.log(
        `[Mock gRPC] Stream completed (${totalChunks} chunks sent, usage: ${totalInputTokens}in/${totalOutputTokens}out)`,
      );
      return;
    }

    const { delay, chunk } = allChunks[index];
    index++;

    setTimeout(() => {
      if (chunk) {
        call.write(chunk);
        if (index % 20 === 0 || index === allChunks.length) {
          console.log(`[Mock gRPC] Progress: ${index}/${allChunks.length} chunks`);
        }
      }
      sendNext();
    }, delay);
  }

  console.log(`[Mock gRPC] Starting stream (${totalChunks} chunks to send)`);
  sendNext();
}

// Start the server
const server = new grpc.Server();
server.addService(chatbotPackage.ChatbotService.service, {
  RunAgentTeam: runAgentTeam,
  GenerateConversationName: generateConversationName,
});

server.bindAsync(PORT, grpc.ServerCredentials.createInsecure(), (err, port) => {
  if (err) {
    console.error('[Mock gRPC] Failed to start:', err);
    process.exit(1);
  }
  console.log(`[Mock gRPC] Server running on ${PORT}`);
  console.log('[Mock gRPC] Ready to accept streaming requests');
});
