const axios = require('axios');

async function test() {
    const url = 'http://127.0.0.1:8001/evaluation-batch/execute_agent_evaluator';
    const data = {
        agent: {
            name: "test",
            model: "gpt-4o",
            instruction: "You are a test assistant."
        },
        test_cases: [
            {
                input: { messages: [{ role: 'user', content: "coucou" }] },
                reference_output: { messages: [{ role: 'assistant', content: "bonjour" }] }
            }
        ],
        session_id: "test_" + Date.now(),
        user_id: "test_user_id",
        trajectory_match_mode: "strict",
        threshold: 0.7
    };

    console.log(`Sending request to ${url}...`);
    try {
        const response = await axios.post(url, data, {
            headers: {
                'Accept': 'text/event-stream',
                // Authorization: 'Bearer ...' // SKIP AUTH FOR TEST if possible, or use a known valid one
            },
            responseType: 'stream'
        });

        console.log(`Status: ${response.status}`);
        response.data.on('data', chunk => {
            console.log(`Received: ${chunk.toString()}`);
        });
        response.data.on('end', () => {
            console.log('Stream ended');
        });
    } catch (error) {
        console.error(`Error: ${error.message}`);
        if (error.response) {
            console.error(`Response data: ${JSON.stringify(error.response.data)}`);
        }
    }
}

test();
