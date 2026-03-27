#!/bin/bash

# Regenerate gRPC Python files from protobuf schema
# Run this script after modifying grpc/proto/chatbot.proto

echo "Regenerating gRPC Python files from protobuf schema..."
echo ""

# Navigate to project root (parent of grpc folder)
cd "$(dirname "$0")/.."

# Use the proper Python script
python grpc/generate_proto.py

echo ""
echo "⚠️  IMPORTANT: Restart your server for changes to take effect!"