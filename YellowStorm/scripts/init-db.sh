#!/bin/bash
# ============================================================
# YellowStorm MongoDB Initialization Script
# ============================================================
# Usage:
#   ./scripts/init-db.sh                    # Default: mongodb://localhost:27017/yellostorm
#   MONGO_URI="mongodb://user:pass@host:27017" ./scripts/init-db.sh
#   DB_NAME="custom_db" ./scripts/init-db.sh
#
# Options:
#   --drop    Drop existing database before initialization (WARNING: destroys all data!)
#   --help    Show this help message
# ============================================================

set -e

# Configuration
MONGO_URI="${MONGO_URI:-mongodb://localhost:27017}"
DB_NAME="${DB_NAME:-yellostorm}"
DROP_DB=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --drop)
      DROP_DB=true
      shift
      ;;
    --help)
      echo "YellowStorm MongoDB Initialization Script"
      echo ""
      echo "Usage:"
      echo "  ./scripts/init-db.sh                    # Initialize with defaults"
      echo "  ./scripts/init-db.sh --drop             # Drop and reinitialize (destroys data!)"
      echo ""
      echo "Environment Variables:"
      echo "  MONGO_URI   MongoDB connection URI (default: mongodb://localhost:27017)"
      echo "  DB_NAME     Database name (default: yellostorm)"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

echo "🔧 YellowStorm MongoDB Initialization"
echo "   URI: $MONGO_URI"
echo "   Database: $DB_NAME"
echo "   Drop existing: $DROP_DB"
echo ""

# Check if mongosh or mongo is available
if command -v mongosh &> /dev/null; then
  MONGO_CMD="mongosh"
elif command -v mongo &> /dev/null; then
  MONGO_CMD="mongo"
else
  echo "❌ MongoDB shell not found. Please install mongosh or mongo."
  exit 1
fi

# Drop database if requested
if [ "$DROP_DB" = true ]; then
  echo "⚠️  Dropping existing database..."
  $MONGO_CMD "$MONGO_URI/$DB_NAME" --quiet --eval "db.dropDatabase()"
  echo "   Database dropped"
fi

# Run initialization script
echo "📦 Running initialization script..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
$MONGO_CMD "$MONGO_URI/$DB_NAME" "$SCRIPT_DIR/init-mongodb.js"

echo ""
echo "✅ Database initialization complete!"
