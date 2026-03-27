# API MetaChatbot ADK

Multi-agent chatbot API with gRPC streaming support.

## Developer Setup Guide

### First Time Setup

When you first pull this repository, follow these steps to set up gRPC:

#### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

Make sure you have the required packages:
- `grpcio`
- `grpcio-tools`
- `protobuf`

#### 2. Generate gRPC Code from Proto Files

The gRPC Python files need to be generated from the `.proto` definitions:

```bash
bash grpc/regenerate_proto.sh
```

This will generate:
- `src/grpc_generated/chatbot_pb2.py` - Protobuf message classes
- `src/grpc_generated/chatbot_pb2_grpc.py` - gRPC service stubs

**Important:** You must run this script whenever you modify `grpc/proto/chatbot.proto`

#### 3. Start the Server

```bash
python main.py
```

The gRPC server will start on port `50051` by default.

### gRPC Services Available

**RunAgentTeam** - Streaming agent team execution
```protobuf
rpc RunAgentTeam(RunAgentTeamRequest) returns (stream StreamChunk);
```

**GenerateConversationName** - Generate conversation names
```protobuf
rpc GenerateConversationName(GenerateConversationNameRequest) returns (GenerateConversationNameResponse);
```

### Testing gRPC

You can test the gRPC endpoints using grpcurl (CLI tool):

```bash
grpcurl -plaintext localhost:50051 list
grpcurl -plaintext localhost:50051 chatbot.ChatbotService/RunAgentTeam
```

### Component Types Supported

The streaming API supports these component types:
- **text** - Text content
- **code** - Code blocks
- **reasoning** - Reasoning/thinking process
- **plan** - Execution plans with task status tracking
- **queue** - Task queues
- **checkpoint** - Progress checkpoints
- **chart** - Data visualizations
- **task** - Task lists
- **error** - Error messages
- **sources** - Web sources/references
- **sandbox** - Python code execution with output
- **web_preview** - HTML/CSS/JS previews
- **artifact** - Generated file artifacts

### Task Status Values

Plan components use these status values:
- `PENDING` (0) - Task not started yet (default)
- `IN_PROGRESS` (1) - Task currently being executed
- `COMPLETED` (2) - Task successfully completed
- `ERROR` (3) - Task failed with error

### Troubleshooting

**Proto generation fails:**
```bash
# Make sure you have grpcio-tools installed
pip install grpcio-tools

# Run regeneration script
bash grpc/regenerate_proto.sh
```

**gRPC import errors:**
```bash
# Regenerate proto files
bash grpc/regenerate_proto.sh

# Restart the server
python main.py
```

**Port already in use:**
```bash
# Check what's using port 50051
lsof -i :50051

# Kill the process or change the port in settings
```

### Contributing

1. Make changes to proto files in `grpc/proto/` if needed
2. Run `bash grpc/regenerate_proto.sh` to regenerate gRPC code
3. Test your changes
4. Commit both proto files and generated code

**Note:** Always commit the generated gRPC files (`chatbot_pb2.py` and `chatbot_pb2_grpc.py`) along with proto changes.
